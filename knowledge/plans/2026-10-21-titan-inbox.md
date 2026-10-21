# Titan Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull new mail from the Titan mailbox `info@blindsnisa.com` (INBOX and Sent) into measure-blinds every 5 minutes, group it into conversations, sort it with staff-editable rules, and show each conversation as a chat-style bubble thread with quoted history trimmed.

**Architecture:** A `*/5 * * * *` cron on the existing `blinds-nisa-api` Worker opens a TLS socket to `imap.titan.email:993` (`cloudflare:sockets`) and speaks a minimal read-only IMAP. New messages are parsed with `postal-mime`, trimmed of quoted history, threaded by `In-Reply-To`/`References` (falling back to subject + other party), classified by rules, and written to four new Supabase tables. Staff read them through new JWT-protected `/api/inbox` routes on an Inbox page and manage rules on a Settings page.

**Tech Stack:** Hono 4 on Cloudflare Workers, `cloudflare:sockets`, `postal-mime` 2.7.6 (exact pin), Zod 3, supabase-js 2 (service role), Postgres (SQL functions via RPC), React 19 + TanStack Query 5 + Tailwind 4 + date-fns, vitest 3.

**Spec:** `knowledge/specs/2026-10-14-titan-inbox-design.md`. Its "Revisions made while planning" section overrides the rest of the spec.

## Global Constraints

- Every new `.ts`/`.tsx`/`.sql` file starts with the SPDX header (AI_GUIDELINES §10). SQL uses `--`:
  ```ts
  // SPDX-License-Identifier: GPL-3.0-only
  // Copyright (c) 2026 Blinds Nisa. All rights reserved.
  ```
- Every exported symbol has a JSDoc of 8/10 or better (AI_GUIDELINES §3). File headers describe the module's responsibility.
- Request schemas are Zod `.strict()`: unknown fields → 400, never stripped.
- `/api/*` routes are JWT-protected by `requireAuth` in `index.ts`; the new group mounts after it.
- Hono literal routes (`/rules`, `/status`) are registered BEFORE param routes (`/:threadId`) in the same group.
- Updates use `PUT`. CORS in `index.ts` allows `GET, POST, PUT, DELETE, OPTIONS` only.
- The Titan password lives only in Worker secrets (`wrangler secret put`, `.dev.vars` locally). Never in `apps/web`, never committed, never logged, never in an error message.
- IMAP is read-only: `EXAMINE` and `BODY.PEEK[]` only. Never `SELECT`, `STORE`, `COPY`, `MOVE`, `EXPUNGE`.
- No email HTML is ever rendered in the browser. Bubbles render plain text through React's escaping; links get `target="_blank" rel="noopener noreferrer"`.
- Files stay under 800 lines; entry points (`apps/api/src/index.ts`) only mount routes and dispatch crons.
- Verification per touched workspace: `pnpm check`, `pnpm test`; web also `pnpm lint`. Target 0 errors / 0 warnings, except the known pre-existing warning in `apps/web/public/embed/lead-form.js`.
- Node/pnpm are at `~/.local/node/bin` and already on PATH.
- **Git:** work on branch `feat/titan-inbox`. The working tree has unrelated changes, some already staged (`apps/api/src/lib/email.ts`, `apps/api/src/routes/orders.ts`, …). Every commit uses the path-limited form `git commit -m "…" -- <paths>` so only this task's files are committed. Never `git add -A` / `git commit -a`.

## File Map

**Database**
- Create `supabase/migrations/20261021000045_inbox.sql`: four tables, indexes, policies, `refresh_email_thread`, `merge_email_threads`.

**API: `apps/api/src/lib/inbox/`** (one responsibility per file)
- `types.ts`: shared types (`InboxFolder`, `ParsedMessage`, `MailSource`, …) and `EMAIL_CATEGORIES`.
- `imapClient.ts`: byte reader + minimal IMAP protocol over any web stream pair. No sockets.
- `mailSource.ts`: `MailSource` on top of `ImapClient` (Sent-folder pick, cursor-based reads).
- `titanConnect.ts`: the ONLY file importing `cloudflare:sockets`; opens + authenticates.
- `htmlToText.ts`: HTML → plain text, blockquotes become `>` lines.
- `parse.ts`: raw bytes → `ParsedMessage` via `postal-mime`.
- `quoteTrim.ts`: full text → new reply text.
- `threading.ts`: subject normalisation, direction, counterpart, thread decision.
- `rules.ts`: rule constants + `classify`.
- `store.ts`: `InboxStore` interface + Supabase implementation.
- `sync.ts`: `syncInbox` orchestration (pure of I/O details; tested with fakes).
- `run.ts`: `runInboxSync(env)`, which wires the real socket, store and timeout for the cron.
- `testEml.ts`: test-only helper that builds RFC 5322 messages.
- Tests: `imapClient.test.ts`, `mailSource.test.ts`, `htmlToText.test.ts`, `parse.test.ts`, `quoteTrim.test.ts`, `threading.test.ts`, `rules.test.ts`, `store.test.ts`, `sync.test.ts`.

**API: routes and wiring**
- Create `apps/api/src/routes/inbox.ts` + `inbox.routes.test.ts`.
- Modify `apps/api/src/index.ts`: `Env` fields, cron dispatch, route mount.
- Modify `apps/api/wrangler.toml`: cron + vars + secrets comment.
- Modify `apps/api/package.json`: `postal-mime` dependency.

**Web**
- Modify `apps/web/src/types/index.ts`: inbox types (appended).
- Create `apps/web/src/hooks/useInbox.ts`.
- Create `apps/web/src/pages/inbox/inboxText.ts` + `inboxText.test.ts`.
- Create `apps/web/src/pages/inbox/InboxPage.tsx`, `InboxThreadPage.tsx`, `MessageBubble.tsx`, `ThreadControls.tsx`.
- Create `apps/web/src/pages/settings/EmailRules.tsx`.
- Modify `apps/web/src/App.tsx` (routes), `apps/web/src/components/Sidebar.tsx` (Inbox item), `apps/web/src/pages/settings/SettingsIndex.tsx` (Email Rules tile).

**Docs:** `knowledge/history/engine_features.md`, `memory-bank/activeContext.md`, `memory-bank/progress.md`, `memory-bank/systemPatterns.md`, `memory-bank/techContext.md`.

---

### Task 0: Branch

- [ ] **Step 1: Create the feature branch (keeps the uncommitted work in the tree)**

```bash
cd /Users/kemal/Desktop/measure-blinds && git switch -c feat/titan-inbox
```

Expected: `Switched to a new branch 'feat/titan-inbox'`.

---

### Task 1: Migration 45

**Files:**
- Create: `supabase/migrations/20261021000045_inbox.sql`

**Interfaces:**
- Produces tables `email_threads`, `email_messages`, `email_rules`, `email_sync_state` with the exact columns below, and RPCs `refresh_email_thread(p_thread_id uuid, p_reopen boolean)` and `merge_email_threads(p_keep uuid, p_drop uuid[])`. Every later API task uses these names.

There is no SQL test runner in this repo; the migration is verified by review here and applied at rollout (Task 12, with the user's go-ahead).

- [ ] **Step 1: Confirm 45 is the next free number**

Run: `ls /Users/kemal/Desktop/measure-blinds/supabase/migrations | tail -3`
Expected: the last file is `20261010000044_sheer_blind_type.sql`. If a `…000045_…` already exists (e.g. leads shipped first), use the next free number in the filename and in the header comment.

- [ ] **Step 2: Write the migration**

```sql
-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 45: the Titan inbox (sidebar Inbox page + Settings → Email Rules).
--
-- A cron on the API Worker reads new mail from the shop's Titan mailbox
-- (INBOX and Sent, read-only IMAP) every 5 minutes and stores it here:
--
--   email_threads    — one row per conversation. Category, customer/order
--                      links and the New/Handled status live here. The
--                      last_* / message_count columns are a summary kept
--                      current by refresh_email_thread(), so the Inbox list
--                      needs no aggregate query.
--   email_messages   — one row per email. direction 'in' = from the other
--                      party (left bubble), 'out' = from the shop (right
--                      bubble). reply_text is the message with quoted
--                      history trimmed off; text_body keeps the full text
--                      for the "···" reveal. message_id is UNIQUE: it is
--                      the dedupe key across runs and across folders.
--   email_rules      — staff-edited filter rules, first match wins by
--                      position. 'ignore' means the conversation is never
--                      stored.
--   email_sync_state — one IMAP cursor per folder role (UIDVALIDITY + last
--                      UID seen) plus the last error for the Settings page.
--
-- Only the Worker writes these (service role). Same single-org RLS model as
-- every other business table: authenticated full access, nothing for anon.

create table public.email_threads (
  id uuid primary key default gen_random_uuid(),
  subject text not null default '',
  -- Lower-cased subject with Re:/Fwd:/[tag] prefixes removed; the
  -- subject-fallback threading key together with counterpart_address.
  normalized_subject text not null default '',
  -- The other party: the sender of an incoming message, the first
  -- non-shop recipient of an outgoing one. Lower-cased.
  counterpart_address text not null default '',
  counterpart_name text not null default '',
  category text not null
    check (category in ('inquiry', 'supplier', 'payment', 'other')),
  -- true once staff picked the category by hand; "Re-apply rules" then
  -- leaves the thread alone.
  category_locked boolean not null default false,
  customer_id uuid references public.customers (id) on delete set null,
  order_id uuid references public.orders (id) on delete set null,
  status text not null default 'new' check (status in ('new', 'handled')),
  handled_at timestamptz,
  last_message_at timestamptz not null,
  last_direction text not null default 'in' check (last_direction in ('in', 'out')),
  last_snippet text not null default '',
  message_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- The Inbox list: one category tab + status, newest conversation first.
create index email_threads_list_idx
  on public.email_threads (category, status, last_message_at desc);
-- Subject-fallback threading lookup.
create index email_threads_subject_idx
  on public.email_threads (counterpart_address, normalized_subject, last_message_at desc);
-- Support ON DELETE SET NULL from customers/orders without a scan.
create index email_threads_customer_idx
  on public.email_threads (customer_id) where customer_id is not null;
create index email_threads_order_idx
  on public.email_threads (order_id) where order_id is not null;

create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.email_threads (id) on delete cascade,
  -- Message-ID header without angle brackets, or 'uid:<folder>:<uidvalidity>:<uid>'
  -- when the header is missing.
  message_id text not null unique,
  in_reply_to text,
  -- The References header ids (named reference_ids: REFERENCES is reserved).
  reference_ids text[] not null default '{}',
  direction text not null check (direction in ('in', 'out')),
  folder text not null check (folder in ('inbox', 'sent')),
  imap_uid bigint,
  uid_validity bigint,
  sent_at timestamptz not null,
  from_address text not null default '',
  from_name text not null default '',
  to_addresses text[] not null default '{}',
  cc_addresses text[] not null default '{}',
  subject text not null default '',
  text_body text not null default '',
  reply_text text not null default '',
  -- [{ filename, mime_type, size }] — names and sizes only; files stay in Titan.
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index email_messages_thread_idx
  on public.email_messages (thread_id, sent_at);
create index email_messages_in_reply_to_idx
  on public.email_messages (in_reply_to) where in_reply_to is not null;
create index email_messages_reference_ids_idx
  on public.email_messages using gin (reference_ids);

create table public.email_rules (
  id uuid primary key default gen_random_uuid(),
  position integer not null default 0,
  field text not null check (field in ('address', 'domain', 'subject', 'body')),
  match_type text not null check (match_type in ('contains', 'equals', 'ends_with')),
  value text not null check (char_length(value) between 1 and 200),
  action text not null
    check (action in ('inquiry', 'supplier', 'payment', 'other', 'ignore')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index email_rules_position_idx on public.email_rules (position);

create trigger email_rules_set_updated_at
  before update on public.email_rules
  for each row execute function public.set_updated_at();

create table public.email_sync_state (
  folder text primary key check (folder in ('inbox', 'sent')),
  -- The IMAP folder name the cursor belongs to ('INBOX', 'Sent', …). A
  -- different name next run means the cursor is reset, not reused.
  folder_name text not null default '',
  uid_validity bigint,
  last_uid bigint,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text
);

alter table public.email_threads enable row level security;
alter table public.email_messages enable row level security;
alter table public.email_rules enable row level security;
alter table public.email_sync_state enable row level security;

create policy authenticated_full_access on public.email_threads
  for all to authenticated using (true) with check (true);
create policy authenticated_full_access on public.email_messages
  for all to authenticated using (true) with check (true);
create policy authenticated_full_access on public.email_rules
  for all to authenticated using (true) with check (true);
create policy authenticated_full_access on public.email_sync_state
  for all to authenticated using (true) with check (true);

-- Recomputes a thread's summary columns from its messages. p_reopen moves
-- a 'handled' thread back to 'new' (the Worker passes true only for an
-- incoming message). A thread left with no messages — possible only when
-- an insert lost a dedupe race right after the thread was created — is
-- deleted so the Inbox never lists an empty conversation.
create or replace function public.refresh_email_thread(p_thread_id uuid, p_reopen boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_last record;
begin
  select count(*) into v_count from email_messages where thread_id = p_thread_id;
  if v_count = 0 then
    delete from email_threads where id = p_thread_id;
    return;
  end if;

  select sent_at, direction, reply_text
    into v_last
    from email_messages
   where thread_id = p_thread_id
   order by sent_at desc, created_at desc
   limit 1;

  update email_threads
     set message_count   = v_count,
         last_message_at = v_last.sent_at,
         last_direction  = v_last.direction,
         last_snippet    = left(regexp_replace(v_last.reply_text, '\s+', ' ', 'g'), 140),
         status          = case when p_reopen then 'new' else status end,
         handled_at      = case when p_reopen then null else handled_at end
   where id = p_thread_id;
end;
$$;

-- Folds p_drop threads into p_keep (the oldest of the set): moves their
-- messages, inherits a customer/order link p_keep lacks, deletes the
-- emptied threads and refreshes p_keep's summary. Used when one message's
-- headers prove two existing conversations are the same one.
create or replace function public.merge_email_threads(p_keep uuid, p_drop uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update email_messages set thread_id = p_keep where thread_id = any(p_drop);

  update email_threads k
     set customer_id = coalesce(k.customer_id, (
           select d.customer_id from email_threads d
            where d.id = any(p_drop) and d.customer_id is not null limit 1)),
         order_id = coalesce(k.order_id, (
           select d.order_id from email_threads d
            where d.id = any(p_drop) and d.order_id is not null limit 1))
   where k.id = p_keep;

  delete from email_threads where id = any(p_drop);
  perform refresh_email_thread(p_keep, false);
end;
$$;

-- Only the Worker (service role) calls these.
revoke all on function public.refresh_email_thread(uuid, boolean) from public, anon, authenticated;
revoke all on function public.merge_email_threads(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.refresh_email_thread(uuid, boolean) to service_role;
grant execute on function public.merge_email_threads(uuid, uuid[]) to service_role;
```

- [ ] **Step 3: Self-check the SQL**

Check by reading: every `check` list matches the TypeScript constants in later tasks (`inquiry|supplier|payment|other`, `ignore`, `address|domain|subject|body`, `contains|equals|ends_with`, `in|out`, `inbox|sent`, `new|handled`). `public.set_updated_at()` exists (defined in `20260703000000_init_helpers.sql`).

- [ ] **Step 4: Commit**

```bash
cd /Users/kemal/Desktop/measure-blinds && git add supabase/migrations/20261021000045_inbox.sql knowledge/specs/2026-10-14-titan-inbox-design.md knowledge/plans/2026-10-21-titan-inbox.md && git commit -m "feat(inbox): migration 45 — email threads, messages, rules, sync state" -- supabase/migrations/20261021000045_inbox.sql knowledge/specs/2026-10-14-titan-inbox-design.md knowledge/plans/2026-10-21-titan-inbox.md
```

---

### Task 2: IMAP client, mail source and Titan connector

**Files:**
- Create: `apps/api/src/lib/inbox/types.ts`
- Create: `apps/api/src/lib/inbox/imapClient.ts`
- Create: `apps/api/src/lib/inbox/mailSource.ts`
- Create: `apps/api/src/lib/inbox/titanConnect.ts`
- Test: `apps/api/src/lib/inbox/imapClient.test.ts`, `apps/api/src/lib/inbox/mailSource.test.ts`

**Interfaces:**
- Produces (types.ts): `InboxFolder`, `EmailDirection`, `EMAIL_CATEGORIES`, `EmailCategory`, `Mailbox`, `AttachmentMeta`, `ParsedMessage`, `RawMessage`, `FolderRead`, `FolderCursor`, `MailSource`.
- Produces: `ImapClient` (`open`, `authenticatePlain`, `list`, `examine`, `uidSearch`, `uidFetchRaw`, `logout`), `ImapError`, `ByteReader`, `parseListResponse`.
- Produces: `createMailSource(client: ImapCommands, closeTransport: () => Promise<void>): MailSource`, `pickSentFolder(list): string | null`, `MAX_MESSAGE_BYTES`.
- Produces: `openTitanSource(cfg: TitanConfig): Promise<MailSource>`.

- [ ] **Step 1: Write `types.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Shared types for the Titan inbox sync (`lib/inbox/*`). Kept in one
 * dependency-free module so the IMAP layer, the parser, the threading
 * and rule logic, the store and the sync orchestration can all agree on
 * shapes without importing each other.
 */

/**
 * Which Titan folder a message was read from. Also the primary key of
 * `email_sync_state` (one IMAP cursor per folder role).
 */
export type InboxFolder = 'inbox' | 'sent';

/**
 * `in` = written by the other party (left bubble); `out` = written by the
 * shop mailbox (right bubble). Decided by `threading.directionOf`.
 */
export type EmailDirection = 'in' | 'out';

/**
 * The fixed conversation categories, in Inbox tab order. Mirrors the
 * `email_threads.category` CHECK constraint in migration 45.
 */
export const EMAIL_CATEGORIES = ['inquiry', 'supplier', 'payment', 'other'] as const;

/** One of {@link EMAIL_CATEGORIES}. */
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

/** One email address with its display name; `address` is lower-cased, `name` may be ''. */
export interface Mailbox {
  address: string;
  name: string;
}

/**
 * Attachment metadata as stored in `email_messages.attachments` (jsonb).
 * The file itself is never stored; staff open Titan for it.
 */
export interface AttachmentMeta {
  filename: string;
  mime_type: string;
  size: number;
}

/**
 * A message after MIME parsing (`parse.parseMessage`). `textBody` is the
 * full plain text (from the text part, or converted from HTML), capped at
 * 200 000 characters. Ids are stored without angle brackets.
 */
export interface ParsedMessage {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  /** ISO 8601 UTC; the Date header, or the fetch time when it is missing/invalid. */
  sentAt: string;
  from: Mailbox;
  to: Mailbox[];
  cc: Mailbox[];
  subject: string;
  textBody: string;
  attachments: AttachmentMeta[];
}

/** One message as fetched from IMAP: its UID and raw RFC 5322 bytes. */
export interface RawMessage {
  uid: number;
  raw: Uint8Array;
}

/**
 * The stored position in one folder: the folder's UIDVALIDITY when the
 * cursor was saved, and the last UID already handled.
 */
export interface FolderCursor {
  uidValidity: number;
  afterUid: number;
}

/**
 * Result of reading one folder. `messages` is empty unless a usable
 * cursor with a matching UIDVALIDITY was passed. `scannedThroughUid` is
 * the highest UID the read looked at (fetched or vanished), or null when
 * nothing was scanned; the sync advances its cursor to it.
 */
export interface FolderRead {
  uidValidity: number;
  highestUid: number;
  scannedThroughUid: number | null;
  messages: RawMessage[];
}

/**
 * The mailbox as the sync sees it. Implemented over IMAP by
 * `mailSource.createMailSource`, and by in-memory fakes in tests.
 */
export interface MailSource {
  /** The Sent folder's name, or null when the server has none we recognise. */
  findSentFolder(): Promise<string | null>;
  /**
   * Opens `folderName` read-only and returns up to `limit` messages with a
   * UID above `cursor.afterUid`, in ascending UID order. With a null cursor
   * or a UIDVALIDITY mismatch it fetches nothing and only reports the
   * folder's current UIDVALIDITY and highest UID.
   */
  readFolder(folderName: string, cursor: FolderCursor | null, limit: number): Promise<FolderRead>;
  /** Logs out and closes the connection. Never throws. */
  close(): Promise<void>;
}
```

- [ ] **Step 2: Write the failing IMAP client tests**

`apps/api/src/lib/inbox/imapClient.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the minimal IMAP client against a scripted fake server built from
 * web streams: greeting check, SASL-IR PLAIN auth (and that a failure
 * message never echoes the credentials), LIST/EXAMINE/SEARCH parsing,
 * byte-exact literal reads for FETCH, and CRLF detection across chunk
 * boundaries.
 */

import { describe, expect, it } from 'vitest';
import { ByteReader, ImapClient, ImapError, parseListResponse } from './imapClient';

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Fake IMAP server: answers each command line with `respond(tag, command)`.
 * Records every command the client sent.
 */
function fakeServer(respond: (tag: string, command: string) => string, greeting = '* OK IMAP ready\r\n') {
  let push!: (s: string) => void;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (s) => controller.enqueue(enc.encode(s));
    },
  });
  const sent: string[] = [];
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      const line = dec.decode(chunk).replace(/\r\n$/, '');
      sent.push(line);
      const sp = line.indexOf(' ');
      push(respond(line.slice(0, sp), line.slice(sp + 1)));
    },
  });
  push(greeting);
  return { readable, writable, sent };
}

describe('ImapClient.open', () => {
  it('rejects a server that does not greet with OK', async () => {
    const s = fakeServer(() => '', '* BYE go away\r\n');
    await expect(ImapClient.open(s.readable, s.writable)).rejects.toBeInstanceOf(ImapError);
  });
});

describe('authenticatePlain', () => {
  it('sends SASL-IR PLAIN in one line', async () => {
    const s = fakeServer((tag) => `${tag} OK authenticated\r\n`);
    const client = await ImapClient.open(s.readable, s.writable);
    await client.authenticatePlain('info@blindsnisa.com', 'pässword');
    const b64 = s.sent[0].split(' ')[3];
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    expect(s.sent[0].startsWith('a1 AUTHENTICATE PLAIN ')).toBe(true);
    expect(dec.decode(bytes)).toBe('\u0000info@blindsnisa.com\u0000pässword');
  });

  it('fails without leaking the credentials', async () => {
    const s = fakeServer((tag) => `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
    const client = await ImapClient.open(s.readable, s.writable);
    const err = await client.authenticatePlain('info@blindsnisa.com', 'secret').catch((e: Error) => e);
    expect(err).toBeInstanceOf(ImapError);
    expect((err as Error).message).toContain('AUTHENTICATE failed');
    expect((err as Error).message).not.toContain('secret');
    expect((err as Error).message).not.toContain(btoa('\u0000info@blindsnisa.com\u0000secret'));
  });
});

describe('list / examine / uidSearch', () => {
  it('parses LIST flags and quoted names', async () => {
    const s = fakeServer(
      (tag) =>
        '* LIST (\\HasNoChildren) "/" "INBOX"\r\n' +
        '* LIST (\\HasNoChildren \\Sent) "/" "Sent Items"\r\n' +
        '* LIST (\\HasNoChildren) "." INBOX.Archive\r\n' +
        `${tag} OK LIST completed\r\n`
    );
    const client = await ImapClient.open(s.readable, s.writable);
    expect(await client.list()).toEqual([
      { name: 'INBOX', flags: ['\\HasNoChildren'] },
      { name: 'Sent Items', flags: ['\\HasNoChildren', '\\Sent'] },
      { name: 'INBOX.Archive', flags: ['\\HasNoChildren'] },
    ]);
    expect(s.sent[0]).toBe('a1 LIST "" "*"');
  });

  it('EXAMINEs (never SELECTs) and reads UIDVALIDITY and EXISTS', async () => {
    const s = fakeServer(
      (tag) =>
        '* FLAGS (\\Seen)\r\n* 12 EXISTS\r\n* 0 RECENT\r\n' +
        '* OK [UIDVALIDITY 1700000001] UIDs valid\r\n* OK [UIDNEXT 345] next\r\n' +
        `${tag} OK [READ-ONLY] EXAMINE completed\r\n`
    );
    const client = await ImapClient.open(s.readable, s.writable);
    expect(await client.examine('Sent Items')).toEqual({ uidValidity: 1700000001, exists: 12 });
    expect(s.sent[0]).toBe('a1 EXAMINE "Sent Items"');
  });

  it('returns sorted UIDs from UID SEARCH', async () => {
    const s = fakeServer((tag) => `* SEARCH 9 3 7\r\n${tag} OK SEARCH completed\r\n`);
    const client = await ImapClient.open(s.readable, s.writable);
    expect(await client.uidSearch('UID 3:*')).toEqual([3, 7, 9]);
  });

  it('returns [] for an empty SEARCH', async () => {
    const s = fakeServer((tag) => `* SEARCH\r\n${tag} OK SEARCH completed\r\n`);
    const client = await ImapClient.open(s.readable, s.writable);
    expect(await client.uidSearch('UID 3:*')).toEqual([]);
  });
});

describe('uidFetchRaw', () => {
  it('returns the literal byte-exact, CRLFs included', async () => {
    const body = 'Subject: Hi\r\n\r\nLine one\r\nLine two é\r\n';
    const size = enc.encode(body).length;
    const s = fakeServer(
      (tag) => `* 4 FETCH (UID 42 BODY[]<0> {${size}}\r\n${body})\r\n${tag} OK FETCH completed\r\n`
    );
    const client = await ImapClient.open(s.readable, s.writable);
    const raw = await client.uidFetchRaw(42, 5_000_000);
    expect(dec.decode(raw!)).toBe(body);
    expect(s.sent[0]).toBe('a1 UID FETCH 42 (UID BODY.PEEK[]<0.5000000>)');
  });

  it('returns null when the message vanished', async () => {
    const s = fakeServer((tag) => `${tag} OK FETCH completed\r\n`);
    const client = await ImapClient.open(s.readable, s.writable);
    expect(await client.uidFetchRaw(42, 1000)).toBeNull();
  });
});

describe('ByteReader', () => {
  it('finds a CRLF split across two chunks', async () => {
    const chunks = ['abc\r', '\ndef\r\n'].map((s) => enc.encode(s));
    const readable = new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(ch);
        c.close();
      },
    });
    const reader = new ByteReader(readable.getReader());
    expect(await reader.readLine()).toBe('abc');
    expect(await reader.readLine()).toBe('def');
    await expect(reader.readLine()).rejects.toBeInstanceOf(ImapError);
  });
});

describe('parseListResponse', () => {
  it('ignores non-LIST lines', () => {
    expect(parseListResponse('* OK hello')).toBeNull();
  });

  it('unescapes quoted names', () => {
    expect(parseListResponse('* LIST () "/" "a \\"b\\""')).toEqual({ name: 'a "b"', flags: [] });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/api && pnpm vitest run src/lib/inbox/imapClient.test.ts`
Expected: FAIL, "Failed to resolve import ./imapClient".

- [ ] **Step 4: Write `imapClient.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Minimal, read-only IMAP4rev1 client for the Titan inbox sync.
 *
 * Works over any web-stream pair (`ReadableStream`/`WritableStream` of
 * bytes), so the protocol logic is unit-tested against a fake server and
 * only `titanConnect.ts` touches real sockets. It speaks exactly the
 * commands the sync needs: AUTHENTICATE PLAIN (with SASL-IR, which Titan
 * advertises, so any password characters are safe), LIST, EXAMINE (the
 * read-only SELECT — the client never selects a folder writable), UID
 * SEARCH, UID FETCH with BODY.PEEK (never sets \Seen) and LOGOUT.
 *
 * Commands are sent one at a time and each response is read to its
 * tagged completion. Server literals (`{n}` + n raw bytes) are read
 * byte-exact and returned separately from the line text, which is how a
 * FETCH delivers a message's bytes.
 *
 * Error messages name the command verb only, never its arguments, so a
 * failed login can never put the credentials into a log line.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A protocol or connection failure. Never carries command arguments. */
export class ImapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImapError';
  }
}

/**
 * Buffered reader over a byte stream that can return CRLF-terminated
 * lines and exact byte counts. Chunks are kept in a list rather than
 * re-concatenated on every read, so a multi-megabyte FETCH literal costs
 * one copy.
 */
export class ByteReader {
  private chunks: Uint8Array[] = [];
  private length = 0;

  constructor(private readonly source: ReadableStreamDefaultReader<Uint8Array>) {}

  /** Pulls one more chunk; throws when the server has closed the stream. */
  private async pull(): Promise<void> {
    const { value, done } = await this.source.read();
    if (done) throw new ImapError('IMAP connection closed by the server');
    if (value && value.length > 0) {
      this.chunks.push(value);
      this.length += value.length;
    }
  }

  /** Removes and returns the first `n` buffered bytes (n ≤ length). */
  private take(n: number): Uint8Array {
    const out = new Uint8Array(n);
    let offset = 0;
    while (offset < n) {
      const head = this.chunks[0];
      const need = n - offset;
      if (head.length <= need) {
        out.set(head, offset);
        offset += head.length;
        this.chunks.shift();
      } else {
        out.set(head.subarray(0, need), offset);
        this.chunks[0] = head.subarray(need);
        offset += need;
      }
    }
    this.length -= n;
    return out;
  }

  /** Index of the CR of the first CRLF in the buffer, or -1. */
  private findCrlf(): number {
    let position = 0;
    let previousWasCr = false;
    for (const chunk of this.chunks) {
      for (let i = 0; i < chunk.length; i++) {
        if (previousWasCr && chunk[i] === 10) return position + i - 1;
        previousWasCr = chunk[i] === 13;
      }
      position += chunk.length;
    }
    return -1;
  }

  /** Reads one line, without its CRLF, decoded as UTF-8. */
  async readLine(): Promise<string> {
    for (;;) {
      const crAt = this.findCrlf();
      if (crAt >= 0) {
        const bytes = this.take(crAt + 2);
        return decoder.decode(bytes.subarray(0, crAt));
      }
      await this.pull();
    }
  }

  /** Reads exactly `n` bytes (an IMAP literal). */
  async readBytes(n: number): Promise<Uint8Array> {
    while (this.length < n) await this.pull();
    return this.take(n);
  }
}

/**
 * One untagged response (`* …`). `text` is the line with every literal's
 * bytes removed (the `{n}` markers stay); `literals` holds those bytes in
 * order.
 */
export interface UntaggedResponse {
  text: string;
  literals: Uint8Array[];
}

/** The tagged completion of a command plus everything untagged before it. */
export interface TaggedResult {
  status: 'OK' | 'NO' | 'BAD';
  text: string;
  untagged: UntaggedResponse[];
}

/** One mailbox from LIST: its decoded name and its flags (e.g. `\Sent`). */
export interface MailboxListing {
  name: string;
  flags: string[];
}

const LITERAL_AT_END = /\{(\d+)\}$/;

/** The verb used in error messages: `UID FETCH`, `EXAMINE`, … — never arguments. */
function verbOf(command: string): string {
  const [first, second] = command.split(' ');
  return (first.toUpperCase() === 'UID' && second ? `UID ${second}` : first).toUpperCase();
}

/** IMAP quoted string with `\` and `"` escaped. */
function quoteString(value: string): string {
  return `"${value.replace(/[\\"]/g, (ch) => `\\${ch}`)}"`;
}

/** Base64 of a string's UTF-8 bytes (btoa alone only handles Latin-1). */
function base64Utf8(value: string): string {
  let binary = '';
  for (const byte of encoder.encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Parses one `* LIST (flags) "delim" name` line. Returns null for any
 * other line, and for the rare literal-encoded name (not used by Titan).
 */
export function parseListResponse(text: string): MailboxListing | null {
  const m = /^\* LIST \(([^)]*)\) (?:NIL|"(?:[^"\\]|\\.)*") (.+)$/i.exec(text);
  if (!m) return null;
  const raw = m[2].trim();
  if (LITERAL_AT_END.test(raw)) return null;
  const name =
    raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, '$1') : raw;
  return { name, flags: m[1].split(/\s+/).filter(Boolean) };
}

/** The read-only IMAP session. Create with {@link ImapClient.open}. */
export class ImapClient {
  private tagSeq = 0;

  private constructor(
    private readonly reader: ByteReader,
    private readonly writer: WritableStreamDefaultWriter<Uint8Array>
  ) {}

  /**
   * Wraps an open byte-stream pair and checks the server greeting
   * (`* OK` or `* PREAUTH`). Throws {@link ImapError} on anything else.
   */
  static async open(
    readable: ReadableStream<Uint8Array>,
    writable: WritableStream<Uint8Array>
  ): Promise<ImapClient> {
    const client = new ImapClient(new ByteReader(readable.getReader()), writable.getWriter());
    const greeting = await client.reader.readLine();
    if (!/^\* (OK|PREAUTH)\b/i.test(greeting)) {
      throw new ImapError(`Unexpected IMAP greeting: ${greeting.slice(0, 120)}`);
    }
    return client;
  }

  /** Reads one untagged response, following any literals it contains. */
  private async readUntagged(firstLine: string): Promise<UntaggedResponse> {
    let text = firstLine;
    const literals: Uint8Array[] = [];
    for (;;) {
      const m = LITERAL_AT_END.exec(text);
      if (!m) return { text, literals };
      literals.push(await this.reader.readBytes(Number(m[1])));
      text += await this.reader.readLine();
    }
  }

  /** Reads responses until the line tagged `tag`. */
  private async readResponse(tag: string, verb: string): Promise<TaggedResult> {
    const untagged: UntaggedResponse[] = [];
    for (;;) {
      const line = await this.reader.readLine();
      if (line.startsWith(`${tag} `)) {
        const rest = line.slice(tag.length + 1);
        const sp = rest.indexOf(' ');
        const status = (sp === -1 ? rest : rest.slice(0, sp)).toUpperCase();
        if (status !== 'OK' && status !== 'NO' && status !== 'BAD') {
          throw new ImapError(`${verb}: malformed tagged response`);
        }
        return { status, text: sp === -1 ? '' : rest.slice(sp + 1), untagged };
      }
      if (line.startsWith('+')) throw new ImapError(`${verb}: unexpected continuation request`);
      untagged.push(await this.readUntagged(line));
    }
  }

  /** Sends one command and returns its full result, whatever the status. */
  private async command(command: string): Promise<TaggedResult> {
    const tag = `a${++this.tagSeq}`;
    await this.writer.write(encoder.encode(`${tag} ${command}\r\n`));
    return this.readResponse(tag, verbOf(command));
  }

  /** Sends one command and throws unless it completes OK. */
  private async ok(command: string): Promise<TaggedResult> {
    const result = await this.command(command);
    if (result.status !== 'OK') {
      throw new ImapError(`${verbOf(command)} failed: ${result.status} ${result.text}`.trim());
    }
    return result;
  }

  /** Logs in with SASL PLAIN in a single line (SASL-IR). */
  async authenticatePlain(user: string, password: string): Promise<void> {
    await this.ok(`AUTHENTICATE PLAIN ${base64Utf8(`\u0000${user}\u0000${password}`)}`);
  }

  /** Every mailbox on the account, with flags. */
  async list(): Promise<MailboxListing[]> {
    const result = await this.ok('LIST "" "*"');
    return result.untagged
      .map((u) => parseListResponse(u.text))
      .filter((m): m is MailboxListing => m !== null);
  }

  /** Opens `folder` read-only; returns its UIDVALIDITY and message count. */
  async examine(folder: string): Promise<{ uidValidity: number; exists: number }> {
    const result = await this.ok(`EXAMINE ${quoteString(folder)}`);
    let uidValidity: number | null = null;
    let exists = 0;
    for (const u of result.untagged) {
      const v = /\[UIDVALIDITY (\d+)\]/i.exec(u.text);
      if (v) uidValidity = Number(v[1]);
      const e = /^\* (\d+) EXISTS\b/i.exec(u.text);
      if (e) exists = Number(e[1]);
    }
    if (uidValidity === null) throw new ImapError('EXAMINE: server did not report UIDVALIDITY');
    return { uidValidity, exists };
  }

  /** `UID SEARCH <criteria>` in the examined folder; UIDs ascending. */
  async uidSearch(criteria: string): Promise<number[]> {
    const result = await this.ok(`UID SEARCH ${criteria}`);
    const uids: number[] = [];
    for (const u of result.untagged) {
      const m = /^\* SEARCH\b(.*)$/i.exec(u.text);
      if (!m) continue;
      for (const token of m[1].trim().split(/\s+/)) if (/^\d+$/.test(token)) uids.push(Number(token));
    }
    return uids.sort((a, b) => a - b);
  }

  /**
   * The first `maxBytes` of message `uid`'s raw source, without marking it
   * read (BODY.PEEK). Null when the message no longer exists.
   */
  async uidFetchRaw(uid: number, maxBytes: number): Promise<Uint8Array | null> {
    const result = await this.ok(`UID FETCH ${uid} (UID BODY.PEEK[]<0.${maxBytes}>)`);
    for (const u of result.untagged) {
      if (/^\* \d+ FETCH\b/i.test(u.text) && u.literals.length > 0) return u.literals[0];
    }
    return null;
  }

  /** Best-effort LOGOUT; the server may close the stream first. */
  async logout(): Promise<void> {
    try {
      await this.command('LOGOUT');
    } catch {
      /* already closed */
    }
  }
}
```

- [ ] **Step 5: Run the IMAP client tests**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/api && pnpm vitest run src/lib/inbox/imapClient.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 6: Write the failing mail-source tests**

`apps/api/src/lib/inbox/mailSource.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins how the mail source picks the Sent folder and how it reads a
 * folder against a cursor: no fetch on first run or after a UIDVALIDITY
 * change, only UIDs above the cursor, the per-run limit, and the IMAP
 * quirk where `UID n:*` returns the last message even when n is past it.
 */

import { describe, expect, it } from 'vitest';
import { createMailSource, pickSentFolder, type ImapCommands } from './mailSource';

/** In-memory stand-in for the IMAP commands the source uses. */
function fakeImap(uidValidity: number, uids: number[]) {
  const fetched: number[] = [];
  const imap: ImapCommands = {
    async list() {
      return [];
    },
    async examine() {
      return { uidValidity, exists: uids.length };
    },
    async uidSearch(criteria: string) {
      if (criteria === 'UID *') return uids.length ? [Math.max(...uids)] : [];
      const from = Number(/^UID (\d+):\*$/.exec(criteria)![1]);
      const hits = uids.filter((u) => u >= from);
      // Real servers answer "n:*" with the last message when n is past it.
      return hits.length ? hits : uids.length ? [Math.max(...uids)] : [];
    },
    async uidFetchRaw(uid: number) {
      fetched.push(uid);
      return uid === 13 ? null : new TextEncoder().encode(`message ${uid}`);
    },
    async logout() {},
  };
  return { imap, fetched };
}

describe('pickSentFolder', () => {
  it('prefers the \\Sent flag', () => {
    expect(
      pickSentFolder([
        { name: 'Sent', flags: [] },
        { name: 'Sent Items', flags: ['\\Sent'] },
      ])
    ).toBe('Sent Items');
  });

  it('falls back to a known name, case-insensitively', () => {
    expect(pickSentFolder([{ name: 'INBOX', flags: [] }, { name: 'SENT', flags: [] }])).toBe('SENT');
    expect(pickSentFolder([{ name: 'INBOX.Sent', flags: [] }])).toBe('INBOX.Sent');
  });

  it('returns null when nothing matches', () => {
    expect(pickSentFolder([{ name: 'INBOX', flags: [] }])).toBeNull();
  });
});

describe('readFolder', () => {
  it('fetches nothing on the first run (no cursor)', async () => {
    const { imap, fetched } = fakeImap(7, [3, 5, 9]);
    const read = await createMailSource(imap, async () => {}).readFolder('INBOX', null, 50);
    expect(read).toEqual({ uidValidity: 7, highestUid: 9, scannedThroughUid: null, messages: [] });
    expect(fetched).toEqual([]);
  });

  it('fetches nothing when UIDVALIDITY changed', async () => {
    const { imap, fetched } = fakeImap(8, [3, 5, 9]);
    const read = await createMailSource(imap, async () => {}).readFolder('INBOX', { uidValidity: 7, afterUid: 3 }, 50);
    expect(read.messages).toEqual([]);
    expect(read.uidValidity).toBe(8);
    expect(fetched).toEqual([]);
  });

  it('fetches only UIDs above the cursor, up to the limit', async () => {
    const { imap, fetched } = fakeImap(7, [3, 5, 9, 11, 12]);
    const read = await createMailSource(imap, async () => {}).readFolder('INBOX', { uidValidity: 7, afterUid: 3 }, 3);
    expect(fetched).toEqual([5, 9, 11]);
    expect(read.messages.map((m) => m.uid)).toEqual([5, 9, 11]);
    expect(read.scannedThroughUid).toBe(11);
  });

  it('ignores the n:* quirk when nothing is new', async () => {
    const { imap, fetched } = fakeImap(7, [3, 5]);
    const read = await createMailSource(imap, async () => {}).readFolder('INBOX', { uidValidity: 7, afterUid: 5 }, 50);
    expect(fetched).toEqual([]);
    expect(read).toMatchObject({ highestUid: 5, scannedThroughUid: null, messages: [] });
  });

  it('skips a message that vanished but still scans past it', async () => {
    const { imap } = fakeImap(7, [12, 13]);
    const read = await createMailSource(imap, async () => {}).readFolder('INBOX', { uidValidity: 7, afterUid: 11 }, 50);
    expect(read.messages.map((m) => m.uid)).toEqual([12]);
    expect(read.scannedThroughUid).toBe(13);
  });

  it('reports highestUid 0 for an empty folder', async () => {
    const { imap } = fakeImap(7, []);
    const read = await createMailSource(imap, async () => {}).readFolder('Sent', null, 50);
    expect(read.highestUid).toBe(0);
  });
});
```

- [ ] **Step 7: Run to verify they fail**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/api && pnpm vitest run src/lib/inbox/mailSource.test.ts`
Expected: FAIL, "Failed to resolve import ./mailSource".

- [ ] **Step 8: Write `mailSource.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The sync's view of the Titan mailbox, built on the minimal IMAP client.
 *
 * Owns two decisions: which folder is "Sent" (Titan does not advertise
 * SPECIAL-USE before login, so a `\Sent` flag is preferred but common
 * names are the fallback), and how a folder is read against the stored
 * cursor (no fetch unless the cursor's UIDVALIDITY still matches; only
 * UIDs above it; at most `limit` per run).
 *
 * Messages are fetched one at a time and capped at {@link MAX_MESSAGE_BYTES}
 * so a huge attachment cannot exhaust the Worker's memory; headers and
 * body text come first in practice, so only the attachment list of such
 * a message can be incomplete.
 */

import type { ImapClient, MailboxListing } from './imapClient';
import type { FolderCursor, FolderRead, MailSource, RawMessage } from './types';

/** Per-message fetch cap (first 5 MB of the raw source). */
export const MAX_MESSAGE_BYTES = 5_000_000;

/** Folder names tried, in order, when no folder carries the `\Sent` flag. */
const SENT_FOLDER_NAMES = ['sent', 'sent items', 'sent messages', 'sent mail', 'inbox.sent', 'inbox/sent'];

/**
 * The IMAP commands the source needs. A structural subset of
 * {@link ImapClient}, so tests can pass a plain object.
 */
export type ImapCommands = Pick<ImapClient, 'list' | 'examine' | 'uidSearch' | 'uidFetchRaw' | 'logout'>;

/**
 * Chooses the Sent folder: the first mailbox flagged `\Sent`, else the
 * first whose name matches a common Sent name (case-insensitive), else null.
 */
export function pickSentFolder(list: MailboxListing[]): string | null {
  const flagged = list.find((m) => m.flags.some((f) => f.toLowerCase() === '\\sent'));
  if (flagged) return flagged.name;
  for (const candidate of SENT_FOLDER_NAMES) {
    const hit = list.find((m) => m.name.toLowerCase() === candidate);
    if (hit) return hit.name;
  }
  return null;
}

/**
 * Wraps an authenticated IMAP session as a {@link MailSource}.
 * `closeTransport` closes the underlying socket after LOGOUT.
 */
export function createMailSource(
  imap: ImapCommands,
  closeTransport: () => Promise<void>
): MailSource {
  return {
    async findSentFolder() {
      return pickSentFolder(await imap.list());
    },

    async readFolder(folderName: string, cursor: FolderCursor | null, limit: number): Promise<FolderRead> {
      const box = await imap.examine(folderName);
      let highestUid = 0;
      if (box.exists > 0) {
        const last = await imap.uidSearch('UID *');
        highestUid = last.length ? last[last.length - 1] : 0;
      }
      const read: FolderRead = {
        uidValidity: box.uidValidity,
        highestUid,
        scannedThroughUid: null,
        messages: [],
      };
      if (!cursor || cursor.uidValidity !== box.uidValidity || highestUid <= cursor.afterUid) {
        return read;
      }

      const uids = (await imap.uidSearch(`UID ${cursor.afterUid + 1}:*`))
        .filter((uid) => uid > cursor.afterUid)
        .slice(0, limit);
      const messages: RawMessage[] = [];
      for (const uid of uids) {
        const raw = await imap.uidFetchRaw(uid, MAX_MESSAGE_BYTES);
        if (raw) messages.push({ uid, raw });
      }
      read.messages = messages;
      read.scannedThroughUid = uids.length ? uids[uids.length - 1] : null;
      return read;
    },

    async close() {
      await imap.logout();
      await closeTransport().catch(() => undefined);
    },
  };
}
```

- [ ] **Step 9: Write `titanConnect.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Opens an authenticated, read-only IMAP session to the Titan mailbox.
 *
 * The ONLY inbox module that imports `cloudflare:sockets`, which exists
 * only inside workerd; every other inbox module stays importable by
 * vitest in Node. Connects with implicit TLS (port 993), checks the
 * greeting, logs in with SASL PLAIN, and hands back a `MailSource`.
 * Verified by a spike against imap.titan.email on 2026-10-21.
 */

import { connect } from 'cloudflare:sockets';
import { ImapClient } from './imapClient';
import { createMailSource } from './mailSource';
import type { MailSource } from './types';

/** Connection settings; `password` comes from a Worker secret only. */
export interface TitanConfig {
  host: string;
  port: number;
  user: string;
  password: string;
}

/**
 * Connects and logs in. On any failure the socket is closed before the
 * error propagates, so a bad password never leaks a connection.
 */
export async function openTitanSource(cfg: TitanConfig): Promise<MailSource> {
  const socket = connect({ hostname: cfg.host, port: cfg.port }, { secureTransport: 'on' });
  try {
    const client = await ImapClient.open(socket.readable, socket.writable);
    await client.authenticatePlain(cfg.user, cfg.password);
    return createMailSource(client, () => socket.close());
  } catch (error) {
    await socket.close().catch(() => undefined);
    throw error;
  }
}
```

- [ ] **Step 10: Run tests and typecheck**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/api && pnpm vitest run src/lib/inbox && pnpm check`
Expected: both test files PASS; `tsc --noEmit` prints nothing. If `tsc` cannot find module `cloudflare:sockets`, confirm `@cloudflare/workers-types` is in `tsconfig.json` `types` (it is) and that the installed version declares it (`grep -l "cloudflare:sockets" node_modules/@cloudflare/workers-types/*/index.d.ts`).

- [ ] **Step 11: Commit**

```bash
cd /Users/kemal/Desktop/measure-blinds/apps/api && git add src/lib/inbox/types.ts src/lib/inbox/imapClient.ts src/lib/inbox/imapClient.test.ts src/lib/inbox/mailSource.ts src/lib/inbox/mailSource.test.ts src/lib/inbox/titanConnect.ts && git commit -m "feat(inbox): read-only IMAP client, mail source and Titan connector" -- src/lib/inbox/types.ts src/lib/inbox/imapClient.ts src/lib/inbox/imapClient.test.ts src/lib/inbox/mailSource.ts src/lib/inbox/mailSource.test.ts src/lib/inbox/titanConnect.ts
```

---

### Task 3: MIME parsing and HTML-to-text

**Files:**
- Modify: `apps/api/package.json` (dependency)
- Create: `apps/api/src/lib/inbox/htmlToText.ts`, `apps/api/src/lib/inbox/parse.ts`, `apps/api/src/lib/inbox/testEml.ts`
- Test: `apps/api/src/lib/inbox/htmlToText.test.ts`, `apps/api/src/lib/inbox/parse.test.ts`

**Interfaces:**
- Consumes: `ParsedMessage`, `Mailbox`, `AttachmentMeta` from `types.ts`.
- Produces: `htmlToText(html: string): string`, `decodeEntities(s: string): string`.
- Produces: `parseMessage(raw: Uint8Array, receivedAt: Date): Promise<ParsedMessage>`, `normalizeMessageId`, `parseReferences`, `MAX_TEXT_CHARS`.
- Produces: `eml(options: EmlOptions): Uint8Array` (tests only).

- [ ] **Step 1: Add postal-mime (exact pin)**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/api && pnpm add postal-mime@2.7.6 --save-exact`
Expected: `package.json` gains `"postal-mime": "2.7.6"` under `dependencies`.

Then read the installed typings to confirm the field names used below (`from`, `to`, `cc`, `subject`, `messageId`, `inReplyTo`, `references`, `date`, `text`, `html`, `attachments[].filename|mimeType|content`) and that `PostalMime.parse` is a static method:

Run: `grep -nE "messageId|inReplyTo|references|static parse|mimeType|content:" node_modules/postal-mime/postal-mime.d.ts | head -20`
Expected: each name appears. If a name differs, adjust `parse.ts` to the installed typings and keep the `ParsedMessage` output identical.

- [ ] **Step 2: Write the failing htmlToText tests**

`apps/api/src/lib/inbox/htmlToText.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins HTML-only email conversion: block tags become line breaks,
 * entities decode, head/style/script vanish, and blockquote content is
 * prefixed with ">" so quoteTrim treats it as quoted history.
 */

import { describe, expect, it } from 'vitest';
import { decodeEntities, htmlToText } from './htmlToText';

describe('htmlToText', () => {
  it('turns paragraphs and line breaks into lines', () => {
    expect(htmlToText('<p>Hi Jane,</p><p>Thanks!<br>See you</p>')).toBe('Hi Jane,\n\nThanks!\nSee you');
  });

  it('drops head, style and script content', () => {
    expect(
      htmlToText('<html><head><title>x</title><style>p{color:red}</style></head><body><script>alert(1)</script><div>Body</div></body></html>')
    ).toBe('Body');
  });

  it('prefixes blockquote lines with >', () => {
    expect(
      htmlToText('<div>Sounds good</div><blockquote><div>On Monday you wrote:</div><div>Can you come Tuesday?</div></blockquote>')
    ).toBe('Sounds good\n\n> On Monday you wrote:\n> Can you come Tuesday?');
  });

  it('nests quote depth', () => {
    expect(htmlToText('<blockquote>a<blockquote>b</blockquote></blockquote>')).toBe('> a\n>> b');
  });

  it('collapses whitespace inside text', () => {
    expect(htmlToText('<p>Hello\n     there</p>')).toBe('Hello there');
  });
});

describe('decodeEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeEntities('a&nbsp;&amp;&lt;b&gt; &#39;q&#39; &#x2014; &quot;')).toBe("a &<b> 'q' — \"");
  });

  it('leaves unknown entities alone', () => {
    expect(decodeEntities('&bogus;')).toBe('&bogus;');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/api && pnpm vitest run src/lib/inbox/htmlToText.test.ts`
Expected: FAIL, "Failed to resolve import ./htmlToText".

- [ ] **Step 4: Write `htmlToText.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * HTML → plain text for emails that arrive with no text/plain part.
 *
 * Deliberately small and DOM-free (Workers have no DOMParser, and vitest
 * runs in Node): a tokenizer that turns block-level tags into line
 * breaks, decodes common entities, drops <head>/<style>/<script>, and —
 * the one thing quote trimming needs — prefixes every line inside a
 * <blockquote> with ">" per nesting level. Gmail, Apple Mail and Outlook
 * all wrap quoted history in blockquotes or attribution lines, so the
 * text-based trimmer (`quoteTrim.ts`) then handles HTML-only mail the
 * same way as plain-text mail. The output is never rendered as HTML.
 */

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'br', 'dd', 'div', 'dl', 'dt', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decodes named (`&amp;` …) and numeric (`&#39;`, `&#x2014;`) entities; unknown ones are kept. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    const lower = body.toLowerCase();
    if (lower.startsWith('#')) {
      const code = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[lower] ?? whole;
  });
}

/**
 * Converts an email's HTML to plain text with quoted (blockquote) lines
 * prefixed by ">" (">>" when nested).
 *
 * Line rules: a block tag ends the current line (never adding an empty
 * one, so nested <div>s don't stack blank lines); <br> always ends a
 * line, so <br><br> keeps a blank line; <p> and the outermost
 * <blockquote> start a new paragraph (one blank line). At most one blank
 * line in a row; result trimmed.
 */
export function htmlToText(html: string): string {
  const source = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, '');

  const lines: string[] = [];
  let current = '';
  let depth = 0;
  let currentDepth = 0;

  const endLine = (force = false) => {
    const text = current.trim();
    if (text) lines.push(`${currentDepth > 0 ? `${'>'.repeat(currentDepth)} ` : ''}${text}`);
    else if (force) lines.push('');
    current = '';
    currentDepth = depth;
  };
  const paragraphBreak = () => {
    endLine();
    if (lines.length && lines[lines.length - 1] !== '') lines.push('');
  };

  for (const token of source.match(/<[^>]*>|[^<]+/g) ?? []) {
    if (token.startsWith('<')) {
      const tag = /^<\s*(\/)?\s*([a-z0-9]+)/i.exec(token);
      if (!tag) continue;
      const closing = Boolean(tag[1]);
      const name = tag[2].toLowerCase();
      if (name === 'blockquote') {
        if (!closing && depth === 0) paragraphBreak();
        else endLine();
        depth = Math.max(0, depth + (closing ? -1 : 1));
        currentDepth = depth;
      } else if (name === 'br') {
        endLine(true);
      } else if (name === 'p') {
        paragraphBreak();
      } else if (BLOCK_TAGS.has(name)) {
        endLine();
      }
      continue;
    }
    const text = decodeEntities(token).replace(/\s+/g, ' ');
    if (!current.trim()) {
      currentDepth = depth;
      current = text.trimStart();
    } else {
      current += text;
    }
  }
  endLine();

  return lines
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
```

- [ ] **Step 5: Run htmlToText tests**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/api && pnpm vitest run src/lib/inbox/htmlToText.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Write the test helper `testEml.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * TEST-ONLY helper: builds a small RFC 5322 message as bytes, so parser
 * and sync tests run real messages through postal-mime instead of
 * hand-made ParsedMessage objects. Not imported by any runtime module
 * (the Worker bundle tree-shakes it away).
 */

/** Header and body inputs for {@link eml}. Ids are given WITHOUT angle brackets. */
export interface EmlOptions {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  /** RFC 2822 date, e.g. 'Mon, 20 Oct 2026 10:00:00 -0400'. */
  date: string;
  id?: string;
  inReplyTo?: string;
  /** Raw References header value, e.g. '<a@x> <b@x>'. */
  references?: string;
  body: string;
  /** Defaults to text/plain; pass 'text/html' for an HTML-only message. */
  contentType?: string;
}

/** Encodes the message with CRLF line endings. */
export function eml(o: EmlOptions): Uint8Array {
  const lines = [
    `From: ${o.from}`,
    `To: ${o.to}`,
    ...(o.cc ? [`Cc: ${o.cc}`] : []),
    `Subject: ${o.subject}`,
    `Date: ${o.date}`,
    ...(o.id ? [`Message-ID: <${o.id}>`] : []),
    ...(o.inReplyTo ? [`In-Reply-To: <${o.inReplyTo}>`] : []),
    ...(o.references ? [`References: ${o.references}`] : []),
    'MIME-Version: 1.0',
    `Content-Type: ${o.contentType ?? 'text/plain'}; charset=utf-8`,
    'Content-Transfer-Encoding: 8bit',
    '',
    o.body.replace(/\r?\n/g, '\r\n'),
  ];
  return new TextEncoder().encode(lines.join('\r\n'));
}
```

- [ ] **Step 7: Write the failing parse tests**

`apps/api/src/lib/inbox/parse.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins MIME parsing into the sync's ParsedMessage: ids without brackets,
 * References split and capped, lower-cased addresses, Date fallback,
 * HTML-only bodies converted with quote markers, attachment metadata,
 * and the 200 000-character text cap.
 */

import { describe, expect, it } from 'vitest';
import { MAX_TEXT_CHARS, normalizeMessageId, parseMessage, parseReferences } from './parse';
import { eml } from './testEml';

const RECEIVED = new Date('2026-10-21T12:00:00Z');

describe('parseMessage', () => {
  it('reads headers and the text body', async () => {
    const msg = await parseMessage(
      eml({
        from: 'Jane Doe <Jane@Example.com>',
        to: 'Blinds Nisa <info@blindsnisa.com>',
        cc: 'bob@example.com',
        subject: 'Re: Quote',
        date: 'Mon, 20 Oct 2026 10:00:00 -0400',
        id: 'abc@mail.example.com',
        inReplyTo: 'orig@blindsnisa.com',
        references: '<root@blindsnisa.com> <orig@blindsnisa.com>',
        body: 'Sounds good.\n',
      }),
      RECEIVED
    );
    expect(msg).toMatchObject({
      messageId: 'abc@mail.example.com',
      inReplyTo: 'orig@blindsnisa.com',
      references: ['root@blindsnisa.com', 'orig@blindsnisa.com'],
      sentAt: '2026-10-20T14:00:00.000Z',
      from: { address: 'jane@example.com', name: 'Jane Doe' },
      to: [{ address: 'info@blindsnisa.com', name: 'Blinds Nisa' }],
      cc: [{ address: 'bob@example.com', name: '' }],
      subject: 'Re: Quote',
      attachments: [],
    });
    expect(msg.textBody.trim()).toBe('Sounds good.');
  });

  it('falls back to the receive time and null ids', async () => {
    const msg = await parseMessage(
      eml({ from: 'a@x.com', to: 'info@blindsnisa.com', subject: 'Hi', date: 'not a date', body: 'x' }),
      RECEIVED
    );
    expect(msg.sentAt).toBe(RECEIVED.toISOString());
    expect(msg.messageId).toBeNull();
    expect(msg.inReplyTo).toBeNull();
    expect(msg.references).toEqual([]);
  });

  it('converts an HTML-only body with quote markers', async () => {
    const msg = await parseMessage(
      eml({
        from: 'a@x.com',
        to: 'info@blindsnisa.com',
        subject: 'Hi',
        date: 'Mon, 20 Oct 2026 10:00:00 -0400',
        contentType: 'text/html',
        body: '<div>Yes</div><blockquote>old</blockquote>',
      }),
      RECEIVED
    );
    expect(msg.textBody).toBe('Yes\n\n> old');
  });

  it('caps the text body', async () => {
    const msg = await parseMessage(
      eml({ from: 'a@x.com', to: 'b@x.com', subject: 'Big', date: 'Mon, 20 Oct 2026 10:00:00 -0400', body: 'a'.repeat(MAX_TEXT_CHARS + 500) }),
      RECEIVED
    );
    expect(msg.textBody.length).toBe(MAX_TEXT_CHARS);
  });

  it('lists attachment names and sizes', async () => {
    const raw = new TextEncoder().encode(
      [
        'From: a@x.com',
        'To: info@blindsnisa.com',
        'Subject: Photo',
        'Date: Mon, 20 Oct 2026 10:00:00 -0400',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="b1"',
        '',
        '--b1',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'See attached.',
        '--b1',
        'Content-Type: image/png; name="window.png"',
        'Content-Disposition: attachment; filename="window.png"',
        'Content-Transfer-Encoding: base64',
        '',
        'iVBORw0KGgo=',
        '--b1--',
        '',
      ].join('\r\n')
    );
    const msg = await parseMessage(raw, RECEIVED);
    expect(msg.attachments).toEqual([{ filename: 'window.png', mime_type: 'image/png', size: 8 }]);
    expect(msg.textBody.trim()).toBe('See attached.');
  });
});

describe('normalizeMessageId / parseReferences', () => {
  it('strips angle brackets and rejects whitespace ids', () => {
    expect(normalizeMessageId('<a@b>')).toBe('a@b');
    expect(normalizeMessageId(' a@b ')).toBe('a@b');
    expect(normalizeMessageId('a b')).toBeNull();
    expect(normalizeMessageId(undefined)).toBeNull();
  });

  it('dedupes and keeps the last 20 references', () => {
    const many = Array.from({ length: 25 }, (_, i) => `<r${i}@x>`).join(' ');
    const refs = parseReferences(`${many} <r24@x>`);
    expect(refs).toHaveLength(20);
    expect(refs[0]).toBe('r5@x');
    expect(refs[19]).toBe('r24@x');
  });
});
```

- [ ] **Step 8: Run to verify failure**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/api && pnpm vitest run src/lib/inbox/parse.test.ts`
Expected: FAIL, "Failed to resolve import ./parse".

- [ ] **Step 9: Write `parse.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Raw RFC 5322 bytes → {@link ParsedMessage}, using postal-mime (pinned
 * at 2.7.6; it runs in Workers and in Node).
 *
 * Normalises what the threading and storage layers rely on: ids without
 * angle brackets, at most the last 20 References ids, lower-cased
 * addresses with groups flattened, an ISO date (falling back to when the
 * message was fetched), and one plain-text body — the text/plain part
 * when present, else the HTML converted by `htmlToText` (blockquotes
 * become ">" lines for the quote trimmer). The body is capped at
 * {@link MAX_TEXT_CHARS}. Attachments are reduced to name, type and
 * size; their bytes are dropped. Throws when postal-mime cannot parse
 * the input at all; the sync stores a placeholder in that case.
 */

import PostalMime from 'postal-mime';
import { htmlToText } from './htmlToText';
import type { AttachmentMeta, Mailbox, ParsedMessage } from './types';

/** Longest stored text body, in characters. */
export const MAX_TEXT_CHARS = 200_000;

/** References ids kept per message (the most recent ones). */
const MAX_REFERENCES = 20;

/** postal-mime's address shape: a mailbox, or a named group of mailboxes. */
interface PmAddress {
  name?: string;
  address?: string;
  group?: PmAddress[];
}

/** `<id@host>` or `id@host` → `id@host`; null when absent or containing whitespace. */
export function normalizeMessageId(value: string | null | undefined): string | null {
  if (!value) return null;
  const bracketed = /<([^>]+)>/.exec(value);
  const id = (bracketed ? bracketed[1] : value).trim();
  return id && !/\s/.test(id) ? id : null;
}

/** A References header → its ids in order, deduplicated, last {@link MAX_REFERENCES} kept. */
export function parseReferences(value: string | null | undefined): string[] {
  if (!value) return [];
  const bracketed = [...value.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim()).filter(Boolean);
  const ids = bracketed.length ? bracketed : value.split(/\s+/).filter(Boolean);
  return [...new Set(ids)].slice(-MAX_REFERENCES);
}

/** Flattens postal-mime addresses (including groups) into lower-cased mailboxes. */
function flatten(list: PmAddress | PmAddress[] | undefined): Mailbox[] {
  const items = !list ? [] : Array.isArray(list) ? list : [list];
  return items.flatMap((a): Mailbox[] => {
    if (a.group) return flatten(a.group);
    const address = (a.address ?? '').trim().toLowerCase();
    return address ? [{ address, name: (a.name ?? '').trim() }] : [];
  });
}

/** Parses one message; `receivedAt` is used when the Date header is missing or invalid. */
export async function parseMessage(raw: Uint8Array, receivedAt: Date): Promise<ParsedMessage> {
  const email = await PostalMime.parse(raw);

  const date = email.date ? new Date(email.date) : null;
  const sentAt = date && !Number.isNaN(date.getTime()) ? date : receivedAt;

  const text = email.text && email.text.trim() ? email.text : email.html ? htmlToText(email.html) : '';

  const attachments: AttachmentMeta[] = (email.attachments ?? []).map((a) => ({
    filename: a.filename || '(unnamed)',
    mime_type: a.mimeType || 'application/octet-stream',
    size: typeof a.content === 'string' ? a.content.length : a.content.byteLength,
  }));

  return {
    messageId: normalizeMessageId(email.messageId),
    inReplyTo: normalizeMessageId(email.inReplyTo),
    references: parseReferences(email.references),
    sentAt: sentAt.toISOString(),
    from: flatten(email.from as PmAddress | undefined)[0] ?? { address: '', name: '' },
    to: flatten(email.to as PmAddress[] | undefined),
    cc: flatten(email.cc as PmAddress[] | undefined),
    subject: (email.subject ?? '').trim(),
    textBody: text.replace(/\r\n?/g, '\n').slice(0, MAX_TEXT_CHARS),
    attachments,
  };
}
```

- [ ] **Step 10: Run parse tests and typecheck**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/api && pnpm vitest run src/lib/inbox/parse.test.ts src/lib/inbox/htmlToText.test.ts && pnpm check`
Expected: PASS; no tsc output. If tsc complains about postal-mime types (e.g. `email.from` typed as `Address`), keep the `as PmAddress…` casts and adjust only the cast source type.

- [ ] **Step 11: Commit**

```bash
cd /Users/kemal/Desktop/measure-blinds && git add apps/api/package.json pnpm-lock.yaml apps/api/src/lib/inbox/htmlToText.ts apps/api/src/lib/inbox/htmlToText.test.ts apps/api/src/lib/inbox/parse.ts apps/api/src/lib/inbox/parse.test.ts apps/api/src/lib/inbox/testEml.ts && git commit -m "feat(inbox): MIME parsing with postal-mime and HTML-to-text with quote markers" -- apps/api/package.json pnpm-lock.yaml apps/api/src/lib/inbox/htmlToText.ts apps/api/src/lib/inbox/htmlToText.test.ts apps/api/src/lib/inbox/parse.ts apps/api/src/lib/inbox/parse.test.ts apps/api/src/lib/inbox/testEml.ts
```

---

### Task 4: Quote trimming

**Files:**
- Create: `apps/api/src/lib/inbox/quoteTrim.ts`
- Test: `apps/api/src/lib/inbox/quoteTrim.test.ts`

**Interfaces:**
- Produces: `trimQuotedReply(text: string): string`, `ATTRIBUTION_PATTERNS: RegExp[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins how a reply's quoted history is cut off for the bubble view:
 * "On … wrote:" / "… said:" attribution lines (also when wrapped over
 * two lines), "-----Original Message-----", Outlook header blocks and
 * trailing ">" runs are cut; forwards, interleaved replies and ordinary
 * sentences ending in "said:" are kept; an empty result falls back to
 * the full text.
 */

import { describe, expect, it } from 'vitest';
import { trimQuotedReply } from './quoteTrim';

describe('trimQuotedReply', () => {
  it('cuts a Gmail attribution and quote', () => {
    const text =
      'Sounds good, see you Tuesday.\n\nOn Mon, Oct 20, 2026 at 3:14 PM Blinds Nisa <info@blindsnisa.com> wrote:\n> Hi Jane,\n> Your estimate is ready.';
    expect(trimQuotedReply(text)).toBe('Sounds good, see you Tuesday.');
  });

  it('cuts an attribution wrapped over two lines', () => {
    const text =
      'Thanks!\n\nOn Mon, Oct 20, 2026 at 3:14 PM Blinds Nisa <\ninfo@blindsnisa.com> wrote:\n\n> Hi';
    expect(trimQuotedReply(text)).toBe('Thanks!');
  });

  it('cuts "<address> said:"', () => {
    expect(trimQuotedReply('Yes please.\n\ninfo@blindsnisa.com said:\nHi Jane, here is your quote')).toBe('Yes please.');
    expect(trimQuotedReply('Ok\n\nJane Doe <jane@example.com> said:\nold')).toBe('Ok');
  });

  it('keeps an ordinary sentence ending in "said:"', () => {
    const text = 'My husband said:\nlet us go with white.';
    expect(trimQuotedReply(text)).toBe(text);
  });

  it('cuts an Outlook header block and its separator', () => {
    const text =
      'Confirmed.\n\n________________________________\nFrom: Blinds Nisa <info@blindsnisa.com>\nSent: Monday, October 20, 2026 3:14 PM\nTo: Jane\nSubject: Your estimate\n\nHi Jane';
    expect(trimQuotedReply(text)).toBe('Confirmed.');
  });

  it('cuts at -----Original Message-----', () => {
    expect(trimQuotedReply('Ok\n-----Original Message-----\nFrom: x\nold')).toBe('Ok');
  });

  it('cuts an Apple Mail ">" run', () => {
    const text =
      'Great\n\n> On Oct 20, 2026, at 3:14 PM, Blinds Nisa <info@blindsnisa.com> wrote:\n> \n> Hi';
    expect(trimQuotedReply(text)).toBe('Great');
  });

  it('keeps interleaved replies', () => {
    const text = '> question 1\nanswer 1\n> question 2\nanswer 2';
    expect(trimQuotedReply(text)).toBe(text);
  });

  it('keeps a forwarded message', () => {
    const text =
      'FYI\n\n---------- Forwarded message ---------\nFrom: Supplier <s@supplier.com>\nDate: Mon, Oct 20, 2026 at 3:14 PM\nSubject: Shipment\nTo: <info@blindsnisa.com>\n\nYour order shipped.';
    expect(trimQuotedReply(text)).toBe(text);
  });

  it('falls back to the full text when everything would be cut', () => {
    const text = 'On Mon, Oct 20, 2026 at 3:14 PM Jane <j@x.com> wrote:\n> hi';
    expect(trimQuotedReply(text)).toBe(text);
  });

  it('drops a trailing signature separator and normalises CRLF', () => {
    expect(trimQuotedReply('Thanks\r\n--\r\n\r\nOn Mon, Oct 20, 2026 at 3:14 PM Jane <j@x.com> wrote:\r\n> hi')).toBe('Thanks');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/api && pnpm vitest run src/lib/inbox/quoteTrim.test.ts`
Expected: FAIL, "Failed to resolve import ./quoteTrim".

- [ ] **Step 3: Write `quoteTrim.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Cuts quoted history off an email so a bubble shows only what the
 * sender actually wrote this time.
 *
 * Text-based on purpose: HTML-only mail is first converted by
 * `htmlToText`, which marks blockquotes with ">", so one rule set covers
 * both. The message is cut at the FIRST line that starts quoted history:
 *
 *   - an attribution line ending in "wrote:" or "said:" that starts with
 *     "On " or contains an email address or a clock time (so "My husband
 *     said:" is kept), also when a client wrapped it over two lines
 *   - "-----Original Message-----"
 *   - an Outlook-style header block: "From:" followed within 4 lines by
 *     "Sent:"/"Date:" and "Subject:", unless it belongs to a
 *     "Forwarded message" (a forward's quoted part IS the content)
 *   - a run of ">" lines that continues to the end of the message
 *     (a ">" line followed by unquoted text is an interleaved reply and
 *     is kept whole)
 *
 * Then trailing blank lines, a trailing "--" signature separator and
 * separator rules ("____", "----") are dropped. If nothing is left, the
 * full text is returned instead, so a bubble is never empty. The full
 * text is always kept in `email_messages.text_body` for the "···" reveal.
 */

/** Lines that introduce quoted history. Exported so tests and future tuning see one list. */
export const ATTRIBUTION_PATTERNS: RegExp[] = [
  /^\s*On\s.{1,300}\s(?:wrote|said):\s*$/i,
  /^.{0,300}(?:@|\b\d{1,2}:\d{2}\b).{0,300}\s(?:wrote|said):\s*$/i,
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i,
];

const FROM_LINE = /^\s*\*?From:\*?\s+\S/i;
const SENT_OR_DATE_LINE = /^\s*\*?(?:Sent|Date):\*?\s/i;
const SUBJECT_LINE = /^\s*\*?Subject:\*?/i;
const QUOTED_LINE = /^\s*>/;
const FORWARD_MARKER = /forwarded message|begin forwarded message/i;
const TRAILING_JUNK = /^\s*(?:--|_{3,}|-{3,})\s*$/;

/** True when line `i` (alone, or joined with the next line) is an attribution. */
function isAttribution(lines: string[], i: number): boolean {
  const line = lines[i];
  if (ATTRIBUTION_PATTERNS.some((p) => p.test(line))) return true;
  if (/^\s*On\s/i.test(line) && i + 1 < lines.length) {
    const joined = `${line.trimEnd()} ${lines[i + 1].trim()}`;
    return ATTRIBUTION_PATTERNS.some((p) => p.test(joined));
  }
  return false;
}

/** True when an Outlook-style From/Sent/Subject header block starts at line `i`. */
function isOutlookHeader(lines: string[], i: number): boolean {
  if (!FROM_LINE.test(lines[i])) return false;
  const window = lines.slice(i + 1, i + 5);
  if (!window.some((l) => SENT_OR_DATE_LINE.test(l)) || !window.some((l) => SUBJECT_LINE.test(l))) {
    return false;
  }
  for (let j = i - 1; j >= 0; j--) {
    if (lines[j].trim() === '') continue;
    return !FORWARD_MARKER.test(lines[j]);
  }
  return true;
}

/** True when line `i` starts a ">" run that lasts to the end (blank lines allowed). */
function isTrailingQuoteRun(lines: string[], i: number): boolean {
  if (!QUOTED_LINE.test(lines[i])) return false;
  return lines.slice(i).every((l) => l.trim() === '' || QUOTED_LINE.test(l));
}

/** Index of the first line of quoted history, or -1. */
function findCut(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (isAttribution(lines, i) || isOutlookHeader(lines, i) || isTrailingQuoteRun(lines, i)) return i;
  }
  return -1;
}

/** The new part of a reply (see the module comment for the exact rules). */
export function trimQuotedReply(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const cut = findCut(lines);
  const kept = cut === -1 ? lines : lines.slice(0, cut);
  while (kept.length && (kept[kept.length - 1].trim() === '' || TRAILING_JUNK.test(kept[kept.length - 1]))) {
    kept.pop();
  }
  return kept.join('\n').trim() || normalized.trim();
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/api && pnpm vitest run src/lib/inbox/quoteTrim.test.ts`
Expected: PASS (11 tests). If the forward test fails, check that `isAttribution` doesn't match the forward's "Date: … 3:14 PM" line: it doesn't end in "wrote:"/"said:", so it must not.

- [ ] **Step 5: Commit**

```bash
cd /Users/kemal/Desktop/measure-blinds/apps/api && git add src/lib/inbox/quoteTrim.ts src/lib/inbox/quoteTrim.test.ts && git commit -m "feat(inbox): trim quoted history from replies" -- src/lib/inbox/quoteTrim.ts src/lib/inbox/quoteTrim.test.ts
```

---

### Task 5: Threading decisions

**Files:**
- Create: `apps/api/src/lib/inbox/threading.ts`
- Test: `apps/api/src/lib/inbox/threading.test.ts`

**Interfaces:**
- Consumes: `InboxFolder`, `EmailDirection`, `Mailbox` from `types.ts`.
- Produces: `normalizeSubject(subject: string): string`, `directionOf(folder, fromAddress, mailbox): EmailDirection`, `counterpartOf(direction, from, to, cc, mailbox): Mailbox`, `ThreadRef { threadId: string; createdAt: string }`, `ThreadDecision`, `chooseThread(input): ThreadDecision`, `isLookupSafeId(id: string): boolean`, `subjectFallbackSince(now: Date): string`, `SUBJECT_FALLBACK_DAYS`.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/lib/inbox/threading.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the pure threading rules: subject normalisation, which side a
 * message is on, who the "other party" is, and how header matches,
 * reverse matches and the subject fallback pick (or merge) a thread.
 */

import { describe, expect, it } from 'vitest';
import {
  chooseThread,
  counterpartOf,
  directionOf,
  isLookupSafeId,
  normalizeSubject,
  subjectFallbackSince,
} from './threading';

const SHOP = 'info@blindsnisa.com';

describe('normalizeSubject', () => {
  it.each([
    ['Re: Quote', 'quote'],
    ['RE: Fwd: re:  Quote  for  kitchen', 'quote for kitchen'],
    ['Re[2]: Quote', 'quote'],
    ['AW: SV: Quote', 'quote'],
    ['[External] Re: Quote', 'quote'],
    ['', ''],
  ])('%s → %s', (input, expected) => {
    expect(normalizeSubject(input)).toBe(expected);
  });
});

describe('directionOf', () => {
  it('is out for the Sent folder or the shop sender, else in', () => {
    expect(directionOf('sent', 'someone@else.com', SHOP)).toBe('out');
    expect(directionOf('inbox', SHOP, SHOP)).toBe('out');
    expect(directionOf('inbox', 'jane@example.com', SHOP)).toBe('in');
  });
});

describe('counterpartOf', () => {
  const jane = { address: 'jane@example.com', name: 'Jane' };
  const shop = { address: SHOP, name: 'Blinds Nisa' };

  it('is the sender for incoming mail', () => {
    expect(counterpartOf('in', jane, [shop], [], SHOP)).toEqual(jane);
  });

  it('is the first non-shop recipient for outgoing mail', () => {
    expect(counterpartOf('out', shop, [shop, jane], [], SHOP)).toEqual(jane);
  });

  it('falls back to CC, then to the shop itself', () => {
    expect(counterpartOf('out', shop, [shop], [jane], SHOP)).toEqual(jane);
    expect(counterpartOf('out', shop, [shop], [], SHOP)).toEqual({ address: SHOP, name: '' });
  });
});

describe('chooseThread', () => {
  const older = { threadId: 't-old', createdAt: '2026-10-01T00:00:00Z' };
  const newer = { threadId: 't-new', createdAt: '2026-10-05T00:00:00Z' };

  it('joins a header match', () => {
    expect(chooseThread({ headerMatches: [newer], reverseMatches: [], subjectMatch: 'x' })).toEqual({
      kind: 'join',
      threadId: 't-new',
      mergeThreadIds: [],
    });
  });

  it('joins a reverse match (reply stored before its parent)', () => {
    expect(chooseThread({ headerMatches: [], reverseMatches: [older], subjectMatch: null })).toEqual({
      kind: 'join',
      threadId: 't-old',
      mergeThreadIds: [],
    });
  });

  it('merges into the oldest when matches point at different threads', () => {
    expect(chooseThread({ headerMatches: [newer], reverseMatches: [older, newer], subjectMatch: null })).toEqual({
      kind: 'join',
      threadId: 't-old',
      mergeThreadIds: ['t-new'],
    });
  });

  it('uses the subject match only without header matches', () => {
    expect(chooseThread({ headerMatches: [], reverseMatches: [], subjectMatch: 't-subj' })).toEqual({
      kind: 'join',
      threadId: 't-subj',
      mergeThreadIds: [],
    });
  });

  it('starts a new thread otherwise', () => {
    expect(chooseThread({ headerMatches: [], reverseMatches: [], subjectMatch: null })).toEqual({ kind: 'new' });
  });
});

describe('isLookupSafeId / subjectFallbackSince', () => {
  it('rejects ids that would break a PostgREST filter', () => {
    expect(isLookupSafeId('abc@mail.gmail.com')).toBe(true);
    expect(isLookupSafeId('a,b@x')).toBe(false);
    expect(isLookupSafeId('a"b@x')).toBe(false);
    expect(isLookupSafeId('a{b}@x')).toBe(false);
    expect(isLookupSafeId('')).toBe(false);
  });

  it('is 60 days back', () => {
    expect(subjectFallbackSince(new Date('2026-10-21T00:00:00Z'))).toBe('2026-08-22T00:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/api && pnpm vitest run src/lib/inbox/threading.test.ts`
Expected: FAIL, "Failed to resolve import ./threading".

- [ ] **Step 3: Write `threading.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pure threading rules for the Titan inbox: no I/O, so every case is a
 * unit test. The sync gathers the lookups (which stored threads contain
 * a message this one replies to, which stored threads reply to this one,
 * which thread has the same subject with the same other party) and asks
 * `chooseThread` what to do.
 *
 * Preference order: header matches and reverse header matches (a reply
 * that was stored before its parent) beat the subject fallback. When the
 * headers point at more than one thread they are the same conversation,
 * so the newer threads are merged into the oldest. The subject fallback
 * (same normalised subject + same counterpart, last message within
 * {@link SUBJECT_FALLBACK_DAYS}) covers clients that drop the headers and
 * replies to app-sent (Resend) mail whose ids we never stored.
 */

import type { EmailDirection, InboxFolder, Mailbox } from './types';

/** How far back the subject fallback looks for a conversation to join. */
export const SUBJECT_FALLBACK_DAYS = 60;

const SUBJECT_PREFIX = /^(?:(?:re|fw|fwd|aw|sv|wg|tr|antw|ré)\s*(?:\[\d+\]|\(\d+\))?\s*:|\[[^\]]{1,40}\])\s*/i;

/**
 * Lower-cased subject with reply/forward prefixes ("Re:", "Fwd:",
 * "AW:", "Re[2]:" …) and bracket tags ("[External]") repeatedly removed
 * and whitespace collapsed. '' stays '' (and never subject-matches).
 */
export function normalizeSubject(subject: string): string {
  let s = subject.replace(/\s+/g, ' ').trim();
  for (let previous = ''; previous !== s; ) {
    previous = s;
    s = s.replace(SUBJECT_PREFIX, '').trim();
  }
  return s.toLowerCase();
}

/**
 * `out` when the message was read from the Sent folder or was sent by the
 * shop mailbox (e.g. a copy to self in INBOX), else `in`. `mailbox` must
 * be lower-cased.
 */
export function directionOf(folder: InboxFolder, fromAddress: string, mailbox: string): EmailDirection {
  return folder === 'sent' || fromAddress === mailbox ? 'out' : 'in';
}

/**
 * The other party of a message: the sender of an incoming one; for an
 * outgoing one, the first To recipient that isn't the shop, else the
 * first such CC, else the shop itself (a note to self).
 */
export function counterpartOf(
  direction: EmailDirection,
  from: Mailbox,
  to: Mailbox[],
  cc: Mailbox[],
  mailbox: string
): Mailbox {
  if (direction === 'in') return from;
  return [...to, ...cc].find((m) => m.address && m.address !== mailbox) ?? { address: mailbox, name: '' };
}

/** A stored thread found by a lookup, with its creation time (merge keeps the oldest). */
export interface ThreadRef {
  threadId: string;
  createdAt: string;
}

/** What to do with a new message. `mergeThreadIds` fold into `threadId` first. */
export type ThreadDecision =
  | { kind: 'join'; threadId: string; mergeThreadIds: string[] }
  | { kind: 'new' };

/** Decides the thread for a message from the three lookups (see module comment). */
export function chooseThread(input: {
  headerMatches: ThreadRef[];
  reverseMatches: ThreadRef[];
  subjectMatch: string | null;
}): ThreadDecision {
  const byId = new Map<string, ThreadRef>();
  for (const ref of [...input.headerMatches, ...input.reverseMatches]) byId.set(ref.threadId, ref);
  if (byId.size > 0) {
    const ordered = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { kind: 'join', threadId: ordered[0].threadId, mergeThreadIds: ordered.slice(1).map((r) => r.threadId) };
  }
  if (input.subjectMatch) return { kind: 'join', threadId: input.subjectMatch, mergeThreadIds: [] };
  return { kind: 'new' };
}

/**
 * True for message ids safe to pass to PostgREST `in` / `cs` filters:
 * non-empty, at most 250 characters, none of `, ( ) { } " \` or whitespace.
 * Unsafe ids are simply not used for lookups (the subject fallback still applies).
 */
export function isLookupSafeId(id: string): boolean {
  return id.length > 0 && id.length <= 250 && !/[\s,(){}"\\]/.test(id);
}

/** ISO timestamp {@link SUBJECT_FALLBACK_DAYS} before `now`. */
export function subjectFallbackSince(now: Date): string {
  return new Date(now.getTime() - SUBJECT_FALLBACK_DAYS * 86_400_000).toISOString();
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/api && pnpm vitest run src/lib/inbox/threading.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/kemal/Desktop/measure-blinds/apps/api && git add src/lib/inbox/threading.ts src/lib/inbox/threading.test.ts && git commit -m "feat(inbox): pure threading rules" -- src/lib/inbox/threading.ts src/lib/inbox/threading.test.ts
```

---

### Task 6: Filter rules

**Files:**
- Create: `apps/api/src/lib/inbox/rules.ts`
- Test: `apps/api/src/lib/inbox/rules.test.ts`

**Interfaces:**
- Consumes: `EMAIL_CATEGORIES`, `EmailCategory` from `types.ts`.
- Produces: `RULE_FIELDS`, `RULE_MATCH_TYPES`, `RULE_ACTIONS`, types `RuleField`, `RuleMatchType`, `RuleAction`, `EmailRule { id; position; field; match_type; value; action; enabled }`, `Classification`, `ClassifyInput { counterpart; subject; body }`, `ruleMatches(rule, input): boolean`, `classify(input, rules): Classification`.

- [ ] **Step 1: Write the failing tests**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins rule evaluation: each field × match type against the
 * counterpart/subject/body, case-insensitivity and trimming, first match
 * by position, disabled rules skipped, `ignore`, and the `other` fallback.
 */

import { describe, expect, it } from 'vitest';
import { classify, ruleMatches, type EmailRule } from './rules';

const input = { counterpart: 'orders@AcmeBlinds.com', subject: 'Shipment for PO 1042', body: 'Your order has shipped.' };

function rule(over: Partial<EmailRule>): EmailRule {
  return { id: 'r', position: 0, field: 'domain', match_type: 'equals', value: 'acmeblinds.com', action: 'supplier', enabled: true, ...over };
}

describe('ruleMatches', () => {
  it.each<[Partial<EmailRule>, boolean]>([
    [{ field: 'address', match_type: 'equals', value: ' Orders@acmeblinds.com ' }, true],
    [{ field: 'address', match_type: 'contains', value: 'acme' }, true],
    [{ field: 'address', match_type: 'ends_with', value: '@acmeblinds.com' }, true],
    [{ field: 'domain', match_type: 'equals', value: 'acmeblinds.com' }, true],
    [{ field: 'domain', match_type: 'equals', value: 'blinds.com' }, false],
    [{ field: 'domain', match_type: 'ends_with', value: 'blinds.com' }, true],
    [{ field: 'subject', match_type: 'contains', value: 'shipment' }, true],
    [{ field: 'subject', match_type: 'equals', value: 'shipment' }, false],
    [{ field: 'body', match_type: 'contains', value: 'HAS SHIPPED' }, true],
    [{ field: 'body', match_type: 'contains', value: '   ' }, false],
  ])('%o → %s', (over, expected) => {
    expect(ruleMatches(rule(over), input)).toBe(expected);
  });
});

describe('classify', () => {
  it('returns the first enabled match by position', () => {
    const rules = [
      rule({ id: 'b', position: 2, field: 'subject', match_type: 'contains', value: 'shipment', action: 'other' }),
      rule({ id: 'a', position: 1, action: 'supplier' }),
    ];
    expect(classify(input, rules)).toEqual({ action: 'category', category: 'supplier' });
  });

  it('skips disabled rules', () => {
    expect(classify(input, [rule({ enabled: false })])).toEqual({ action: 'category', category: 'other' });
  });

  it('returns ignore', () => {
    expect(classify(input, [rule({ action: 'ignore' })])).toEqual({ action: 'ignore' });
  });

  it('falls back to other', () => {
    expect(classify(input, [])).toEqual({ action: 'category', category: 'other' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/api && pnpm vitest run src/lib/inbox/rules.test.ts`
Expected: FAIL, "Failed to resolve import ./rules".

- [ ] **Step 3: Write `rules.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Staff-editable filter rules for the Titan inbox (Settings → Email
 * Rules), and the pure function that applies them.
 *
 * A rule tests one field — the conversation's other party's address or
 * domain, the subject, or the new message's trimmed text — with
 * contains / equals / ends-with, case-insensitively, and either assigns
 * a category or says "ignore" (never store the conversation). Enabled
 * rules run in `position` order and the first match wins; no match
 * means `other`. Rules run only when a message starts a new
 * conversation (and on "Re-apply rules"); later messages inherit the
 * thread's category. The constants mirror migration 45's CHECKs and are
 * reused by the route's Zod schemas.
 */

import { EMAIL_CATEGORIES, type EmailCategory } from './types';

/** What a rule looks at. `address`/`domain` mean the counterpart, not the raw From. */
export const RULE_FIELDS = ['address', 'domain', 'subject', 'body'] as const;
/** How the value is compared. */
export const RULE_MATCH_TYPES = ['contains', 'equals', 'ends_with'] as const;
/** A category, or `ignore`. */
export const RULE_ACTIONS = [...EMAIL_CATEGORIES, 'ignore'] as const;

/** One of {@link RULE_FIELDS}. */
export type RuleField = (typeof RULE_FIELDS)[number];
/** One of {@link RULE_MATCH_TYPES}. */
export type RuleMatchType = (typeof RULE_MATCH_TYPES)[number];
/** One of {@link RULE_ACTIONS}. */
export type RuleAction = (typeof RULE_ACTIONS)[number];

/** An `email_rules` row as the classifier needs it. */
export interface EmailRule {
  id: string;
  position: number;
  field: RuleField;
  match_type: RuleMatchType;
  value: string;
  action: RuleAction;
  enabled: boolean;
}

/** The classifier's verdict. */
export type Classification = { action: 'category'; category: EmailCategory } | { action: 'ignore' };

/** What rules are tested against: counterpart address, subject, new message text. */
export interface ClassifyInput {
  counterpart: string;
  subject: string;
  body: string;
}

/** The text a field refers to. */
function fieldText(field: RuleField, input: ClassifyInput): string {
  switch (field) {
    case 'address':
      return input.counterpart;
    case 'domain':
      return input.counterpart.split('@')[1] ?? '';
    case 'subject':
      return input.subject;
    case 'body':
      return input.body;
  }
}

/** True when `rule` matches `input` (case-insensitive; a blank value never matches). */
export function ruleMatches(rule: EmailRule, input: ClassifyInput): boolean {
  const needle = rule.value.trim().toLowerCase();
  if (!needle) return false;
  const haystack = fieldText(rule.field, input).trim().toLowerCase();
  switch (rule.match_type) {
    case 'contains':
      return haystack.includes(needle);
    case 'equals':
      return haystack === needle;
    case 'ends_with':
      return haystack.endsWith(needle);
  }
}

/** First enabled matching rule by position decides; otherwise `other`. */
export function classify(input: ClassifyInput, rules: EmailRule[]): Classification {
  const ordered = rules.filter((r) => r.enabled).sort((a, b) => a.position - b.position);
  for (const rule of ordered) {
    if (!ruleMatches(rule, input)) continue;
    return rule.action === 'ignore' ? { action: 'ignore' } : { action: 'category', category: rule.action };
  }
  return { action: 'category', category: 'other' };
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/api && pnpm vitest run src/lib/inbox/rules.test.ts && pnpm check`
Expected: PASS; no tsc output.

- [ ] **Step 5: Commit**

```bash
cd /Users/kemal/Desktop/measure-blinds/apps/api && git add src/lib/inbox/rules.ts src/lib/inbox/rules.test.ts && git commit -m "feat(inbox): filter rules and classifier" -- src/lib/inbox/rules.ts src/lib/inbox/rules.test.ts
```

---

### Task 7: Store, sync orchestration and the cron

**Files:**
- Create: `apps/api/src/lib/inbox/store.ts`, `apps/api/src/lib/inbox/sync.ts`, `apps/api/src/lib/inbox/run.ts`
- Test: `apps/api/src/lib/inbox/store.test.ts`, `apps/api/src/lib/inbox/sync.test.ts`
- Modify: `apps/api/src/index.ts` (Env fields + cron dispatch)
- Modify: `apps/api/wrangler.toml`

**Interfaces:**
- Consumes: everything from Tasks 2–6.
- Produces: `InboxStore`, `SyncCursor`, `CursorUpdate`, `NewThread`, `NewMessage`, `createSupabaseInboxStore(sb)`, `escapeLikeValue(value)`; `syncInbox(deps: SyncDeps): Promise<SyncReport>`, `FETCH_LIMIT_PER_FOLDER`, `UNREADABLE_TEXT`; `runInboxSync(env: Env): Promise<void>`, `INBOX_SYNC_CRON = '*/5 * * * *'`.

- [ ] **Step 1: Write the failing store tests**

`apps/api/src/lib/inbox/store.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the Supabase store's few non-trivial mappings: ILIKE escaping for
 * customer email matching, "exactly one customer" linking, and a 23505
 * unique violation on insert reported as a duplicate instead of thrown.
 */

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseInboxStore, escapeLikeValue, type NewMessage } from './store';

/** Chainable fake whose terminal await resolves to `result`. Records calls. */
function fakeSb(result: { data?: unknown; error?: unknown }) {
  const calls: Array<[string, unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'eq', 'ilike', 'is', 'limit']) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return builder;
    };
  }
  builder.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(onF, onR);
  const sb = { from: (table: string) => (calls.push(['from', [table]]), builder) } as unknown as SupabaseClient;
  return { sb, calls };
}

const message: NewMessage = {
  threadId: 't1', messageId: 'm1', inReplyTo: null, referenceIds: [], direction: 'in', folder: 'inbox',
  imapUid: 1, uidValidity: 1, sentAt: '2026-10-21T00:00:00Z', fromAddress: 'a@x.com', fromName: '',
  toAddresses: [], ccAddresses: [], subject: '', textBody: '', replyText: '', attachments: [],
};

describe('escapeLikeValue', () => {
  it('escapes LIKE wildcards and refuses PostgREST *', () => {
    expect(escapeLikeValue('first_last%@x.com')).toBe('first\\_last\\%@x.com');
    expect(escapeLikeValue('a*b@x.com')).toBeNull();
  });
});

describe('customerIdByEmail', () => {
  it('links exactly one live customer', async () => {
    const { sb, calls } = fakeSb({ data: [{ id: 'c1' }] });
    expect(await createSupabaseInboxStore(sb).customerIdByEmail('jane@example.com')).toBe('c1');
    expect(calls).toContainEqual(['is', ['deleted_at', null]]);
    expect(calls).toContainEqual(['ilike', ['email', 'jane@example.com']]);
  });

  it('links nothing when two customers share the address', async () => {
    const { sb } = fakeSb({ data: [{ id: 'c1' }, { id: 'c2' }] });
    expect(await createSupabaseInboxStore(sb).customerIdByEmail('jane@example.com')).toBeNull();
  });
});

describe('insertMessage', () => {
  it('maps a unique violation to duplicate', async () => {
    const { sb } = fakeSb({ error: { code: '23505', message: 'duplicate key' } });
    expect(await createSupabaseInboxStore(sb).insertMessage(message)).toBe('duplicate');
  });

  it('throws other errors', async () => {
    const { sb } = fakeSb({ error: { code: '500', message: 'boom' } });
    await expect(createSupabaseInboxStore(sb).insertMessage(message)).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/api && pnpm vitest run src/lib/inbox/store.test.ts`
Expected: FAIL, "Failed to resolve import ./store".

- [ ] **Step 3: Write `store.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Persistence for the Titan inbox sync, behind an interface so
 * `sync.ts` is tested against an in-memory fake and only this file
 * knows table and column names.
 *
 * Every method throws on a database error (the sync then retries that
 * message next run) except `insertMessage`, which reports a 23505
 * unique violation on `message_id` as `'duplicate'` — the normal outcome
 * when two runs overlap. Thread summaries and merges run in SQL
 * (`refresh_email_thread`, `merge_email_threads`, migration 45) so they
 * are atomic. Customer linking matches the counterpart address against
 * live customers case-insensitively and links only when exactly one
 * matches.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmailRule } from './rules';
import type { ThreadRef } from './threading';
import type { AttachmentMeta, EmailCategory, EmailDirection, InboxFolder } from './types';

/** A folder's stored cursor (nullable columns: a row may hold only an error). */
export interface SyncCursor {
  folderName: string;
  uidValidity: number | null;
  lastUid: number | null;
}

/** New cursor position after a run; `error` null marks the run successful. */
export interface CursorUpdate {
  folderName: string;
  uidValidity: number;
  lastUid: number;
  error: string | null;
}

/** A conversation created by its first stored message. */
export interface NewThread {
  subject: string;
  normalizedSubject: string;
  counterpartAddress: string;
  counterpartName: string;
  category: EmailCategory;
  customerId: string | null;
  firstMessageAt: string;
}

/** One `email_messages` row in camelCase. */
export interface NewMessage {
  threadId: string;
  messageId: string;
  inReplyTo: string | null;
  referenceIds: string[];
  direction: EmailDirection;
  folder: InboxFolder;
  imapUid: number;
  uidValidity: number;
  sentAt: string;
  fromAddress: string;
  fromName: string;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string;
  textBody: string;
  replyText: string;
  attachments: AttachmentMeta[];
}

/** Everything the sync reads and writes. */
export interface InboxStore {
  getCursor(folder: InboxFolder): Promise<SyncCursor | null>;
  saveCursor(folder: InboxFolder, update: CursorUpdate): Promise<void>;
  /** Records a failed run for the Settings status line; leaves the cursor alone. */
  recordError(folder: InboxFolder, message: string): Promise<void>;
  messageExists(messageId: string): Promise<boolean>;
  /** Threads containing any of these message ids. */
  threadsByMessageIds(messageIds: string[]): Promise<ThreadRef[]>;
  /** Threads with a message whose In-Reply-To or References names `messageId`. */
  threadsReferencing(messageId: string): Promise<ThreadRef[]>;
  /** Most recent thread with this counterpart + normalised subject active since `sinceIso`. */
  threadBySubject(counterpart: string, normalizedSubject: string, sinceIso: string): Promise<string | null>;
  enabledRules(): Promise<EmailRule[]>;
  /** The one live customer with this email, else null. */
  customerIdByEmail(email: string): Promise<string | null>;
  createThread(thread: NewThread): Promise<string>;
  insertMessage(message: NewMessage): Promise<'inserted' | 'duplicate'>;
  mergeThreads(keepId: string, dropIds: string[]): Promise<void>;
  /** Recomputes summary columns; `reopen` moves a handled thread back to new. */
  refreshThread(threadId: string, reopen: boolean): Promise<void>;
}

/**
 * Escapes `\`, `%` and `_` for an ILIKE exact match. Returns null for a
 * value containing `*`, which PostgREST treats as a wildcard and cannot
 * be escaped; such an address is simply not auto-linked.
 */
export function escapeLikeValue(value: string): string | null {
  if (value.includes('*')) return null;
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Wraps a PostgREST error with what was being done. */
function failure(what: string, error: { message: string }): Error {
  return new Error(`${what}: ${error.message}`);
}

/** The Supabase-backed store used by the cron (service-role client). */
export function createSupabaseInboxStore(sb: SupabaseClient): InboxStore {
  async function refs(threadIds: string[]): Promise<ThreadRef[]> {
    const unique = [...new Set(threadIds)];
    if (unique.length === 0) return [];
    const { data, error } = await sb.from('email_threads').select('id, created_at').in('id', unique);
    if (error) throw failure('Load threads', error);
    return (data ?? []).map((t) => ({ threadId: t.id as string, createdAt: t.created_at as string }));
  }

  return {
    async getCursor(folder) {
      const { data, error } = await sb
        .from('email_sync_state')
        .select('folder_name, uid_validity, last_uid')
        .eq('folder', folder)
        .maybeSingle();
      if (error) throw failure('Load sync cursor', error);
      if (!data) return null;
      return {
        folderName: data.folder_name as string,
        uidValidity: data.uid_validity === null ? null : Number(data.uid_validity),
        lastUid: data.last_uid === null ? null : Number(data.last_uid),
      };
    },

    async saveCursor(folder, u) {
      const now = new Date().toISOString();
      const { error } = await sb.from('email_sync_state').upsert(
        {
          folder,
          folder_name: u.folderName,
          uid_validity: u.uidValidity,
          last_uid: u.lastUid,
          last_run_at: now,
          last_error: u.error,
          ...(u.error === null ? { last_success_at: now } : {}),
        },
        { onConflict: 'folder' }
      );
      if (error) throw failure('Save sync cursor', error);
    },

    async recordError(folder, message) {
      const { error } = await sb
        .from('email_sync_state')
        .upsert(
          { folder, last_run_at: new Date().toISOString(), last_error: message.slice(0, 500) },
          { onConflict: 'folder' }
        );
      if (error) throw failure('Record sync error', error);
    },

    async messageExists(messageId) {
      const { data, error } = await sb.from('email_messages').select('id').eq('message_id', messageId).limit(1);
      if (error) throw failure('Check message', error);
      return (data ?? []).length > 0;
    },

    async threadsByMessageIds(messageIds) {
      const { data, error } = await sb.from('email_messages').select('thread_id').in('message_id', messageIds);
      if (error) throw failure('Find parent messages', error);
      return refs((data ?? []).map((r) => r.thread_id as string));
    },

    async threadsReferencing(messageId) {
      const [direct, listed] = await Promise.all([
        sb.from('email_messages').select('thread_id').eq('in_reply_to', messageId),
        sb.from('email_messages').select('thread_id').contains('reference_ids', [messageId]),
      ]);
      if (direct.error) throw failure('Find replies', direct.error);
      if (listed.error) throw failure('Find replies', listed.error);
      return refs([...(direct.data ?? []), ...(listed.data ?? [])].map((r) => r.thread_id as string));
    },

    async threadBySubject(counterpart, normalizedSubject, sinceIso) {
      const { data, error } = await sb
        .from('email_threads')
        .select('id')
        .eq('counterpart_address', counterpart)
        .eq('normalized_subject', normalizedSubject)
        .gte('last_message_at', sinceIso)
        .order('last_message_at', { ascending: false })
        .limit(1);
      if (error) throw failure('Find thread by subject', error);
      return (data?.[0]?.id as string | undefined) ?? null;
    },

    async enabledRules() {
      const { data, error } = await sb
        .from('email_rules')
        .select('id, position, field, match_type, value, action, enabled')
        .eq('enabled', true)
        .order('position', { ascending: true });
      if (error) throw failure('Load rules', error);
      return (data ?? []) as EmailRule[];
    },

    async customerIdByEmail(email) {
      const pattern = email ? escapeLikeValue(email) : null;
      if (!pattern) return null;
      const { data, error } = await sb
        .from('customers')
        .select('id')
        .ilike('email', pattern)
        .is('deleted_at', null)
        .limit(2);
      if (error) throw failure('Match customer', error);
      return data && data.length === 1 ? (data[0].id as string) : null;
    },

    async createThread(t) {
      const { data, error } = await sb
        .from('email_threads')
        .insert({
          subject: t.subject,
          normalized_subject: t.normalizedSubject,
          counterpart_address: t.counterpartAddress,
          counterpart_name: t.counterpartName,
          category: t.category,
          customer_id: t.customerId,
          last_message_at: t.firstMessageAt,
        })
        .select('id')
        .single();
      if (error) throw failure('Create thread', error);
      return data.id as string;
    },

    async insertMessage(m) {
      const { error } = await sb.from('email_messages').insert({
        thread_id: m.threadId,
        message_id: m.messageId,
        in_reply_to: m.inReplyTo,
        reference_ids: m.referenceIds,
        direction: m.direction,
        folder: m.folder,
        imap_uid: m.imapUid,
        uid_validity: m.uidValidity,
        sent_at: m.sentAt,
        from_address: m.fromAddress,
        from_name: m.fromName,
        to_addresses: m.toAddresses,
        cc_addresses: m.ccAddresses,
        subject: m.subject,
        text_body: m.textBody,
        reply_text: m.replyText,
        attachments: m.attachments,
      });
      if (!error) return 'inserted';
      if (error.code === '23505') return 'duplicate';
      throw failure('Insert message', error);
    },

    async mergeThreads(keepId, dropIds) {
      const { error } = await sb.rpc('merge_email_threads', { p_keep: keepId, p_drop: dropIds });
      if (error) throw failure('Merge threads', error);
    },

    async refreshThread(threadId, reopen) {
      const { error } = await sb.rpc('refresh_email_thread', { p_thread_id: threadId, p_reopen: reopen });
      if (error) throw failure('Refresh thread', error);
    },
  };
}
```

- [ ] **Step 4: Run store tests**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/api && pnpm vitest run src/lib/inbox/store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing sync tests**

`apps/api/src/lib/inbox/sync.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * End-to-end tests of one sync run with real parsing (postal-mime) but
 * an in-memory mail source and store. Pins: first run only sets cursors;
 * replies from Sent land in the customer's thread as `out`; date order
 * across folders; reverse matching and merges; subject fallback window;
 * ignore rules; dedupe across folders; reopen on incoming only; the
 * 50-per-folder cap; UIDVALIDITY reset; a missing Sent folder; a store
 * failure holding the cursor; and the unreadable-message placeholder.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { FETCH_LIMIT_PER_FOLDER, syncInbox, UNREADABLE_TEXT } from './sync';
import { eml, type EmlOptions } from './testEml';
import type { CursorUpdate, InboxStore, NewMessage, NewThread, SyncCursor } from './store';
import type { EmailRule } from './rules';
import type { ThreadRef } from './threading';
import type { InboxFolder, MailSource, RawMessage } from './types';

const SHOP = 'info@blindsnisa.com';
const NOW = new Date('2026-10-21T12:00:00Z');

interface MemThread extends NewThread {
  id: string;
  createdAt: string;
  status: 'new' | 'handled';
  lastMessageAt: string;
  lastDirection: 'in' | 'out';
}

/** In-memory InboxStore with the same semantics as the Supabase one. */
class MemoryStore implements InboxStore {
  cursors = new Map<InboxFolder, CursorUpdate>();
  errors: Array<[InboxFolder, string]> = [];
  threads: MemThread[] = [];
  messages: NewMessage[] = [];
  rules: EmailRule[] = [];
  customers = new Map<string, string>();
  failInsertFor = new Set<string>();
  private seq = 0;

  async getCursor(folder: InboxFolder): Promise<SyncCursor | null> {
    const c = this.cursors.get(folder);
    return c ? { folderName: c.folderName, uidValidity: c.uidValidity, lastUid: c.lastUid } : null;
  }
  async saveCursor(folder: InboxFolder, update: CursorUpdate) {
    this.cursors.set(folder, update);
  }
  async recordError(folder: InboxFolder, message: string) {
    this.errors.push([folder, message]);
  }
  async messageExists(id: string) {
    return this.messages.some((m) => m.messageId === id);
  }
  async threadsByMessageIds(ids: string[]) {
    return this.refs(this.messages.filter((m) => ids.includes(m.messageId)).map((m) => m.threadId));
  }
  async threadsReferencing(id: string) {
    return this.refs(
      this.messages.filter((m) => m.inReplyTo === id || m.referenceIds.includes(id)).map((m) => m.threadId)
    );
  }
  async threadBySubject(counterpart: string, normalizedSubject: string, sinceIso: string) {
    const hit = this.threads
      .filter((t) => t.counterpartAddress === counterpart && t.normalizedSubject === normalizedSubject && t.lastMessageAt >= sinceIso)
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))[0];
    return hit?.id ?? null;
  }
  async enabledRules() {
    return this.rules.filter((r) => r.enabled);
  }
  async customerIdByEmail(email: string) {
    return this.customers.get(email) ?? null;
  }
  async createThread(t: NewThread) {
    const id = `t${++this.seq}`;
    this.threads.push({
      ...t,
      id,
      createdAt: new Date(Date.UTC(2026, 0, 1) + this.seq * 1000).toISOString(),
      status: 'new',
      lastMessageAt: t.firstMessageAt,
      lastDirection: 'in',
    });
    return id;
  }
  async insertMessage(m: NewMessage) {
    if (this.failInsertFor.has(m.messageId)) throw new Error('db down');
    if (this.messages.some((x) => x.messageId === m.messageId)) return 'duplicate' as const;
    this.messages.push({ ...m });
    return 'inserted' as const;
  }
  async mergeThreads(keepId: string, dropIds: string[]) {
    for (const m of this.messages) if (dropIds.includes(m.threadId)) m.threadId = keepId;
    this.threads = this.threads.filter((t) => !dropIds.includes(t.id));
  }
  async refreshThread(threadId: string, reopen: boolean) {
    const t = this.threads.find((x) => x.id === threadId);
    if (!t) return;
    const msgs = this.messages.filter((m) => m.threadId === threadId);
    if (msgs.length === 0) {
      this.threads = this.threads.filter((x) => x.id !== threadId);
      return;
    }
    const last = [...msgs].sort((a, b) => a.sentAt.localeCompare(b.sentAt)).at(-1)!;
    t.lastMessageAt = last.sentAt;
    t.lastDirection = last.direction;
    if (reopen) t.status = 'new';
  }
  private refs(threadIds: string[]): ThreadRef[] {
    return [...new Set(threadIds)]
      .map((id) => this.threads.find((t) => t.id === id))
      .filter((t): t is MemThread => Boolean(t))
      .map((t) => ({ threadId: t.id, createdAt: t.createdAt }));
  }
  messagesOf(threadId: string) {
    return this.messages.filter((m) => m.threadId === threadId);
  }
}

type Folders = Record<string, { uidValidity: number; messages: RawMessage[] }>;

/** In-memory MailSource with the same cursor semantics as the IMAP one. */
function fakeSource(folders: Folders, sentName: string | null = 'Sent'): MailSource {
  return {
    async findSentFolder() {
      return sentName;
    },
    async readFolder(name, cursor, limit) {
      const f = folders[name] ?? { uidValidity: 1, messages: [] };
      const highestUid = f.messages.reduce((max, m) => Math.max(max, m.uid), 0);
      if (!cursor || cursor.uidValidity !== f.uidValidity || highestUid <= cursor.afterUid) {
        return { uidValidity: f.uidValidity, highestUid, scannedThroughUid: null, messages: [] };
      }
      const messages = f.messages
        .filter((m) => m.uid > cursor.afterUid)
        .sort((a, b) => a.uid - b.uid)
        .slice(0, limit);
      return { uidValidity: f.uidValidity, highestUid, scannedThroughUid: messages.at(-1)?.uid ?? null, messages };
    },
    async close() {},
  };
}

/** A customer message to the shop, as raw bytes at `uid`. */
function incoming(uid: number, o: Partial<EmlOptions> & { id: string }): RawMessage {
  return {
    uid,
    raw: eml({
      from: 'Jane Doe <jane@example.com>',
      to: `Blinds Nisa <${SHOP}>`,
      subject: 'Quote for kitchen',
      date: 'Mon, 20 Oct 2026 10:00:00 -0400',
      body: 'Hello, can I get a quote?',
      ...o,
    }),
  };
}

/** A shop reply to Jane, as raw bytes at `uid`. */
function outgoing(uid: number, o: Partial<EmlOptions> & { id: string }): RawMessage {
  return {
    uid,
    raw: eml({
      from: `Blinds Nisa <${SHOP}>`,
      to: 'Jane Doe <jane@example.com>',
      subject: 'Re: Quote for kitchen',
      date: 'Mon, 20 Oct 2026 11:00:00 -0400',
      body: 'Sure, Tuesday works.\n\nOn Mon, Oct 20, 2026 at 10:00 AM Jane Doe <jane@example.com> wrote:\n> Hello, can I get a quote?',
      ...o,
    }),
  };
}

let store: MemoryStore;

/** Cursors as if a previous run had seen both folders empty. */
function primeCursors() {
  store.cursors.set('inbox', { folderName: 'INBOX', uidValidity: 1, lastUid: 0, error: null });
  store.cursors.set('sent', { folderName: 'Sent', uidValidity: 1, lastUid: 0, error: null });
}

function run(folders: Folders, sentName: string | null = 'Sent') {
  return syncInbox({ source: fakeSource(folders, sentName), store, mailbox: SHOP, now: () => NOW });
}

beforeEach(() => {
  store = new MemoryStore();
});

describe('syncInbox', () => {
  it('first run only records cursors at the highest UID', async () => {
    const report = await run({
      INBOX: { uidValidity: 1, messages: [incoming(7, { id: 'a@x' })] },
      Sent: { uidValidity: 4, messages: [] },
    });
    expect(report.imported).toBe(0);
    expect(store.cursors.get('inbox')).toMatchObject({ folderName: 'INBOX', uidValidity: 1, lastUid: 7 });
    expect(store.cursors.get('sent')).toMatchObject({ folderName: 'Sent', uidValidity: 4, lastUid: 0 });
  });

  it('creates a categorised, customer-linked thread for a new inbound message', async () => {
    primeCursors();
    store.rules = [{ id: 'r', position: 0, field: 'subject', match_type: 'contains', value: 'quote', action: 'inquiry', enabled: true }];
    store.customers.set('jane@example.com', 'cust-1');
    await run({ INBOX: { uidValidity: 1, messages: [incoming(1, { id: 'a@x' })] }, Sent: { uidValidity: 1, messages: [] } });
    expect(store.threads).toHaveLength(1);
    expect(store.threads[0]).toMatchObject({
      counterpartAddress: 'jane@example.com',
      counterpartName: 'Jane Doe',
      category: 'inquiry',
      customerId: 'cust-1',
      normalizedSubject: 'quote for kitchen',
    });
    expect(store.cursors.get('inbox')).toMatchObject({ lastUid: 1, error: null });
  });

  it('puts a Sent reply in the same thread as out, ordered by date across folders', async () => {
    primeCursors();
    await run({
      INBOX: { uidValidity: 1, messages: [incoming(1, { id: 'a@x' })] },
      Sent: { uidValidity: 1, messages: [outgoing(1, { id: 'b@x', inReplyTo: 'a@x' })] },
    });
    expect(store.threads).toHaveLength(1);
    const msgs = store.messagesOf(store.threads[0].id);
    expect(msgs.map((m) => [m.direction, m.replyText])).toEqual([
      ['in', 'Hello, can I get a quote?'],
      ['out', 'Sure, Tuesday works.'],
    ]);
    expect(store.threads[0].lastDirection).toBe('out');
  });

  it('reopens a handled thread on an incoming reply but not on an outgoing one', async () => {
    primeCursors();
    const inbox: RawMessage[] = [incoming(1, { id: 'a@x' })];
    const sent: RawMessage[] = [];
    const folders = { INBOX: { uidValidity: 1, messages: inbox }, Sent: { uidValidity: 1, messages: sent } };
    await run(folders);
    store.threads[0].status = 'handled';

    sent.push(outgoing(1, { id: 'b@x', inReplyTo: 'a@x' }));
    await run(folders);
    expect(store.threads[0].status).toBe('handled');

    inbox.push(incoming(2, { id: 'c@x', inReplyTo: 'b@x', subject: 'Re: Quote for kitchen', date: 'Tue, 21 Oct 2026 09:00:00 -0400' }));
    await run(folders);
    expect(store.threads[0].status).toBe('new');
  });

  it('joins a parent that arrives after its reply (reverse match)', async () => {
    primeCursors();
    const inbox: RawMessage[] = [];
    const sent: RawMessage[] = [outgoing(1, { id: 'b@x', inReplyTo: 'a@x', subject: 'Different subject' })];
    const folders = { INBOX: { uidValidity: 1, messages: inbox }, Sent: { uidValidity: 1, messages: sent } };
    await run(folders);
    inbox.push(incoming(1, { id: 'a@x' }));
    await run(folders);
    expect(store.threads).toHaveLength(1);
    expect(store.messagesOf(store.threads[0].id)).toHaveLength(2);
  });

  it('merges two threads proven to be one conversation', async () => {
    primeCursors();
    const inbox: RawMessage[] = [
      incoming(1, { id: 'a@x', subject: 'One' }),
      incoming(2, { id: 'b@x', subject: 'Two', date: 'Mon, 20 Oct 2026 10:30:00 -0400' }),
    ];
    const folders = { INBOX: { uidValidity: 1, messages: inbox }, Sent: { uidValidity: 1, messages: [] } };
    await run(folders);
    expect(store.threads).toHaveLength(2);
    inbox.push(incoming(3, { id: 'c@x', subject: 'Re: One', references: '<a@x> <b@x>', date: 'Mon, 20 Oct 2026 12:00:00 -0400' }));
    await run(folders);
    expect(store.threads.map((t) => t.id)).toEqual(['t1']);
    expect(store.messagesOf('t1')).toHaveLength(3);
  });

  it('falls back to subject + counterpart within 60 days only', async () => {
    primeCursors();
    const inbox: RawMessage[] = [incoming(1, { id: 'a@x', date: 'Mon, 20 Oct 2026 10:00:00 -0400' })];
    const folders = { INBOX: { uidValidity: 1, messages: inbox }, Sent: { uidValidity: 1, messages: [] } };
    await run(folders);
    inbox.push(incoming(2, { id: 'b@x', subject: 'RE: Quote for kitchen', date: 'Tue, 21 Oct 2026 08:00:00 -0400' }));
    await run(folders);
    expect(store.threads).toHaveLength(1);

    store.threads[0].lastMessageAt = '2026-06-01T00:00:00.000Z';
    inbox.push(incoming(3, { id: 'c@x', subject: 'Re: Quote for kitchen', date: 'Tue, 21 Oct 2026 09:00:00 -0400' }));
    await run(folders);
    expect(store.threads).toHaveLength(2);
  });

  it('stores nothing for an ignored conversation but advances the cursor', async () => {
    primeCursors();
    store.rules = [{ id: 'r', position: 0, field: 'domain', match_type: 'equals', value: 'example.com', action: 'ignore', enabled: true }];
    const report = await run({ INBOX: { uidValidity: 1, messages: [incoming(1, { id: 'a@x' })] }, Sent: { uidValidity: 1, messages: [] } });
    expect(report.ignored).toBe(1);
    expect(store.threads).toHaveLength(0);
    expect(store.cursors.get('inbox')?.lastUid).toBe(1);
  });

  it('stores a message seen in both folders once', async () => {
    primeCursors();
    const self = { id: 'self@x', from: `Blinds Nisa <${SHOP}>`, to: SHOP, subject: 'Note' };
    const report = await run({
      INBOX: { uidValidity: 1, messages: [incoming(1, self)] },
      Sent: { uidValidity: 1, messages: [incoming(1, self)] },
    });
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0].direction).toBe('out');
    expect(report.duplicates).toBe(1);
  });

  it('takes at most 50 messages per folder per run', async () => {
    primeCursors();
    const many = Array.from({ length: 60 }, (_, i) => incoming(i + 1, { id: `m${i}@x`, subject: `S${i}` }));
    await run({ INBOX: { uidValidity: 1, messages: many }, Sent: { uidValidity: 1, messages: [] } });
    expect(store.messages).toHaveLength(FETCH_LIMIT_PER_FOLDER);
    expect(store.cursors.get('inbox')?.lastUid).toBe(50);
  });

  it('resets the cursor without importing when UIDVALIDITY changes', async () => {
    primeCursors();
    await run({ INBOX: { uidValidity: 2, messages: [incoming(9, { id: 'a@x' })] }, Sent: { uidValidity: 1, messages: [] } });
    expect(store.messages).toHaveLength(0);
    expect(store.cursors.get('inbox')).toMatchObject({ uidValidity: 2, lastUid: 9 });
  });

  it('still syncs INBOX when there is no Sent folder', async () => {
    primeCursors();
    const report = await run({ INBOX: { uidValidity: 1, messages: [incoming(1, { id: 'a@x' })] } }, null);
    expect(store.messages).toHaveLength(1);
    expect(store.errors[0][0]).toBe('sent');
    expect(report.errors).toHaveLength(1);
  });

  it('holds the cursor before a message the store failed to save', async () => {
    primeCursors();
    store.failInsertFor.add('b@x');
    const report = await run({
      INBOX: {
        uidValidity: 1,
        messages: [
          incoming(1, { id: 'a@x', subject: 'A' }),
          incoming(2, { id: 'b@x', subject: 'B', date: 'Mon, 20 Oct 2026 10:10:00 -0400' }),
          incoming(3, { id: 'c@x', subject: 'C', date: 'Mon, 20 Oct 2026 10:20:00 -0400' }),
        ],
      },
      Sent: { uidValidity: 1, messages: [] },
    });
    expect(report.failed).toBe(1);
    expect(store.cursors.get('inbox')).toMatchObject({ lastUid: 1 });
    expect(store.cursors.get('inbox')?.error).toContain('UID 2');
  });

  it('stores an unreadable message as a placeholder bubble', async () => {
    primeCursors();
    await syncInbox({
      source: fakeSource({ INBOX: { uidValidity: 1, messages: [{ uid: 1, raw: new Uint8Array([1]) }] }, Sent: { uidValidity: 1, messages: [] } }),
      store,
      mailbox: SHOP,
      now: () => NOW,
      parse: async () => {
        throw new Error('bad mime');
      },
    });
    expect(store.messages[0]).toMatchObject({ messageId: 'uid:inbox:1:1', replyText: UNREADABLE_TEXT });
    expect(store.threads[0].category).toBe('other');
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/api && pnpm vitest run src/lib/inbox/sync.test.ts`
Expected: FAIL, "Failed to resolve import ./sync".

- [ ] **Step 7: Write `sync.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * One run of the Titan inbox sync, independent of sockets and Supabase
 * (both are injected), so the whole pipeline is tested in memory.
 *
 * Per run:
 *   1. Resolve the Sent folder (missing → recorded error, INBOX still syncs).
 *   2. For each folder, read up to {@link FETCH_LIMIT_PER_FOLDER} messages
 *      after its cursor. No usable cursor, a different folder name, or a
 *      changed UIDVALIDITY → move the cursor to the folder's highest UID
 *      and import nothing (start "from now", never re-import a mailbox).
 *   3. Parse everything (unparseable → placeholder) and process all
 *      folders' messages together in Date order, so a customer's email is
 *      normally stored before the shop's reply to it.
 *   4. Per message: skip known ids; thread it (headers, reverse headers,
 *      subject fallback; merge when headers prove two threads are one);
 *      a message that starts a thread is classified by the rules
 *      (ignore → not stored) and auto-linked to a customer; insert; refresh
 *      the thread summary (incoming mail reopens a handled thread).
 *   5. Save each folder's cursor — just before the first message the
 *      store failed to save, if any, so it and later ones are retried
 *      (duplicates are skipped next time).
 */

import { parseMessage } from './parse';
import { trimQuotedReply } from './quoteTrim';
import { classify, type Classification, type EmailRule } from './rules';
import {
  chooseThread,
  counterpartOf,
  directionOf,
  isLookupSafeId,
  normalizeSubject,
  subjectFallbackSince,
  type ThreadDecision,
} from './threading';
import type { InboxStore } from './store';
import type { InboxFolder, MailSource, ParsedMessage } from './types';

/** Messages read per folder per run (the cron runs every 5 minutes). */
export const FETCH_LIMIT_PER_FOLDER = 50;

/** Bubble text for a message postal-mime could not parse. */
export const UNREADABLE_TEXT = '(This message could not be read. Open it in Titan to see it.)';

/** What a run needs. `mailbox` is the shop address; `parse` is injectable for tests. */
export interface SyncDeps {
  source: MailSource;
  store: InboxStore;
  mailbox: string;
  now: () => Date;
  parse?: (raw: Uint8Array, receivedAt: Date) => Promise<ParsedMessage>;
}

/** Counts and human-readable problems from one run (logged by `run.ts`). */
export interface SyncReport {
  imported: number;
  ignored: number;
  duplicates: number;
  failed: number;
  errors: string[];
}

type Outcome = 'imported' | 'ignored' | 'duplicates';

interface Pending {
  folder: InboxFolder;
  uidValidity: number;
  uid: number;
  message: ParsedMessage;
  unreadable: boolean;
}

interface FolderProgress {
  folderName: string;
  uidValidity: number;
  lastUid: number;
}

interface ImportContext {
  store: InboxStore;
  mailbox: string;
  now: () => Date;
  loadRules: () => Promise<EmailRule[]>;
}

/** The ParsedMessage stand-in for bytes postal-mime rejected. */
function unreadableMessage(receivedAt: Date): ParsedMessage {
  return {
    messageId: null,
    inReplyTo: null,
    references: [],
    sentAt: receivedAt.toISOString(),
    from: { address: '', name: '' },
    to: [],
    cc: [],
    subject: '(unreadable message)',
    textBody: '',
    attachments: [],
  };
}

/** Gathers the three lookups and lets `chooseThread` decide. */
async function decideThread(
  ctx: ImportContext,
  msg: ParsedMessage,
  counterpart: string,
  normalizedSubject: string
): Promise<ThreadDecision> {
  const lookupIds = [...new Set([msg.inReplyTo, ...msg.references])].filter(
    (id): id is string => typeof id === 'string' && isLookupSafeId(id)
  );
  const headerMatches = lookupIds.length ? await ctx.store.threadsByMessageIds(lookupIds) : [];
  const reverseMatches =
    msg.messageId && isLookupSafeId(msg.messageId) ? await ctx.store.threadsReferencing(msg.messageId) : [];
  const subjectMatch =
    headerMatches.length || reverseMatches.length || !normalizedSubject || !counterpart
      ? null
      : await ctx.store.threadBySubject(counterpart, normalizedSubject, subjectFallbackSince(ctx.now()));
  return chooseThread({ headerMatches, reverseMatches, subjectMatch });
}

/** Imports one parsed message; throws only on a store failure. */
async function importOne(p: Pending, ctx: ImportContext): Promise<Outcome> {
  const { store, mailbox } = ctx;
  const msg = p.message;
  const messageId = msg.messageId ?? `uid:${p.folder}:${p.uidValidity}:${p.uid}`;
  if (await store.messageExists(messageId)) return 'duplicates';

  const direction = directionOf(p.folder, msg.from.address, mailbox);
  const counterpart = counterpartOf(direction, msg.from, msg.to, msg.cc, mailbox);
  const replyText = p.unreadable ? UNREADABLE_TEXT : trimQuotedReply(msg.textBody);
  const normalizedSubject = normalizeSubject(msg.subject);

  const decision: ThreadDecision = p.unreadable
    ? { kind: 'new' }
    : await decideThread(ctx, msg, counterpart.address, normalizedSubject);

  let threadId: string;
  if (decision.kind === 'join') {
    threadId = decision.threadId;
    if (decision.mergeThreadIds.length) await store.mergeThreads(threadId, decision.mergeThreadIds);
  } else {
    const verdict: Classification = p.unreadable
      ? { action: 'category', category: 'other' }
      : classify({ counterpart: counterpart.address, subject: msg.subject, body: replyText }, await ctx.loadRules());
    if (verdict.action === 'ignore') return 'ignored';
    threadId = await store.createThread({
      subject: msg.subject,
      normalizedSubject,
      counterpartAddress: counterpart.address,
      counterpartName: counterpart.name,
      category: verdict.category,
      customerId: counterpart.address ? await store.customerIdByEmail(counterpart.address) : null,
      firstMessageAt: msg.sentAt,
    });
  }

  let inserted: 'inserted' | 'duplicate';
  try {
    inserted = await store.insertMessage({
    threadId,
    messageId,
    inReplyTo: msg.inReplyTo,
    referenceIds: msg.references,
    direction,
    folder: p.folder,
    imapUid: p.uid,
    uidValidity: p.uidValidity,
    sentAt: msg.sentAt,
    fromAddress: msg.from.address,
    fromName: msg.from.name,
    toAddresses: msg.to.map((m) => m.address),
    ccAddresses: msg.cc.map((m) => m.address),
    subject: msg.subject,
    textBody: msg.textBody,
    replyText,
    attachments: msg.attachments,
    });
  } catch (error) {
    // Don't leave a just-created conversation with no messages behind.
    if (decision.kind === 'new') await store.refreshThread(threadId, false).catch(() => undefined);
    throw error;
  }
  // Also run after a lost dedupe race: it deletes a just-created empty thread.
  await store.refreshThread(threadId, inserted === 'inserted' && direction === 'in');
  return inserted === 'inserted' ? 'imported' : 'duplicates';
}

/** Runs one sync (see the module comment for the steps). */
export async function syncInbox(deps: SyncDeps): Promise<SyncReport> {
  const { source, store, now } = deps;
  const parse = deps.parse ?? parseMessage;
  const mailbox = deps.mailbox.trim().toLowerCase();
  const report: SyncReport = { imported: 0, ignored: 0, duplicates: 0, failed: 0, errors: [] };

  const folders: Array<{ folder: InboxFolder; name: string }> = [{ folder: 'inbox', name: 'INBOX' }];
  const sentName = await source.findSentFolder();
  if (sentName) {
    folders.push({ folder: 'sent', name: sentName });
  } else {
    const message = 'No Sent folder found on the mail server, so replies will not appear.';
    report.errors.push(message);
    await store.recordError('sent', message);
  }

  const pending: Pending[] = [];
  const progress = new Map<InboxFolder, FolderProgress>();
  for (const { folder, name } of folders) {
    const cursor = await store.getCursor(folder);
    const usable =
      cursor && cursor.folderName === name && cursor.uidValidity !== null && cursor.lastUid !== null
        ? { uidValidity: cursor.uidValidity, afterUid: cursor.lastUid }
        : null;
    const read = await source.readFolder(name, usable, FETCH_LIMIT_PER_FOLDER);
    if (!usable || usable.uidValidity !== read.uidValidity) {
      await store.saveCursor(folder, { folderName: name, uidValidity: read.uidValidity, lastUid: read.highestUid, error: null });
      continue;
    }
    progress.set(folder, { folderName: name, uidValidity: read.uidValidity, lastUid: read.scannedThroughUid ?? usable.afterUid });
    for (const raw of read.messages) {
      const receivedAt = now();
      try {
        pending.push({ folder, uidValidity: read.uidValidity, uid: raw.uid, message: await parse(raw.raw, receivedAt), unreadable: false });
      } catch {
        pending.push({ folder, uidValidity: read.uidValidity, uid: raw.uid, message: unreadableMessage(receivedAt), unreadable: true });
      }
    }
  }

  pending.sort((a, b) => a.message.sentAt.localeCompare(b.message.sentAt) || a.uid - b.uid);

  let rules: EmailRule[] | null = null;
  const ctx: ImportContext = { store, mailbox, now, loadRules: async () => (rules ??= await store.enabledRules()) };
  const firstFailure = new Map<InboxFolder, number>();
  for (const p of pending) {
    try {
      report[await importOne(p, ctx)] += 1;
    } catch (error) {
      report.failed += 1;
      report.errors.push(`${p.folder} UID ${p.uid}: ${error instanceof Error ? error.message : String(error)}`);
      const previous = firstFailure.get(p.folder);
      firstFailure.set(p.folder, previous === undefined ? p.uid : Math.min(previous, p.uid));
    }
  }

  for (const [folder, prog] of progress) {
    const failedUid = firstFailure.get(folder);
    await store.saveCursor(folder, {
      folderName: prog.folderName,
      uidValidity: prog.uidValidity,
      lastUid: failedUid === undefined ? prog.lastUid : failedUid - 1,
      error: failedUid === undefined ? null : `Could not save message UID ${failedUid}; it will be retried.`,
    });
  }
  return report;
}
```

- [ ] **Step 8: Run the sync tests**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/api && pnpm vitest run src/lib/inbox/sync.test.ts`
Expected: PASS (14 tests). If "puts a Sent reply in the same thread" fails because `replyText` still contains the quote, run `trimQuotedReply` on the exact body from `outgoing()` in a scratch test to see which pattern missed; fix the pattern in `quoteTrim.ts` and add that body as a quoteTrim test case.

- [ ] **Step 9: Write `run.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Cron entry for the Titan inbox sync (every 5 minutes, cron
 * {@link INBOX_SYNC_CRON}, dispatched from `index.ts`'s scheduled handler). Wires the real pieces — the TLS
 * socket to Titan, the Supabase store — around `syncInbox`.
 *
 * Skips quietly (one log line) until TITAN_IMAP_USER and
 * TITAN_IMAP_PASSWORD are set, so deploying the code before the secrets
 * is harmless. A run is capped at 4 minutes so a stalled server cannot
 * overlap many runs; on any connection-level failure the error is
 * written to both folders' sync state (shown in Settings) and the
 * cursors stay where they were. Never logs the password: IMAP errors
 * carry only the command verb.
 */

import { createSupabaseAdmin } from '../supabase';
import { createSupabaseInboxStore } from './store';
import { syncInbox } from './sync';
import { openTitanSource } from './titanConnect';
import type { Env } from '../../index';
import type { MailSource } from './types';

/** The cron expression this sync runs on; must match wrangler.toml. */
export const INBOX_SYNC_CRON = '*/5 * * * *';

/** Hard cap for one run. */
const SYNC_TIMEOUT_MS = 4 * 60 * 1000;

/** Runs one inbox sync with production wiring. Never throws. */
export async function runInboxSync(env: Env): Promise<void> {
  const user = env.TITAN_IMAP_USER?.trim();
  const password = env.TITAN_IMAP_PASSWORD;
  if (!user || !password) {
    console.log('Inbox sync skipped: TITAN_IMAP_USER / TITAN_IMAP_PASSWORD are not set.');
    return;
  }

  const store = createSupabaseInboxStore(createSupabaseAdmin(env));
  let source: MailSource | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = (async () => {
      source = await openTitanSource({
        host: env.TITAN_IMAP_HOST || 'imap.titan.email',
        port: Number(env.TITAN_IMAP_PORT || 993),
        user,
        password,
      });
      return syncInbox({ source, store, mailbox: user, now: () => new Date() });
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Inbox sync timed out after 4 minutes')), SYNC_TIMEOUT_MS);
    });
    const report = await Promise.race([work, timeout]);
    console.log(
      `Inbox sync: ${report.imported} imported, ${report.ignored} ignored, ` +
        `${report.duplicates} duplicate(s), ${report.failed} failed`
    );
    for (const problem of report.errors) console.warn(`Inbox sync: ${problem}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Inbox sync failed: ${message}`);
    await Promise.allSettled([store.recordError('inbox', message), store.recordError('sent', message)]);
  } finally {
    clearTimeout(timer);
    // Assigned inside the closure above, which TS's flow analysis can't see.
    await (source as MailSource | null)?.close().catch(() => undefined);
  }
}
```

- [ ] **Step 10: Wire `index.ts`**

In `apps/api/src/index.ts`:

1. Add the import after `import { runDailyEmailJobs } from './lib/reminders';`:
```ts
import { INBOX_SYNC_CRON, runInboxSync } from './lib/inbox/run';
```
2. Add to the `Env` interface, after `ETRANSFER_WEBHOOK_SECRET?: string;`:
```ts
  /** Titan mailbox login for the inbox sync (e.g. "info@blindsnisa.com"); sync is skipped while unset. */
  TITAN_IMAP_USER?: string;
  /** Titan mailbox password — Worker secret only, never logged. */
  TITAN_IMAP_PASSWORD?: string;
  /** IMAP host, default "imap.titan.email" ([vars]). */
  TITAN_IMAP_HOST?: string;
  /** IMAP TLS port, default "993" ([vars]). */
  TITAN_IMAP_PORT?: string;
```
3. In `scheduled`, make the inbox branch the FIRST check inside the async IIFE. This is required: the existing final branch (auto-expiry) runs for any cron that isn't `0 14 * * *`, so without this branch auto-expiry would run every 5 minutes:
```ts
        if (event.cron === INBOX_SYNC_CRON) {
          await runInboxSync(env);
          return;
        }
```
4. Update the `scheduled` JSDoc list with the line below. Do NOT write the literal cron string `*/5 …` inside the `/** … */` comment: `*/` would end the comment.
```
   *   every 5 min — Titan inbox sync (INBOX_SYNC_CRON; INBOX + Sent →
   *                email_threads / email_messages); see lib/inbox/run.ts.
```

- [ ] **Step 11: Update `wrangler.toml`**

Replace the `[triggers]` block and extend `[vars]` and the secrets comment:

```toml
[triggers]
# 06:00 UTC — auto-expire stale estimates.
# 14:00 UTC — customer emails at 10 AM Toronto (EDT; 9 AM during EST):
#             day-before appointment/installation reminders + review
#             requests 2 days after an order is marked installed.
# */5       — Titan inbox sync (lib/inbox/run.ts). Must match INBOX_SYNC_CRON.
crons = ["0 6 * * *", "0 14 * * *", "*/5 * * * *"]

[vars]
ENVIRONMENT = "development"
TITAN_IMAP_HOST = "imap.titan.email"
TITAN_IMAP_PORT = "993"
```

and append to the secrets comment list:

```toml
# TITAN_IMAP_USER           (e.g. "info@blindsnisa.com" — the inbox sync)
# TITAN_IMAP_PASSWORD       (that mailbox's password; sync is skipped until set)
```

- [ ] **Step 12: Run all api tests and typecheck**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/api && pnpm check && pnpm test`
Expected: no tsc output; all test files pass (existing + 9 inbox files).

- [ ] **Step 13: Commit**

```bash
cd /Users/kemal/Desktop/measure-blinds/apps/api && git add src/lib/inbox/store.ts src/lib/inbox/store.test.ts src/lib/inbox/sync.ts src/lib/inbox/sync.test.ts src/lib/inbox/run.ts && git commit -m "feat(inbox): sync orchestration, Supabase store and 5-minute cron" -- src/lib/inbox/store.ts src/lib/inbox/store.test.ts src/lib/inbox/sync.ts src/lib/inbox/sync.test.ts src/lib/inbox/run.ts src/index.ts wrangler.toml
```

---

### Task 8: Inbox API routes

**Files:**
- Create: `apps/api/src/routes/inbox.ts`
- Test: `apps/api/src/routes/inbox.routes.test.ts`
- Modify: `apps/api/src/index.ts` (mount)

**Interfaces:**
- Consumes: `EMAIL_CATEGORIES`, `RULE_FIELDS`, `RULE_MATCH_TYPES`, `RULE_ACTIONS`, `classify`, `EmailRule`.
- Produces HTTP (all under `/api/inbox`, JWT required):
  - `GET /rules` → `{ data: EmailRule[] }` (with `created_at`, `updated_at`)
  - `POST /rules` body `{ field, match_type, value, action, enabled? }` → 201 `{ data: EmailRule }`
  - `POST /rules/reorder` body `{ ids: uuid[] }` → `{ data: { ok: true } }`
  - `POST /rules/reapply` → `{ data: { changed: number } }`
  - `PUT /rules/:ruleId` body: any non-empty subset of the POST fields → `{ data: EmailRule }`
  - `DELETE /rules/:ruleId` → `{ data: { id } }`
  - `GET /status` → `{ data: { folder, folder_name, last_run_at, last_success_at, last_error }[] }`
  - `GET /?category=&status=&page=` → `{ data: ThreadSummary[], page, page_size: 15, total, total_pages }`
  - `GET /:threadId` → `{ data: ThreadSummary & { handled_at, category_locked, order, messages, customer_orders } }`
  - `PUT /:threadId` body any non-empty subset of `{ category, customer_id, order_id, status }` → `{ data: { id } }`

- [ ] **Step 1: Write the failing route tests**

`apps/api/src/routes/inbox.routes.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Route-level tests for `/api/inbox` against a scripted fake Supabase
 * client that records every builder call per table and answers from a
 * per-table queue.
 *
 * What these pin: literal routes are not swallowed by `/:threadId`;
 * strict schemas reject unknown keys and empty updates; list paging and
 * defaults; rule position on create and reorder; re-apply only touches
 * changed, unlocked threads and skips message bodies when no rule needs
 * them; thread PUT semantics (category lock, handled_at, order → customer,
 * customer change clears order); non-UUID ids are 404.
 *
 * Auth is not exercised: `requireAuth` is applied in `index.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Call {
  table: string;
  ops: Array<[string, unknown[]]>;
}
type Answer = { data?: unknown; error?: unknown; count?: number };

const calls: Call[] = [];
let answers: Record<string, Answer[]> = {};

function makeBuilder(table: string) {
  const call: Call = { table, ops: [] };
  calls.push(call);
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'in', 'is', 'order', 'range', 'limit', 'maybeSingle', 'single', 'gte', 'contains', 'ilike']) {
    builder[m] = (...args: unknown[]) => {
      call.ops.push([m, args]);
      return builder;
    };
  }
  builder.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => {
    const next = answers[table]?.shift() ?? {};
    return Promise.resolve({ data: next.data ?? null, error: next.error ?? null, count: next.count ?? null }).then(onF, onR);
  };
  return builder;
}

vi.mock('../lib/supabase', () => ({
  createSupabaseAdmin: () => ({ from: (table: string) => makeBuilder(table) }),
}));

import inboxApp from './inbox';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  RESEND_API_KEY: 'x',
  APP_URL: 'http://localhost:5173',
  ENVIRONMENT: 'test',
};
const T1 = '11111111-1111-4111-8111-111111111111';
const R1 = '22222222-2222-4222-8222-222222222222';
const R2 = '33333333-3333-4333-8333-333333333333';
const C1 = '44444444-4444-4444-8444-444444444444';
const C2 = '55555555-5555-4555-8555-555555555555';
const O1 = '66666666-6666-4666-8666-666666666666';

function json(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}
function callsFor(table: string): Call[] {
  return calls.filter((c) => c.table === table);
}
function op(call: Call, name: string): unknown[] | undefined {
  return call.ops.find(([m]) => m === name)?.[1];
}

beforeEach(() => {
  calls.length = 0;
  answers = {};
});

describe('GET /', () => {
  it('defaults to Inquiry / New / page 1 and returns the pager envelope', async () => {
    answers.email_threads = [{ data: [{ id: T1 }], count: 16 }];
    const res = await inboxApp.request('/', {}, ENV);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: [{ id: T1 }], page: 1, page_size: 15, total: 16, total_pages: 2 });
    const [call] = callsFor('email_threads');
    expect(call.ops).toContainEqual(['eq', ['category', 'inquiry']]);
    expect(call.ops).toContainEqual(['eq', ['status', 'new']]);
    expect(op(call, 'range')).toEqual([0, 14]);
  });

  it.each(['/?category=spam', '/?status=open', '/?page=0', '/?foo=1'])('400 for %s', async (path) => {
    expect((await inboxApp.request(path, {}, ENV)).status).toBe(400);
  });
});

describe('literal routes', () => {
  it('GET /rules reads rules, not a thread', async () => {
    answers.email_rules = [{ data: [{ id: R1 }] }];
    const res = await inboxApp.request('/rules', {}, ENV);
    expect(await res.json()).toEqual({ data: [{ id: R1 }] });
    expect(callsFor('email_threads')).toHaveLength(0);
  });

  it('GET /status reads the sync state', async () => {
    answers.email_sync_state = [{ data: [{ folder: 'inbox' }] }];
    const res = await inboxApp.request('/status', {}, ENV);
    expect(await res.json()).toEqual({ data: [{ folder: 'inbox' }] });
  });
});

describe('rules', () => {
  it('appends a new rule after the last position', async () => {
    answers.email_rules = [{ data: { position: 4 } }, { data: { id: R1, position: 5 } }];
    const res = await inboxApp.request('/rules', json('POST', { field: 'domain', match_type: 'equals', value: ' acme.com ', action: 'supplier' }), ENV);
    expect(res.status).toBe(201);
    const insert = op(callsFor('email_rules')[1], 'insert')![0];
    expect(insert).toEqual({ field: 'domain', match_type: 'equals', value: 'acme.com', action: 'supplier', enabled: true, position: 5 });
  });

  it('rejects unknown keys and blank values', async () => {
    expect((await inboxApp.request('/rules', json('POST', { field: 'domain', match_type: 'equals', value: 'a', action: 'supplier', position: 1 }), ENV)).status).toBe(400);
    expect((await inboxApp.request('/rules', json('POST', { field: 'domain', match_type: 'equals', value: '  ', action: 'supplier' }), ENV)).status).toBe(400);
  });

  it('reorders by index', async () => {
    const res = await inboxApp.request('/rules/reorder', json('POST', { ids: [R2, R1] }), ENV);
    expect(res.status).toBe(200);
    const updates = callsFor('email_rules').map((c) => [op(c, 'update')![0], op(c, 'eq')]);
    expect(updates).toEqual([
      [{ position: 0 }, ['id', R2]],
      [{ position: 1 }, ['id', R1]],
    ]);
  });

  it('updates and deletes by uuid, 404 otherwise', async () => {
    answers.email_rules = [{ data: { id: R1, enabled: false } }, { data: { id: R1 } }];
    expect((await inboxApp.request(`/rules/${R1}`, json('PUT', { enabled: false }), ENV)).status).toBe(200);
    expect((await inboxApp.request(`/rules/${R1}`, { method: 'DELETE' }, ENV)).status).toBe(200);
    expect((await inboxApp.request('/rules/nope', json('PUT', { enabled: false }), ENV)).status).toBe(404);
    expect((await inboxApp.request(`/rules/${R1}`, json('PUT', {}), ENV)).status).toBe(400);
  });

  it('re-applies rules to unlocked threads whose category changes', async () => {
    answers.email_rules = [{ data: [{ id: R1, position: 0, field: 'domain', match_type: 'equals', value: 'acme.com', action: 'supplier', enabled: true }] }];
    answers.email_threads = [
      {
        data: [
          { id: 'ta', subject: 'Hi', counterpart_address: 'x@acme.com', category: 'other' },
          { id: 'tb', subject: 'Hi', counterpart_address: 'y@else.com', category: 'other' },
          { id: 'tc', subject: 'Hi', counterpart_address: 'z@acme.com', category: 'supplier' },
        ],
      },
    ];
    const res = await inboxApp.request('/rules/reapply', { method: 'POST' }, ENV);
    expect(await res.json()).toEqual({ data: { changed: 1 } });
    const threadCalls = callsFor('email_threads');
    expect(threadCalls[0].ops).toContainEqual(['eq', ['category_locked', false]]);
    expect(op(threadCalls[1], 'update')).toEqual([{ category: 'supplier' }]);
    expect(op(threadCalls[1], 'in')).toEqual(['id', ['ta']]);
    expect(callsFor('email_messages')).toHaveLength(0);
  });
});

describe('GET /:threadId', () => {
  it('404s a non-uuid', async () => {
    expect((await inboxApp.request('/abc', {}, ENV)).status).toBe(404);
  });

  it('returns messages oldest first and the customer’s orders', async () => {
    answers.email_threads = [{ data: { id: T1, customer_id: C1 } }];
    answers.email_messages = [{ data: [{ id: 'm1' }, { id: 'm2' }] }];
    answers.orders = [{ data: [{ id: O1, order_number: 'F1021-001', status: 'sent' }] }];
    const res = await inboxApp.request(`/${T1}`, {}, ENV);
    expect(await res.json()).toEqual({
      data: { id: T1, customer_id: C1, messages: [{ id: 'm1' }, { id: 'm2' }], customer_orders: [{ id: O1, order_number: 'F1021-001', status: 'sent' }] },
    });
    expect(callsFor('email_messages')[0].ops).toContainEqual(['order', ['sent_at', { ascending: true }]]);
  });
});

describe('PUT /:threadId', () => {
  it('locks a hand-picked category and stamps handled_at', async () => {
    answers.email_threads = [{ data: { id: T1 } }];
    const res = await inboxApp.request(`/${T1}`, json('PUT', { category: 'supplier', status: 'handled' }), ENV);
    expect(res.status).toBe(200);
    const update = op(callsFor('email_threads')[0], 'update')![0] as Record<string, unknown>;
    expect(update).toMatchObject({ category: 'supplier', category_locked: true, status: 'handled' });
    expect(typeof update.handled_at).toBe('string');
  });

  it('linking an order also links its customer', async () => {
    answers.orders = [{ data: { id: O1, customer_id: C1 } }];
    answers.email_threads = [{ data: { id: T1 } }];
    await inboxApp.request(`/${T1}`, json('PUT', { order_id: O1 }), ENV);
    expect(op(callsFor('email_threads')[0], 'update')![0]).toEqual({ order_id: O1, customer_id: C1 });
  });

  it('rejects an order belonging to a different customer', async () => {
    answers.orders = [{ data: { id: O1, customer_id: C1 } }];
    const res = await inboxApp.request(`/${T1}`, json('PUT', { order_id: O1, customer_id: C2 }), ENV);
    expect(res.status).toBe(400);
  });

  it('changing the customer clears the order', async () => {
    answers.customers = [{ data: { id: C2 } }];
    answers.email_threads = [{ data: { id: T1 } }];
    await inboxApp.request(`/${T1}`, json('PUT', { customer_id: C2 }), ENV);
    expect(op(callsFor('email_threads')[0], 'update')![0]).toEqual({ customer_id: C2, order_id: null });
  });

  it('400s unknown keys and empty bodies; 404s a missing thread', async () => {
    expect((await inboxApp.request(`/${T1}`, json('PUT', { subject: 'x' }), ENV)).status).toBe(400);
    expect((await inboxApp.request(`/${T1}`, json('PUT', {}), ENV)).status).toBe(400);
    answers.email_threads = [{ data: null }];
    expect((await inboxApp.request(`/${T1}`, json('PUT', { status: 'new' }), ENV)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/api && pnpm vitest run src/routes/inbox.routes.test.ts`
Expected: FAIL, "Failed to resolve import ./inbox".

- [ ] **Step 3: Write `routes/inbox.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Staff Inbox API (authenticated, mounted at `/api/inbox`).
 *
 * Reads the conversations the inbox cron (`lib/inbox/run.ts`) stores,
 * lets staff triage them (category, customer/order link, New/Handled),
 * and manages the filter rules (Settings → Email Rules). Nothing here
 * talks to Titan: the app never changes the mailbox.
 *
 * Route order matters (locked Hono pattern): every literal path —
 * `/rules`, `/rules/reorder`, `/rules/reapply`, `/status` — is
 * registered before `/:threadId`. Ids are checked as UUIDs up front so
 * a bad id is a 404, not a Postgres cast error.
 *
 * Thread updates: picking a category by hand sets `category_locked`
 * (Re-apply rules then leaves the thread alone); `handled` stamps
 * `handled_at`; linking an order also links that order's customer;
 * changing or clearing the customer clears the order.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { createSupabaseAdmin } from '../lib/supabase';
import { EMAIL_CATEGORIES, type EmailCategory } from '../lib/inbox/types';
import { RULE_ACTIONS, RULE_FIELDS, RULE_MATCH_TYPES, classify, type EmailRule } from '../lib/inbox/rules';
import type { AuthVariables } from '../middleware/auth';
import type { Env } from '../index';

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

/** Conversations per page — fixed, like the Notifications page. */
export const INBOX_PAGE_SIZE = 15;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Batch size for `in()` filters, keeping request URLs short. */
const ID_CHUNK = 200;

/** `?category=&status=&page=` for the conversation list. */
const listQuerySchema = z
  .object({
    category: z.enum(EMAIL_CATEGORIES).default('inquiry'),
    status: z.enum(['new', 'handled']).default('new'),
    page: z.coerce.number().int().min(1).default(1),
  })
  .strict();

/** A new rule. Position is assigned by the server (appended last). */
const ruleSchema = z
  .object({
    field: z.enum(RULE_FIELDS),
    match_type: z.enum(RULE_MATCH_TYPES),
    value: z.string().trim().min(1).max(200),
    action: z.enum(RULE_ACTIONS),
    enabled: z.boolean().default(true),
  })
  .strict();

/** Any non-empty subset of a rule's editable fields. */
const ruleUpdateSchema = z
  .object({
    field: z.enum(RULE_FIELDS).optional(),
    match_type: z.enum(RULE_MATCH_TYPES).optional(),
    value: z.string().trim().min(1).max(200).optional(),
    action: z.enum(RULE_ACTIONS).optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

/** The full rule order, first rule first. */
const reorderSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).strict();

/** Any non-empty subset of a thread's triage fields. */
const threadUpdateSchema = z
  .object({
    category: z.enum(EMAIL_CATEGORIES).optional(),
    customer_id: z.string().uuid().nullable().optional(),
    order_id: z.string().uuid().nullable().optional(),
    status: z.enum(['new', 'handled']).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

/** First Zod issue as "path: message" (same wording as the other route groups). */
function firstZodIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid payload';
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

/** Splits ids into `in()`-sized batches. */
function chunks<T>(items: T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** All rules, first-match order. */
app.get('/rules', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb
    .from('email_rules')
    .select('id, position, field, match_type, value, action, enabled, created_at, updated_at')
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data: data ?? [] });
});

/** Creates a rule at the end of the list. */
app.post('/rules', async (c) => {
  const parsed = ruleSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const sb = createSupabaseAdmin(c.env);
  const { data: last, error: lastError } = await sb
    .from('email_rules')
    .select('position')
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) return c.json({ error: lastError.message }, 500);
  const { data, error } = await sb
    .from('email_rules')
    .insert({ ...parsed.data, position: ((last?.position as number | undefined) ?? -1) + 1 })
    .select('id, position, field, match_type, value, action, enabled, created_at, updated_at')
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data }, 201);
});

/** Sets every listed rule's position to its index. */
app.post('/rules/reorder', async (c) => {
  const parsed = reorderSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const sb = createSupabaseAdmin(c.env);
  for (const [index, id] of parsed.data.ids.entries()) {
    const { error } = await sb.from('email_rules').update({ position: index }).eq('id', id);
    if (error) return c.json({ error: error.message }, 500);
  }
  return c.json({ data: { ok: true } });
});

/**
 * Re-classifies every unlocked thread with the current enabled rules
 * (an `ignore` verdict becomes `other`: stored mail is never deleted).
 * First-message bodies are loaded only when some rule tests the body.
 */
app.post('/rules/reapply', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const { data: rules, error: rulesError } = await sb
    .from('email_rules')
    .select('id, position, field, match_type, value, action, enabled')
    .eq('enabled', true)
    .order('position', { ascending: true });
  if (rulesError) return c.json({ error: rulesError.message }, 500);
  const { data: threads, error: threadsError } = await sb
    .from('email_threads')
    .select('id, subject, counterpart_address, category')
    .eq('category_locked', false);
  if (threadsError) return c.json({ error: threadsError.message }, 500);

  const ruleList = (rules ?? []) as EmailRule[];
  const threadList = (threads ?? []) as Array<{ id: string; subject: string; counterpart_address: string; category: EmailCategory }>;

  const firstBody = new Map<string, string>();
  if (ruleList.some((r) => r.field === 'body')) {
    for (const batch of chunks(threadList.map((t) => t.id))) {
      const { data: messages, error } = await sb
        .from('email_messages')
        .select('thread_id, reply_text, sent_at')
        .in('thread_id', batch)
        .order('sent_at', { ascending: true });
      if (error) return c.json({ error: error.message }, 500);
      for (const m of messages ?? []) {
        if (!firstBody.has(m.thread_id as string)) firstBody.set(m.thread_id as string, m.reply_text as string);
      }
    }
  }

  const moves = new Map<EmailCategory, string[]>();
  for (const t of threadList) {
    const verdict = classify(
      { counterpart: t.counterpart_address, subject: t.subject, body: firstBody.get(t.id) ?? '' },
      ruleList
    );
    const category: EmailCategory = verdict.action === 'ignore' ? 'other' : verdict.category;
    if (category !== t.category) moves.set(category, [...(moves.get(category) ?? []), t.id]);
  }

  let changed = 0;
  for (const [category, ids] of moves) {
    for (const batch of chunks(ids)) {
      const { error } = await sb.from('email_threads').update({ category }).in('id', batch);
      if (error) return c.json({ error: error.message }, 500);
      changed += batch.length;
    }
  }
  return c.json({ data: { changed } });
});

/** Edits one rule. */
app.put('/rules/:ruleId', async (c) => {
  const id = c.req.param('ruleId');
  if (!UUID_RE.test(id)) return c.json({ error: 'Rule not found' }, 404);
  const parsed = ruleUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb
    .from('email_rules')
    .update(parsed.data)
    .eq('id', id)
    .select('id, position, field, match_type, value, action, enabled, created_at, updated_at')
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'Rule not found' }, 404);
  return c.json({ data });
});

/** Deletes one rule. */
app.delete('/rules/:ruleId', async (c) => {
  const id = c.req.param('ruleId');
  if (!UUID_RE.test(id)) return c.json({ error: 'Rule not found' }, 404);
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb.from('email_rules').delete().eq('id', id).select('id').maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'Rule not found' }, 404);
  return c.json({ data });
});

/** Per-folder sync health for the Settings page. */
app.get('/status', async (c) => {
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb
    .from('email_sync_state')
    .select('folder, folder_name, last_run_at, last_success_at, last_error')
    .order('folder', { ascending: true });
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data: data ?? [] });
});

/** One page of conversations for a category tab + status, newest activity first. */
app.get('/', async (c) => {
  const parsed = listQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const { category, status, page } = parsed.data;
  const fromRow = (page - 1) * INBOX_PAGE_SIZE;

  const sb = createSupabaseAdmin(c.env);
  const { data, count, error } = await sb
    .from('email_threads')
    .select(
      'id, subject, counterpart_address, counterpart_name, category, status, last_message_at, last_direction, last_snippet, message_count, customer_id, order_id, customer:customers(id, first_name, last_name)',
      { count: 'exact' }
    )
    .eq('category', category)
    .eq('status', status)
    .order('last_message_at', { ascending: false })
    .order('id', { ascending: false })
    .range(fromRow, fromRow + INBOX_PAGE_SIZE - 1);
  if (error) return c.json({ error: error.message }, 500);

  const total = count ?? 0;
  return c.json({
    data: data ?? [],
    page,
    page_size: INBOX_PAGE_SIZE,
    total,
    total_pages: Math.max(1, Math.ceil(total / INBOX_PAGE_SIZE)),
  });
});

/** One conversation with every message (oldest first) and the linked customer's orders. */
app.get('/:threadId', async (c) => {
  const id = c.req.param('threadId');
  if (!UUID_RE.test(id)) return c.json({ error: 'Conversation not found' }, 404);
  const sb = createSupabaseAdmin(c.env);

  const { data: thread, error } = await sb
    .from('email_threads')
    .select(
      'id, subject, counterpart_address, counterpart_name, category, category_locked, status, handled_at, last_message_at, last_direction, last_snippet, message_count, customer_id, order_id, customer:customers(id, first_name, last_name), order:orders(id, order_number, status)'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  if (!thread) return c.json({ error: 'Conversation not found' }, 404);

  const { data: messages, error: messagesError } = await sb
    .from('email_messages')
    .select('id, direction, from_name, from_address, to_addresses, sent_at, reply_text, text_body, attachments')
    .eq('thread_id', id)
    .order('sent_at', { ascending: true })
    .order('created_at', { ascending: true });
  if (messagesError) return c.json({ error: messagesError.message }, 500);

  let customerOrders: unknown[] = [];
  if (thread.customer_id) {
    const { data: orders, error: ordersError } = await sb
      .from('orders')
      .select('id, order_number, status')
      .eq('customer_id', thread.customer_id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (ordersError) return c.json({ error: ordersError.message }, 500);
    customerOrders = orders ?? [];
  }

  return c.json({ data: { ...thread, messages: messages ?? [], customer_orders: customerOrders } });
});

/** Triage update (see the module comment for the link rules). */
app.put('/:threadId', async (c) => {
  const id = c.req.param('threadId');
  if (!UUID_RE.test(id)) return c.json({ error: 'Conversation not found' }, 404);
  const parsed = threadUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: firstZodIssue(parsed.error) }, 400);
  const input = parsed.data;
  const sb = createSupabaseAdmin(c.env);

  const update: Record<string, unknown> = {};
  if (input.category !== undefined) {
    update.category = input.category;
    update.category_locked = true;
  }
  if (input.status !== undefined) {
    update.status = input.status;
    update.handled_at = input.status === 'handled' ? new Date().toISOString() : null;
  }
  if (input.order_id !== undefined) {
    update.order_id = input.order_id;
    if (input.order_id) {
      const { data: order, error } = await sb
        .from('orders')
        .select('id, customer_id')
        .eq('id', input.order_id)
        .maybeSingle();
      if (error) return c.json({ error: error.message }, 500);
      if (!order) return c.json({ error: 'Order not found' }, 400);
      if (input.customer_id && input.customer_id !== order.customer_id) {
        return c.json({ error: 'That order belongs to a different customer.' }, 400);
      }
      update.customer_id = order.customer_id;
    }
  }
  if (input.customer_id !== undefined && update.customer_id === undefined) {
    if (input.customer_id) {
      const { data: customer, error } = await sb
        .from('customers')
        .select('id')
        .eq('id', input.customer_id)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) return c.json({ error: error.message }, 500);
      if (!customer) return c.json({ error: 'Customer not found' }, 400);
    }
    update.customer_id = input.customer_id;
    if (input.order_id === undefined) update.order_id = null;
  }

  const { data, error } = await sb.from('email_threads').update(update).eq('id', id).select('id').maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'Conversation not found' }, 404);
  return c.json({ data });
});

export default app;
```

- [ ] **Step 4: Mount the routes in `index.ts`**

Add `import inboxRoutes from './routes/inbox';` after the `notificationsRoutes` import, and after the `/api/notifications` mount:

```ts
/** Staff Inbox — Titan conversations, triage and filter rules. */
app.route('/api/inbox', inboxRoutes);
```

- [ ] **Step 5: Run route tests, all api tests and typecheck**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/api && pnpm vitest run src/routes/inbox.routes.test.ts && pnpm test && pnpm check`
Expected: all PASS; no tsc output. If tsc reports `thread.customer_id` as a `GenericStringError` property, the select string was split or built from a template — keep each `.select('…')` a single string literal.

- [ ] **Step 6: Commit**

```bash
cd /Users/kemal/Desktop/measure-blinds/apps/api && git add src/routes/inbox.ts src/routes/inbox.routes.test.ts && git commit -m "feat(inbox): /api/inbox routes for conversations, triage and rules" -- src/routes/inbox.ts src/routes/inbox.routes.test.ts src/index.ts
```

---

### Task 9: Web types, hooks and pure helpers

**Files:**
- Modify: `apps/web/src/types/index.ts` (append at the end)
- Create: `apps/web/src/hooks/useInbox.ts`
- Create: `apps/web/src/pages/inbox/inboxText.ts`
- Test: `apps/web/src/pages/inbox/inboxText.test.ts`

**Interfaces:**
- Consumes: the HTTP shapes from Task 8.
- Produces (types): `EmailCategory`, `EmailThreadStatus`, `EmailDirection`, `EmailThreadSummary`, `EmailAttachment`, `EmailMessage`, `EmailThreadDetail`, `EmailRuleField`, `EmailRuleMatch`, `EmailRuleAction`, `EmailRuleInput`, `EmailRule`, `InboxSyncState`.
- Produces (hooks): `useInboxThreads(category, status, page)`, `useInboxThread(id)`, `useUpdateInboxThread()`, `ThreadUpdate`, `useEmailRules()`, `useInboxStatus()`, `useCreateEmailRule()`, `useUpdateEmailRule()`, `useDeleteEmailRule()`, `useReorderEmailRules()`, `useReapplyEmailRules()`.
- Produces (helpers): `CATEGORY_ORDER`, `CATEGORY_LABELS`, `RULE_FIELD_LABELS`, `RULE_MATCH_LABELS`, `RULE_ACTION_LABELS`, `InboxParams`, `parseInboxParams`, `inboxParamsToSearch`, `threadTitle`, `snippetLine`, `formatThreadTime`, `TextSegment`, `linkify`, `hiddenHistory`, `senderLabel`, `formatBytes`, `describeRule`, `syncStatusLine`, `moveId`.

- [ ] **Step 1: Append the types to `apps/web/src/types/index.ts`**

```ts
/**
 * Inbox conversation category (tab). Mirrors the API's EMAIL_CATEGORIES
 * and the `email_threads.category` CHECK in migration 45.
 */
export type EmailCategory = 'inquiry' | 'supplier' | 'payment' | 'other';

/** `new` until staff mark the conversation handled; an incoming reply reopens it. */
export type EmailThreadStatus = 'new' | 'handled';

/** `in` = the other party (left bubble); `out` = the shop mailbox (right bubble). */
export type EmailDirection = 'in' | 'out';

/**
 * One row of the Inbox list (`GET /api/inbox`). The `last_*` fields and
 * `message_count` are a server-maintained summary of the conversation;
 * `last_snippet` is the first 140 characters of the newest message's
 * trimmed text.
 */
export interface EmailThreadSummary {
  id: string;
  subject: string;
  counterpart_address: string;
  counterpart_name: string;
  category: EmailCategory;
  status: EmailThreadStatus;
  last_message_at: string;
  last_direction: EmailDirection;
  last_snippet: string;
  message_count: number;
  customer_id: string | null;
  order_id: string | null;
  customer: { id: string; first_name: string; last_name: string } | null;
}

/** Attachment metadata only — the file stays in Titan. */
export interface EmailAttachment {
  filename: string;
  mime_type: string;
  size: number;
}

/**
 * One email in a conversation. `reply_text` is what the bubble shows
 * (quoted history trimmed); `text_body` is the full text behind "···".
 * Both are plain text: no email HTML ever reaches the browser.
 */
export interface EmailMessage {
  id: string;
  direction: EmailDirection;
  from_name: string;
  from_address: string;
  to_addresses: string[];
  sent_at: string;
  reply_text: string;
  text_body: string;
  attachments: EmailAttachment[];
}

/** One conversation (`GET /api/inbox/:id`): summary + messages oldest first + link options. */
export interface EmailThreadDetail extends EmailThreadSummary {
  category_locked: boolean;
  handled_at: string | null;
  order: { id: string; order_number: string; status: OrderStatus } | null;
  messages: EmailMessage[];
  /** The linked customer's orders, newest first (empty when no customer is linked). */
  customer_orders: Array<{ id: string; order_number: string; status: OrderStatus }>;
}

/** What an inbox rule tests: the other party's address/domain, the subject, or the message text. */
export type EmailRuleField = 'address' | 'domain' | 'subject' | 'body';
/** How an inbox rule compares (case-insensitive). */
export type EmailRuleMatch = 'contains' | 'equals' | 'ends_with';
/** A category, or `ignore` (the conversation is never imported). */
export type EmailRuleAction = EmailCategory | 'ignore';

/** Body of `POST /api/inbox/rules` (and, partially, `PUT /rules/:id`). */
export interface EmailRuleInput {
  field: EmailRuleField;
  match_type: EmailRuleMatch;
  value: string;
  action: EmailRuleAction;
  enabled?: boolean;
}

/** A stored inbox rule; enabled rules run in `position` order, first match wins. */
export interface EmailRule extends Required<EmailRuleInput> {
  id: string;
  position: number;
  created_at: string;
  updated_at: string;
}

/** Sync health for one Titan folder (`GET /api/inbox/status`). */
export interface InboxSyncState {
  folder: 'inbox' | 'sent';
  folder_name: string;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
}
```

- [ ] **Step 2: Write `apps/web/src/hooks/useInbox.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * TanStack Query hooks for the Inbox (`/api/inbox`): the conversation
 * list per category tab, one conversation, triage updates, and the
 * Settings → Email Rules CRUD + sync status.
 *
 * Mail arrives from outside the app (the 5-minute cron), so the list and
 * thread queries are always stale and the list also polls every minute
 * while open. Every mutation invalidates the whole `['inbox']` key space
 * it can affect, so tabs, counts and the open thread never disagree.
 * Imported directly by the pages (not via the hooks barrel), like
 * `useNotifications`.
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type {
  EmailCategory,
  EmailRule,
  EmailRuleInput,
  EmailThreadDetail,
  EmailThreadStatus,
  EmailThreadSummary,
  InboxSyncState,
} from '../types';

/** Every inbox endpoint wraps its payload as `{ data }`. */
interface Envelope<T> {
  data: T;
}

/** `GET /api/inbox` — one page of conversations plus pager metadata. */
export interface PaginatedThreads {
  data: EmailThreadSummary[];
  page: number;
  /** Fixed at 15 by the Worker. */
  page_size: number;
  total: number;
  /** Never below 1. */
  total_pages: number;
}

/** Fields `PUT /api/inbox/:id` accepts; send only what changes. */
export interface ThreadUpdate {
  category?: EmailCategory;
  customer_id?: string | null;
  order_id?: string | null;
  status?: EmailThreadStatus;
}

const INBOX_KEY = ['inbox'] as const;
const RULES_KEY = ['inbox', 'rules'] as const;

/** One page of a category tab; keeps the previous page on screen while paging. */
export function useInboxThreads(
  category: EmailCategory,
  status: EmailThreadStatus,
  page: number
): UseQueryResult<PaginatedThreads> {
  return useQuery({
    queryKey: [...INBOX_KEY, 'threads', category, status, page],
    queryFn: () =>
      apiFetch<PaginatedThreads>(`/api/inbox?${new URLSearchParams({ category, status, page: String(page) })}`),
    staleTime: 0,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}

/** One conversation with all its messages; disabled until an id is known. */
export function useInboxThread(id: string | undefined): UseQueryResult<EmailThreadDetail> {
  return useQuery({
    queryKey: [...INBOX_KEY, 'thread', id],
    queryFn: async () => (await apiFetch<Envelope<EmailThreadDetail>>(`/api/inbox/${id}`)).data,
    enabled: Boolean(id),
    staleTime: 0,
  });
}

/** Category / customer / order / status change on one conversation. */
export function useUpdateInboxThread(): UseMutationResult<{ id: string }, Error, { id: string; update: ThreadUpdate }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, update }) =>
      (await apiFetch<Envelope<{ id: string }>>(`/api/inbox/${id}`, { method: 'PUT', body: JSON.stringify(update) })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: INBOX_KEY }),
  });
}

/** All rules in first-match order. */
export function useEmailRules(): UseQueryResult<EmailRule[]> {
  return useQuery({
    queryKey: RULES_KEY,
    queryFn: async () => (await apiFetch<Envelope<EmailRule[]>>('/api/inbox/rules')).data,
  });
}

/** Per-folder sync health; refreshed every minute while Settings is open. */
export function useInboxStatus(): UseQueryResult<InboxSyncState[]> {
  return useQuery({
    queryKey: [...INBOX_KEY, 'status'],
    queryFn: async () => (await apiFetch<Envelope<InboxSyncState[]>>('/api/inbox/status')).data,
    staleTime: 0,
    refetchInterval: 60_000,
  });
}

/** Adds a rule at the end of the list. */
export function useCreateEmailRule(): UseMutationResult<EmailRule, Error, EmailRuleInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input) =>
      (await apiFetch<Envelope<EmailRule>>('/api/inbox/rules', { method: 'POST', body: JSON.stringify(input) })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: RULES_KEY }),
  });
}

/** Edits one rule. */
export function useUpdateEmailRule(): UseMutationResult<EmailRule, Error, { id: string; input: Partial<EmailRuleInput> }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }) =>
      (await apiFetch<Envelope<EmailRule>>(`/api/inbox/rules/${id}`, { method: 'PUT', body: JSON.stringify(input) })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: RULES_KEY }),
  });
}

/** Deletes one rule. */
export function useDeleteEmailRule(): UseMutationResult<{ id: string }, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) =>
      (await apiFetch<Envelope<{ id: string }>>(`/api/inbox/rules/${id}`, { method: 'DELETE' })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: RULES_KEY }),
  });
}

/** Saves the full rule order (ids, first rule first). */
export function useReorderEmailRules(): UseMutationResult<{ ok: true }, Error, string[]> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids) =>
      (await apiFetch<Envelope<{ ok: true }>>('/api/inbox/rules/reorder', { method: 'POST', body: JSON.stringify({ ids }) })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: RULES_KEY }),
  });
}

/** Re-sorts every conversation not categorised by hand; returns how many moved. */
export function useReapplyEmailRules(): UseMutationResult<{ changed: number }, Error, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await apiFetch<Envelope<{ changed: number }>>('/api/inbox/rules/reapply', { method: 'POST' })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: INBOX_KEY }),
  });
}
```

- [ ] **Step 3: Write the failing helper tests**

`apps/web/src/pages/inbox/inboxText.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Locks the Inbox's pure display rules: URL params ↔ tab state, row
 * titles and "You:" snippets, list timestamps, link detection in bubble
 * text, the hidden-history split behind "···", sender labels, byte
 * sizes, rule sentences, sync status lines and rule reordering.
 */

import { describe, expect, it } from 'vitest';
import {
  describeRule,
  formatBytes,
  formatThreadTime,
  hiddenHistory,
  inboxParamsToSearch,
  linkify,
  moveId,
  parseInboxParams,
  senderLabel,
  snippetLine,
  syncStatusLine,
  threadTitle,
} from './inboxText';

describe('parseInboxParams / inboxParamsToSearch', () => {
  it('defaults to Inquiry / New / page 1', () => {
    expect(parseInboxParams(new URLSearchParams())).toEqual({ category: 'inquiry', status: 'new', page: 1 });
  });

  it('ignores unknown values', () => {
    expect(parseInboxParams(new URLSearchParams('category=spam&status=x&page=-2'))).toEqual({
      category: 'inquiry',
      status: 'new',
      page: 1,
    });
  });

  it('round-trips and omits defaults', () => {
    const p = { category: 'supplier' as const, status: 'handled' as const, page: 3 };
    expect(parseInboxParams(new URLSearchParams(inboxParamsToSearch(p)))).toEqual(p);
    expect(inboxParamsToSearch({ category: 'inquiry', status: 'new', page: 1 })).toEqual({});
  });
});

describe('threadTitle / snippetLine', () => {
  it('prefers the name, then the address', () => {
    expect(threadTitle({ counterpart_name: 'Jane', counterpart_address: 'j@x.com' })).toBe('Jane');
    expect(threadTitle({ counterpart_name: '', counterpart_address: 'j@x.com' })).toBe('j@x.com');
    expect(threadTitle({ counterpart_name: '', counterpart_address: '' })).toBe('Unknown sender');
  });

  it('prefixes our own last message with "You:"', () => {
    expect(snippetLine({ last_direction: 'out', last_snippet: 'Tuesday works' })).toBe('You: Tuesday works');
    expect(snippetLine({ last_direction: 'in', last_snippet: 'Hi' })).toBe('Hi');
  });
});

describe('formatThreadTime', () => {
  const now = new Date(2026, 9, 21, 15, 0);
  it('shows the time today, the date this year, the full date otherwise', () => {
    expect(formatThreadTime(new Date(2026, 9, 21, 9, 5).toISOString(), now)).toBe('9:05 AM');
    expect(formatThreadTime(new Date(2026, 2, 4, 9, 5).toISOString(), now)).toBe('Mar 4');
    expect(formatThreadTime(new Date(2025, 2, 4, 9, 5).toISOString(), now)).toBe('Mar 4, 2025');
  });
});

describe('linkify', () => {
  it('splits URLs out and leaves trailing punctuation as text', () => {
    expect(linkify('See https://blindsnisa.com/a?b=1. Thanks')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', text: 'https://blindsnisa.com/a?b=1', href: 'https://blindsnisa.com/a?b=1' },
      { kind: 'text', text: '. Thanks' },
    ]);
  });

  it('does not link javascript: or bare text', () => {
    expect(linkify('javascript:alert(1) and www.x.com')).toEqual([{ kind: 'text', text: 'javascript:alert(1) and www.x.com' }]);
  });
});

describe('hiddenHistory', () => {
  it('returns what was trimmed after the reply', () => {
    expect(hiddenHistory({ reply_text: 'Yes', text_body: 'Yes\n\nOn Mon … wrote:\n> old' })).toBe('On Mon … wrote:\n> old');
  });

  it('returns null when nothing was trimmed', () => {
    expect(hiddenHistory({ reply_text: 'Yes', text_body: 'Yes\n' })).toBeNull();
  });

  it('returns the whole body when the reply is not its prefix', () => {
    expect(hiddenHistory({ reply_text: '(unreadable)', text_body: '' })).toBeNull();
    expect(hiddenHistory({ reply_text: 'B', text_body: 'A B' })).toBe('A B');
  });
});

describe('senderLabel / formatBytes / describeRule / moveId', () => {
  it('labels senders', () => {
    expect(senderLabel({ direction: 'out', from_name: 'Blinds Nisa', from_address: 'info@blindsnisa.com' })).toBe('You');
    expect(senderLabel({ direction: 'in', from_name: '', from_address: 'j@x.com' })).toBe('j@x.com');
  });

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3_500_000)).toBe('3.3 MB');
  });

  it('describes a rule as a sentence', () => {
    expect(describeRule({ field: 'domain', match_type: 'ends_with', value: 'acme.com', action: 'supplier' })).toBe(
      'Email domain ends with “acme.com” → Supplier'
    );
  });

  it('moves an id up or down and ignores out-of-range moves', () => {
    expect(moveId(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveId(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('syncStatusLine', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  it('shows the error first, then the last success, then never', () => {
    expect(syncStatusLine({ folder: 'inbox', folder_name: 'INBOX', last_run_at: null, last_success_at: null, last_error: 'AUTHENTICATE failed' }, now)).toBe(
      'Inbox: error — AUTHENTICATE failed'
    );
    expect(syncStatusLine({ folder: 'sent', folder_name: 'Sent', last_run_at: null, last_success_at: '2026-10-21T11:57:00Z', last_error: null }, now)).toBe(
      'Sent: last synced 3 minutes ago'
    );
    expect(syncStatusLine({ folder: 'inbox', folder_name: '', last_run_at: null, last_success_at: null, last_error: null }, now)).toBe(
      'Inbox: not synced yet'
    );
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/web && pnpm vitest run src/pages/inbox/inboxText.test.ts`
Expected: FAIL, "Failed to resolve import ./inboxText".

- [ ] **Step 5: Write `apps/web/src/pages/inbox/inboxText.ts`**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pure display rules for the Inbox and Settings → Email Rules: labels,
 * URL-param state for the list, row text, timestamps, link detection in
 * bubble text, the "···" history split, and small formatters. No React,
 * so every rule is unit-tested (`inboxText.test.ts`).
 *
 * Link detection is deliberately strict: only `http://` and `https://`
 * URLs become links (never `javascript:` or bare domains), and trailing
 * punctuation stays text. Rendering stays plain text through React's
 * escaping; this module only splits strings.
 */

import { format, formatDistanceStrict, isSameDay, isSameYear } from 'date-fns';
import type {
  EmailCategory,
  EmailMessage,
  EmailRule,
  EmailRuleAction,
  EmailRuleField,
  EmailRuleMatch,
  EmailThreadStatus,
  EmailThreadSummary,
  InboxSyncState,
} from '../../types';

/** Tab order on the Inbox page. */
export const CATEGORY_ORDER: EmailCategory[] = ['inquiry', 'supplier', 'payment', 'other'];

/** Tab and select labels. */
export const CATEGORY_LABELS: Record<EmailCategory, string> = {
  inquiry: 'Inquiry',
  supplier: 'Supplier',
  payment: 'Payment',
  other: 'Other',
};

/** Rule field names as staff read them. */
export const RULE_FIELD_LABELS: Record<EmailRuleField, string> = {
  address: 'Email address',
  domain: 'Email domain',
  subject: 'Subject',
  body: 'Message text',
};

/** Rule comparison names as staff read them. */
export const RULE_MATCH_LABELS: Record<EmailRuleMatch, string> = {
  contains: 'contains',
  equals: 'is exactly',
  ends_with: 'ends with',
};

/** Rule outcomes as staff read them. */
export const RULE_ACTION_LABELS: Record<EmailRuleAction, string> = {
  ...CATEGORY_LABELS,
  ignore: 'Ignore (don’t import)',
};

/** The Inbox list's URL state. */
export interface InboxParams {
  category: EmailCategory;
  status: EmailThreadStatus;
  page: number;
}

/** Reads `?category=&status=&page=`; anything unknown falls back to Inquiry / New / 1. */
export function parseInboxParams(params: URLSearchParams): InboxParams {
  const category = params.get('category');
  const status = params.get('status');
  const page = Number(params.get('page'));
  return {
    category: CATEGORY_ORDER.includes(category as EmailCategory) ? (category as EmailCategory) : 'inquiry',
    status: status === 'handled' ? 'handled' : 'new',
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** The inverse of {@link parseInboxParams}, omitting defaults for clean URLs. */
export function inboxParamsToSearch(p: InboxParams): Record<string, string> {
  const out: Record<string, string> = {};
  if (p.category !== 'inquiry') out.category = p.category;
  if (p.status !== 'new') out.status = p.status;
  if (p.page > 1) out.page = String(p.page);
  return out;
}

/** The other party's name, else address, else a placeholder. */
export function threadTitle(t: Pick<EmailThreadSummary, 'counterpart_name' | 'counterpart_address'>): string {
  return t.counterpart_name.trim() || t.counterpart_address.trim() || 'Unknown sender';
}

/** The row's preview line; "You: " when the shop sent the last message. */
export function snippetLine(t: Pick<EmailThreadSummary, 'last_direction' | 'last_snippet'>): string {
  return `${t.last_direction === 'out' ? 'You: ' : ''}${t.last_snippet}`;
}

/** "9:05 AM" today, "Mar 4" this year, "Mar 4, 2025" before. */
export function formatThreadTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (isSameDay(date, now)) return format(date, 'h:mm a');
  if (isSameYear(date, now)) return format(date, 'MMM d');
  return format(date, 'MMM d, yyyy');
}

/** A piece of bubble text: plain text, or an http(s) link. */
export type TextSegment = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

/** Splits text into text and http(s) link segments (see module comment). */
export function linkify(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    const url = match[0].replace(TRAILING_PUNCTUATION, '');
    if (start > last) segments.push({ kind: 'text', text: text.slice(last, start) });
    segments.push({ kind: 'link', text: url, href: url });
    last = start + url.length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments.length ? segments : [{ kind: 'text', text }];
}

/**
 * What "···" reveals: the part of the full text after the shown reply,
 * the whole full text when the reply isn't its prefix, or null when
 * nothing was trimmed (no "···" button).
 */
export function hiddenHistory(m: Pick<EmailMessage, 'reply_text' | 'text_body'>): string | null {
  const full = m.text_body.trim();
  const reply = m.reply_text.trim();
  if (!full || full === reply) return null;
  if (full.startsWith(reply)) return full.slice(reply.length).trim() || null;
  return full;
}

/** "You" for the shop's messages, else the sender's name or address. */
export function senderLabel(m: Pick<EmailMessage, 'direction' | 'from_name' | 'from_address'>): string {
  if (m.direction === 'out') return 'You';
  return m.from_name.trim() || m.from_address || 'Unknown sender';
}

/** 512 B, 2 KB, 3.3 MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 'Email domain ends with “acme.com” → Supplier'. */
export function describeRule(r: Pick<EmailRule, 'field' | 'match_type' | 'value' | 'action'>): string {
  return `${RULE_FIELD_LABELS[r.field]} ${RULE_MATCH_LABELS[r.match_type]} “${r.value}” → ${RULE_ACTION_LABELS[r.action]}`;
}

const FOLDER_LABELS: Record<InboxSyncState['folder'], string> = { inbox: 'Inbox', sent: 'Sent' };

/** One status line per folder: the error if any, else time since last success. */
export function syncStatusLine(s: InboxSyncState, now: Date = new Date()): string {
  const label = FOLDER_LABELS[s.folder];
  if (s.last_error) return `${label}: error — ${s.last_error}`;
  if (s.last_success_at) {
    return `${label}: last synced ${formatDistanceStrict(new Date(s.last_success_at), now)} ago`;
  }
  return `${label}: not synced yet`;
}

/** A copy of `ids` with item `index` moved by `delta` (unchanged when out of range). */
export function moveId(ids: string[], index: number, delta: -1 | 1): string[] {
  const target = index + delta;
  if (target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
```

- [ ] **Step 6: Run the helper tests and typecheck**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/web && pnpm vitest run src/pages/inbox/inboxText.test.ts && pnpm check`
Expected: PASS; no tsc output. `formatThreadTime` uses local time on purpose (the test builds dates with the local `Date` constructor), so it passes in any time zone.

- [ ] **Step 7: Commit**

```bash
cd /Users/kemal/Desktop/measure-blinds/apps/web && git add src/hooks/useInbox.ts src/pages/inbox/inboxText.ts src/pages/inbox/inboxText.test.ts && git commit -m "feat(inbox): web types, query hooks and display helpers" -- src/types/index.ts src/hooks/useInbox.ts src/pages/inbox/inboxText.ts src/pages/inbox/inboxText.test.ts
```

Note: `src/types/index.ts` also holds the uncommitted `customer_viewed_at` field from the eye-icon change. Committing the path includes it. That's fine only if that change is meant to ship with this branch; otherwise stage just the inbox hunk with `git add -p src/types/index.ts` and commit without the path list for that file. Ask the user if unsure.

---

### Task 10: Inbox list and bubble thread pages

**Files:**
- Create: `apps/web/src/pages/inbox/InboxPage.tsx`
- Create: `apps/web/src/pages/inbox/InboxThreadPage.tsx`
- Create: `apps/web/src/pages/inbox/MessageBubble.tsx`
- Create: `apps/web/src/pages/inbox/ThreadControls.tsx`
- Modify: `apps/web/src/App.tsx` (routes), `apps/web/src/components/Sidebar.tsx` (nav item)

**Interfaces:**
- Consumes: hooks and helpers from Task 9; `useCustomerSearch` (`hooks/useCustomers`); `displayName` (`lib/customerName`); `statusLabel` (`lib/statusStyles`); `PageHeader`, `ListSkeleton`, `Card`, `CardBody`, `Button`, `Field`, `inputClass`.
- Produces: routes `/inbox` and `/inbox/:id`; sidebar item "Inbox".

- [ ] **Step 1: Write `MessageBubble.tsx`**

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * One email as a chat bubble: the other party on the left (white card),
 * the shop on the right (brand blue), with sender and time above.
 *
 * Shows `reply_text` (quoted history already trimmed by the Worker) as
 * plain text: line breaks kept, http(s) URLs turned into links that open
 * in a new tab with `noopener noreferrer`. No email HTML is ever
 * rendered. When the Worker trimmed something, a small "···" button
 * reveals it underneath, muted. Attachments are listed by name and size
 * only; the files stay in Titan.
 */

import { useState } from 'react';
import { format } from 'date-fns';
import type { EmailMessage } from '../../types';
import { formatBytes, hiddenHistory, linkify, senderLabel } from './inboxText';

/** Plain text with http(s) links; React escapes every text node. */
function LinkifiedText({ text, linkClass }: { text: string; linkClass: string }) {
  return (
    <>
      {linkify(text).map((segment, i) =>
        segment.kind === 'link' ? (
          <a key={i} href={segment.href} target="_blank" rel="noopener noreferrer" className={linkClass}>
            {segment.text}
          </a>
        ) : (
          <span key={i}>{segment.text}</span>
        )
      )}
    </>
  );
}

/** Renders one message of a conversation. */
export default function MessageBubble({ message }: { message: EmailMessage }) {
  const [showHistory, setShowHistory] = useState(false);
  const mine = message.direction === 'out';
  const history = hiddenHistory(message);
  const linkClass = mine ? 'underline decoration-white/60 break-all' : 'text-brand-700 underline break-all';

  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[85%] flex-col gap-1 sm:max-w-[75%] ${mine ? 'items-end' : 'items-start'}`}>
        <div className="flex items-baseline gap-2 px-1 text-[12px] text-text-muted">
          <span className="font-semibold text-text-secondary">{senderLabel(message)}</span>
          <time dateTime={message.sent_at}>{format(new Date(message.sent_at), 'MMM d, h:mm a')}</time>
        </div>

        <div
          className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[14px] leading-5 shadow-sm ${
            mine
              ? 'rounded-br-md bg-brand-600 text-white'
              : 'rounded-bl-md border border-border-light bg-surface text-text-primary'
          }`}
        >
          <LinkifiedText text={message.reply_text} linkClass={linkClass} />
          {history && (
            <>
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                aria-expanded={showHistory}
                aria-label={showHistory ? 'Hide earlier messages' : 'Show earlier messages'}
                className={`mt-1 block rounded px-1.5 text-[13px] font-bold leading-4 ${
                  mine ? 'bg-white/20 hover:bg-white/30' : 'bg-surface-sunken text-text-secondary hover:bg-border-light'
                }`}
              >
                ···
              </button>
              {showHistory && (
                <div className={`mt-2 border-t pt-2 text-[13px] ${mine ? 'border-white/30 text-white/80' : 'border-border-light text-text-muted'}`}>
                  <LinkifiedText text={history} linkClass={linkClass} />
                </div>
              )}
            </>
          )}
        </div>

        {message.attachments.length > 0 && (
          <ul className="flex flex-col gap-0.5 px-1 text-[12px] text-text-muted">
            {message.attachments.map((a, i) => (
              <li key={i}>
                Attachment: {a.filename} · {formatBytes(a.size)}
              </li>
            ))}
            <li className="italic">Open the email in Titan to download attachments.</li>
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `ThreadControls.tsx`**

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Triage card at the top of a conversation: category select, Mark
 * handled / Mark as new, customer link (search existing customers, or
 * open / unlink the linked one), and — once a customer is linked — an
 * order select listing that customer's orders.
 *
 * Every change is one `PUT /api/inbox/:id`; the server applies the link
 * rules (an order brings its customer; changing the customer clears the
 * order; a hand-picked category is locked against "Re-apply rules").
 * Errors surface as toasts; the thread query refetches on success.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Button, Card, CardBody, Field, inputClass } from '../../components/ui';
import { useCustomerSearch } from '../../hooks/useCustomers';
import { useUpdateInboxThread, type ThreadUpdate } from '../../hooks/useInbox';
import { displayName } from '../../lib/customerName';
import { statusLabel } from '../../lib/statusStyles';
import type { EmailCategory, EmailThreadDetail } from '../../types';
import { CATEGORY_LABELS, CATEGORY_ORDER } from './inboxText';

/** Triage controls for one conversation. */
export default function ThreadControls({ thread }: { thread: EmailThreadDetail }) {
  const update = useUpdateInboxThread();
  const [term, setTerm] = useState('');
  const search = useCustomerSearch(term);
  const results = term.trim() ? (search.data ?? []).slice(0, 5) : [];

  function save(patch: ThreadUpdate, successMessage?: string) {
    update.mutate(
      { id: thread.id, update: patch },
      {
        onSuccess: () => {
          if (successMessage) toast.success(successMessage);
        },
        onError: (e) => toast.error(e.message),
      }
    );
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[10rem]">
            <Field label="Category" htmlFor="thread-category">
              <select
                id="thread-category"
                className={`${inputClass} h-11`}
                value={thread.category}
                onChange={(e) => save({ category: e.target.value as EmailCategory })}
              >
                {CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="ml-auto">
            {thread.status === 'new' ? (
              <Button variant="primary" loading={update.isPending} onClick={() => save({ status: 'handled' }, 'Marked as handled')}>
                Mark handled
              </Button>
            ) : (
              <Button loading={update.isPending} onClick={() => save({ status: 'new' })}>
                Mark as new
              </Button>
            )}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold text-text-secondary">Customer</p>
          {thread.customer ? (
            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/customers/${thread.customer.id}`} className="text-sm font-semibold text-brand-700 underline">
                {displayName(thread.customer)}
              </Link>
              <Button size="sm" variant="ghost" onClick={() => save({ customer_id: null })}>
                Unlink
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <input
                className={`${inputClass} h-11`}
                placeholder="Search customers by name, email or phone"
                aria-label="Search customers to link"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
              {results.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-border-light bg-surface px-3 py-2 text-left text-sm hover:bg-surface-muted"
                  onClick={() => {
                    save({ customer_id: c.id }, 'Customer linked');
                    setTerm('');
                  }}
                >
                  <span className="truncate font-medium text-text-primary">{displayName(c)}</span>
                  <span className="truncate text-[12px] text-text-muted">{c.email}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {thread.customer && (
          <Field label="Order" htmlFor="thread-order">
            <div className="flex flex-wrap items-center gap-2">
              <select
                id="thread-order"
                className={`${inputClass} h-11 max-w-xs`}
                value={thread.order_id ?? ''}
                onChange={(e) => save({ order_id: e.target.value || null })}
              >
                <option value="">No order</option>
                {thread.customer_orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.order_number} · {statusLabel(o.status)}
                  </option>
                ))}
              </select>
              {thread.order && (
                <Link to={`/orders/${thread.order.id}`} className="text-sm font-semibold text-brand-700 underline">
                  Open {thread.order.order_number}
                </Link>
              )}
            </div>
          </Field>
        )}
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 3: Write `InboxThreadPage.tsx`**

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * One conversation (`/inbox/:id`): the triage card, then every message as
 * a bubble, oldest at the top, scrolled to the newest on open — the
 * other party on the left, the shop (info@blindsnisa.com, read from
 * Titan's Sent folder) on the right. Back returns to the conversation's
 * category tab. Replies are written in Titan; they appear here after
 * the next 5-minute sync.
 */

import { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { ListSkeleton } from '../../components/Skeleton';
import { useInboxThread } from '../../hooks/useInbox';
import MessageBubble from './MessageBubble';
import ThreadControls from './ThreadControls';
import { threadTitle } from './inboxText';

/** The bubble view of one conversation. */
export default function InboxThreadPage() {
  const { id } = useParams();
  const { data: thread, isLoading, error } = useInboxThread(id);
  const endRef = useRef<HTMLDivElement>(null);
  const messageCount = thread?.messages.length ?? 0;

  useEffect(() => {
    if (messageCount > 0) endRef.current?.scrollIntoView({ block: 'end' });
  }, [messageCount]);

  return (
    <div className="min-h-screen bg-surface-muted pb-16">
      <PageHeader
        eyebrow="Inbox"
        title={thread ? threadTitle(thread) : 'Conversation'}
        subtitle={thread?.subject || undefined}
        backTo={thread && thread.category !== 'inquiry' ? `/inbox?category=${thread.category}` : '/inbox'}
      />
      <div className="page-container flex flex-col gap-4 py-4 md:py-6 [--page-max:56rem]">
        {isLoading && <ListSkeleton />}
        {error && <p className="text-danger">{error.message}</p>}
        {thread && (
          <>
            <ThreadControls thread={thread} />
            <div className="flex flex-col gap-4">
              {thread.messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
            </div>
            <p className="text-center text-[12px] text-text-muted">
              Reply from Titan. Your reply shows up here within about 5 minutes.
            </p>
            <div ref={endRef} />
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write `InboxPage.tsx`**

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The Inbox (`/inbox`, envelope icon in the sidebar): conversations from
 * the shop's Titan mailbox, one category tab at a time (Inquiry,
 * Supplier, Payment, Other — sorted by the rules in Settings → Email
 * Rules), New or Handled, newest activity first, 15 per page.
 *
 * Tab, status and page live in the URL (`?category=&status=&page=`), so
 * opening a conversation and pressing Back returns to the same list.
 * Each row shows the other party, the subject, a preview of the latest
 * message ("You: …" when the shop wrote last), the time, the message
 * count, and the linked customer.
 */

import { useNavigate, useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { ListSkeleton } from '../../components/Skeleton';
import { useInboxThreads } from '../../hooks/useInbox';
import { displayName } from '../../lib/customerName';
import type { EmailThreadStatus, EmailThreadSummary } from '../../types';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  formatThreadTime,
  inboxParamsToSearch,
  parseInboxParams,
  snippetLine,
  threadTitle,
  type InboxParams,
} from './inboxText';

/** One conversation row; bold title while it's New. */
function ThreadRow({ thread, onOpen }: { thread: EmailThreadSummary; onOpen: () => void }) {
  const isNew = thread.status === 'new';
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-0.5 rounded-xl border border-border-light bg-surface p-3 text-left shadow-sm hover:bg-surface-muted"
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className={`truncate text-sm text-text-primary ${isNew ? 'font-bold' : 'font-semibold'}`}>
          {threadTitle(thread)}
        </span>
        <time dateTime={thread.last_message_at} className="shrink-0 text-[12px] text-text-muted">
          {formatThreadTime(thread.last_message_at)}
        </time>
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-[13px] font-medium text-text-secondary">{thread.subject || '(no subject)'}</span>
        {thread.message_count > 1 && (
          <span className="shrink-0 rounded-pill bg-surface-sunken px-1.5 text-[11px] font-semibold text-text-secondary">
            {thread.message_count}
          </span>
        )}
      </span>
      <span className="truncate text-[13px] text-text-muted">{snippetLine(thread)}</span>
      {thread.customer && (
        <span className="mt-1 self-start rounded-pill bg-info-tint px-2 py-0.5 text-[11px] font-semibold text-info">
          {displayName(thread.customer)}
        </span>
      )}
    </button>
  );
}

const STATUS_OPTIONS: Array<{ value: EmailThreadStatus; label: string }> = [
  { value: 'new', label: 'New' },
  { value: 'handled', label: 'Handled' },
];

/** The conversation list. */
export default function InboxPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const state = parseInboxParams(params);
  const { data, isLoading, error, isPlaceholderData } = useInboxThreads(state.category, state.status, state.page);
  const threads = data?.data ?? [];
  const totalPages = data?.total_pages ?? 1;

  function go(next: Partial<InboxParams>) {
    setParams(inboxParamsToSearch({ ...state, ...next }));
    window.scrollTo({ top: 0 });
  }

  const segment = (active: boolean) =>
    `min-h-9 flex-1 whitespace-nowrap rounded-md px-3 text-[13px] font-semibold ${
      active ? 'bg-surface text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
    }`;
  const pagerButton =
    'h-9 rounded-md border border-border-input bg-surface px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-muted disabled:opacity-40';

  return (
    <div className="min-h-screen bg-surface-muted pb-16">
      <PageHeader title="Inbox" backTo="/" />
      <div className="page-container flex flex-col gap-4 py-4 md:py-6 lg:py-8 [--page-max:56rem]">
        <div role="tablist" aria-label="Category" className="flex gap-1 overflow-x-auto rounded-lg bg-surface-sunken p-1">
          {CATEGORY_ORDER.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={c === state.category}
              className={segment(c === state.category)}
              onClick={() => go({ category: c, page: 1 })}
            >
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>

        <div className="flex gap-1 self-start rounded-lg bg-surface-sunken p-1" aria-label="Status">
          {STATUS_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={o.value === state.status}
              className={segment(o.value === state.status)}
              onClick={() => go({ status: o.value, page: 1 })}
            >
              {o.label}
            </button>
          ))}
        </div>

        {isLoading && <ListSkeleton />}
        {error && <p className="text-danger">{error.message}</p>}

        {!isLoading && !error && (
          <>
            {threads.length === 0 ? (
              <p className="rounded-xl border border-border-light bg-surface p-6 text-center text-[13px] text-text-muted shadow-sm">
                {state.page > 1
                  ? 'No conversations on this page.'
                  : `No ${state.status === 'new' ? 'new' : 'handled'} ${CATEGORY_LABELS[state.category].toLowerCase()} conversations.`}
              </p>
            ) : (
              <div className={`flex flex-col gap-2 transition-opacity ${isPlaceholderData ? 'opacity-60' : ''}`}>
                {threads.map((t) => (
                  <ThreadRow key={t.id} thread={t} onOpen={() => navigate(`/inbox/${t.id}`)} />
                ))}
              </div>
            )}

            {(totalPages > 1 || state.page > 1) && (
              <div className="mt-2 flex items-center justify-between gap-2">
                <button type="button" className={pagerButton} disabled={state.page <= 1} onClick={() => go({ page: state.page - 1 })}>
                  ‹ Previous
                </button>
                <span className="text-[13px] text-text-secondary">
                  Page {state.page} of {totalPages}
                </span>
                <button type="button" className={pagerButton} disabled={state.page >= totalPages} onClick={() => go({ page: state.page + 1 })}>
                  Next ›
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Register the routes in `App.tsx`**

After `const NotificationsPage = lazy(...)` add:

```tsx
const InboxPage = lazy(() => import('./pages/inbox/InboxPage'));
const InboxThreadPage = lazy(() => import('./pages/inbox/InboxThreadPage'));
```

Before the `{/* Notifications — … */}` route add:

```tsx
            {/* Inbox — Titan conversations (INBOX + Sent), synced every 5 minutes */}
            <Route path="/inbox" element={guard(<Layout><InboxPage /></Layout>)} />
            <Route path="/inbox/:id" element={guard(<Layout><InboxThreadPage /></Layout>)} />
```

- [ ] **Step 6: Add the sidebar item in `Sidebar.tsx`**

Insert before the Notifications item in `ITEMS`:

```ts
  {
    // Envelope: Titan conversations, sorted by Settings → Email Rules.
    to: '/inbox',
    label: 'Inbox',
    d: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M22 6l-10 7L2 6',
  },
```

and change the JSDoc above `ITEMS` from "The five sections" to "The six sections".

- [ ] **Step 7: Typecheck, test, lint**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/web && pnpm check && pnpm test && pnpm lint`
Expected: no tsc output; all tests pass; oxlint shows only the pre-existing `lead-form.js` warning. If `Field`'s `htmlFor` prop doesn't exist under that name, read `src/components/ui/Field.tsx` and use its actual prop.

- [ ] **Step 8: Verify in the browser with a harness (no Supabase session needed)**

Follow memory `browser-preview-needs-supabase-env`: create throwaway `apps/web/harness.html` + `apps/web/src/harness.tsx` that mount `InboxThreadPage` under `MemoryRouter initialEntries={['/inbox/t1']}` + `Routes`/`Route path="/inbox/:id"` + `QueryClientProvider`, with the cache pre-seeded:

```tsx
qc.setQueryData(['inbox', 'thread', 't1'], {
  id: 't1', subject: 'Quote for kitchen', counterpart_address: 'jane@example.com', counterpart_name: 'Jane Doe',
  category: 'inquiry', category_locked: false, status: 'new', handled_at: null,
  last_message_at: '2026-10-21T15:00:00Z', last_direction: 'out', last_snippet: 'Tuesday works', message_count: 3,
  customer_id: null, order_id: null, customer: null, order: null, customer_orders: [],
  messages: [
    { id: 'm1', direction: 'in', from_name: 'Jane Doe', from_address: 'jane@example.com', to_addresses: ['info@blindsnisa.com'], sent_at: '2026-10-20T14:00:00Z', reply_text: 'Hi, can I get a quote for 4 kitchen windows? Photos: https://example.com/p', text_body: 'Hi, can I get a quote for 4 kitchen windows? Photos: https://example.com/p', attachments: [{ filename: 'window.jpg', mime_type: 'image/jpeg', size: 245000 }] },
    { id: 'm2', direction: 'out', from_name: 'Blinds Nisa', from_address: 'info@blindsnisa.com', to_addresses: ['jane@example.com'], sent_at: '2026-10-20T15:00:00Z', reply_text: 'Sure! Tuesday at 10?', text_body: 'Sure! Tuesday at 10?\n\nOn Mon, Oct 20, 2026 Jane Doe <jane@example.com> wrote:\n> Hi, can I get a quote', attachments: [] },
    { id: 'm3', direction: 'in', from_name: 'Jane Doe', from_address: 'jane@example.com', to_addresses: ['info@blindsnisa.com'], sent_at: '2026-10-21T15:00:00Z', reply_text: 'Tuesday works', text_body: 'Tuesday works', attachments: [] },
  ],
});
```

Write a throwaway `apps/web/.env.local` with placeholder Supabase values only if the import chain needs it (it does: hooks → `lib/api` → `supabaseClient`). Start the `web` preview, open `/harness.html`, and check:
- Jane's bubbles are on the left (white), "You" bubble on the right (blue).
- The link in m1 is an `<a target="_blank" rel="noopener noreferrer">`.
- m2 has a "···" button that reveals the quoted text; m1 and m3 have none.
- At 375px width: no horizontal scroll, bubbles ≤ 85% wide.

Screenshot both widths, then delete `harness.html`, `src/harness.tsx` and `.env.local`.

- [ ] **Step 9: Commit**

```bash
cd /Users/kemal/Desktop/measure-blinds/apps/web && git add src/pages/inbox/InboxPage.tsx src/pages/inbox/InboxThreadPage.tsx src/pages/inbox/MessageBubble.tsx src/pages/inbox/ThreadControls.tsx && git commit -m "feat(inbox): Inbox list and chat-bubble conversation view" -- src/pages/inbox/InboxPage.tsx src/pages/inbox/InboxThreadPage.tsx src/pages/inbox/MessageBubble.tsx src/pages/inbox/ThreadControls.tsx src/App.tsx src/components/Sidebar.tsx
```

---

### Task 11: Settings → Email Rules

**Files:**
- Create: `apps/web/src/pages/settings/EmailRules.tsx`
- Modify: `apps/web/src/pages/settings/SettingsIndex.tsx` (tile), `apps/web/src/App.tsx` (route)

**Interfaces:**
- Consumes: `useEmailRules`, `useInboxStatus`, `useCreateEmailRule`, `useUpdateEmailRule`, `useDeleteEmailRule`, `useReorderEmailRules`, `useReapplyEmailRules`; `RULE_*_LABELS`, `describeRule`, `syncStatusLine`, `moveId`.
- Produces: route `/settings/email-rules`.

- [ ] **Step 1: Write `EmailRules.tsx`**

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Settings → Email Rules (`/settings/email-rules`).
 *
 * Shows whether the Titan sync is healthy (one line per folder, with the
 * last error if any) and manages the rules that sort NEW conversations
 * into Inbox tabs: field (other party's address or domain, subject,
 * message text) + comparison + value → category or Ignore. Rules run top
 * to bottom and the first match wins; up/down arrows change the order.
 * The same form adds a rule or, after "Edit", saves changes to one.
 * "Re-apply rules" re-sorts existing conversations, except those whose
 * category was picked by hand.
 */

import { useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import PageHeader from '../../components/PageHeader';
import { ListSkeleton } from '../../components/Skeleton';
import { Button, Card, CardBody, CardFooter, CardHeader, Field, inputClass } from '../../components/ui';
import {
  useCreateEmailRule,
  useDeleteEmailRule,
  useEmailRules,
  useInboxStatus,
  useReapplyEmailRules,
  useReorderEmailRules,
  useUpdateEmailRule,
} from '../../hooks/useInbox';
import type { EmailRule, EmailRuleAction, EmailRuleField, EmailRuleMatch } from '../../types';
import {
  RULE_ACTION_LABELS,
  RULE_FIELD_LABELS,
  RULE_MATCH_LABELS,
  describeRule,
  moveId,
  syncStatusLine,
} from '../inbox/inboxText';

/** The add/edit form's state. */
interface RuleDraft {
  field: EmailRuleField;
  match_type: EmailRuleMatch;
  value: string;
  action: EmailRuleAction;
}

const EMPTY_DRAFT: RuleDraft = { field: 'domain', match_type: 'equals', value: '', action: 'supplier' };

/** `<option>`s from a label map. */
function options<K extends string>(labels: Record<K, string>) {
  return (Object.entries(labels) as Array<[K, string]>).map(([value, label]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));
}

/** The Email Rules settings page. */
export default function EmailRules() {
  const rulesQuery = useEmailRules();
  const statusQuery = useInboxStatus();
  const createRule = useCreateEmailRule();
  const updateRule = useUpdateEmailRule();
  const deleteRule = useDeleteEmailRule();
  const reorder = useReorderEmailRules();
  const reapply = useReapplyEmailRules();

  const [draft, setDraft] = useState<RuleDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const rules = rulesQuery.data ?? [];

  function resetForm() {
    setDraft(EMPTY_DRAFT);
    setEditingId(null);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const input = { ...draft, value: draft.value.trim() };
    if (!input.value) {
      toast.error('Enter a value to match.');
      return;
    }
    const callbacks = {
      onSuccess: () => {
        toast.success(editingId ? 'Rule saved' : 'Rule added');
        resetForm();
      },
      onError: (err: Error) => toast.error(err.message),
    };
    if (editingId) updateRule.mutate({ id: editingId, input }, callbacks);
    else createRule.mutate(input, callbacks);
  }

  function startEdit(rule: EmailRule) {
    setEditingId(rule.id);
    setDraft({ field: rule.field, match_type: rule.match_type, value: rule.value, action: rule.action });
  }

  function move(index: number, delta: -1 | 1) {
    const ids = rules.map((r) => r.id);
    const next = moveId(ids, index, delta);
    if (next !== ids) reorder.mutate(next, { onError: (err) => toast.error(err.message) });
  }

  return (
    <div className="min-h-screen bg-surface-muted pb-16">
      <PageHeader eyebrow="Settings" title="Email Rules" backTo="/settings" />
      <div className="page-container flex flex-col gap-4 py-4 md:py-6 lg:py-8 [--page-max:48rem]">
        <Card>
          <CardHeader title="Mail sync" subtitle="info@blindsnisa.com is checked every 5 minutes" />
          <CardBody className="flex flex-col gap-1 text-[13px]">
            {statusQuery.isLoading && <p className="text-text-muted">Loading…</p>}
            {statusQuery.data?.length === 0 && <p className="text-text-muted">Not synced yet.</p>}
            {statusQuery.data?.map((s) => (
              <p key={s.folder} className={s.last_error ? 'text-danger' : 'text-text-secondary'}>
                {syncStatusLine(s)}
              </p>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Rules" subtitle="Checked top to bottom for each new conversation; the first match wins. No match → Other." />
          <CardBody flush>
            {rulesQuery.isLoading && (
              <div className="p-4">
                <ListSkeleton rows={2} />
              </div>
            )}
            {!rulesQuery.isLoading && rules.length === 0 && (
              <p className="px-4 py-4 text-[13px] text-text-muted">No rules yet. Everything goes to Other until you add one.</p>
            )}
            <ul className="divide-y divide-border-light">
              {rules.map((rule, index) => (
                <li key={rule.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                  <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      aria-label="Rule enabled"
                      onChange={(e) =>
                        updateRule.mutate(
                          { id: rule.id, input: { enabled: e.target.checked } },
                          { onError: (err) => toast.error(err.message) }
                        )
                      }
                    />
                    <span className={`min-w-0 break-words ${rule.enabled ? 'text-text-primary' : 'text-text-muted line-through'}`}>
                      {describeRule(rule)}
                    </span>
                  </label>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" aria-label="Move rule up" disabled={index === 0} onClick={() => move(index, -1)}>
                      ↑
                    </Button>
                    <Button size="sm" variant="ghost" aria-label="Move rule down" disabled={index === rules.length - 1} onClick={() => move(index, 1)}>
                      ↓
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => startEdit(rule)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        deleteRule.mutate(rule.id, {
                          onSuccess: () => {
                            if (editingId === rule.id) resetForm();
                          },
                          onError: (err) => toast.error(err.message),
                        })
                      }
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
          <CardFooter>
            <Button
              loading={reapply.isPending}
              onClick={() =>
                reapply.mutate(undefined, {
                  onSuccess: (r) => toast.success(r.changed === 1 ? '1 conversation moved' : `${r.changed} conversations moved`),
                  onError: (err) => toast.error(err.message),
                })
              }
            >
              Re-apply rules
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader title={editingId ? 'Edit rule' : 'Add a rule'} />
          <form onSubmit={submit}>
            <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="When" htmlFor="rule-field">
                <select id="rule-field" className={`${inputClass} h-11`} value={draft.field} onChange={(e) => setDraft({ ...draft, field: e.target.value as EmailRuleField })}>
                  {options(RULE_FIELD_LABELS)}
                </select>
              </Field>
              <Field label="Comparison" htmlFor="rule-match">
                <select id="rule-match" className={`${inputClass} h-11`} value={draft.match_type} onChange={(e) => setDraft({ ...draft, match_type: e.target.value as EmailRuleMatch })}>
                  {options(RULE_MATCH_LABELS)}
                </select>
              </Field>
              <Field label="Value" htmlFor="rule-value">
                <input
                  id="rule-value"
                  className={`${inputClass} h-11`}
                  maxLength={200}
                  placeholder={draft.field === 'domain' ? 'e.g. supplier.com' : draft.field === 'address' ? 'e.g. orders@supplier.com' : 'e.g. quote'}
                  value={draft.value}
                  onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                />
              </Field>
              <Field label="Then" htmlFor="rule-action">
                <select id="rule-action" className={`${inputClass} h-11`} value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value as EmailRuleAction })}>
                  {options(RULE_ACTION_LABELS)}
                </select>
              </Field>
            </CardBody>
            <CardFooter>
              {editingId && (
                <Button type="button" variant="ghost" onClick={resetForm}>
                  Cancel
                </Button>
              )}
              <Button type="submit" variant="primary" loading={createRule.isPending || updateRule.isPending}>
                {editingId ? 'Save rule' : 'Add rule'}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the Settings tile**

In `SettingsIndex.tsx`, append to the `BUSINESS` array (after Terms & Conditions):

```ts
  {
    to: '/settings/email-rules',
    label: 'Email Rules',
    desc: 'Sort incoming mail into Inbox tabs',
    accent: 'brand',
    d: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M22 6l-10 7L2 6',
  },
```

- [ ] **Step 3: Add the route in `App.tsx`**

With the other lazy settings imports:

```tsx
const EmailRules = lazy(() => import('./pages/settings/EmailRules'));
```

After the `/settings/terms` route:

```tsx
            <Route path="/settings/email-rules" element={guard(<Layout><EmailRules /></Layout>)} />
```

- [ ] **Step 4: Typecheck, test, lint**

Run: `cd /Users/kemal/Desktop/measure-blinds/apps/web && pnpm check && pnpm test && pnpm lint`
Expected: clean (only the pre-existing `lead-form.js` warning). If `CardBody` has no `flush` prop or `Button` has no `size="sm"`, read `src/components/ui/Card.tsx` / `Button.tsx`; both exist as of 2026-10-21.

- [ ] **Step 5: Harness check**

Same harness approach as Task 10 Step 8, mounting `EmailRules` with the cache pre-seeded at `['inbox', 'rules']` (two rules, one disabled) and `['inbox', 'status']` (inbox OK 3 minutes ago, sent with `last_error: 'No Sent folder found…'`). Check the rule sentences, the struck-through disabled rule, the red error line, and the 375px layout. Delete the harness files.

- [ ] **Step 6: Commit**

```bash
cd /Users/kemal/Desktop/measure-blinds/apps/web && git add src/pages/settings/EmailRules.tsx && git commit -m "feat(inbox): Settings → Email Rules page with sync status" -- src/pages/settings/EmailRules.tsx src/pages/settings/SettingsIndex.tsx src/App.tsx
```

---

### Task 12: Docs, full verification and rollout

**Files:**
- Modify: `knowledge/history/engine_features.md`, `memory-bank/activeContext.md`, `memory-bank/progress.md`, `memory-bank/systemPatterns.md`, `memory-bank/techContext.md`

- [ ] **Step 1: Full verification**

Run:
```bash
cd /Users/kemal/Desktop/measure-blinds/apps/api && pnpm check && pnpm test
```
```bash
cd /Users/kemal/Desktop/measure-blinds/apps/web && pnpm check && pnpm test && pnpm lint
```
Expected: 0 errors, all tests pass, only the known `lead-form.js` lint warning.

- [ ] **Step 2: Add the history entry (top of `knowledge/history/engine_features.md`, under the title)**

```markdown
## 2026-10-21 — Titan inbox: conversations from info@blindsnisa.com in the app
A `*/5 * * * *` cron on `blinds-nisa-api` reads new mail from the Titan mailbox's INBOX and
Sent folders over read-only IMAP (`cloudflare:sockets` TLS to imap.titan.email:993; in-house
client in `lib/inbox/imapClient.ts`, `EXAMINE` + `BODY.PEEK` only) and stores it in migration
45's `email_threads` / `email_messages`. Messages are parsed with postal-mime 2.7.6, quoted
history is trimmed (`quoteTrim.ts`: "On … wrote:", "… said:", Outlook headers, trailing `>`
runs; forwards kept), and threaded by In-Reply-To/References (reverse matches and merges
included), else same subject + other party within 60 days. New conversations are sorted by
Settings → Email Rules (first match wins; Ignore = not stored) and auto-linked to a customer
when exactly one has the sender's email. The **Inbox** page (sidebar, `/inbox`) lists
conversations per tab (Inquiry / Supplier / Payment / Other) and New/Handled; a conversation
(`/inbox/:id`) is a bubble thread (customer left, shop right), plain text only, "···" reveals
trimmed history, with category, customer/order link and Mark handled. A customer reply
reopens a handled conversation. First run only sets the cursors (no backfill); no
attachments stored; no replying from the app; app (Resend) emails are not shown. Secrets:
`TITAN_IMAP_USER`, `TITAN_IMAP_PASSWORD`. Spec `knowledge/specs/2026-10-14-titan-inbox-design.md`,
plan `knowledge/plans/2026-10-21-titan-inbox.md`.
```

- [ ] **Step 3: Update the memory bank (current-state, overwrite — don't append history)**

- `activeContext.md`: replace the "Designed, not started: Titan inbox" paragraph with: built on `feat/titan-inbox`, needs migration 45 + two secrets + deploy; link the history entry.
- `progress.md`: under what works, add the Inbox; under known issues, add "quote trimming tuned on synthetic samples; check real Titan replies after first live sync" and "attachment list may be incomplete for messages over 5 MB".
- `systemPatterns.md`: add an "Email ingestion" section: cron → `lib/inbox/run.ts` → `syncInbox` (injected `MailSource` + `InboxStore`), per-folder UID cursors in `email_sync_state`, `cloudflare:sockets` confined to `titanConnect.ts`.
- `techContext.md`: add `postal-mime` 2.7.6 (exact pin), `cloudflare:sockets`, secrets `TITAN_IMAP_USER` / `TITAN_IMAP_PASSWORD`, vars `TITAN_IMAP_HOST` / `TITAN_IMAP_PORT`, cron `*/5 * * * *`.

- [ ] **Step 4: Commit the docs**

```bash
cd /Users/kemal/Desktop/measure-blinds && git commit -m "docs(inbox): history entry and memory bank" -- knowledge/history/engine_features.md memory-bank/activeContext.md memory-bank/progress.md memory-bank/systemPatterns.md memory-bank/techContext.md
```

Note: `engine_features.md` and `activeContext.md` already carry other uncommitted entries (the eye icon, the deploy script). Committing these paths includes them. If that's not wanted, use `git add -p` for just the inbox hunks and commit without the path list. Ask the user if unsure.

- [ ] **Step 5: Local end-to-end run (USER provides the password)**

The user adds to `apps/api/.dev.vars` (gitignored; never typed by the agent):
```
TITAN_IMAP_USER=info@blindsnisa.com
TITAN_IMAP_PASSWORD=<their Titan password>
```
Migration 45 must exist in the database the local Worker points at (see Step 6). Then:
```bash
cd /Users/kemal/Desktop/measure-blinds/apps/api && npx wrangler dev --test-scheduled --port 8787
```
```bash
curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```
Expected log: first call → `Inbox sync: 0 imported …` (cursors set). Send a test email to info@blindsnisa.com from another account, reply to it from Titan webmail, wait a minute, call the cron URL again → `2 imported`. Open `/inbox` in the app: one conversation, left bubble + right bubble, no quoted history in the reply.

Then read 3–5 real `reply_text` / `text_body` pairs (Supabase table editor or `select reply_text, text_body from email_messages order by created_at desc limit 5`). For any reply where quoted history survived, add an anonymised copy as a `quoteTrim.test.ts` case, fix the pattern, and commit.

- [ ] **Step 6: Rollout (each step needs the user's explicit go-ahead)**

1. Apply migration 45 to Supabase project `lgbxxlwsdeuhdgzrjjen` (Supabase MCP `apply_migration`, name `inbox`, body = the migration file), only after the user says yes.
2. The user sets production secrets themselves:
   ```bash
   cd /Users/kemal/Desktop/measure-blinds/apps/api && npx wrangler secret put TITAN_IMAP_USER
   ```
   ```bash
   cd /Users/kemal/Desktop/measure-blinds/apps/api && npx wrangler secret put TITAN_IMAP_PASSWORD
   ```
3. Deploy both apps (after the user says yes): `pnpm run deploy:apps api web`.
4. After ≥ 10 minutes: Settings → Email Rules shows "last synced N minutes ago" for Inbox and Sent; `npx wrangler tail blinds-nisa-api` shows `Inbox sync:` lines and no `Auto-expiry` lines every 5 minutes (which would mean the cron dispatch branch is missing).

---

## Self-review (done while writing)

- **Spec coverage:** IMAP polling INBOX + Sent (T2, T7) · read-only commands (T2) · per-folder cursors, first run from now, UIDVALIDITY reset, 50 cap (T2, T7) · parse + 200 KB text cap + attachments metadata (T3) · quote trimming incl. said:/wrote:/Outlook/`>`/forward/fallback (T4) · threading header/reverse/subject 60 d/merge (T5, T7) · direction + counterpart (T5) · rules + ignore + other + re-apply + lock (T6, T8) · customer exactly-one link (T7) · reopen on incoming only (T1 SQL, T7) · unreadable placeholder (T7) · store failure holds cursor (T7) · API endpoints incl. status and reorder (T8) · Inbox list, bubbles, "···", links, attachments, triage (T10) · Email Rules + sync status (T11) · secrets/cron/vars (T7) · docs + rollout (T12). No gaps found.
- **Placeholders:** none; every code step has full code.
- **Type consistency:** `match_type` (not `match`), `reference_ids`, `FolderCursor.afterUid`, `FolderRead.scannedThroughUid`, `InboxStore.recordError(folder, message)`, `ThreadRef.createdAt`, `EmailRuleInput`/`EmailRule`, query keys `['inbox', …]` checked across tasks.
