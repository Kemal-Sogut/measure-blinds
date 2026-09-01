# System Patterns

## Architecture
- **Monorepo** — pnpm workspaces with `apps/web` (frontend) and `apps/api` (backend)
- **Frontend** — React SPA with client-side routing (React Router v6)
- **Backend** — Cloudflare Workers edge functions (Hono.js framework)
- **Database** — Supabase PostgreSQL with Row Level Security on all tables
- **Auth flow** — Supabase Auth (frontend) → JWT → Worker verifies via JWKS

## Key Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Worker as API gateway | Frontend never calls Supabase directly for data; all goes through Worker with service role key |
| RLS on every table | Defense-in-depth; even if Worker is bypassed somehow, RLS blocks unauthorized access |
| Client-side live pricing | Immediate feedback on keystroke; Worker recalculates authoritatively on save |
| Snapshot pricing on line items | Material/cassette/control/installation prices stored on line item at creation time to prevent retroactive price changes |
| Price lock from send onward | Sending an estimate quotes a price, so each item freezes its calculated price (`locked_base_price`) plus a fingerprint of the inputs behind it (migration 39) at `/send`, not at confirmation. Saving re-uses the frozen figure while the fingerprint matches; only an item whose OWN pricing inputs were edited is re-priced and re-locked. `draft` is the only live-priced status, and returning an order to draft is the only thing that releases a lock |
| Per-option price basis | How a hardware option is charged (per m / m2 / unit / panel) lives on the catalog ROW, not in the formula; one function interprets it |
| Catalog scoping join tables | Which hardware slots a blind type uses is DATA (`<catalog>_blind_types`), not a code constant — the shop switches a slot off per type from Settings without a deploy |
| UUID public tokens | Unguessable tokens for customer view URLs — no auth required, token acts as capability |
| No anon RLS on estimates | Public estimate view served only by the Worker (service role, single-row lookup by token); anon key grants zero data access, preventing enumeration |
| DB-enforced order_number uniqueness | Count-based generation can race under concurrent saves; UNIQUE index + Worker retry makes duplicates impossible |
| Session-sourced API tokens | `apiFetch` asks supabase-js for the current token per request (auto-refresh); tokens are never manually persisted |
| Vitest on money math | `pricing.ts`/`orderNumber.ts` (and later `totals.ts`) are pure functions; tests lock the formulas against silent drift |

## Design Patterns
- **Single Responsibility per File** — Each `.ts`/`.tsx` file has one clearly defined purpose
- **Barrel exports** — Types and hooks use index.ts barrel files
- **Thin entry points** — `main.tsx` and `index.ts` delegate all logic to modules
- **Zod validation** — All Worker inputs validated with Zod schemas before any DB operation
- **Optimistic UI** — TanStack Query with optimistic updates for settings CRUD

## Component Relationships
```
App.tsx → Router → Pages → Components
                 → Hooks (useAuth, useQuery...)
                 → Lib (api.ts, pricing.ts, orderNumber.ts)
                 → Types (index.ts)
```

## Order lifecycle & payments (2026-07-04)
- **Entity rename:** `estimates → orders`, `estimate_date → order_date`,
  `line_items.estimate_id → order_id`. An estimate/invoice is only the generated document.
- **Statuses:** draft → sent → awaiting_payment → in_progress → ready → installed
  (+ expired). Transitions live in `routes/orders.ts`; each is DB-guarded (e.g. confirm
  updates only a `sent` row). `unconfirm` (awaiting_payment→sent) is user-only and refused
  once a payment exists. Recording the first payment advances awaiting_payment→in_progress;
  `/ready` (in_progress→ready) and `/installed` (ready→installed) are user actions.
- **Installation scheduling:** once `ready`, the user proposes a time (`/install/propose`,
  ready-only) which emails the customer a one-hour arrival window [install_time, +1h] on
  install_date and a link to the token'd public page. The customer confirms
  (`/install/confirm`) or requests another (`/install/request`, optional note). This lives
  in `install_status` (unscheduled/proposed/confirmed/change_requested) independent of the
  order status; the customer can respond but can never reverse the order confirmation.
  Reaching `installed` remains a deliberate user action.
- **Payments ledger:** `payments` table (one order → many payments). Balance is DERIVED
  (`total − Σamount`), never stored, so it can't drift. `amount_paid` is attached to API
  responses by the Worker (summed server-side). Payments may be recorded at ANY
  post-confirmation stage (awaiting_payment / in_progress / ready / installed); the Record
  Payment sheet opens with an empty amount.
- **Document type:** the PDF is an Estimate until the first payment, then an Invoice
  (`docType` in `lib/pdf.ts`); the send flow always emails an Estimate.

### Money-triggered side effects live in `lib/` (added 2026-08-02)
Payments reach an order through TWO doors — `POST /orders/:id/payments` (a consultant) and
`POST /webhooks/etransfer` (the Gmail Apps Script). Anything that must happen "when money
lands" therefore belongs in a `lib/` helper called after `recordOrderPayment` from both, never
inline in one route. `lib/payments.ts` set the precedent; `lib/warrantyIssue.ts` follows it.
Two rules for such helpers:
- **They never throw.** The payment is already committed by the time they run, so a failure
  must come back as a value the caller logs — a bounced email must not turn a recorded payment
  into a failed request, and the webhook must not answer non-2xx and invite a retry of an
  already-applied transfer.
- **They own their own idempotency**, because both doors can fire for the same event. The
  warranty uses `orders.warranty_sent_at`; the e-Transfer ingest uses the Gmail message id.

## Calendar surface (2026-07-06)
A read-only presentation layer over the existing installation-scheduling domain — no
new lifecycle or schema. `GET /api/orders/calendar?from=&to=` (Zod-validated inclusive
date range) returns lightweight `CalendarEvent` rows (mirrors the list route's
`.select()` shape) for orders with an active `install_status`. **Must be registered
before `GET /:id` in `routes/orders.ts`** — Hono matches routes in registration order,
so a param route registered first would swallow `/calendar` as `id="calendar"`.
`pages/calendar/CalendarPage.tsx` is a thin composition root (month state + wizard
open/day state) delegating to `MonthGrid.tsx` (pure grid) and
`InstallProposalWizard.tsx` (strict 3-step Day→Time→Ready-order flow). The wizard
submits through the SAME `useProposeInstallation` mutation used by `OrderDetail.tsx` —
there is no separate "quiet" scheduling endpoint; creating a proposal from the calendar
always emails the customer. `useCalendar.ts` follows `useOrders.ts`'s direct-import
convention (not added to the `hooks/index.ts` barrel). Calendar is a 5th item in both
`Sidebar.tsx` and `BottomNav.tsx` (Home, Customers, Orders, Calendar, Settings).
(As of 2026-08-03 `BottomNav.tsx` no longer exists; nav items live only in `Sidebar.tsx`.)

## Order activity log & always-editable orders (2026-07-06)
- **Editability:** an order's customer/dates/line items can be edited (and saved via
  `PUT /:id`) at ANY lifecycle stage, not just draft/sent. This is distinct from
  send/confirm eligibility (`EDITABLE = ['draft','sent']` still gates whether an
  estimate can be (re)sent or the order (re)confirmed) — editing line items and
  advancing the lifecycle are separate concerns.
- **Activity log:** `order_logs` (order_id FK cascade, `message` text, `created_at`) is
  an append-only trail written by a best-effort `logOrderEvent()` call at every
  mutation point in `routes/orders.ts`. It is diagnostic/display-only — logging
  failures never fail the mutation they describe, and there is no update/delete path.
  `GET /:id/logs` returns newest-first; the web `useOrderLogs` hook is invalidated by
  the same `useCacheOrder` callback every lifecycle mutation already uses.

## Customer-raised side conversations (2026-07-21, widened 2026-08-26)
Two shapes now exist for "the customer asks staff for something from the token'd public
page", and the choice between them is a modelling decision, not a style one:
- **One optional side-conversation per order → COLUMNS on `orders`.** The cancellation
  request (migration 27) is `cancel_requested_at` + `cancel_request_note`; there is only ever
  one, either answer clears it back to NULL, and `order_logs` keeps the history.
- **A collection → its own TABLE.** Edit requests (migration 41) are
  `order_edit_requests` rows, several of which can be open at once and each resolved
  independently via a `resolved_at` stamp that is set once and never cleared.

Both share the invariants that make them safe on an unauthenticated surface: the customer
writes ONLY free text, never a status/line item/money field; the request is accepted only in
the window where it makes sense (cancellation: `awaiting_payment` with an empty ledger; edit:
`sent`), re-read server-side rather than trusted from the page; the customer's note is never
interpolated into the activity trail; and staff answer from `/api/*`, never the public group.
They differ on notification by design — a cancellation emails the shop, an edit request does
not, because an edit request is not time-critical and the order page already shows it.

The STAFF-side colour is load-bearing: the cancellation banner is red because it must be
answered before anything else proceeds, and the edit-request card is amber precisely so that
distinction survives. Two red cards would flatten it.

## Expandable/collapsible sections (2026-07-07)
No accordion component existed anywhere in `apps/web/src` before the customer-view
Terms & Conditions section — the pattern is a local `useState<boolean>` toggled by a
`<button aria-expanded>` header (title + a rotating chevron `<svg>` reusing
`PageHeader.tsx`'s stroke-icon style: `stroke="currentColor" strokeWidth="1.9"`,
`rotate-180` via a `transition-transform` class when open), with the content only
mounted while open. See `pages/customer-view/CustomerView.tsx`'s TERMS & CONDITIONS
section as the reference implementation for future collapsible UI.

## Blind-type modules + per-type Materials (2026-07-12, widened 2026-08-09 and 2026-08-10)
- **Class hierarchy (twins):** `apps/{api,web}/src/lib/blindTypes/` (named `calculators/`
  until 2026-08-09) — a concrete `BaseBlindType` holds the shared "main" formula (material +
  cassette + bottom rail + control with the width/height minimums) exposed via granular
  override hooks (`materialCost`, `cassetteCost`, `bottomRailCost`, `controlCost`,
  `applyWidthMinimum`, `applyHeightMinimum`). Each of the ten canonical types has its own
  file that `extends` the base. Nine still inherit it unchanged; **Curtains overrides
  `calculateUnitPrice` outright (2026-08-10)** because its shape genuinely differs — fabric
  is priced per running metre × pleat fullness and height does not enter at all, so no
  granular hook could express it. That remains the exception: prefer the smallest hook, and
  fork `calculateUnitPrice` only when the formula's SHAPE changes, not its coefficients.
  (2026-07-12)
- **A blind type owns more than a formula (2026-08-09).** `BaseBlindType` also carries
  `attributeSchema` (a `.strict()` Zod contract for that type's extra inputs; base accepts
  only `{}`), `defaultAttributes()`, and `describeAttributes()` → `{label, value}[]`. The
  formatter is deliberately React-free because `apps/api/src/lib/pdf.ts` runs on the Worker.
  Every display surface renders through it, so labels cannot drift between the PDF, the
  customer page, the manufacturer copy and the order rows.
- **Per-type inputs live in one `line_items.attributes` jsonb column** (migration 29), not a
  column per field. The Zod schema is the contract, enforced server-side before the write,
  because jsonb gives no DB-level type checking. Validation is TWO-STAGE: the payload schema
  takes a loose `z.record` (Zod cannot branch on the sibling `blinds_type`), then
  `resolveLineItems` re-parses through the type's own strict schema — an undeclared key is a
  400, never a silent store.
- **A type's PRICE INPUT that lives in a catalog: `catalogRefs` (2026-08-10).** When a
  per-type input is a row in a priced catalog (a pleat's fullness multiplier, an
  installation charge), the client must never send the number. The type declares
  `catalogRefs: {attrKey, table, valueColumn, nameKey, valueKey, noun}[]`; the client sends
  only `attrKey` (an id) and `attributeSchema` deliberately does NOT declare `nameKey` or
  `valueKey`, so a client that sends one gets a 400 from the same `.strict()` gate. After
  the parse, `resolveCatalogRefs(attrs, resolve)` writes the row's name and value into the
  blob, ALWAYS overwriting. Ordering is the whole safety property: parse proves the client
  sent no price, the overwrite puts the real one in.
  - `resolveLineItems` collects ids and queries once per referenced table, driven entirely
    by the declaration — no branch on `blinds_type` anywhere in `orders.ts`.
  - The web preview satisfies the same `CatalogResolver` from the TanStack Query cache, so
    the keystroke price and the server agree. `lineItemDrafts.ts` holds the ONLY table-name
    → list mapping on the client; the twins must not know how either side stores catalogs.
  - `inputKeys()` (the schema's declared keys) is what lets the client strip snapshot keys
    back out of a re-opened draft. Without it the round trip fails the strict parse and the
    options vanish on the second save — see `bug_fixes.md` 2026-08-10.
- **SETTINGS decides which shared hardware a type uses, not the type (2026-08-11).**
  Superseded `requiredCatalogs`, which was deleted. Cassette / bottom rail / control /
  installation options each carry the blind types they are offered for
  (`<catalog>_blind_types` join tables, migration 35), and a type uses a slot iff at least
  one ACTIVE option is linked to it. The Worker requires an id for each slot in use and
  REJECTS one for a slot that is not — a stored id for a slot with no formula would be
  named on every document while contributing nothing to the price. All four ids are
  therefore nullable in the payload schema, and ONE rule drives four client paths: the save
  guard, the price preview, `BlindTypeSelect` (clears an id the new type does not use) and
  bulk edit. Miss one and switching type makes the order unsavable.
  - The rule lives twice — `apps/api/src/lib/optionScoping.ts` (reads Postgres) and
    `slotsForType` in `lineItemDrafts.ts` (reads the TanStack cache). Untwinned by
    necessity; they must still agree.
  - EMPTY MEANS NONE, the OPPOSITE of `material_blind_types` (no links = every type). Both
    conventions are deliberate and both are live.
- **Billed material quantity is a first-class blind-type concept (2026-08-22), alongside
  `describeUnitCosts` (2026-08-20).** `BaseBlindType.describeMaterialUsage(item)` returns
  `{ unit: 'sqm' | 'running_m'; quantity; measured }` for ONE blind, on the same minimised
  dimensions `materialCost` charges — `quantity` is billed (minimums applied, matches the
  material leg's own money), `measured` skips the minimums and is reporting-only. Nine types
  inherit the base `sqm` formula; Curtains overrides it to report `running_m` (width minimum
  only, pleat fullness applied before the hem allowance is added, mirroring `materialCost`'s
  own shape). It backs the internal Material usage panel
  (`apps/web/src/pages/orders/MaterialUsageDialog.tsx` + `materialUsage.ts`) — never the PDF,
  the customer view, or `/orders/:id/present`.
  - **A material row and its per-window breakdown are ONE reading, not two (2026-08-25).**
    `MaterialUsageRow.lines` is built by pushing the same `describeMaterialUsage` quantity and
    the same `describeUnitCosts(inputs).material` product the row accumulates, in the same
    loop pass. Nothing recomputes a per-line figure from the row, and nothing recomputes the
    row from its lines — which is why the sum identity holds exactly and why adding a figure
    to one means adding it to the other in that one place. The unit is `row.unit` throughout,
    so the m²/running-metre split needs no per-type branch in the dialog.
  - **It is held consistent with `materialCost` BY TEST, not by construction.** The tempting
    refactor — deriving `materialCost` from `describeMaterialUsage(item).quantity × rate` —
    was deliberately rejected (design §4.2,
    `knowledge/specs/2026-08-21-material-usage-discount-design.md`): `(W × H × price) /
    10000` and `((W × H) / 10000) × price` are not bit-identical in IEEE-754, and
    reassociating the material leg could move a stored cent at a half-cent boundary on a
    production system with historical orders — the same hazard `HARDWARE_LEG_ORDER` exists to
    contain. Instead, both `pricing.test.ts` suites carry a case table asserting
    `describeUnitCosts(item).material ≈ describeMaterialUsage(item).quantity × rate`; deleting
    that test removes the ONLY guard against the two drifting apart. Any future blind type
    that overrides `materialCost` MUST also override `describeMaterialUsage` AND add a row
    to the `CASES` table in both `pricing.test.ts` suites — that table is hand-maintained,
    not derived from the registry, so an eleventh type with a divergent `materialCost` and
    no new `CASES` row drifts silently rather than failing the test.
- **Fabric give-backs COMPOSE the order discount; they never touch a line item
  (2026-08-22).** The Material usage dialog offers two ways to discount fabric — a rate per
  material, and one rate across the order — and both resolve to a dollar figure added to the
  order's single FIXED discount by `applyGiveBackPart` (`materialUsage.ts`). No unit price is
  overridden and no line is repriced, so a price a consultant typed on a line is never at
  risk from using the dialog.
  - **Keyed contributions, not a running total.** `Record<key, number>` (keys from
    `materialRowKey`, plus `ORDER_WIDE_GIVE_BACK`) records what each instrument last
    contributed. That is what makes Apply additive but idempotent — re-applying one row
    swaps its own figure rather than stacking a second copy — and makes Reset exact
    (`amount: 0` removes just that key). A hand-typed discount is the base underneath.
  - **The map is session state.** Nothing persists a per-material rate, so after a reload the
    discount is a plain dollar figure and Reset can no longer take an earlier session's
    contributions back out. Said on screen rather than assumed.
  - Clamped at zero in both directions: a rate above the catalog rate yields $0.00 with a
    disabled button, and the composed discount can never go negative.
  - **An earlier iteration wrote per-line `unit_price_override` and was replaced.** It made
    the give-back survive a save, but it consumed the one field a consultant uses to price a
    line by hand and needed a session-only provenance flag to tell the two apart. Discount
    composition needs neither. Do not reintroduce the override path without that trade-off
    being asked for again.
- **One column can mean two things, keyed by type (2026-08-10).** `materials.price_per_sqm`
  is dollars per m² for every type except Curtains, where it is dollars per RUNNING METRE.
  Accepted deliberately over a second column; the mitigation is that `MaterialsForType`
  relabels every affected string when the type resolves to Curtains. Any future reuse of a
  shared column must carry the same UI-level relabel, or the number gets entered wrong.
- **Catalog seeds must be identities (2026-07-29, generalised 2026-08-10).** Pricing is
  recomputed server-side on every save, so a newly seeded catalog value applies retroactively
  the moment an old order is re-saved. Seed the identity for the operation — `0` for anything
  added, `1` for anything multiplied — and let the shop set real values in Settings.
- **Dispatch by snapshot name:** line items store `blinds_type` as free text, so
  `registry.ts` resolves it with `normalizeBlindType` (lowercase, alphanumerics only, trailing
  "blind" stripped) → "Roller Blind" and "Roller" both map to Roller; unknown/empty falls back
  to the base default so pricing never throws. `getBlindType(name)` returns the instance
  (called `getCalculator` before 2026-08-09).
- **pricing.ts is a façade:** keeps `calculateBlindUnitPrice` (type-agnostic default, used by
  the shared money-math tests) and adds `calculateBlindUnitPriceForType(blindsType, inputs)`
  used by `resolveLineItems` (api) and the editor's live preview (web). The api and web sides
  remain twins — change both, and both `pricing.test.ts` suites.
- **Forms are per type too (2026-08-09):** `apps/web/src/pages/orders/blindForms/` — shared
  controls in `fields.tsx`, one hand-written file per type, `DefaultForm` as the permanent
  fallback, and `BlindEditForm` reduced to a dispatcher. This is a SECOND registry (React
  cannot live in `lib/blindTypes`, which runs on the Worker), but `getBlindForm` resolves the
  name through `getBlindType` first and keys on the canonical label, so the two cannot
  disagree about aliases. Draft models and pure functions live apart in `lineItemDrafts.ts`;
  keeping them out of the `.tsx` is what allows Fast Refresh.
- **Materials ↔ blind types (many-to-many):** `material_blind_types` join. The Materials
  settings API embeds `blind_type_ids` on reads and replaces them on create/update. The
  settings UI is a TWO-LEVEL flow: `Materials.tsx` lists blind types (and manages them),
  `MaterialsForType.tsx` (`/settings/materials/:blindTypeId`) lists+adds Materials scoped to
  one type. RULE (updated 2026-07-12): the editor's `materialsForType()` shows ONLY Materials
  linked to the selected type (linked-only; empty until a type is chosen) — the earlier
  "empty links = all types" rule was dropped, and migration 22 linked any orphaned Materials
  to Roller. Materials use dedicated settings routes/pages, not the generic CatalogEditor,
  because of these links. There is no separate "Blind Types" settings page — it lives inside
  Materials.

## Critical Implementation Paths
1. **Order creation:** Customer select → Add line items → Live pricing → Save → Server recalculates
2. **Send flow:** Save draft → Generate Estimate PDF → Send via Resend → Set status=sent
3. **Customer confirm:** Email link → Public view → Confirm → status=awaiting_payment → Notification email
4. **Reverse confirm (user only):** Order detail → Reverse Confirmation → status back to sent
5. **Payment:** Order detail → Record Payment → ledger row → status=in_progress → balance updates → PDF now an Invoice
6. **Ready:** Order detail → Mark Ready → status=ready
7. **Installation scheduling:** Order detail → Propose Installation (date + time) → email to customer → customer confirms/requests on public page → shows on the order; the panel also offers Change time (re-propose) / Delete time (`/install/cancel`)
8. **Installed:** Order detail → Mark Installed → status=installed (terminal)
9. **Revert / delete:** the order-detail Progress timeline shows all stages with an undo icon on earlier ones (`/:id/revert { to }`, backward-only, resets stage metadata but keeps payments); a Delete Order button removes the order (`DELETE /:id`, cascades line items + payments)

## Semantic colour (added 2026-07-31)
Hue encodes STATE, never decoration. blue=info/sent, violet=scheduled/in progress,
amber=payment owed, emerald=ready/paid, rose=expired/destructive, slate=draft.

- The `OrderStatus` mapping lives in ONE place: `apps/web/src/lib/statusStyles.ts`
  (`statusLabel`, `statusPill`, `PillTone`). It is JSX-free so it is unit-testable under the
  project's pure-logic Vitest setup.
- Components MUST NOT hard-code a status colour. `StatusBadge` is a thin binding of that
  mapping to the `Pill` primitive and holds no colour knowledge itself.
- Two states that legitimately share a hue are told apart by FILL, not by a new hue —
  `installed` is solid emerald, `ready` is tinted emerald.
- The same discipline extends beyond order status: installations are violet everywhere
  (EventChip, the appointments list, the schedule headings, the order page's Installation
  card), estimate visits emerald.

## UI primitive layer (added 2026-07-31)
`apps/web/src/components/ui/` owns the app's chrome: `Pill`, `Card` (+`CardHeader`,
`CardBody`, `CardFooter`, `CardAccent`), `Button`, `Field` (+`inputClass`), `Modal`,
`StatTile`, re-exported from `ui/index.ts`.

- Pages COMPOSE these rather than repeating class strings, so a future visual change is a
  primitive-level edit instead of a sweep through ~30 files.
- `inputClass` exists as a bare string alongside the `Field` wrapper specifically so pages
  with their own form grids can adopt the treatment WITHOUT being restructured. Existing
  local `INPUT_CLS` constants compose it rather than redefining it.
- `Modal` owns Escape, backdrop dismissal, scroll lock and focus. A caller migrating onto it
  MUST delete its own equivalents or the close handler fires twice.
- Cards carry a shadow AND a hairline border. The border is not redundant — the app is used
  on phones outdoors where a soft shadow alone can vanish in daylight.

## Design tokens are the propagation lever (added 2026-07-31)
`apps/web/src/index.css`'s `@theme` block is the single point of visual control.

- **Never delete a token name; change its value.** The pre-2026-07-31 system flattened every
  radius token to 2px, so the codebase says `rounded-sm` almost everywhere. Retokenizing
  reshaped the entire app with zero markup edits — and by the same mechanism, removing a
  name silently breaks every page nobody happened to open.
- Corollary: `rounded-full` used to render as a SQUARE. Any pre-2026-07-31 markup that says
  `rounded-full` may have meant "not a circle". Audit before trusting it.
- ~~`Sidebar`'s width and `Layout`'s `lg:pl-[…]` are one measurement written in two files.~~
  **Retired 2026-08-03.** That pairing is gone. Rail width is now `--sidebar-w` alone:
  `.app-shell-rail { width }` and `.app-shell-main { padding-inline-start }` both read it,
  and `Layout` picks the value by stamping `data-rail="icons|expanded"` on `.app-shell`.
  There is no second copy to keep in sync. Do not reintroduce a literal rail width.

## App shell & responsive layout (2026-08-03)
- **One nav component for every width.** `Sidebar` renders a collapsible rail at `md+` and a
  full-screen overlay below it. `BottomNav` and `Layout`'s `nav` prop were DELETED — the
  split of "sidebar at lg+, tab bar below, tab bar suppressed on detail pages" left tablets
  and every detail page with no navigation at all. Do not reintroduce a second nav component
  keyed on width.
- **One horizontal track.** `.page-container` (in `index.css`, re-exported as
  `PAGE_CONTAINER` from `PageHeader`) is the only page container: fluid, gutters 16/24/32px,
  capped at `var(--page-max, 1600px)`. Page headers and page bodies MUST use it, or they sit
  on different tracks and stop aligning. Narrow a body with `[--page-max:48rem]` on the same
  element — never with a second `max-w-*` utility, which resolves against `.page-container`'s
  own `max-width` by Tailwind's internal sort order rather than by written order.
- **Breakpoint meanings on the order screen:** `md` (768) = rail appears; `xl` (1280) = the
  summary rail appears as a third column and the sticky bottom action bar goes away. The
  order screen's `lg:` classes were remapped to `xl:` for this reason — `lg` no longer marks
  anything structural there.
- **Measured, not assumed, sticky offsets.** `--action-bar-h` and `--order-head-h` are both
  published from a `ResizeObserver` in `OrderDetail`. Hard-coded pixel offsets for these are
  wrong at most lifecycle stages and most widths; that is how `top-[57px]` came to be wrong.
- **Touch/overflow invariant:** assert `document.documentElement.scrollWidth ===
  window.innerWidth`. The page root's `overflow-x-clip` guard HIDES horizontal overflow, so
  "it looks fine" is not evidence.
