# Titan inbox on the dashboard

**Date:** 2026-10-14
**Status:** Approved — ready for implementation plan

## Problem

The shop's mail lives in Titan Email (Hostinger), mailbox `info@blindsnisa.com`.
Customer inquiries, supplier notices and everything else arrive there, and none
of it is visible in measure-blinds. Staff have to switch to Titan webmail and
mentally connect each conversation to a customer or order.

## Goal

Pull new mail from Titan's INBOX **and Sent** folders into the app, group it into
**conversations** the way mail apps do, sort each conversation into a category
with staff-editable filter rules, and show it on an **Inbox** page as a
chat-style **bubble thread**: the other party on the left, `info@blindsnisa.com`
on the right, with quoted history trimmed off each message. Staff can link a
conversation to a customer/order and mark it handled.

## Revisions made while planning (2026-10-21)

These override the sections below where they disagree.

- **IMAP client:** spike done. A Worker reached `imap.titan.email:993` over
  `cloudflare:sockets` with TLS and got `IMAP4rev1 AUTH=PLAIN SASL-IR ID LITERAL-`.
  No `imapflow`; a small in-house client (`AUTHENTICATE PLAIN` with SASL-IR,
  `LIST`, `EXAMINE`, `UID SEARCH`, `UID FETCH`, `LOGOUT`). Titan does not
  advertise SPECIAL-USE before login, so the Sent folder is found by `\Sent`
  flag if present, else by name.
- **Message size:** each message is fetched as `BODY.PEEK[]<0.5000000>` (first
  5 MB). Bodies and headers come first in practice; the attachment list of a
  bigger message can be incomplete.
- **HTML:** no DOM-based quote removal. When a message has no text part, its HTML
  is converted to text with `<blockquote>` content prefixed by `>`, and the
  same text-based trimming applies.
- **Direction:** `out` when the folder is Sent **or** the sender is the mailbox.
- **Columns renamed:** `email_messages.references` → `reference_ids` (`references`
  is reserved in SQL); `email_rules.match` → `match_type`.
- **Policies:** the four tables follow migration 43's pattern
  (`authenticated_full_access`, nothing for anon), not "no policies".
- **Thread summary + merge** run as SQL functions `refresh_email_thread` and
  `merge_email_threads`, called via RPC. `refresh_email_thread` deletes a thread
  left with no messages.
- **HTTP verbs:** updates are `PUT` (no route in this API uses PATCH and CORS does
  not allow it). Rule order is set with `POST /api/inbox/rules/reorder { ids }`.
- **Linking:** linking an order also sets the thread's customer to that order's
  customer; changing or clearing the customer clears the order.
- **Errors:** an unparseable message is stored as an "(unreadable message)"
  bubble in its own Other thread. A database error on a message leaves that
  folder's cursor just before it, so it and everything after it are retried
  next run (duplicates are skipped).
- **Web tests:** the web app has no DOM test setup, so web tests cover the pure
  helpers (`inboxText.ts`) rather than rendering components.

## Non-goals (v1)

- Replying from the app. Replies are written in Titan webmail and show up here
  through the Sent folder.
- Two-way sync. The app never changes Titan's read/unread state, never moves or
  deletes mail.
- App-sent mail (estimates, invoices, reminders via Resend from
  `estimates@blindsnisa.com`). It never reaches Titan's Sent folder and is **not**
  shown. A customer's reply to it lands in INBOX and threads by subject where it can.
- Attachments. Only attachment names and sizes are stored; staff open Titan for
  the files themselves.
- Backfill. Only mail that arrives after the first sync run is imported.
- Rendering email HTML. Bubbles show plain text (see Display).
- Unread badges or counts in the sidebar.
- Sieve. Titan exposes no Sieve or ManageSieve; rules are a simple table edited in
  Settings instead.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | How mail reaches the app | **IMAP polling** from the `blinds-nisa-api` Worker, folders INBOX + Sent. DNS stays at Hostinger. |
| D2 | Where filter rules live | `email_rules` table, edited in a Settings card. |
| D3 | Unmatched mail | Category **Other**. A rule with action **Ignore** means that conversation is never created. |
| D4 | Categories | Fixed set: `inquiry`, `supplier`, `payment`, `other`. Labels: Inquiry, Supplier, Payment, Other. |
| D5 | Attachments / history | Metadata only; start from "now". |
| D6 | Unit of the dashboard | The **conversation** (thread). Category, links and status live on the thread. |
| D7 | Display | Bubble thread, plain text, quoted history trimmed, hidden "···" reveal. |
| D8 | App (Resend) mail | Not shown. Titan mail only. |

## Architecture

```
Titan INBOX + Sent ──IMAP/TLS :993──▶ blinds-nisa-api Worker (cron */5)
                                        │ parse → trim quotes → thread → rules → customer link
                                        ▼
                Supabase: email_threads, email_messages, email_rules, email_sync_state
                                        ▼
                GET /api/inbox ──▶ web /inbox (thread list) ──▶ /inbox/:threadId (bubbles)
```

Same stack as the rest of the app: SPA → Worker API → Supabase. All data access
goes through the Worker; no anon RLS policy on the new tables.

Module layout under `apps/api/src/lib/inbox/`, one responsibility each:

| File | Responsibility |
|------|----------------|
| `imap.ts` | `ImapSource` implementation (the only file that touches sockets). |
| `parse.ts` | Raw bytes → `ParsedMessage` (postal-mime). |
| `quoteTrim.ts` | Full text/HTML → the new reply text only. Pure. |
| `threading.ts` | Subject normalisation + "which thread does this message join". Pure decision over lookup results. |
| `rules.ts` | `classify(counterpart, subject, body, rules)`. Pure. |
| `sync.ts` | Orchestration: cursors, fetch, per-message pipeline, persistence. |

## Sync

- **Trigger:** new cron `*/5 * * * *` in `apps/api/wrangler.toml`. The existing
  `scheduled()` handler in `index.ts` dispatches that cron to
  `runInboxSync(env)` in `lib/inbox/sync.ts`. `index.ts` gains only the dispatch
  branch.
- **Folders:** `INBOX`, plus the Sent folder found with `LIST` by its `\Sent`
  special-use attribute (fallback names: `Sent`, `Sent Items`, `Sent Messages`,
  `INBOX.Sent`). The resolved name is stored in the folder's sync-state row.
  If no Sent folder is found, sync continues with INBOX only and records the
  error for the Settings status line.
- **IMAP access is read-only:** `EXAMINE` (not `SELECT`) and
  `UID FETCH … BODY.PEEK[]`. Spam/Junk/Trash are never opened.
- **Cursor, per folder:** `email_sync_state` has one row per folder role
  (`inbox`, `sent`): `folder_name`, `uid_validity`, `last_uid`, `last_run_at`,
  `last_success_at`, `last_error`.
  - First run for a folder (no row): record its current `UIDVALIDITY` and highest
    UID (`UIDNEXT - 1`), import nothing.
  - Normal run: `UID SEARCH UID <last_uid+1>:*`, fetch at most **50** messages per
    folder in ascending UID order.
  - `UIDVALIDITY` changed: reset that folder's cursor to its current highest UID,
    import nothing. Log it.
- **Order of processing:** the new messages from both folders are merged and
  processed in ascending `Date` order, so in the normal case a parent is stored
  before its reply. Threading still handles out-of-order arrival (below).
- **Direction:** `out` when `from_address` = the mailbox address
  (`TITAN_IMAP_USER`, lower-cased), else `in`, regardless of the folder.
- **Dedupe:** `email_messages.message_id` is UNIQUE. A message seen in both
  folders (e.g. sent to self) is stored once. A 23505 on insert counts as "already
  imported". Messages without a `Message-ID` header use
  `uid:<folder>:<uid_validity>:<uid>`.
- **IMAP client boundary:** one interface used by `sync.ts`:
  `ImapSource.listSentFolder()`, `ImapSource.fetchSince(folder, lastUid, limit) →
  { uidValidity, highestUid, messages: { uid, raw: Uint8Array }[] }`. The first
  plan task is a spike: does `imapflow` run under `nodejs_compat` in workerd? If
  yes, `imap.ts` wraps it. If not, `imap.ts` is a minimal client on
  `cloudflare:sockets` `connect()` with `secureTransport: "on"` that speaks only
  `LOGIN`, `LIST`, `EXAMINE`, `UID SEARCH`, `UID FETCH`, `LOGOUT`. Tests use a
  fake `ImapSource`.
- **Secrets:** `TITAN_IMAP_USER`, `TITAN_IMAP_PASSWORD` (`wrangler secret put`,
  `.dev.vars` locally). `[vars]`: `TITAN_IMAP_HOST = "imap.titan.email"`,
  `TITAN_IMAP_PORT = "993"`. Missing secrets: sync logs once and returns.

## Parsing (`parse.ts`)

`postal-mime` turns raw bytes into: `message_id`, `in_reply_to`, `references`
(array of ids, angle brackets stripped), `sent_at` (Date header, falling back to
fetch time), `from_address` (lower-cased), `from_name`, `to_addresses`,
`cc_addresses` (lower-cased arrays), `subject`, `text_body`, `html_body`,
`attachments` (`[{ filename, mime_type, size }]`).

- When there is no text part, `text_body` is derived from the HTML by stripping
  tags (after the HTML quote-stripping step in `quoteTrim.ts`).
- `text_body` is truncated to 200 KB. `html_body` is **not stored**: it's only used
  during import to produce the text.
- A message that fails to parse is still stored as a bubble reading
  `(this message could not be read — open it in Titan)`, in its own new thread
  with category `other`, so one bad message never blocks the cursor.

## Quote trimming (`quoteTrim.ts`)

Produces `reply_text` (shown in the bubble) from the message; `text_body` keeps
the full text for the "···" reveal.

1. **HTML first** (when an HTML part exists): drop well-known quote containers
   before converting to text: `div.gmail_quote`, `blockquote[type=cite]`,
   Outlook `#divRplyFwdMsg` and everything after it, `#appendonsend`,
   Apple/Yahoo `blockquote` quote wrappers.
2. **Then text**: cut at the first line matching any of:
   - `On … wrote:` (also when wrapped across two lines)
   - `… said:` (including `info@blindsnisa.com said:`)
   - `-----Original Message-----`
   - (`---------- Forwarded message ----------` is deliberately **not** a cut
     point: in a forward, the forwarded part is the content.)
   - an Outlook header block: a `From:` line followed within 4 lines by `Sent:`
     or `Date:` and `Subject:`
   - the start of a run of lines beginning with `>`
3. Trim trailing whitespace and a trailing lone `--` signature separator line.
4. **Safety:** if the result is empty (e.g. a top-posted reply with nothing
   recognisable, or a pattern ate everything), `reply_text` = the full text.

The pattern list lives in one exported array. During implementation, real replies
from the Titan mailbox (sent from Titan webmail, Gmail, Outlook, iPhone Mail) are
saved as anonymised fixtures so the patterns match Titan's actual quote header.

## Threading (`threading.ts`)

A new message joins a thread, in this order of preference:

1. **Header match:** any stored message whose `message_id` is in this message's
   `in_reply_to` ∪ `references` → join that message's thread.
2. **Reverse header match (out-of-order):** any stored message whose
   `in_reply_to`/`references` contain this message's `message_id` → join that
   thread.
3. **Subject fallback:** a thread with the same normalised subject and the same
   counterpart address whose `last_message_at` is within the last 60 days → join
   the most recent one. Normalised subject = lower-cased, prefixes repeatedly
   stripped (`re:`, `fw:`, `fwd:`, `aw:`, `sv:`, `ré:`, with `[n]` counters), and
   whitespace collapsed.
4. Otherwise a **new thread**.

If steps 1 and 2 point at two different threads, the message joins the older
thread and the newer thread's messages move into it (merge); the emptied thread
row is deleted.

**Counterpart** (the "other party" of a message): for `in`, `from_address`; for
`out`, the first of `to_addresses` that is not the mailbox address (falling back
to the first CC). A new thread takes its counterpart, name and subject from the
message that creates it.

## Rules (`rules.ts`)

Pure function, no I/O:
`classify({ counterpart, subject, body }, rules) → { action: 'category', category } | { action: 'ignore' }`.

- `email_rules` columns: `id`, `position` (int, ascending), `field`
  (`address` | `domain` | `subject` | `body`), `match`
  (`contains` | `equals` | `ends_with`), `value` (text, 1–200 chars), `action`
  (`inquiry` | `supplier` | `payment` | `other` | `ignore`), `enabled` (bool),
  `created_at`, `updated_at`.
- `address`/`domain` match the **counterpart**, not the raw From. So a
  conversation staff start with a supplier classifies the same as one the
  supplier starts.
- Case-insensitive; value trimmed. `domain` = the part after `@`. `body` checks
  the new message's `reply_text`.
- Enabled rules in `position` order; first match wins; no match → `other`.
- **When rules run:** only when a message would **create a new thread**. A
  message that joins an existing thread inherits its category.
  - `ignore` → nothing is stored for that message (no thread, no message row).
    Later messages in that conversation have nothing to join and are classified
    afresh, so they're ignored too while the rule stands.
- **Customer link (independent of rules):** when a thread is created, if exactly
  one customer has `lower(email) = counterpart` (non-empty), set the thread's
  `customer_id`. Zero or several matches → null.
- **Re-apply:** `POST /api/inbox/rules/reapply` re-classifies every thread whose
  `category_locked` is false, using its first message. Threads a rule now ignores
  get category `other` rather than being deleted.

## Thread status

- `status`: `new` | `handled`.
- An incoming (`in`) message joining a `handled` thread sets it back to `new` and
  clears `handled_at`. Outgoing (`out`) messages never change status.
- Thread summary fields are updated on every insert: `last_message_at`,
  `last_direction`, `last_snippet` (first 140 chars of `reply_text`),
  `message_count`.

## Data (migration 45)

`supabase/migrations/20261014000045_inbox.sql`. The lead-capture plan also
claimed 44, which Sheer took, so whichever of leads/inbox ships second takes the
next free number.

- `email_threads`: `id uuid pk`, `subject text not null default ''`,
  `normalized_subject text not null default ''`, `counterpart_address text not
  null`, `counterpart_name text not null default ''`, `category text not null
  check (category in ('inquiry','supplier','payment','other'))`,
  `category_locked boolean not null default false`, `customer_id uuid null
  references customers(id) on delete set null`, `order_id uuid null references
  orders(id) on delete set null`, `status text not null default 'new' check
  (status in ('new','handled'))`, `handled_at timestamptz null`,
  `last_message_at timestamptz not null`, `last_direction text not null check
  (last_direction in ('in','out'))`, `last_snippet text not null default ''`,
  `message_count int not null default 0`, `created_at timestamptz not null
  default now()`.
  Indexes: `(category, status, last_message_at desc)`;
  `(counterpart_address, normalized_subject, last_message_at desc)`.
- `email_messages`: `id uuid pk`, `thread_id uuid not null references
  email_threads(id) on delete cascade`, `message_id text unique not null`,
  `in_reply_to text null`, `references text[] not null default '{}'`, `direction
  text not null check (direction in ('in','out'))`, `folder text not null check
  (folder in ('inbox','sent'))`, `imap_uid bigint`, `uid_validity bigint`,
  `sent_at timestamptz not null`, `from_address text not null`, `from_name text
  not null default ''`, `to_addresses text[] not null default '{}'`,
  `cc_addresses text[] not null default '{}'`, `subject text not null default
  ''`, `text_body text not null default ''`, `reply_text text not null default
  ''`, `attachments jsonb not null default '[]'`, `created_at timestamptz not
  null default now()`.
  Indexes: `(thread_id, sent_at)`; GIN on `references`; btree on `in_reply_to`.
- `email_rules` as above; `check` constraints on `field`, `match`, `action`.
- `email_sync_state`: `folder text pk check (folder in ('inbox','sent'))` plus
  the cursor columns above.
- RLS enabled on all four, no policies (service role only). Same pattern as
  `notifications`.

## API (`apps/api/src/routes/inbox.ts`, mounted at `/api/inbox`, JWT-protected)

Literal routes registered before `/:threadId` (locked Hono pattern), and
`/rules/reapply` before `/rules/:ruleId`. Every body schema is `.strict()`.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/rules` | List rules ordered by `position`. |
| POST | `/rules` | Create a rule (appended at the end). |
| POST | `/rules/reapply` | Re-classify unlocked threads. Returns a count. |
| PATCH | `/rules/:ruleId` | Edit `field`/`match`/`value`/`action`/`enabled`/`position`. |
| DELETE | `/rules/:ruleId` | Delete a rule. |
| GET | `/status` | Per-folder `last_success_at`, `last_error` for the Settings card. |
| GET | `/` | `?category=&status=&page=` → threads, 15 per page, by `last_message_at` desc, summary fields + linked customer name. |
| GET | `/:threadId` | Thread + all messages oldest first (`direction`, `from_name`, `from_address`, `sent_at`, `reply_text`, `text_body`, `attachments`) + linked customer/order summary. |
| PATCH | `/:threadId` | `category` (sets `category_locked`), `customer_id`, `order_id`, `status` (`handled` sets `handled_at`, `new` clears it). |

## Web (`apps/web/src/pages/inbox/`)

- Sidebar: **Inbox** item (envelope icon) next to Notifications.
- **`/inbox` — thread list:** category tabs (Inquiry, Supplier, Payment, Other)
  and a New/Handled toggle in the URL (`?category=&status=&page=`). Each row:
  counterpart name (or address), subject, `last_snippet` prefixed with "You: "
  when `last_direction = out`, relative time, message-count pill when > 1,
  customer chip when linked. Bottom pager, same as Notifications.
- **`/inbox/:threadId` — bubble thread:**
  - Header: subject, counterpart, category select, customer link (existing
    customer search), order link (that customer's orders), Mark handled / Mark
    new.
  - Messages oldest → newest. `in` = left bubble (neutral surface), `out` = right
    bubble (brand-tinted), each with sender name and time. Sender name is always
    shown on left bubbles so multiple outside participants are distinguishable.
  - Bubble body = `reply_text` as plain text: `white-space: pre-wrap`, URLs
    turned into links (`rel="noopener noreferrer" target="_blank"`), no HTML
    rendered. React's text escaping is the only rendering path.
  - When `text_body` is longer than `reply_text`, a small "···" button under
    the bubble expands the trimmed history in muted text. Collapsed by default.
  - Attachments listed under the bubble as names + sizes, with "Open in Titan".
  - Opens scrolled to the newest message.
- **Settings → Email rules card:** list with up/down reorder, enable toggle,
  edit/delete, "Add rule", "Re-apply rules", and a "Last synced N min ago" line
  per folder that shows `last_error` when set.

## Error handling

- Login/network/TLS failure: log, write `last_error` + `last_run_at` on the
  affected folder rows, leave cursors untouched, so the next run retries.
- Per-message failure (parse, trim, or insert other than 23505): store the
  "could not be read" placeholder; if even that fails, stop processing **that
  folder** before advancing past that UID, so it's retried next run.
- A folder's cursor only advances past a UID once that message is stored,
  ignored, or identified as a duplicate.
- Overlapping runs are harmless: dedupe on `message_id` absorbs double fetches;
  thread summary fields are recomputed from the thread's messages, not incremented.

## Testing

- `quoteTrim.test.ts`: fixture replies from Titan webmail, Gmail, Outlook,
  iPhone Mail; `said:` and `wrote:` forms incl. two-line wrapping; `>` runs;
  Outlook header block; forwards kept intact; empty-result fallback.
- `threading.test.ts`: subject normalisation; header match; reverse match;
  subject + counterpart fallback within/outside 60 days; merge of two threads;
  counterpart for `out` (skip mailbox address, CC fallback).
- `rules.test.ts`: each field/match combination against the counterpart,
  case-insensitivity, first-match order, disabled rules skipped, `ignore`,
  fallback to `other`.
- `parse.test.ts`: fixture `.eml` files (plain, HTML-only, multipart with an
  attachment, missing Message-ID, references header, garbage bytes); 200 KB cap.
- `sync.test.ts` with a fake `ImapSource` and stubbed Supabase: first run per
  folder imports nothing; inbox + sent merged in date order; reply in Sent lands
  in the customer's thread as `out`; message in both folders stored once;
  handled thread reopens on `in` but not on `out`; 50-per-folder cap;
  `UIDVALIDITY` reset; missing Sent folder; login failure leaves cursors.
- `inbox.routes.test.ts` in the style of `notifications.routes.test.ts`: auth
  required, strict schemas reject unknown fields, route ordering, pagination,
  PATCH semantics (`category_locked`, `handled_at`).
- Web: component tests for the bubble thread (left/right by direction, "···"
  reveal, link rendering escapes text) and the rule list reorder.
- Verification: `pnpm check`, `pnpm test` in api and web; `pnpm lint` in web.
  0 errors / 0 warnings.

## Security notes

- Titan credentials live only in Worker secrets; never in `apps/web`, never
  committed.
- No email HTML is ever rendered: bubbles are escaped plain text, links get
  `noopener noreferrer`. Tracking pixels can't fire.
- Email content never goes into outbound email HTML in v1; if it ever does, it
  passes through `escapeHtml`.
- Read-only IMAP commands only.

## Rollout

1. Apply migration 45.
2. `wrangler secret put TITAN_IMAP_USER` / `TITAN_IMAP_PASSWORD`.
3. Deploy api (adds the cron) and web.
4. First cron run sets both cursors; mail and replies from then on appear in
   `/inbox`.
5. Add rules in Settings; use "Re-apply rules" to re-sort existing threads.

Docs to update during implementation: `knowledge/history/engine_features.md`,
`memory-bank/activeContext.md`, `memory-bank/progress.md`,
`memory-bank/systemPatterns.md` (new ingestion path), `techContext.md` (new
secrets, `postal-mime`, IMAP client).
