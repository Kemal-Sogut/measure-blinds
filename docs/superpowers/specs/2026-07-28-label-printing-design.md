# Production Label Printing — Design

Date: 2026-07-28 · Status: approved by user

## Goal

Print a production label for every blind on an order. The label is fixed behind
the blind's cassette before it leaves the shop, so it is invisible after
installation — it exists to keep a unit identifiable from the cut bench through
to the install van. Aesthetics are irrelevant; legibility at arm's length is the
only visual requirement.

Two print paths ship together:

1. **Shop PC** — the label page prints straight to the Windows-installed printer
   via `window.print()`.
2. **Any device (iPad included)** — a button enqueues a job that a local agent on
   an always-on shop PC picks up and sends to the printer. iOS has no Web
   Bluetooth, so this is the only way an iPad can reach the hardware.

## Hardware (fixed — not a decision this spec reopens)

- **Printer:** LabelCreate 2410BT. 203 dpi, direct thermal, USB **and** PC
  Bluetooth. Installs as a standard Windows printer; over Bluetooth it also
  exposes an outgoing SPP COM port.
- **Stock:** 3" × 1.5" direct thermal die-cut labels = **609 × 304 dots** at
  203 dpi.

## Decisions (confirmed with user)

- **One label per line item per unit of quantity.** A row with
  `panels [120, 90] × quantity 2` produces **2** labels, each listing both panel
  widths. A multi-panel row is treated as one installed unit.
- **No barcode.** Text only. This removes the Code128 encoder entirely and frees
  the vertical space it would have taken.
- **Fields:** order number, a `n of m` counter, customer name, room, panel widths
  × drop, material · colour, cassette, control. Blind type and the item note are
  deliberately excluded — the note is unbounded and would need truncation to a
  line that could mislead by omission.
- **Entry point:** a new route `/orders/:id/labels`, opened in a new tab, with
  per-label checkboxes so one scorched label can be reprinted alone.
- **Transport:** the agent polls a job queue every **30 seconds**. The API is a
  Cloudflare Worker with no route into the shop LAN, so every connection must be
  agent-initiated.
- **Render:** the Worker renders TSPL; the agent is a dumb pipe that writes those
  bytes to the printer.

## 1. Label layout

Only `item_type === 'blind'` rows produce labels. Preset and custom lines have no
dimensions and are skipped. An order with no blind rows returns 400 —
`This order has no blinds to label.`

Label ordering is stable and shared by both paths: line items ascending by
`position`, then copy index `1..quantity`. The `n of m` counter numbers labels
across the whole order, so `3 of 7` is unambiguous on the bench.

TSPL geometry, 10-dot left margin, 589 dots usable width:

| y | Field | Font | Cell | Height |
|---|-------|------|------|--------|
| 6 | `order_number`, and right-aligned `n of m` | `4` / `2` | 24×32 / 12×20 | 32 |
| 42 | rule (`BAR 10,42,589,2`) | — | — | 2 |
| 50 | Customer name | `3` | 16×24 | 24 |
| 78 | Room | `3` | 16×24 | 24 |
| 106 | `120 + 90 x 210 cm` | `4` | 24×32 | 32 |
| 142 | rule (`BAR 10,142,589,2`) | — | — | 2 |
| 150 | Material · Colour | `3` | 16×24 | 24 |
| 178 | Cassette | `3` | 16×24 | 24 |
| 206 | Control | `3` | 16×24 | 24 |

Content ends at y=230 of 304. The 74-dot tail is deliberate slack for gap
calibration drift — a label that creeps up or down by a couple of millimetres
still prints whole.

Truncation is per-font: font `3` fits 36 characters (589 ÷ 16), font `4` fits 24.
Overlong values are cut to the limit; nothing wraps, because a wrapped line would
push the layout past the label edge.

Empty fields collapse: a blind with no cassette prints nothing on that row rather
than a dangling `Cassette:` label, and the rows below do **not** move up (fixed y
coordinates keep every label scannable by eye in the same places).

## 2. Field extraction — twin modules

The two paths use different renderers (browser CSS vs TSPL), so only the field
extraction is shared, as twin pure modules. This follows the existing
`pricing.ts` / `totals.ts` convention in this repo: two implementations, mirrored
test suites, changed together.

- `apps/web/src/lib/labels.ts`
- `apps/api/src/lib/labels.ts`

Both export the same shape:

```ts
export interface LabelFields {
  /** Order number, e.g. "T0408-126". */
  orderNumber: string;
  /** 1-based position across the whole order. */
  index: number;
  /** Total labels for the order (the `m` in `n of m`). */
  total: number;
  customer: string;
  room: string;
  /** Pre-joined, e.g. "120 + 90 x 210 cm". */
  dimensions: string;
  /** Material and colour joined with " · "; either side may be absent. */
  material: string;
  cassette: string;
  control: string;
}

export function buildLabels(order: OrderLike): LabelFields[];
```

`OrderLike` is structurally the minimum each app already has — order number,
customer first/last name, and the line-item array.

Exact pixel layout differs between the browser and TSPL paths. That divergence is
accepted: the label is shop-floor, and both paths carry the same words in the
same order.

## 3. TSPL rendering — `apps/api/src/lib/labelTspl.ts`

(Named `labelTspl.ts`, not `label.ts`, so it cannot be confused at a glance with
the `labels.ts` twin above.)

`renderLabelsTspl(labels: LabelFields[]): string` returns the complete command
stream for a batch: one `CLS` … `PRINT 1,1` block per label, concatenated.

Preamble per block:

```
SIZE 3,1.50
GAP 0.12,0
DIRECTION 1
DENSITY 8
SPEED 4
CLS
```

`GAP 0.12,0` (≈ 3 mm) is the starting value for the die-cut stock and is the one
number expected to need adjustment after a physical calibration run.

Two sanitizers guard every interpolated string, and both are unit-tested:

- **`stripControl()` — a security invariant, not a formatting nicety.** TSPL is a
  command language delimited by newlines. A customer name or room containing
  `\r`, `\n`, or other control characters could otherwise close the `TEXT`
  statement and inject arbitrary printer commands. All control characters are
  removed, and `"` and `\` are escaped, before any value reaches the stream. This
  is the same class of rule as `escapeHtml` for email bodies and the PostgREST
  `or()` sanitizer in AI_GUIDELINES §2.
- **`foldAscii()`** — TSPL internal bitmap fonts are codepage-limited and will not
  render accented or non-Latin characters. Names like `Émile` or `Şoğut` are
  folded to their closest ASCII form (`Emile`, `Sogut`) rather than printed as
  blanks or garbage. Characters with no fold are dropped. The browser path needs
  no such fold and does not apply one.

Tests assert the emitted stream exactly, in the manner of `pdf.test.ts`: field
order, truncation at the per-font limits, omission of empty fields, control-char
stripping, ASCII folding, and one full golden-stream case.

## 4. Schema — migration 28

`supabase/migrations/20260728000028_print_jobs.sql`

```sql
create table public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'printing', 'done', 'failed')),
  payload text not null,
  label_count int not null default 1 check (label_count >= 1),
  attempts int not null default 0,
  last_error text not null default '',
  requested_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index print_jobs_pending_idx on public.print_jobs (status, created_at);
```

Plus the `set_updated_at` trigger, RLS enabled, and the
`authenticated_full_access` policy every other business table carries.

`payload` holds the rendered TSPL for the whole batch — one job per print
request, not one per label. `requested_by` stores the actor email, matching the
`order_logs.actor_email` convention.

### Claim RPC

Claiming must be atomic or two agent instances would print the same job twice.
PostgREST cannot express "update the oldest pending row" safely, so this is an
RPC, service-role-only, in the same style as `update_order_with_items`:

```sql
create or replace function public.claim_print_job()
returns table (id uuid, payload text, label_count int, order_number text)
language plpgsql security definer set search_path = public as $$
...
$$;

revoke execute on function public.claim_print_job() from public, anon, authenticated;
grant execute on function public.claim_print_job() to service_role;
```

The function does three things in one transaction:

1. Re-queues rows stuck in `printing` for more than **5 minutes** (the agent died
   mid-print). Rows that have already reached **3 attempts** go to `failed` with
   `last_error = 'Abandoned after 3 attempts.'` instead.
2. Selects the oldest `pending` row `for update skip locked`.
3. Sets it to `printing`, increments `attempts`, and returns it.

Returns zero rows when the queue is empty.

## 5. API routes

### `POST /api/orders/:id/print-label`

In `apps/api/src/routes/orders.ts`, alongside the other order actions. JWT-authed
like the rest of `/api/*`.

- **Body:** `{ items?: number[] }`, zod `.strict()`. Entries are 1-based label
  indexes in the ordering defined in §1. Omitted or empty = every label.
- **Guards:** order must exist (404); it must have at least one blind line item
  (400); every supplied index must be in range (400).
- **Effect:** builds `LabelFields[]`, filters to the requested indexes, renders
  TSPL, inserts one `print_jobs` row with `requested_by` = the authenticated
  actor's email, and writes an activity log entry —
  `Queued N label(s) for printing.`
- **Returns:** `{ job_id, label_count }`, 202.

Selection filters the labels **after** numbering, so a reprint of label 3 still
prints `3 of 7`, not `1 of 1`.

### `GET /agent/print-jobs/next`

### `POST /agent/print-jobs/:id/result`

Both live in a new `apps/api/src/routes/printAgent.ts`, mounted at `/agent` in
`index.ts` **outside `/api/*`** — that group requires a Supabase JWT, which a
headless agent has no way to obtain. Authentication is a shared bearer secret,
`PRINT_AGENT_SECRET`, checked exactly the way `routes/webhook.ts` checks
`ETRANSFER_WEBHOOK_SECRET`: a missing secret in the environment fails closed.

`PRINT_AGENT_SECRET?: string` is added to the `Env` interface in `index.ts` and
set with `wrangler secret put`.

- `GET next` calls `claim_print_job()`. Returns
  `{ id, order_number, label_count, payload }` (200) or **204** when idle. A 204
  is the normal case — the agent polls 2,880 times a day and will print on very
  few of them.
- `POST result` takes `{ ok: boolean, error?: string }`, zod `.strict()`. Sets
  the row to `done`, or to `failed` with `last_error` (truncated to 500 chars).
  A result for a job not in `printing` is a no-op returning 200, so a retried
  POST after a network blip cannot corrupt state.

No rate limiter on `/agent/*`. The one legitimate caller polls twice a minute,
and a limiter that misfires would stop production printing; the shared secret is
the control.

## 6. Web — `/orders/:id/labels`

`apps/web/src/pages/orders/OrderLabels.tsx`, lazy-loaded and guarded in
`App.tsx`, registered after `/orders/:id` alongside the existing `/manufacturer`
and `/overview` routes.

Print CSS:

```css
@page { size: 3in 1.5in; margin: 0 }
```

Body and every label element sized to exactly `3in × 1.5in` with zero margin and
`page-break-after: always`, so one label is one physical label. Only selected
labels render into the print flow — deselected ones are `display: none` on paper.

On screen the page shows the labels as a checkable list, each rendered at its
true proportions, with a select-all toggle. Two buttons in the header, both
`print:hidden`, following the `ManufacturerCopy.tsx` pattern:

- **Print** — `window.print()`. The shop-PC path. With Chrome launched using
  `--kiosk-printing` the dialog is suppressed entirely.
- **Send to printer** — calls the enqueue endpoint via a new
  `useEnqueuePrintLabels()` in `apps/web/src/hooks/useOrders.ts`, passing the
  checked label indexes as `items` (omitted when all are checked), and reports
  the queued count by toast. The iPad path.

Both buttons honour the same checkbox selection, so what the shop PC prints and
what the agent prints are chosen identically.

### Entry point

`OrderDetail.tsx`, in the `in_progress` branch of `stageActions()`, gains a third
secondary action beside Cut Sheet and Overview:

```ts
const labels: StageAction = {
  key: 'labels',
  icon: ICONS.labels,
  label: 'Labels',
  short: 'Labels',
  onClick: () => window.open(`/orders/${id}/labels`, '_blank', 'noopener'),
};
```

Three secondaries still fit the mobile action bar's one-row-of-three rule, so the
bar's worst case does not grow.

## 7. Print agent — `apps/print-agent/`

A new pnpm workspace package; the root `pnpm-workspace.yaml` already globs
`apps/*`. TypeScript source compiled by `tsc` to `dist/`, run as
`node dist/index.js`. **Zero runtime dependencies** — everything it needs is in
the Node 22 standard library. Devdependencies are `typescript` and `vitest` only,
so it satisfies the Rule 9 `check` / `test` scripts like the other workspaces.

Modules:

- `src/config.ts` — reads and validates environment variables, failing loudly at
  startup rather than at the first print: `API_BASE_URL`, `PRINT_AGENT_SECRET`,
  `PRINTER_TARGET`, `POLL_MS` (default `30000`).
- `src/printer.ts` — picks a write strategy from the shape of `PRINTER_TARGET`:
  - matches `/^COM\d+$/` → writes the bytes directly to `\\.\COM<n>`. This is the
    Bluetooth SPP outgoing port, or a USB serial port. No driver involved at all.
  - anything else is treated as a Windows printer share (e.g.
    `\\localhost\LabelCreate`) → writes the payload to a temp file and runs
    `cmd /c copy /b <file> <target>`, which passes the bytes through the spooler
    with RAW datatype, bypassing driver layout.

  Both strategies ship. Which one is used is settled at install time against real
  hardware.
- `src/index.ts` — the poll loop: `GET next`; on 204 sleep and repeat; on 200
  print and `POST result`. Network errors are caught and logged, never fatal —
  the agent must survive a Worker restart, a dropped Wi-Fi link, and a printer
  that is switched off, and resume on its own.
- `README.md` — install and run steps for the shop PC, including registering the
  agent as a Windows scheduled task at logon.

Tests cover `config.ts` validation and `printer.ts` strategy selection. The
actual byte write is not unit-tested — it is I/O against hardware, and a mock of
it would assert nothing real.

## 8. Files

New:

- `supabase/migrations/20260728000028_print_jobs.sql`
- `apps/api/src/lib/labels.ts`, `labels.test.ts`
- `apps/api/src/lib/labelTspl.ts`, `labelTspl.test.ts`
- `apps/api/src/routes/printAgent.ts`, `printAgent.test.ts`
- `apps/web/src/lib/labels.ts`, `labels.test.ts`
- `apps/web/src/pages/orders/OrderLabels.tsx`
- `apps/print-agent/**`

Modified:

- `apps/api/src/index.ts` — `PRINT_AGENT_SECRET` on `Env`, mount `/agent`
- `apps/api/src/routes/orders.ts` — `POST /:id/print-label`
- `apps/web/src/App.tsx` — the `/orders/:id/labels` route
- `apps/web/src/pages/orders/OrderDetail.tsx` — the Labels action + icon
- `apps/web/src/hooks/useOrders.ts` — `useEnqueuePrintLabels()`
- `knowledge/history/engine_features.md`, `memory-bank/activeContext.md`,
  `memory-bank/progress.md`

## 9. Verification

Per AI_GUIDELINES §9, in each affected workspace: `pnpm check`, `pnpm test`,
`pnpm lint`. No pricing or totals code is touched, so the both-suites clause does
not apply — but web, api, and print-agent are all affected here and all three get
run.

## 10. Open risks

Two assumptions cannot be settled from this machine and must be checked against
the physical printer before the agent is trusted:

- **The `GAP` value.** `0.12,0` is the standard ≈3 mm die-cut gap. It is
  config-adjustable in `labelTspl.ts` and is expected to need a calibration run
  with the real stock loaded.
- **TSPL support.** The whole agent path rests on the 2410BT speaking TSPL rather
  than an OEM dialect. Labelife-family printers normally do, but this is
  unverified. If it turns out not to, the web `window.print()` path is unaffected
  and still delivers the shop-PC use case in full; only §3 and §7 would need
  rework.

A third, milder risk carried over from the hardware notes: LabelCreate is in the
Labelife OEM family, and on the sibling PM240 the Windows driver refused to
install until the firmware was flashed from the vendor phone app. If driver
installation misbehaves, check the firmware version first.
