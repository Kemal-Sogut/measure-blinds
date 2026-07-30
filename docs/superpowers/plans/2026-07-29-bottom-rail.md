# Bottom Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Bottom rail option (Regular / Pear) to blind line items — a settings-managed catalog priced per linear metre of width — and surface it on the production label, the order overview, the estimate PDF, and the public customer view.

**Architecture:** Bottom rail is a fourth priced catalog alongside materials / cassettes / controls, modelled byte-for-byte on `cassette_options` (same `price_per_m` column, same `on delete set null` FK, same `id`/`name`/`price` snapshot triple on `line_items`). It enters the shared pricing formula as one new cost hook on `BaseBlindCalculator`, charged identically to cassette, so all ten blind-type subclasses inherit it unchanged. Existing blind rows are backfilled to Regular at price 0, which makes the field safely REQUIRED (no historical order becomes unsavable) and keeps the migration price-neutral.

**Tech Stack:** pnpm monorepo. `apps/api` — Hono 4 on Cloudflare Workers, Zod 3, vitest. `apps/web` — React 19, Vite 8, Tailwind v4 (`@theme` tokens), TanStack Query 5, React Router, vitest, oxlint. `supabase/migrations` — raw SQL + RLS, applied to live project `lgbxxlwsdeuhdgzrjjen`.

## Global Constraints

- **SPDX header (AI_GUIDELINES §10):** every `.ts` / `.tsx` / `.sql` file created MUST begin with `// SPDX-License-Identifier: GPL-3.0-only` then `// Copyright (c) 2026 Blinds Nisa. All rights reserved.` (SQL uses `--`). Preserve the header on every file modified.
- **Server-authoritative money (§1, highest priority):** clients send catalog option IDs only. The Worker fetches prices itself and snapshots name + price onto the line item. `blindItemSchema` is `.strict()` — a client-supplied `bottom_rail_price_per_m` must be REJECTED with 400, never silently stripped.
- **Pricing twins (§1):** `apps/web/src/lib/calculators/base.ts` and `apps/api/src/lib/calculators/base.ts` are twins, as are `apps/web/src/lib/pricing.test.ts` and `apps/api/src/lib/pricing.test.ts`. Touch one side, change BOTH. Run BOTH suites.
- **JSDoc (§3):** every exported module, component, hook, function, type and route group needs a `/** ... */` comment scoring ≥8/10 — purpose, behaviour, constraints and integration context, English only. Never restate the name.
- **Scope isolation (§7):** modify ONLY the files each task names. No drive-by refactors.
- **Locked pattern (§8):** bulk `line_items` inserts require every row to carry the SAME column set — PostgREST NULL-fills gaps and violates not-null defaults. Non-blind rows must carry the three `bottom_rail_*` keys as `null`.
- **Verification (§9):** `apps/api` runs `pnpm check` and `pnpm test`. `apps/web` has NO `check` script — use `npx tsc -b --noEmit` from `apps/web`, plus `pnpm test` and `pnpm lint`. `apps/web` lint has 4 PRE-EXISTING `LineItemEditor.tsx` warnings; that count must not grow.
- **Measured baselines at the start of this plan** (verified, not estimated): `apps/api` 116 tests across 6 files; `apps/web` 58 tests across 5 files. Per-file: `api/lib/pricing.test.ts` 11, `api/lib/pdf.test.ts` 8, `api/routes/orders.routes.test.ts` 34, `web/lib/pricing.test.ts` 16, `web/lib/labels.test.ts` 11. Each task states the count it should leave behind; if a run disagrees, investigate rather than adjusting the number.
- **Migration numbering:** next free number is 28. Migration 23 (`20260712000023_line_items_add_color.sql`) holds the CURRENT definition of `update_order_with_items()` — any rebuild starts from that body.
- **Do NOT apply the migration to the live database.** Write the file only. Applying is the owner's decision (see the Deployment note at the end).
- **Option names are exactly `Regular` and `Pear`**, both seeded at price `0`.
- Column order convention: the bottom-rail triple goes AFTER cassette and BEFORE control everywhere it appears — schema, snapshot, payload, label, table, PDF, customer view.

---

### Task 1: Migration 28 — catalog table, snapshot columns, backfill, RPC rebuild

**Files:**
- Create: `supabase/migrations/20260729000028_bottom_rail_options.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: table `public.bottom_rail_options (id uuid, name text, price_per_m numeric(10,2), active boolean, sort_order int, created_at, updated_at)`; columns `public.line_items.bottom_rail_id uuid`, `.bottom_rail_name text`, `.bottom_rail_price_per_m numeric(10,2)`; a rebuilt `public.update_order_with_items(uuid, jsonb, jsonb)` that carries all three.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260729000028_bottom_rail_options.sql`:

```sql
-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 28: bottom_rail_options + the line_items bottom-rail snapshot.
--
-- The bottom rail is the weighted bar at the foot of a blind. It is a
-- PRICED catalog, charged per linear metre of width exactly like the
-- cassette, so this table mirrors cassette_options column for column.
-- The chosen option's NAME and PRICE are snapshotted onto line_items, so
-- renaming or repricing an option never rewrites a historical order.
--
-- Both seeded options are priced at 0. That is deliberate: pricing is
-- recomputed server-side whenever an order is saved, so a non-zero seed
-- would silently raise the total of every existing order the moment
-- someone re-saved it. The shop sets real prices in Settings when ready,
-- and only orders saved after that pick them up.
--
-- Existing blind rows are backfilled to Regular. Without that, the
-- REQUIRED bottom_rail_id would make every historical order unsavable
-- until an operator picked a rail for each of its blinds. Preset and
-- custom rows keep NULL, exactly as they already do for cassette and
-- control.
--
-- update_order_with_items() is rebuilt because the atomic edit path
-- inserts an explicit column list: BOTH the insert list AND the
-- jsonb_to_recordset signature must name the new columns or the field is
-- silently dropped on every edit. Body copied from migration 23 with the
-- three bottom-rail columns added after cassette.

create table public.bottom_rail_options (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_per_m numeric(10,2) not null default 0,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger bottom_rail_options_set_updated_at
  before update on public.bottom_rail_options
  for each row execute function public.set_updated_at();

alter table public.bottom_rail_options enable row level security;

create policy authenticated_full_access on public.bottom_rail_options
  for all to authenticated
  using (true) with check (true);

insert into public.bottom_rail_options (name, price_per_m, sort_order) values
  ('Regular', 0, 0),
  ('Pear', 0, 1);

alter table public.line_items
  add column bottom_rail_id uuid references public.bottom_rail_options (id) on delete set null,
  add column bottom_rail_name text,
  add column bottom_rail_price_per_m numeric(10,2);

update public.line_items
set bottom_rail_id = (select id from public.bottom_rail_options where name = 'Regular'),
    bottom_rail_name = 'Regular',
    bottom_rail_price_per_m = 0
where item_type = 'blind';

create or replace function public.update_order_with_items(
  p_order_id uuid,
  p_fields jsonb,
  p_items jsonb
) returns void
language plpgsql
set search_path = ''  -- pinned per Supabase advisor lint 0011 (mutable search_path)
as $$
begin
  update public.orders set
    customer_id     = (p_fields->>'customer_id')::uuid,
    order_date      = (p_fields->>'order_date')::date,
    expiry_date     = (p_fields->>'expiry_date')::date,
    discount_type   = p_fields->>'discount_type',
    discount_value  = (p_fields->>'discount_value')::numeric,
    subtotal        = (p_fields->>'subtotal')::numeric,
    discount_amount = (p_fields->>'discount_amount')::numeric,
    taxable_amount  = (p_fields->>'taxable_amount')::numeric,
    tax_rate        = (p_fields->>'tax_rate')::numeric,
    tax_amount      = (p_fields->>'tax_amount')::numeric,
    total           = (p_fields->>'total')::numeric
  where id = p_order_id;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  delete from public.line_items where order_id = p_order_id;

  insert into public.line_items (
    order_id, item_type, position, room_name, blinds_type, panels, height_cm,
    material_id, material_name, material_price_per_sqm,
    cassette_id, cassette_name, cassette_price_per_m,
    bottom_rail_id, bottom_rail_name, bottom_rail_price_per_m,
    control_id, control_name, control_price_per_item,
    description, note, color, quantity, unit_price, line_total
  )
  select
    p_order_id, i.item_type, i.position,
    coalesce(i.room_name, ''), coalesce(i.blinds_type, ''),
    coalesce(i.panels, '[]'::jsonb), i.height_cm,
    i.material_id, i.material_name, i.material_price_per_sqm,
    i.cassette_id, i.cassette_name, i.cassette_price_per_m,
    i.bottom_rail_id, i.bottom_rail_name, i.bottom_rail_price_per_m,
    i.control_id, i.control_name, i.control_price_per_item,
    coalesce(i.description, ''), coalesce(i.note, ''), coalesce(i.color, ''),
    i.quantity, i.unit_price, i.line_total
  from jsonb_to_recordset(p_items) as i(
    item_type text, position int, room_name text, blinds_type text,
    panels jsonb, height_cm numeric,
    material_id uuid, material_name text, material_price_per_sqm numeric,
    cassette_id uuid, cassette_name text, cassette_price_per_m numeric,
    bottom_rail_id uuid, bottom_rail_name text, bottom_rail_price_per_m numeric,
    control_id uuid, control_name text, control_price_per_item numeric,
    description text, note text, color text, quantity int, unit_price numeric, line_total numeric
  );
end;
$$;
```

- [ ] **Step 2: Verify the insert list and the recordset signature agree**

There is no SQL test harness in this repo, so this check is manual and mandatory — a mismatch here silently drops the field on every order edit and no test catches it.

Run from the repo root:

```bash
node -e "const s=require('fs').readFileSync('supabase/migrations/20260729000028_bottom_rail_options.sql','utf8');const ins=s.match(/insert into public\.line_items \(([\s\S]*?)\)/)[1].split(',').map(x=>x.trim()).filter(x=>x&&!x.startsWith('--'));const rec=s.match(/as i\(([\s\S]*?)\);/)[1].split(',').map(x=>x.trim().split(/\s+/)[0]).filter(Boolean);const missing=ins.filter(c=>c!=='order_id'&&!rec.includes(c));console.log('insert cols:',ins.length,'recordset cols:',rec.length);console.log('in insert but not recordset:',missing);"
```

Expected: `insert cols: 25 recordset cols: 24` and `in insert but not recordset: []`. The one-column difference is `order_id`, which comes from the function parameter rather than the JSON — that is correct. Any other name in the `missing` list is a bug: fix it before continuing.

- [ ] **Step 3: Confirm the three columns appear in all five required places**

```bash
grep -o "bottom_rail_id\|bottom_rail_name\|bottom_rail_price_per_m" supabase/migrations/20260729000028_bottom_rail_options.sql | wc -l
```

Expected: `16` — three columns × five code sites (the `alter table`, the backfill `update`, the RPC's insert list, the RPC's `select`, and the `jsonb_to_recordset` signature) = 15, plus one incidental mention of `bottom_rail_id` in the migration's own header comment. Confirm the split with `grep "^--" <file> | grep -o … | wc -l`, which must be `1`. Count occurrences (`grep -o`), not matching lines (`grep -c`) — several of these sites put all three names on one line.

The table name `bottom_rail_options` does not match any of the three patterns, so the `create table`, the seed `insert`, and the FK reference are correctly excluded from the count.

- [ ] **Step 4: Commit**

```bash
git add -f supabase/migrations/20260729000028_bottom_rail_options.sql
git commit -m "feat(db): add bottom_rail_options catalog and line-item snapshot"
```

Note: `-f` is required because `.gitignore:15` ignores all of `supabase/`. This matches how the tracked migrations were added.

---

### Task 2: Pricing formula — the bottomRailCost hook, in both twins

**Files:**
- Modify: `apps/api/src/lib/calculators/base.ts` (header formula block, `BlindPricingInputs`, new hook, `calculateUnitPrice`)
- Modify: `apps/web/src/lib/calculators/base.ts` (identical changes)
- Modify: `apps/api/src/lib/pricing.test.ts`
- Modify: `apps/web/src/lib/pricing.test.ts`
- Modify: the SEVEN subclasses in `apps/api/src/lib/calculators/` that enumerate the cost hooks in their header (`roller.ts`, `zebra.ts`, `roman.ts`, `sunscreen.ts`, `verticalSheer.ts`, `verticalPanel.ts`, `verticalRoller.ts`) — one doc line each
- Modify: the same seven files in `apps/web/src/lib/calculators/`
- Do NOT modify `honeycomb.ts`, `shutter.ts` or `curtains.ts` in either app. Their headers say "by overriding the cost hooks" without enumerating them, so nothing in them goes stale. Adding the new hook name there would be inventing doc changes outside this task's scope.
- Total: 18 files (2 × `base.ts`, 14 subclasses, 2 × `pricing.test.ts`).

**Interfaces:**
- Consumes: nothing from Task 1 (pricing never touches the DB).
- Produces: `BlindPricingInputs` gains a REQUIRED `bottom_rail_price_per_m: number`. `BaseBlindCalculator` gains `protected bottomRailCost(widthCm: number, pricePerM: number): number`. Every existing caller of `calculateBlindUnitPrice` / `calculateBlindUnitPriceForType` / `calculateBlindLineTotal` / `blindDraftPrice` must now supply the new field — Tasks 3 and 6 do that for the two production call sites.

- [ ] **Step 1: Write the failing test — api side**

In `apps/api/src/lib/pricing.test.ts`, add `bottom_rail_price_per_m: 0` to the three existing inline input objects (in the `W=140` test, the `sums panels` test, and the `inputs` const in the registry suite), then add this test at the end of the `describe('pricing (server)')` block:

```ts
  it('charges the bottom rail per metre of the minimised width, like the cassette', () => {
    const base = {
      panels: [70, 70],
      height_cm: 200,
      material_price_per_sqm: 50,
      cassette_price_per_m: 0,
      control_price_per_item: 0,
    };
    // 140cm wide → 1.4m. A $15/m rail adds $21 on top of the $140 material.
    expect(calculateBlindUnitPrice({ ...base, bottom_rail_price_per_m: 15 })).toBe(161);
    // The width MINIMUM applies first: 60cm is charged as 100cm = 1m.
    expect(
      calculateBlindUnitPrice({
        ...base,
        panels: [60],
        material_price_per_sqm: 0,
        bottom_rail_price_per_m: 15,
      })
    ).toBe(15);
    // A zero-priced rail (the seeded default) must not move the price.
    expect(calculateBlindUnitPrice({ ...base, bottom_rail_price_per_m: 0 })).toBe(140);
  });
```

- [ ] **Step 2: Write the failing test — web side**

In `apps/web/src/lib/pricing.test.ts`, add `bottom_rail_price_per_m: 0,` to the `blind()` helper (line 31-32 area, after `cassette_price_per_m: 0,`), then add the MIRROR of the same test. It must encode the SAME expected numbers — that identity is the twin guarantee:

```ts
describe('bottomRailCost', () => {
  it('charges the bottom rail per metre of the minimised width, like the cassette', () => {
    // 140cm wide → 1.4m. A $15/m rail adds $21 on top of the $140 material.
    expect(calculateBlindUnitPrice(blind({ bottom_rail_price_per_m: 15 }))).toBe(161);
    // The width MINIMUM applies first: 60cm is charged as 100cm = 1m.
    expect(
      calculateBlindUnitPrice(
        blind({ panels: [60], material_price_per_sqm: 0, bottom_rail_price_per_m: 15 })
      )
    ).toBe(15);
    // A zero-priced rail (the seeded default) must not move the price.
    expect(calculateBlindUnitPrice(blind({ bottom_rail_price_per_m: 0 }))).toBe(140);
  });
});
```

- [ ] **Step 3: Run both suites to verify they fail**

```bash
cd apps/api && npx vitest run src/lib/pricing.test.ts
```

Expected: FAIL. The `bottom_rail_price_per_m` property does not exist on `BlindPricingInputs`, and the priced assertions return 140/0/140 instead of 161/15/140.

```bash
cd apps/web && npx vitest run src/lib/pricing.test.ts
```

Expected: FAIL the same way.

- [ ] **Step 4: Implement in `apps/api/src/lib/calculators/base.ts`**

Replace the formula block in the module header (currently three lines, `material` / `cassette` / `control`) with four:

```ts
 * Formula (IMPLEMENTATION.md §5), all costs summed then rounded to 2dp:
 *   material   = W × H × price_per_sqm / 10000   (cm² → m²)
 *   cassette   = W / 100 × price_per_m           (per linear metre of width)
 *   bottomRail = W / 100 × price_per_m           (per linear metre of width)
 *   control    = panelCount × price_per_item     (per panel)
 * with the width minimum (raise <100cm to 100cm) and the tiered height
 * minimum (<100→100, 100–199→200, ≥200→actual) applied first.
```

In the same header, extend the hook list on the line reading `* hooks (\`materialCost\` / \`cassetteCost\` / \`controlCost\`), the minimum` so it names the new hook:

```ts
 * hooks (`materialCost` / `cassetteCost` / `bottomRailCost` /
 * `controlCost`), the minimum rules (`applyWidthMinimum` /
 * `applyHeightMinimum`), or the whole `calculateUnitPrice` — whichever is
 * the smallest correct change.
```

Add to `BlindPricingInputs`, immediately after `cassette_price_per_m`:

```ts
  /**
   * Bottom-rail cost per linear metre of width (server-fetched snapshot).
   * REQUIRED, not optional: every blind row carries a rail (migration 28
   * backfilled the historical ones to Regular at 0), so an absent value
   * would mean a caller forgot to pass it rather than "no rail fitted" —
   * and a silent 0 there would under-price the blind.
   */
  bottom_rail_price_per_m: number;
```

Add the hook after `cassetteCost`:

```ts
  /**
   * Bottom-rail cost, charged per linear metre of the effective width —
   * the same basis as the cassette, because both are cut to the blind's
   * width. Kept as its own hook rather than folded into `cassetteCost` so
   * a blind type can diverge on one without touching the other.
   */
  protected bottomRailCost(widthCm: number, pricePerM: number): number {
    return (widthCm / 100) * pricePerM;
  }
```

Update `calculateUnitPrice`'s doc line and sum:

```ts
  /**
   * Unit price of one blind: material + cassette + bottom rail + control
   * with the width/height minimums applied first, rounded to 2 decimals.
   */
  calculateUnitPrice(item: BlindPricingInputs): number {
    const width = this.applyWidthMinimum(item.panels.reduce((a, b) => a + b, 0));
    const height = this.applyHeightMinimum(item.height_cm);
    const total =
      this.materialCost(width, height, item.material_price_per_sqm) +
      this.cassetteCost(width, item.cassette_price_per_m) +
      this.bottomRailCost(width, item.bottom_rail_price_per_m) +
      this.controlCost(item.panels.length, item.control_price_per_item);
    return Math.round(total * 100) / 100;
  }
```

- [ ] **Step 5: Implement the identical change in `apps/web/src/lib/calculators/base.ts`**

Apply Step 4 verbatim. The ONLY permitted difference between the two files is the existing twin-pointer paragraph (api says "twin of the web-side", web says "twin of the AUTHORITATIVE api"). Verify afterwards:

```bash
diff <(sed -n '/^export interface BlindPricingInputs/,$p' apps/api/src/lib/calculators/base.ts) <(sed -n '/^export interface BlindPricingInputs/,$p' apps/web/src/lib/calculators/base.ts)
```

Expected: no output. Everything from the interface down must be byte-identical.

- [ ] **Step 6: Update the stale hook list in the 14 subclass files that have one**

SEVEN subclasses in each app (`roller`, `zebra`, `roman`, `sunscreen`, `verticalSheer`, `verticalPanel`, `verticalRoller`) carry this line in their header — 14 files in total. The other three (`honeycomb`, `shutter`, `curtains`) say "by overriding the cost hooks" without listing them, so they have nothing stale and MUST be left alone.

```
 * Override the cost hooks (materialCost / cassetteCost / controlCost) or the
```

Replace it in those 14 files with:

```
 * Override the cost hooks (materialCost / cassetteCost / bottomRailCost /
 * controlCost) or the
```

Then confirm none were missed:

```bash
grep -rn "cassetteCost / controlCost" apps/api/src/lib/calculators apps/web/src/lib/calculators
```

Expected: no output (exit 1).

- [ ] **Step 7: Run both suites to verify they pass**

```bash
cd apps/api && npx vitest run src/lib/pricing.test.ts
```

Expected: PASS, 12 tests (was 11).

```bash
cd apps/web && npx vitest run src/lib/pricing.test.ts
```

Expected: PASS, 17 tests (was 16). The whole web suite is now 59.

`apps/api`'s full `pnpm test` will still FAIL at this point — `resolveLineItems` does not yet pass the new required field, so `orders.routes.test.ts` breaks. Task 3 fixes that. This is expected; do not "fix" it by making the field optional.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/lib/calculators apps/web/src/lib/calculators apps/api/src/lib/pricing.test.ts apps/web/src/lib/pricing.test.ts
git commit -m "feat(pricing): charge the bottom rail per metre of width"
```

---

### Task 3: API — settings catalog route, order schema, and price snapshot

**Files:**
- Modify: `apps/api/src/routes/settings.ts` (the `catalogs` array, and the section comment above it)
- Modify: `apps/api/src/routes/orders.ts` (`blindItemSchema`, `resolveLineItems`)
- Modify: `apps/api/src/routes/orders.routes.test.ts`

**Interfaces:**
- Consumes: `bottom_rail_price_per_m` from Task 2's `BlindPricingInputs`; the `bottom_rail_options` table from Task 1.
- Produces: `GET|POST /api/settings/bottom-rail-options` and `PUT|DELETE /api/settings/bottom-rail-options/:id`. `blindItemSchema` gains a required `bottom_rail_id: z.string().uuid()`. Inserted rows gain `bottom_rail_id` / `bottom_rail_name` / `bottom_rail_price_per_m` (null on non-blind rows).

- [ ] **Step 1: Write the failing tests**

In `apps/api/src/routes/orders.routes.test.ts`, add the fixture after `CONTROL` (line 101):

```ts
// Priced at 0, mirroring the production seed, so every pre-existing money
// assertion in this file still holds. The priced case is exercised below.
const BOTTOM_RAIL = { id: '55555555-5555-4555-8555-555555555555', name: 'Regular', price_per_m: 0 };
```

Add `bottom_rail_id: BOTTOM_RAIL.id,` to the blind item in `payload()`, immediately after `cassette_id`. Add to the `db.responses` block in `beforeEach`:

```ts
    'bottom_rail_options.select': [BOTTOM_RAIL],
```

Then add these tests inside `describe('POST /api/orders')`:

```ts
  it('snapshots the bottom rail name and price onto the line item', async () => {
    db.orderInsertResults = [{ data: { id: 'e1', subtotal: 0 } }];
    const res = await ordersApp.request('/', {
      method: 'POST',
      body: JSON.stringify(payload()),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
    expect(res.status).toBe(201);
    const rows = db.insertPayloads['line_items'] as Record<string, unknown>[];
    const blind = rows.find((r) => r.item_type === 'blind')!;
    expect(blind.bottom_rail_id).toBe(BOTTOM_RAIL.id);
    expect(blind.bottom_rail_name).toBe('Regular');
    expect(blind.bottom_rail_price_per_m).toBe(0);
    // Preset rows must carry the SAME column set with null values — a
    // missing key here lets PostgREST NULL-fill and break the insert.
    const preset = rows.find((r) => r.item_type === 'preset')!;
    expect(preset).toHaveProperty('bottom_rail_id', null);
    expect(preset).toHaveProperty('bottom_rail_name', null);
    expect(preset).toHaveProperty('bottom_rail_price_per_m', null);
  });

  it('adds the bottom rail to the unit price at its catalog rate', async () => {
    // 140cm of width at $15/m = $21 per blind, ×2 blinds = $42 over the
    // 389 baseline asserted above.
    db.responses['bottom_rail_options.select'] = [{ ...BOTTOM_RAIL, price_per_m: 15 }];
    db.orderInsertResults = [{ data: { id: 'e1', subtotal: 0 } }];
    const res = await ordersApp.request('/', {
      method: 'POST',
      body: JSON.stringify(payload()),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
    expect(res.status).toBe(201);
    const orderRow = db.insertPayloads['orders']?.[0] as Record<string, number>;
    expect(orderRow.subtotal).toBe(431);
  });

  it('rejects a client-supplied bottom rail price with 400 and inserts nothing', async () => {
    const bad = payload();
    (bad.line_items[0] as Record<string, unknown>).bottom_rail_price_per_m = 0;
    const res = await ordersApp.request('/', {
      method: 'POST',
      body: JSON.stringify(bad),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
    expect(res.status).toBe(400);
    expect(db.calls).not.toContain('line_items.insert');
  });

  it('rejects a blind with no bottom rail chosen', async () => {
    const bad = payload();
    delete (bad.line_items[0] as Record<string, unknown>).bottom_rail_id;
    const res = await ordersApp.request('/', {
      method: 'POST',
      body: JSON.stringify(bad),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
    expect(res.status).toBe(400);
    expect(db.calls).not.toContain('line_items.insert');
  });

  it('fails clearly when the chosen bottom rail was deleted mid-edit', async () => {
    db.responses['bottom_rail_options.select'] = [];
    db.orderInsertResults = [{ data: { id: 'e1', subtotal: 0 } }];
    const res = await ordersApp.request('/', {
      method: 'POST',
      body: JSON.stringify(payload()),
      headers: { 'Content-Type': 'application/json' },
    }, ENV);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'Selected bottom rail option no longer exists.',
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/api && npx vitest run src/routes/orders.routes.test.ts
```

Expected: FAIL. The snapshot test finds `bottom_rail_id` undefined, the priced test reports 389 instead of 431, and the `.strict()` rejection test already passes for the wrong reason (any unknown key is rejected) — that one is a guard against a future author loosening the schema.

- [ ] **Step 3: Add the Zod field in `apps/api/src/routes/orders.ts`**

In `blindItemSchema`, after `cassette_id: z.string().uuid(),`:

```ts
    bottom_rail_id: z.string().uuid(),
```

- [ ] **Step 4: Resolve and snapshot it in `resolveLineItems`**

Add to the `ids` object, after `cassette_options`:

```ts
    bottom_rail_options: new Set<string>(),
```

Add inside the `if (it.item_type === 'blind')` collection loop, after the cassette line:

```ts
      ids.bottom_rail_options.add(it.bottom_rail_id);
```

Extend the parallel lookup:

```ts
  const [materials, cassettes, bottomRails, controls] = await Promise.all([
    lookup('materials', ids.materials, 'price_per_sqm'),
    lookup('cassette_options', ids.cassette_options, 'price_per_m'),
    lookup('bottom_rail_options', ids.bottom_rail_options, 'price_per_m'),
    lookup('control_options', ids.control_options, 'price_per_item'),
  ]);
```

In the non-blind branch, after `cassette_price_per_m: null,`:

```ts
        bottom_rail_id: null,
        bottom_rail_name: null,
        bottom_rail_price_per_m: null,
```

In the blind branch, add the resolve + guard after the cassette ones:

```ts
    const bottomRail = bottomRails.get(it.bottom_rail_id);
```
```ts
    if (!bottomRail) throw new Error('Selected bottom rail option no longer exists.');
```

Add to the pricing inputs, after `cassette_price_per_m`:

```ts
      bottom_rail_price_per_m: bottomRail.price,
```

And to the returned row, after `cassette_price_per_m: cassette.price,`:

```ts
      bottom_rail_id: it.bottom_rail_id,
      bottom_rail_name: bottomRail.name,
      bottom_rail_price_per_m: bottomRail.price,
```

- [ ] **Step 5: Register the settings catalog in `apps/api/src/routes/settings.ts`**

Update the section comment above `interface CatalogConfig` from `/* Catalog entities (cassettes / controls / presets / blind types)     */` to:

```ts
/* Catalog entities (cassettes / bottom rails / controls / presets /   */
/* blind types)                                                        */
```

Add to the `catalogs` array, between the `cassette-options` and `control-options` entries:

```ts
  {
    // Priced per linear metre of width, the same basis as the cassette.
    path: 'bottom-rail-options',
    table: 'bottom_rail_options',
    schema: z.object({ name, price_per_m: price, active, sort_order: sortOrder }),
    orderBy: [{ column: 'sort_order', ascending: true }, { column: 'name', ascending: true }],
  },
```

- [ ] **Step 6: Run the api suite and type-check**

```bash
cd apps/api && npx vitest run
```

Expected: PASS, all files. `orders.routes.test.ts` rises from 34 to 39, so the api total goes 117 → 122.

```bash
cd apps/api && pnpm check
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/settings.ts apps/api/src/routes/orders.ts apps/api/src/routes/orders.routes.test.ts
git commit -m "feat(api): resolve and snapshot the bottom rail on blind line items"
```

---

### Task 4: API — estimate PDF and public estimate payload

**Files:**
- Modify: `apps/api/src/lib/pdf.ts` (`PdfDocumentData.line_items`, `itemContent`)
- Modify: `apps/api/src/lib/pdf.test.ts`
- Modify: `apps/api/src/routes/public.ts` (the sanitized `line_items` map)

**Interfaces:**
- Consumes: the `bottom_rail_name` column from Task 1.
- Produces: `PdfDocumentData['line_items'][number]` gains `bottom_rail_name: string | null`. The `/public/estimate/:token` payload gains `bottom_rail_name`. Task 8's `PublicLineItem` mirrors that shape.

- [ ] **Step 1: Write the failing test**

In `apps/api/src/lib/pdf.test.ts`, add `bottom_rail_name: 'Regular Rail',` to the `blind` fixture in `describe('itemContent color')` (after `cassette_name`), and to the top-level fixtures at lines ~42 and ~57 add `bottom_rail_name: 'Regular Rail',` and `bottom_rail_name: null,` respectively to match their existing cassette/control values. Then update the full-block assertion and add an omission test:

```ts
  it('prints the full blind attribute block in order', () => {
    expect(itemContent(blind).attrs).toEqual([
      'Panels: 70 + 70 cm (total 140 cm) x H 200 cm',
      'Material: Blackout White',
      'Color: White 02',
      'Cassette: Standard Cassette',
      'Bottom rail: Regular Rail',
      'Control: Chain Control',
      'Note: Inside mount',
    ]);
  });

  it('places the Bottom rail line between Cassette and Control', () => {
    const { attrs } = itemContent(blind);
    const cassetteIdx = attrs.findIndex((a) => a.startsWith('Cassette:'));
    const railIdx = attrs.findIndex((a) => a === 'Bottom rail: Regular Rail');
    const controlIdx = attrs.findIndex((a) => a.startsWith('Control:'));
    expect(railIdx).toBeGreaterThan(cassetteIdx);
    expect(controlIdx).toBeGreaterThan(railIdx);
  });

  it('omits the Bottom rail line when null, so a legacy row prints clean', () => {
    const { attrs } = itemContent({ ...blind, bottom_rail_name: null });
    expect(attrs.some((a) => a.startsWith('Bottom rail:'))).toBe(false);
    // The neighbouring lines must still be present and adjacent.
    expect(attrs).toContain('Cassette: Standard Cassette');
    expect(attrs).toContain('Control: Chain Control');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/api && npx vitest run src/lib/pdf.test.ts
```

Expected: FAIL — `bottom_rail_name` is not a known property of the line-item type, and the ordered-block assertion is missing the `Bottom rail:` entry.

- [ ] **Step 3: Implement in `apps/api/src/lib/pdf.ts`**

In the `line_items` array type, after `cassette_name: string | null;`:

```ts
    bottom_rail_name: string | null;
```

In `itemContent`, in the `attrs` array after the cassette entry:

```ts
      li.bottom_rail_name ? `Bottom rail: ${li.bottom_rail_name}` : null,
```

- [ ] **Step 4: Add it to the public payload in `apps/api/src/routes/public.ts`**

In the `line_items` map, after `cassette_name: li.cassette_name,`:

```ts
        bottom_rail_name: li.bottom_rail_name,
```

Only the NAME crosses the public boundary. `bottom_rail_price_per_m` must NOT be added here — per AI_GUIDELINES §2 the public payload is sanitized, and component-level pricing is not customer-facing (the cassette and control prices are withheld the same way).

- [ ] **Step 5: Run the api suite**

```bash
cd apps/api && npx vitest run
```

Expected: PASS. `pdf.test.ts` rises from 8 to 10, so the api total goes 122 → 124.

```bash
cd apps/api && pnpm check
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/pdf.ts apps/api/src/lib/pdf.test.ts apps/api/src/routes/public.ts
git commit -m "feat(api): show the bottom rail on the estimate PDF and public view"
```

---

### Task 5: Web — types, payload, catalog hook, and the settings page

**Files:**
- Modify: `apps/web/src/types/index.ts` (new `BottomRailOption`, `LineItem` fields)
- Modify: `apps/web/src/hooks/useOrders.ts` (`BlindItemInput`)
- Modify: `apps/web/src/hooks/useSettings.ts` (`CatalogPath`)
- Create: `apps/web/src/pages/settings/BottomRailOptions.tsx`
- Modify: `apps/web/src/App.tsx` (lazy import + route)
- Modify: `apps/web/src/pages/settings/SettingsIndex.tsx` (`BUSINESS` row)

**Interfaces:**
- Consumes: the `bottom-rail-options` route from Task 3.
- Produces: `BottomRailOption { id, name, price_per_m, active, sort_order }`; `LineItem.bottom_rail_id | bottom_rail_name | bottom_rail_price_per_m`; `BlindItemInput.bottom_rail_id: string`; `CatalogPath` accepts `'bottom-rail-options'`; route `/settings/bottom-rail`. Task 6 consumes `BottomRailOption` and `BlindItemInput`.

- [ ] **Step 1: Add the catalog type in `apps/web/src/types/index.ts`**

After the `CassetteOption` interface:

```ts
/**
 * Bottom-rail option from settings — the weighted bar at the foot of a
 * blind, priced per linear meter of width on the same basis as the
 * cassette. Shipped options are Regular and Pear.
 */
export interface BottomRailOption {
  id: string;
  name: string;
  price_per_m: number;
  active: boolean;
  sort_order: number;
}
```

Add to `LineItem`, after `cassette_price_per_m`:

```ts
  bottom_rail_id: string | null;
  bottom_rail_name: string | null;
  bottom_rail_price_per_m: number | null;
```

- [ ] **Step 2: Add the payload field in `apps/web/src/hooks/useOrders.ts`**

In `BlindItemInput`, after `cassette_id: string;`:

```ts
  bottom_rail_id: string;
```

- [ ] **Step 3: Extend `CatalogPath` in `apps/web/src/hooks/useSettings.ts`**

Replace the doc line `/** URL segments for the four catalog entities under /api/settings. */` — it already undercounts at five — and add the new member:

```ts
/** URL segments for the catalog entities managed under /api/settings. */
export type CatalogPath =
  | 'materials'
  | 'cassette-options'
  | 'bottom-rail-options'
  | 'control-options'
  | 'presets'
  | 'blind-types';
```

- [ ] **Step 4: Create the settings page**

Create `apps/web/src/pages/settings/BottomRailOptions.tsx`:

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Bottom rail options settings page — CRUD list priced per meter of
 * width, the same basis as cassettes. Both shipped options (Regular and
 * Pear) are seeded at 0, so editing a price here is what first makes the
 * rail cost anything; only orders saved AFTER that pick up the new rate,
 * because each line item snapshots the price it was quoted at.
 */

import PageHeader from '../../components/PageHeader';
import CatalogEditor from '../../components/CatalogEditor';

export default function BottomRailOptions() {
  return (
    <div className="min-h-screen bg-surface-muted">
      <PageHeader title="Bottom Rail Options" backTo="/settings" />
      <CatalogEditor
        config={{
          path: 'bottom-rail-options',
          priceKey: 'price_per_m',
          priceLabel: 'per m',
          noun: 'bottom rail option',
        }}
      />
    </div>
  );
}
```

- [ ] **Step 5: Wire the route in `apps/web/src/App.tsx`**

Add the lazy import after the `CassetteOptions` line:

```tsx
const BottomRailOptions = lazy(() => import('./pages/settings/BottomRailOptions'));
```

Add the route after the `/settings/cassette` line:

```tsx
            <Route path="/settings/bottom-rail" element={guard(<Layout nav={false}><BottomRailOptions /></Layout>)} />
```

- [ ] **Step 6: Add the settings row in `apps/web/src/pages/settings/SettingsIndex.tsx`**

Insert into `BUSINESS`, between the `cassette` and `controls` entries:

```tsx
  { to: '/settings/bottom-rail', label: 'Bottom Rail Options', d: 'M3 4h18 M3 12h18 M3 20h18M7 20v-4M17 20v-4' },
```

- [ ] **Step 7: Type-check**

```bash
cd apps/web && npx tsc -b --noEmit
```

Expected: errors ONLY in `LineItemEditor.tsx` / `OrderDetail.tsx` about the missing `bottom_rail_id` on blind drafts and payloads, and about `Catalogs` lacking `bottomRails`. Those are Task 6's work. No errors in the files this task touched.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/types/index.ts apps/web/src/hooks/useOrders.ts apps/web/src/hooks/useSettings.ts apps/web/src/pages/settings/BottomRailOptions.tsx apps/web/src/App.tsx apps/web/src/pages/settings/SettingsIndex.tsx
git commit -m "feat(web): add the bottom rail catalog type, hook path and settings page"
```

---

### Task 6: Web — the blind editor, defaults, bulk edit and save payload

**Files:**
- Modify: `apps/web/src/pages/orders/LineItemEditor.tsx` (`BlindDraft`, `Catalogs`, `blindDraftPrice`, `BlindEditForm`, `BulkEditState`, `BulkEditForm`, and the bulk-form JSDoc)
- Modify: `apps/web/src/pages/orders/OrderDetail.tsx` (catalog query, `catalogs` memo, `toDrafts`, `addBlind`, `openBulkEdit`, `applyBulkEdit`, `buildPayload`, the bulk-apply disabled guard)

**Interfaces:**
- Consumes: `BottomRailOption`, `LineItem.bottom_rail_id`, `BlindItemInput.bottom_rail_id`, `CatalogPath` (Task 5); `bottom_rail_price_per_m` in the pricing inputs (Task 2).
- Produces: `BlindDraft.bottom_rail_id: string`; `Catalogs.bottomRails: BottomRailOption[]`; `BulkEditState.bottom_rail_id: string`. Nothing later depends on these.

- [ ] **Step 1: Extend the draft and catalog types in `LineItemEditor.tsx`**

In `BlindDraft`, after `cassette_id: string;`:

```ts
  bottom_rail_id: string;
```

In `Catalogs`, after `cassettes: CassetteOption[];`:

```ts
  bottomRails: BottomRailOption[];
```

Extend the type import on line 19:

```ts
import type { Material, CassetteOption, BottomRailOption, ControlOption, BlindType } from '../../types';
```

- [ ] **Step 2: Include it in the live price preview**

In `blindDraftPrice`, add the lookup after the cassette line:

```ts
  const bottomRail = catalogs.bottomRails.find((x) => x.id === draft.bottom_rail_id);
```

Extend the guard so an unchosen rail blocks the preview exactly as an unchosen cassette does:

```ts
  if (!height || !qty || !material || !cassette || !bottomRail || !control) return null;
```

Add the input after `cassette_price_per_m`:

```ts
    bottom_rail_price_per_m: Number(bottomRail.price_per_m),
```

Update the function's JSDoc — it says "all three options":

```ts
/**
 * Live price preview for a blind draft. Returns null until every
 * required field (panels, height, all four options) is filled.
 */
```

- [ ] **Step 3: Add the select to the blind form**

In `BlindEditForm`, replace the `{/* Material / Cassette / Control */}` block's comment and container class, and insert the new select between Cassette and Control. Four selects at `sm:grid-cols-3` would leave one orphaned on its own row, so the grid becomes 2-up on small screens and 4-up on large:

```tsx
      {/* Material / Cassette / Bottom rail / Control */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
```

Then, after the Cassette `OptionSelect` and before the Control one:

```tsx
        <OptionSelect
          label="Bottom rail"
          value={draft.bottom_rail_id}
          onChange={(id) => onChange({ ...draft, bottom_rail_id: id })}
          options={catalogs.bottomRails}
        />
```

- [ ] **Step 4: Add it to bulk edit**

Update the `BulkEditForm` JSDoc first line — it names the exposed fields:

```ts
/**
 * Bulk-edit form — only material, cassette, bottom rail and control are
 * exposed. Each starts as "" (no change); only non-empty selections are
 * applied by the parent when the user clicks Apply. The Material list is
 * not type-filtered here because a bulk selection may span several blind
 * types; every Material is offered.
 */
```

In `BulkEditState`, after `cassette_id: string;`:

```ts
  bottom_rail_id: string;
```

Change the form's grid to match Step 3 (`sm:grid-cols-2 lg:grid-cols-4`) and add, between Cassette and Control:

```tsx
        <OptionSelect
          label="Bottom rail"
          value={state.bottom_rail_id}
          onChange={(id) => onChange({ ...state, bottom_rail_id: id })}
          options={catalogs.bottomRails}
          placeholder="No change"
        />
```

- [ ] **Step 5: Load the catalog in `OrderDetail.tsx`**

Add the query after `cassettesQ`:

```tsx
  const bottomRailsQ = useCatalogList<BottomRailOption>('bottom-rail-options');
```

Add `BottomRailOption` to the type import from `../../types` in this file.

Extend the `catalogs` memo AND its dependency array — omitting the dep means the selects stay empty until an unrelated re-render:

```tsx
  const catalogs: Catalogs = useMemo(
    () => ({
      materials: materialsQ.data ?? [],
      cassettes: cassettesQ.data ?? [],
      bottomRails: bottomRailsQ.data ?? [],
      controls: controlsQ.data ?? [],
      blindTypes: blindTypesQ.data ?? [],
    }),
    [materialsQ.data, cassettesQ.data, bottomRailsQ.data, controlsQ.data, blindTypesQ.data]
  );
```

- [ ] **Step 6: Hydrate, default, and bulk-patch it**

In `toDrafts`, after `cassette_id: li.cassette_id ?? '',`:

```ts
        bottom_rail_id: li.bottom_rail_id ?? '',
```

In `addBlind`, after the cassette default:

```ts
      bottom_rail_id: findOptionIdByName(catalogs.bottomRails, 'Regular'),
```

In `openBulkEdit`, extend the reset:

```ts
    setBulkState({ material_id: '', cassette_id: '', bottom_rail_id: '', control_id: '' });
```

In `applyBulkEdit`, after the cassette line:

```ts
        if (bulkState.bottom_rail_id) patch.bottom_rail_id = bulkState.bottom_rail_id;
```

Find the `useState<BulkEditState>` initialiser (it reads `{ material_id: '', cassette_id: '', control_id: '' }`) and add `bottom_rail_id: ''` there too.

Find the bulk-apply button's `disabled` expression (`!bulkState.material_id && !bulkState.cassette_id && !bulkState.control_id`) and extend it, or Apply stays greyed out when the rail is the only chosen change:

```tsx
                disabled={!bulkState.material_id && !bulkState.cassette_id && !bulkState.bottom_rail_id && !bulkState.control_id}
```

- [ ] **Step 7: Send it in the payload**

In `buildPayload`, extend the completeness guard and its message:

```ts
        if (!it.material_id || !it.cassette_id || !it.bottom_rail_id || !it.control_id)
          return `Item ${i + 1}: choose material, cassette, bottom rail, and control.`;
```

And add to the pushed object, after `cassette_id: it.cassette_id,`:

```ts
          bottom_rail_id: it.bottom_rail_id,
```

- [ ] **Step 8: Type-check, test and lint**

```bash
cd apps/web && npx tsc -b --noEmit
```

Expected: 0 errors.

```bash
cd apps/web && npx vitest run
```

Expected: PASS 59/59 (unchanged from Task 2 — no web test covers `LineItemEditor.tsx` or `OrderDetail.tsx`).

```bash
cd apps/web && pnpm lint
```

Expected: exactly the 4 pre-existing `LineItemEditor.tsx` warnings, no more.

- [ ] **Step 9: Manual check of the one thing types cannot catch**

Confirm by reading the code that `addBlind`'s `findOptionIdByName(catalogs.bottomRails, 'Regular')` degrades safely: `findOptionIdByName` returns `''` when no option matches, which leaves the select on its placeholder and makes `buildPayload` refuse with "choose material, cassette, bottom rail, and control." That is the correct behaviour when the catalog has not loaded yet or the Regular option was renamed — a blind is never silently saved without a rail.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/orders/LineItemEditor.tsx apps/web/src/pages/orders/OrderDetail.tsx
git commit -m "feat(web): choose a bottom rail per blind, in single and bulk edit"
```

---

### Task 7: Web — the production label

**Files:**
- Modify: `apps/web/src/lib/labels.ts` (`LabelLineItem`, `LabelFields`, `buildLabels`)
- Modify: `apps/web/src/lib/labels.test.ts` (helper, stale header, hardware assertions)
- Modify: `apps/web/src/pages/orders/OrderLabels.tsx` (the `hardware` join and the `Label` JSDoc)

**Interfaces:**
- Consumes: `LineItem.bottom_rail_name` (Task 5) — `buildLabels` is called with a full `Order`, so the field must exist on the type or `OrderLabels.tsx` will not compile.
- Produces: `LabelLineItem.bottom_rail_name: string | null`; `LabelFields.bottomRail: string`.

- [ ] **Step 1: Write the failing test**

In `apps/web/src/lib/labels.test.ts`, first fix the module JSDoc. It claims to mirror `apps/api/src/lib/labels.test.ts`, which no longer exists — the print-agent removal deleted the api twin:

```ts
/**
 * Unit tests for the web-side label field extraction. This is the only
 * implementation — printing is browser-only, so there is no server-side
 * twin to keep in step (the api copy went with the print-agent removal).
 */
```

Add `bottom_rail_name: 'Regular',` to the `blind()` helper after `cassette_name`. Then replace the final test with:

```ts
  it('passes cassette, bottom rail and control through, blanking nulls', () => {
    const [full] = buildLabels(order({ line_items: [blind()] }));
    expect(full.cassette).toBe('Standard');
    expect(full.bottomRail).toBe('Regular');
    expect(full.control).toBe('Chain Left');

    const [bare] = buildLabels(
      order({
        line_items: [
          blind({ cassette_name: null, bottom_rail_name: null, control_name: null }),
        ],
      })
    );
    expect(bare.cassette).toBe('');
    expect(bare.bottomRail).toBe('');
    expect(bare.control).toBe('');
  });

  it('trims the bottom rail name, so a padded catalog entry still fits', () => {
    const [label] = buildLabels(
      order({ line_items: [blind({ bottom_rail_name: '  Pear  ' })] })
    );
    expect(label.bottomRail).toBe('Pear');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/web && npx vitest run src/lib/labels.test.ts
```

Expected: FAIL — `bottom_rail_name` is not assignable to `LabelLineItem`, and `bottomRail` does not exist on `LabelFields`.

- [ ] **Step 3: Implement in `apps/web/src/lib/labels.ts`**

In `LabelLineItem`, after `cassette_name: string | null;`:

```ts
  bottom_rail_name: string | null;
```

In `LabelFields`, after `cassette: string;`:

```ts
  /** Bottom-rail name, e.g. "Regular"; `''` when the row has none. */
  bottomRail: string;
```

In `buildLabels`, in the pushed object after `cassette: text(item.cassette_name),`:

```ts
        bottomRail: text(item.bottom_rail_name),
```

- [ ] **Step 4: Put it on the label in `OrderLabels.tsx`**

Change the `hardware` join so the rail sits between the cassette and the control:

```tsx
  const hardware = [fields.cassette, fields.bottomRail, fields.control]
    .filter(Boolean)
    .join(' · ');
```

Update the `Label` JSDoc paragraph that describes that row — it currently names only two fields:

```tsx
 * Cassette, bottom rail and control share ONE row, joined with the same
 * " · " the field builder uses for material and colour: they are three
 * parts of the same hardware spec and the freed rows keep the stock from
 * crowding. The join drops any blank part, so a unit missing one still
 * reads clean with no dangling separator.
 *
 * That row is `truncate`d at 10pt on 3in stock — roughly 40 characters.
 * Three long catalog names can exceed it and clip the control. If the
 * first physical print shows that, the fix is to give the bottom rail its
 * own row (there is vertical slack), NOT to shrink the type.
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd apps/web && npx vitest run src/lib/labels.test.ts
```

Expected: PASS. `labels.test.ts` rises from 11 to 12 (the cassette/control test was rewritten in place, and the trimming test is new), so the web total goes 59 → 60.

```bash
cd apps/web && npx tsc -b --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/labels.ts apps/web/src/lib/labels.test.ts apps/web/src/pages/orders/OrderLabels.tsx
git commit -m "feat(labels): print the bottom rail between the cassette and control"
```

---

### Task 8: Web — order overview table and customer view

**Files:**
- Modify: `apps/web/src/pages/orders/OrderOverview.tsx` (`BlindTypeTable` header, body, `min-w`, and the module/function JSDoc)
- Modify: `apps/web/src/pages/customer-view/CustomerView.tsx` (`PublicLineItem`, `itemContent`)

**Interfaces:**
- Consumes: `LineItem.bottom_rail_name` (Task 5); the `bottom_rail_name` key added to the public payload (Task 4).
- Produces: nothing.

- [ ] **Step 1: Add the column to `OrderOverview.tsx`**

The table is 11 columns at `min-w-[820px]`; a twelfth needs proportionally more room or the columns crush on desktop:

```tsx
      <table className="w-full min-w-[900px] border-collapse">
```

In the header row, between Cassette and Control:

```tsx
            <Th>Bottom rail</Th>
```

In the body row, between the cassette and control cells:

```tsx
                <Td>{item.bottom_rail_name ?? '—'}</Td>
```

Update the `BlindTypeTable` JSDoc line that lists the snapshot columns so it names the new one — it currently reads `option names are the pricing-time snapshots stored on the line item`, which stays true; extend the module header at line ~19 where it enumerates `material_name` / `cassette_name` / `control_name`:

```tsx
 * `material_name` / `cassette_name` / `bottom_rail_name` /
 * `control_name` and the stored
```

(Preserve the rest of that sentence exactly as it reads on disk.)

- [ ] **Step 2: Add it to `CustomerView.tsx`**

In `PublicLineItem`, after `cassette_name: string | null;`:

```ts
  bottom_rail_name: string | null;
```

In `itemContent`, in the `attrs` array after the cassette entry:

```ts
        li.bottom_rail_name ? `Bottom rail: ${li.bottom_rail_name}` : '',
```

Note this file uses `''` for omitted attrs and filters with `.filter(Boolean)`, unlike the PDF's `null` — follow the local convention.

- [ ] **Step 3: Verify screen-and-paper parity**

The four surfaces must state the same fact in the same position. Confirm each shows the bottom rail immediately after the cassette and before the control:

```bash
grep -n "Bottom rail\|bottom_rail_name" apps/api/src/lib/pdf.ts apps/web/src/pages/customer-view/CustomerView.tsx apps/web/src/pages/orders/OrderOverview.tsx apps/web/src/pages/orders/OrderLabels.tsx apps/web/src/lib/labels.ts
```

Expected: a hit in each file, and in `pdf.ts` / `CustomerView.tsx` the `Bottom rail:` line must sit between the `Cassette:` and `Control:` lines.

- [ ] **Step 4: Type-check, test, lint**

```bash
cd apps/web && npx tsc -b --noEmit
```

Expected: 0 errors.

```bash
cd apps/web && npx vitest run
```

Expected: PASS 60/60 — the 58 baseline plus one new pricing test (Task 2) and one new label test (Task 7).

```bash
cd apps/web && pnpm lint
```

Expected: exactly the 4 pre-existing `LineItemEditor.tsx` warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/orders/OrderOverview.tsx apps/web/src/pages/customer-view/CustomerView.tsx
git commit -m "feat(web): show the bottom rail on the overview table and customer view"
```

---

### Task 9: Knowledge base, memory bank, and whole-feature verification

**Files:**
- Modify: `knowledge/history/engine_features.md` (untracked on disk — do NOT `git add`)
- Modify: `memory-bank/activeContext.md` (untracked — do NOT `git add`)
- Modify: `memory-bank/progress.md` (untracked — do NOT `git add`)

**Interfaces:**
- Consumes: everything.
- Produces: nothing.

**CRITICAL:** `knowledge/` and `memory-bank/` are deliberately untracked (`.gitignore:9-10`, commit d75f688 "Untrack and ignore knowledge, memory-bank, AI_guidelines, and implementation_plan"). Update them ON DISK ONLY. Do NOT `git add -f` them — a previous task did and the commit had to be reset.

- [ ] **Step 1: Log the feature in `knowledge/history/engine_features.md`**

Append an entry, matching the file's existing format, covering: the new `bottom_rail_options` catalog priced per metre of width; the `line_items` snapshot triple; that the rail is charged on the same basis as the cassette via a dedicated `bottomRailCost` hook so all ten blind-type subclasses inherit it; and WHY the seed price is 0 and the historical rows were backfilled to Regular (a non-zero seed would silently raise the total of every re-saved order; without the backfill a required `bottom_rail_id` would make historical orders unsavable).

- [ ] **Step 2: Update `memory-bank/activeContext.md` and `memory-bank/progress.md`**

Record the current state and these open items verbatim:

1. **Migration 28 is NOT applied.** `supabase/migrations/20260729000028_bottom_rail_options.sql` exists but has not run against project `lgbxxlwsdeuhdgzrjjen`. Until it does, saving any order returns 400 — `resolveLineItems` looks up a table that does not exist. Apply it before deploying either Worker.
2. **Both rails are priced 0.** The rail costs nothing until someone sets a price in Settings → Bottom Rail Options. Orders already saved keep their stored totals; only orders saved after the price change include it.
3. **Label truncation is untested on paper.** The cassette / bottom rail / control row is `truncate`d at 10pt on 3in stock, about 40 characters. Three long catalog names will clip the control. If the physical print shows it, give the bottom rail its own row — there is vertical slack — rather than shrinking the type.
4. **The blind form is now four selects wide** (`sm:grid-cols-2 lg:grid-cols-4`). Unverified on a real tablet in portrait; check it on the field device.
5. Pre-existing, untouched: `apps/web` still has no `check` script (§9's `pnpm check` silently does nothing there); `.gitignore:15` still ignores `supabase/`, so migrations need `git add -f`.

- [ ] **Step 3: Run the full verification sweep and record REAL numbers**

```bash
cd apps/api && pnpm check && pnpm test
```

Expected: 0 type errors; 124 tests passing across 6 files (baseline 116 + 1 pricing + 5 orders + 2 pdf).

```bash
cd apps/web && npx tsc -b --noEmit && npx vitest run && pnpm lint
```

Expected: 0 type errors; 60 tests across 5 files; exactly 4 `LineItemEditor.tsx` lint warnings.

Do not paraphrase these. Report the actual counts the commands print, and if any differ from the expectations above, say so explicitly rather than rounding to "passing".

- [ ] **Step 4: Confirm nothing references a bottom rail that does not exist**

```bash
grep -rn "bottomRail\|bottom_rail" apps/web/src apps/api/src --include=*.ts --include=*.tsx | grep -v ".test." | wc -l
```

Then verify the twin invariant one last time:

```bash
diff <(sed -n '/^export interface BlindPricingInputs/,$p' apps/api/src/lib/calculators/base.ts) <(sed -n '/^export interface BlindPricingInputs/,$p' apps/web/src/lib/calculators/base.ts)
```

Expected: no output.

- [ ] **Step 5: Confirm the memory-bank files are still untracked**

```bash
git status --short knowledge memory-bank
```

Expected: no output — they are ignored, so a clean `git status` here proves they were not force-added.

- [ ] **Step 6: No commit for this task**

By design. The only files this task changes are untracked. Report the verification numbers instead.

---

## Deployment note (owner action, NOT part of any task)

The feature is inert until the migration runs. In order:

1. Apply `supabase/migrations/20260729000028_bottom_rail_options.sql` to project `lgbxxlwsdeuhdgzrjjen`. This creates the table, seeds Regular and Pear at 0, adds three `line_items` columns, backfills every existing blind row to Regular, and rebuilds `update_order_with_items()`.
2. `wrangler deploy` in `apps/api`.
3. `wrangler deploy` in `apps/web`.
4. Set real prices in Settings → Bottom Rail Options if the rail should cost anything.

No new secrets. Deploying the Workers BEFORE the migration breaks order saving, so keep this order.
