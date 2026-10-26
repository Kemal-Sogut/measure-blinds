# Sent estimates: option-change immunity + price-update notices

Date: 2026-10-25
Status: approved as written and implemented on 2026-10-25 (migration 48 not yet applied)
Branch: `feat/multi-estimate-send` (or a fresh branch off it)

## Intent

Adding a new installation option to a blind type that previously had none
retroactively broke every estimate and order already quoted on that type.
The requirement became live for line items that were quoted without it, so
those rows now fail validation and **Present to customer** is unreachable
on them.

The rule the shop wants: **once an estimate has been sent, a later catalog
change must not alter it, block it, or demand anything new from it.** When
a price does legitimately move after a send, staff must be told, in the
place where the change is visible, until the estimate is sent again.

## Why now

The field team cannot open sent estimates and orders of that blind type at
all. The workaround (navigating straight to the `/present` URL, which reads
the server row) does not help the editor, where the save itself is refused.

## What is already in place

Most of the freeze exists. Migration 39
(`20260825000039_line_items_price_lock.sql`) gives every line item
`locked_base_price` + `locked_inputs_fingerprint`, frozen the moment the
estimate reaches the customer (`lib/priceLock.ts`, `lib/priceLockStore.ts`).
The Worker already skips the hardware-slot gate for an item whose lock is
intact — `routes/orders.ts:682`, *"Nothing below runs for it — no lookup,
no slot-scoping gate."*

Two gaps:

1. **The web never consults the lock.** `buildPayload()` in
   `OrderDetail.tsx:1143` enforces the live slot requirement on every item,
   so `handlePresent()` fails client-side before the Worker is called. This
   is the actual blocker staff are hitting.
2. **Pre-migration-39 rows have no lock**, so on the Worker they fall
   through to live validation and are refused.

A third finding shapes the notice work: an edited item on a lock-holding
order is **re-locked at its new price by the save**
(`routes/orders.ts:622-630`). A notice driven by the lock would therefore
vanish the moment the consultant pressed Save. Persisting a notice until
the next send needs a second figure that a save never touches.

## Goals

- A sent-or-later order opens, saves and presents regardless of hardware
  options added to its blind type afterwards.
- A line item whose price has moved since the last send says so, at the top
  of its own details form.
- The order says so too, below its total.
- Sending the estimate again clears both notices.

## Non-goals

- Changing how prices are calculated, or what the price lock freezes.
- Changing `optionScoping.ts`, `slotsForType`, or the presentation pages.
- Backfilling locks onto pre-migration-39 rows (considered and rejected:
  it needs a third model of "the pricing inputs" and risks silently
  re-pricing items whose derived fingerprint is slightly wrong).
- Grandfathering **draft** estimates. A draft is a live quote, so a blind
  of that type still has to pick the new option. *(My call — see Open
  questions.)*

## Anti-goals

- A consultant must never be able to add a **new** line to a sent estimate
  without choosing the hardware its blind type requires. The formula would
  price it with no installation charge and the document would undercharge
  silently. This is why the exemption is scoped to rows that were already
  on the order, not to the order's status alone.
- No notice may claim a price moved when only quantity, an add-on or a
  manual override changed. None of those is a re-quote.

## Part 1 — Option-change immunity

### The rule

Enforce a blind's hardware-slot requirement only when that blind is being
quoted. An item is **not** being quoted when all of:

1. the order holds the price lock — `sent`, `expired`, or confirmed
   (`holdsPriceLock`, `routes/orders.ts:362`) — and this save is not the
   revive-to-draft branch;
2. its `uid` was already on the order before this save;
3. and either its lock still applies, or it never had a lock (a row from
   before migration 39).

Editing a sent row's pricing inputs breaks its lock on purpose — that row
is being re-quoted, so it must satisfy today's requirements. That door is
already documented in `lib/priceLock.ts`.

### Worker

`routes/orders.ts`:

- `resolveLineItems` gains an optional set of the uids already on the
  order, passed only under the same
  `holdsPriceLock(existing.status) && !reviveToDraft` gate that already
  builds `locks` (line 1290).
- `const enforced = scoping.isKnownType(it.blinds_type)` becomes
  `&& !grandfathered`, where `grandfathered = prior?.has(uid) && !locks?.has(uid)`.
  Both directions of the gate are skipped, matching the locked path.
- Intact locks need no change — the early return at line 682 already
  covers them. The new clause exists only for pre-migration-39 rows.
- `POST /` passes nothing: every item is new, full enforcement.

### Web

- `apps/web/src/lib/orderStatus.ts` gains `holdsPriceLock`, the twin of
  `PRICE_LOCKED` in `routes/orders.ts` — `['sent', 'expired', ...CONFIRMED_STATUSES]`.
- `OrderDetail.tsx` `buildPayload()` skips the four `uses.has(...)` checks
  when `holdsPriceLock(status) && it.uid && (isPriceLocked(it) || !it.lock)`.
  `status` is in scope at line 829; `uid` and `lock` are already on
  `ItemDraft`; `isPriceLocked` is exported from `lineItemDrafts.ts:648`.
- `blindDraftInputs` takes an optional `quoted` flag that relaxes the same
  four `uses.has(...)` completeness checks, threaded from `blindDraftPrice`
  and from the Material usage report. Without it a pre-39 grandfathered row
  shows no price in the editor and drops out of the usage report, which
  would put the preview and the save in disagreement — forbidden by
  AI_GUIDELINES Rule 1. *(My call — see Open questions.)*
- Post-39 rows already preview correctly: `blindDraftPrice:789` reads the
  frozen base before touching the catalog.

## Part 2 — Price-update notices

### Why a new stored figure

The lock cannot carry these notices: a save re-locks an edited item at its
new price, so the comparison would be lost exactly when it matters. The
notices compare against what was **last sent**, which no column records
today.

### Migration 48 — `20261025000048_quoted_price_snapshot.sql`

- `line_items.quoted_base_price numeric(10,2)` — the calculated base price
  this item carried at the last send.
- `orders.quoted_total numeric(10,2)` — the grand total the order carried
  at the last send.
- Both null until the first send, and null again on a return to draft.

### Writing and resetting

A new `stampQuotedFigures(sb, orderId)` in `lib/priceLockStore.ts`, beside
`freezeOrderPrices`:

- Called at the two genuine send points — `lib/estimateSend.ts:323` and
  `POST /:id/mark-sent` (`routes/orders.ts:1656`) — where it **always
  overwrites**. That overwrite is the reset the shop asked for: send again
  and both notices go quiet.
- Called at `POST /:id/confirm` (line 1811) and the `/status` jumps (lines
  2544, 2651) where it writes **only null columns**, mirroring the freeze's
  rule that a later stage is not a re-quote.
- `clearOrderPriceLocks` and the revive-to-draft branch clear both columns:
  a draft has no quoted figure.
- `PUT /:id` never writes them. Because that route replaces line items
  wholesale, `quoted_base_price` must be carried over per `uid` from
  `existing.line_items` into the new rows — the same pattern `buildLockMap`
  uses — and must be present on **every** inserted row, per the standing
  bulk-insert rule in AI_GUIDELINES §8.

### Per-item notice

At the top of the line-item details form — `BlindEditForm` and
`FlatEditForm` in `LineItemEditor.tsx:66`, above the first field group.
Nothing in `LineItemRow.tsx` (it has its own lock badge) and nothing on the
order page.

- Shows when the draft has a `quoted_base_price` and the current calculated
  base differs from it: `Price update: $200 → $220`.
- Compares the **calculated base unit price**, which is what is stamped.
  Quantity, add-ons and the manual override are excluded from the lock
  fingerprint on purpose and apply live on top of either figure, so
  comparing anything else would mix a stamped figure with live arithmetic.
  *(My call — see Open questions.)*
- Renders both directions; a drop reads `$220 → $200`.
- Hidden while the draft is not priceable, so a half-typed edit does not
  flicker.

### Order-level notice

Below the total on `OrderDetail.tsx`, for an order that holds the price
lock and has a `quoted_total`: the live total against the stamped one, same
arrow form.

- Compares the grand `total` — the figure the customer was shown — not the
  subtotal. *(My call — see Open questions.)*
- It is not a sum of the per-item notices: discount, tax, add-ons, quantity
  and hidden items all sit between a line base and the total, so it is read
  from `quoted_total` directly.

### Shared logic

Both notices come from pure exported helpers in `lineItemDrafts.ts` (and a
small one beside the totals for the order level), so the rule is unit
tested and the components only render:

```ts
quotedPriceChange(draft, catalogs): { from: number; to: number } | null
```

Returns null when there is no stamp, when the draft is not priceable, or
when the figures match.

## Part 3 — Dismissing a notice (added 2026-10-25, after approval)

Replaces the alternative considered at hand-over, which was to limit the notices to
`sent`/`expired` so confirmed invoices stayed quiet.

- **On the order, not per device.** A dismissal a colleague cannot see would not solve the
  problem it is for: the person who confirms the order would meet the notice again.
- **Migration 48 extended** (it had not been applied, so no 49):
  `line_items.quoted_notice_ack_base` and `orders.quoted_notice_ack_total`.
- **The figure, not a flag.** A notice shows while today's figure differs from the stamp AND
  from the acknowledged figure, so dismissing settles one move and a later one speaks up again.
- **`POST /api/orders/:id/dismiss-price-notice`**, optional `uid` (the item's notice) or none
  (the order total's). `.strict()` and figure-free: the Worker records the price the order
  holds, per AI_GUIDELINES §1. Logs an activity entry; 404 on an unknown order or uid.
- **Cleared** by `stampQuotedFigures` in `'overwrite'` mode and by `clearOrderPriceLocks`;
  carried across `PUT /:id` by `buildQuotedMap`, beside the stamp.
- **Hidden at the click** by `dismissedNotices` state in `OrderDetail`, reverted with a toast on
  failure, because line-item drafts hydrate once and are not rebuilt from a refetch. The edit
  forms take the notice as a `notice?: ReactNode` instead of building it.
- **My call:** the acknowledged figure is the one the order HOLDS, not the one being previewed,
  so dismissing mid-edit settles the saved price and saving that edit raises a fresh notice at
  the new one.

## Part 4 — Clearing on a re-send (added 2026-10-25, during testing)

Sending again must silence both notices. The Worker always did (the `'overwrite'` stamp), but
the WEB did not, for the per-item one: `useSendEstimates` invalidates the order's detail query,
so the order-level notice cleared, while line-item drafts hydrate once — deliberately, so a
refetch cannot discard unsaved edits — and kept the previous send's stamp until a reload.

`applyServerFields(items, byUid)` in `lineItemDrafts.ts` refreshes only the four server-owned
draft fields (`lock`, `previously_quoted`, `quoted_base`, `notice_ack_base`) by uid, leaves
every typed field alone, and returns the same array when nothing differs so an ordinary refetch
costs no re-render. `OrderDetail` applies it in an effect on the order, and clears the
optimistic dismissal set in the same pass — otherwise a dismissal made before a re-send would
go on hiding a notice whose acknowledgement the send had just cleared.

## Verification

Tests first, per workspace:

- `apps/api/src/routes/orders.routes.test.ts` — a pre-39 row on a sent
  order saves; a **new** item on a sent order is still rejected; an item
  whose lock broke is still rejected; `POST /` still enforces.
- `apps/api/src/lib/priceLockStore` coverage for `stampQuotedFigures`:
  overwrite at a send, fill-only at confirm, cleared on release, carried
  across a `PUT` by uid.
- `apps/web/src/pages/orders/lineItemDrafts.test.ts` — the grandfathering
  predicate, the `quoted` flag on `blindDraftInputs`, `quotedPriceChange`
  in both directions and its null cases.
- `apps/web/src/lib/orderStatus` — the `holdsPriceLock` twin.

Then `pnpm check`, `pnpm test`, `pnpm lint` in both workspaces, 0 errors
and 0 warnings. Pricing touched on both sides, so both suites run
(AI_GUIDELINES §9).

Finally: `knowledge/history/bug_fixes.md` for the retroactive-requirement
break, `knowledge/history/engine_features.md` for the two notices, and the
memory-bank current-state files (§4, §5).

## Open questions (all settled on approval, 2026-10-25)

Approved as written, so each of the four calls below stands as made: drafts are not
grandfathered, the preview relaxation is in, the per-item notice compares the calculated base
unit price, and the order-level notice compares the grand total. Kept for the record.

### As put at the time

1. **Drafts** — a draft estimate of that blind type, cut before the option
   existed, still has to pick one. Assumed, unchallenged, but it is the
   shop's call.
2. **The preview relaxation** — in, or left for later with pre-39 rows
   showing no price in the editor and missing from the Material usage
   report?
3. **Per-item figure** — calculated base unit price, or the line total?
4. **Order-level figure** — grand total, or subtotal?
