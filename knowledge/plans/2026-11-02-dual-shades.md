# Dual Shades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Dual Shades" blind type with a Front and a Back fabric, priced at area ×
(front + back rate) with control and bottom rail charged twice, and seed its own fabric list
as a copy of Roller's.

**Architecture:** A new twinned pricing module `DualShadesBlindType` extends the base formula.
Front fabric is the existing `material_id` column; Back fabric is a `catalogRefs` attribute
(`back_material_id` → `materials.price_per_sqm`) that the Worker resolves and snapshots, so
`orders.ts` needs only one generic "required attribute" gate. Two small generic extension points
are added to `BaseBlindType`: `requiredAttributes` and `displayOnlyKeys`. Migration 51 creates
the type and copies Roller's hardware scoping and fabrics into NEW rows.

**Tech Stack:** TypeScript, Zod 3, Hono 4 (Worker), React 19 + Tailwind 4, Vitest, Supabase Postgres.

Spec: `knowledge/specs/2026-11-02-dual-shades-design.md`.

## Global Constraints

> **Revised 2026-11-03 — the incomplete-draft-items plan has LANDED** (PRs #66/#67). Already on
> main and NOT to be re-added: `RequiredAttribute`, `BaseBlindType.requiredAttributes` and
> `missingRequiredAttribute()` (both base twins); `lib/lineItemCompleteness.ts` (twins), whose
> `missingFields` appends every `requiredAttributes` noun. Consequences: a Dual line without a back
> fabric is INCOMPLETE — savable on a draft at $0, refused (shared message "Item N: choose a back
> fabric.") by every route that leaves draft. No hard 400 in `resolveLineItems`, no `buildPayload`
> guard, and no extra `blindDraftInputs` gate (`blindDraftPrice` already returns null when
> `draftMissingFields` is non-empty). Tasks 2, 4 and 5 below are written against that state.
> UI work is also bound by AI_GUIDELINES §11 (visual verification in the real container at 375 px
> and desktop widths, worst-case content, never through the live app).

- Every new source file starts with:
  `// SPDX-License-Identifier: GPL-3.0-only` / `// Copyright (c) 2026 Blinds Nisa. All rights reserved.` (`--` in SQL).
- Every exported symbol has a JSDoc scoring ≥ 8/10 (purpose, behaviour, constraints, integration).
- `apps/api/src/lib/blindTypes/*` and `apps/web/src/lib/blindTypes/*` are TWINS: identical code,
  only the header comment differs (api = "AUTHORITATIVE twin of apps/web/…", web = "Twin of the
  AUTHORITATIVE apps/api/…"). Same for `priceLock.ts` and both `pricing.test.ts` /
  `attributes.test.ts` / `priceLock.test.ts` suites.
- Clients never send money. Snapshot keys (`back_material_name`, `back_material_price_per_sqm`)
  are NOT declared in `attributeSchema`, so a client sending one is a 400.
- Files ≤ 800 lines (standing exceptions: `orders.ts`, `OrderDetail.tsx` — add only what is needed).
- Commands: `pnpm --filter ./apps/api test|check`, `pnpm --filter ./apps/web test|check|lint`.
  Target 0 errors / 0 warnings.
- Do NOT apply migration 51 to the live project without the user's explicit go-ahead.

## File map

| File | Change |
|---|---|
| `supabase/migrations/20261103000051_dual_shades_blind_type.sql` | Create: type row, Roller scoping/defaults copy, fabric copy |
| `supabase/seed.sql` | Add `('Dual Shades', 12)` |
| `apps/{api,web}/src/lib/blindTypes/base.ts` | Add `displayOnlyKeys` (`requiredAttributes` already on main) |
| `apps/{api,web}/src/lib/priceLock.ts` | Exclude `displayOnlyKeys` from the fingerprint |
| `apps/{api,web}/src/lib/blindTypes/dualShades.ts` | Create: the pricing module |
| `apps/{api,web}/src/lib/blindTypes/{registry,index}.ts` | Register + export |
| `apps/{api,web}/src/lib/blindTypes/attributes.test.ts` | CANONICAL + Dual cases |
| `apps/{api,web}/src/lib/pricing.test.ts` | Dual block + parity row (combined rate) |
| `apps/{api,web}/src/lib/priceLock.test.ts` | back_color does not move the fingerprint |
| `apps/api/src/routes/orders.routes.test.ts` | Dual line items block (no `orders.ts` change expected) |
| `apps/{api,web}/src/lib/lineItemCompleteness.test.ts` | Dual back fabric is an open field |
| `apps/web/src/pages/orders/lineItemDrafts.ts` | `materials` in `catalogResolver` |
| `apps/web/src/pages/orders/blindForms/fields.tsx` | `MaterialAndColor` label props; new `AttributeMaterialAndColor` |
| `apps/web/src/pages/orders/blindForms/DualShadesForm.tsx` | Create |
| `apps/web/src/pages/orders/blindForms/{index,blindForms.test}.ts` | Register + test |
| `apps/web/src/pages/orders/BulkAddSectionCard.tsx` | Dual case in `SectionAttributes` |
| `apps/web/src/pages/orders/materialUsage.ts` (+ test) | Extra rows for `materials` catalog refs |
| `knowledge/history/engine_features.md`, `memory-bank/*` | Docs |

---

### Task 1: Migration 51 — Dual Shades type and its own fabric list

**Files:**
- Create: `supabase/migrations/20261103000051_dual_shades_blind_type.sql`
- Modify: `supabase/seed.sql` (blind_types insert list, after `('Sheer', 11)`)

**Interfaces:**
- Produces: a `blind_types` row named exactly `Dual Shades` (the web/pricing registry key
  normalises to `dualshades`).

- [ ] **Step 1: Write the migration**

```sql
-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 51: the "Dual Shades" blind type.
--
-- A Dual Shade is one headrail carrying two independent rolls -- a FRONT
-- and a BACK fabric -- each with its own control and bottom rail. Pricing
-- lives in apps/*/src/lib/blindTypes/dualShades.ts: area x (front rate +
-- back rate), control and bottom rail charged twice. The front fabric is
-- the ordinary line_items.material_id; the back fabric is the
-- attributes.back_material_id catalog ref, resolved by the Worker.
--
-- Dual Shades has its OWN fabric list. It starts as a COPY of every
-- material linked to Roller: new materials rows (same name, price, width,
-- active flag, sort order) linked ONLY to Dual Shades. Nothing is shared,
-- so editing or deleting a Dual fabric in Settings never touches Roller.
--
-- Hardware: the new type inherits Roller's CURRENT scoping (cassette,
-- bottom rail, control, installation -- migration 35: an option with no
-- link is shown for NO type) and Roller's hardware defaults (migration
-- 38). The default MATERIAL is deliberately not copied: it would point at
-- a Roller row, which Dual no longer lists.
--
-- RE-RUNNABLE and ONE-SHOT, like migration 44: everything happens only on
-- the run that creates the row, so a re-run can never resurrect a fabric
-- or link the shop has since removed.

do $$
declare
  v_roller uuid;
  v_dual   uuid;
  r        record;
  v_new    uuid;
begin
  if exists (select 1 from public.blind_types where name = 'Dual Shades') then
    return;
  end if;

  insert into public.blind_types (name, sort_order)
  values ('Dual Shades', 12)
  returning id into v_dual;

  select id into v_roller
    from public.blind_types
   where name = 'Roller'
     and archived_at is null
   order by created_at
   limit 1;

  -- No Roller row (a database seeded differently): Dual Shades is created
  -- unscoped and with no fabrics; the shop configures it in Settings.
  if v_roller is null then
    return;
  end if;

  insert into public.cassette_option_blind_types (cassette_option_id, blind_type_id)
  select cassette_option_id, v_dual
    from public.cassette_option_blind_types
   where blind_type_id = v_roller
  on conflict do nothing;

  insert into public.bottom_rail_option_blind_types (bottom_rail_option_id, blind_type_id)
  select bottom_rail_option_id, v_dual
    from public.bottom_rail_option_blind_types
   where blind_type_id = v_roller
  on conflict do nothing;

  insert into public.control_option_blind_types (control_option_id, blind_type_id)
  select control_option_id, v_dual
    from public.control_option_blind_types
   where blind_type_id = v_roller
  on conflict do nothing;

  insert into public.installation_option_blind_types (installation_option_id, blind_type_id)
  select installation_option_id, v_dual
    from public.installation_option_blind_types
   where blind_type_id = v_roller
  on conflict do nothing;

  insert into public.blind_type_defaults
    (blind_type_id, cassette_id, bottom_rail_id, control_id, installation_id)
  select v_dual, cassette_id, bottom_rail_id, control_id, installation_id
    from public.blind_type_defaults
   where blind_type_id = v_roller
  on conflict (blind_type_id) do nothing;

  -- Fabric copy: one NEW materials row per Roller material, each linked
  -- only to Dual Shades. Row by row so every copy gets exactly one link.
  for r in
    select m.name, m.price_per_sqm, m.width_cm, m.active, m.sort_order
      from public.materials m
      join public.material_blind_types mbt on mbt.material_id = m.id
     where mbt.blind_type_id = v_roller
       and m.archived_at is null   -- retired in Settings (migration 49): not copied
     order by m.sort_order, m.name
  loop
    insert into public.materials (name, price_per_sqm, width_cm, active, sort_order)
    values (r.name, r.price_per_sqm, r.width_cm, r.active, r.sort_order)
    returning id into v_new;

    insert into public.material_blind_types (material_id, blind_type_id)
    values (v_new, v_dual);
  end loop;
end $$;
```

- [ ] **Step 2: Confirm the defaults copy omits `material_id`**

`blind_type_defaults` (migration 38) has `material_id, cassette_id, bottom_rail_id, control_id,
installation_id`. The insert above lists every column except `material_id`, which therefore stays
null for Dual Shades. No change needed; just check the SQL matches.

- [ ] **Step 3: Add the seed row**

In `supabase/seed.sql` change `('Sheer',           11)` to `('Sheer',           11),` and add
`  ('Dual Shades',     12)` on the next line.

- [ ] **Step 4: Dry-run the migration against the live project inside a rolled-back transaction**

Only with the user's go-ahead, via Supabase MCP `execute_sql` (the whole block is rolled back, so nothing persists):
```sql
begin;
-- paste the do $$ … $$ block
select (select count(*) from material_blind_types mbt join blind_types bt on bt.id = mbt.blind_type_id where bt.name = 'Roller') as roller_fabrics,
       (select count(*) from material_blind_types mbt join blind_types bt on bt.id = mbt.blind_type_id where bt.name = 'Dual Shades') as dual_fabrics,
       (select count(*) from material_blind_types a join material_blind_types b on a.material_id = b.material_id
          join blind_types ta on ta.id = a.blind_type_id join blind_types tb on tb.id = b.blind_type_id
         where ta.name = 'Roller' and tb.name = 'Dual Shades') as shared_rows;
rollback;
```
Expected: `dual_fabrics = roller_fabrics`, `shared_rows = 0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261103000051_dual_shades_blind_type.sql supabase/seed.sql
git commit -m "feat(db): migration 51 — Dual Shades type with its own copy of Roller fabrics"
```

---

### Task 2: Display-only attribute keys (price lock ignores them)

**Files:**
- Modify: `apps/api/src/lib/blindTypes/base.ts`, `apps/web/src/lib/blindTypes/base.ts` (identical change)
- Modify: `apps/api/src/lib/priceLock.ts`, `apps/web/src/lib/priceLock.ts` (`inputAttributes`)
- Test: `apps/{api,web}/src/lib/blindTypes/attributes.test.ts`, `apps/{api,web}/src/lib/priceLock.test.ts`

**Interfaces:**
- Already on main (do NOT add again): `RequiredAttribute`, `requiredAttributes`, `missingRequiredAttribute()`.
- Produces (on `BaseBlindType`): `readonly displayOnlyKeys: readonly string[]` (default `[]`).

- [ ] **Step 1: Failing test** — append to the `generic extension points` describe in BOTH
`attributes.test.ts` files:

```ts
  it('defaults to no display-only keys', () => {
    expect(new BaseBlindType().displayOnlyKeys).toEqual([]);
  });
```

and to BOTH `priceLock.test.ts` files (inside `describe('pricingFingerprint — blinds')`), a test with a
throwaway subclass so it does not depend on Task 3. `pricingFingerprint` resolves the type through
`getBlindType(blinds_type)`, so instead exercise the exported behaviour through a real registered type
only in Task 3; here assert the no-op for existing types:

```ts
  it('treats every attribute of a type with no display-only keys as an input', () => {
    // Curtains declares no display-only keys: changing its pleat id must
    // still move the fingerprint (Task 2 must not widen what is ignored).
    const curtain = (pleat: string) =>
      blind({ blinds_type: 'Curtains', attributes: { pleat_type_id: pleat } });
    expect(pricingFingerprint(curtain('66666666-6666-4666-8666-666666666666'))).not.toBe(
      pricingFingerprint(curtain('77777777-7777-4777-8777-777777777777'))
    );
  });
```

- [ ] **Step 2: Run** `pnpm --filter ./apps/api test -- attributes` — Expected: the `displayOnlyKeys`
test FAILS (undefined); the priceLock test passes already (it pins the no-op).

- [ ] **Step 3: Implement in BOTH `base.ts`**, directly after `missingRequiredAttribute()`:

```ts
  /**
   * Attribute keys that are DISPLAY-ONLY — printed on documents, never
   * priced (Dual Shades' `back_color`). Both `priceLock.ts` twins drop
   * them from the pricing fingerprint, so editing one on a confirmed order
   * does not break its price lock, exactly as the front `color` column
   * never has. A key listed here must not feed any cost hook.
   */
  readonly displayOnlyKeys: readonly string[] = [];
```

- [ ] **Step 4: Implement in BOTH `priceLock.ts`** — in `inputAttributes`, replace the `snapshots`
set construction and filter:

```ts
  const blindType = getBlindType(blindsType);
  // Output keys (catalog snapshots) and display-only keys (a colour) are
  // not inputs: neither may count as the consultant having repriced the item.
  const ignored = new Set([
    ...blindType.catalogRefs.flatMap((ref) => [ref.nameKey, ref.valueKey]),
    ...blindType.displayOnlyKeys,
  ]);
  return Object.entries(attributes)
    .filter(([key]) => !ignored.has(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
```

Extend the function's JSDoc with one sentence on display-only keys.

- [ ] **Step 5: Run** `pnpm --filter ./apps/api test`, `pnpm --filter ./apps/web test`,
`pnpm --filter ./apps/api check`, `pnpm --filter ./apps/web check` — all PASS / 0 errors (the pinned
wire-format fingerprint case must be unchanged).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/blindTypes apps/web/src/lib/blindTypes apps/api/src/lib/priceLock.ts apps/web/src/lib/priceLock.ts
git commit -m "feat(pricing): blind types can declare display-only attributes the price lock ignores"
```

---

### Task 3: `DualShadesBlindType` (twins) + pricing tests

**Files:**
- Create: `apps/api/src/lib/blindTypes/dualShades.ts`, `apps/web/src/lib/blindTypes/dualShades.ts`
- Modify: both `registry.ts` (import + `new DualShadesBlindType()` after Sheer; update the
  "canonical ten plus Sheer" comment to "…plus Sheer and Dual Shades"), both `index.ts`
  (`export { DualShadesBlindType } from './dualShades';`)
- Test: both `pricing.test.ts`, both `attributes.test.ts`

**Interfaces:**
- Consumes: `RequiredAttribute` / `requiredAttributes` (already on main), Task 2's `displayOnlyKeys`.
- Produces: `DualShadesBlindType` with `blindType = 'Dual Shades'`, attribute keys
  `back_material_id` (input, uuid), `back_color` (input, ≤100 chars), `back_material_name`,
  `back_material_price_per_sqm` (Worker snapshots).

- [ ] **Step 1: Failing pricing tests** — add BEFORE the parity describe in BOTH `pricing.test.ts`
(api file: use its own `blind()` helper — same shape; if the api helper's type is
`BlindPricingInputs` without `quantity`, the objects still fit):

```ts
describe('Dual Shades', () => {
  const T = 'Dual Shades';

  it('resolves by name and aliases', () => {
    expect(getBlindType('Dual Shades').blindType).toBe(T);
    expect(getBlindType('dual').blindType).toBe(T);
    expect(getBlindType('Dual Shade').blindType).toBe(T);
  });

  it('charges both fabrics on the area and doubles control and bottom rail', () => {
    // 100 cm x 200 cm = 2 m² (at or above both minimums).
    // fabric 2 x (20 + 30) = 100; motor 2 x 150 = 300; rail 2 x 10 = 20;
    // cassette 25 once → $445.00
    const item = blind({
      panels: [100],
      height_cm: 200,
      material_price_per_sqm: 20,
      attributes: { back_material_price_per_sqm: 30 },
      hardware: {
        cassette: { price: 25, basis: 'per_unit' },
        bottom_rail: { price: 10, basis: 'per_unit' },
        control: { price: 150, basis: 'per_unit' },
      },
    });
    expect(calculateBlindUnitPriceForType(T, item)).toBe(445);
  });

  it('doubles a per-panel control but not cassette or installation', () => {
    // 120 cm x 250 cm = 3 m²: fabric 3 x (40 + 10) = 150; cassette 1.2 m x 20 = 24;
    // control 2 panels x 10 x 2 = 40; installation 45 once → $259.00
    const item = blind({
      panels: [60, 60],
      height_cm: 250,
      material_price_per_sqm: 40,
      attributes: { back_material_price_per_sqm: 10 },
      hardware: {
        cassette: { price: 20, basis: 'per_m' },
        control: { price: 10, basis: 'per_panel' },
        installation: { price: 45, basis: 'per_unit' },
      },
    });
    const legs = getBlindType(T).describeUnitCosts(item);
    expect(legs.material).toBeCloseTo(150, 10);
    expect(legs.cassette).toBeCloseTo(24, 10);
    expect(legs.control).toBeCloseTo(40, 10);
    expect(legs.installation).toBeCloseTo(45, 10);
    expect(calculateBlindUnitPriceForType(T, item)).toBe(259);
  });

  it('prices a missing back snapshot at 0 rather than NaN', () => {
    const item = blind({ panels: [60, 60], height_cm: 250, material_price_per_sqm: 40, hardware: {} });
    expect(calculateBlindUnitPriceForType(T, item)).toBe(120);
  });

  it('reports one roll of area as material usage', () => {
    const item = blind({ panels: [100], height_cm: 200, material_price_per_sqm: 20 });
    expect(getBlindType(T).describeMaterialUsage(item)).toEqual({ unit: 'sqm', quantity: 2, measured: 2 });
  });
});
```

Add parity rows to the parity `CASES` table in BOTH files:

```ts
    { type: 'Dual Shades', item: blind({ panels: [100], height_cm: 200, material_price_per_sqm: 20, attributes: { back_material_price_per_sqm: 30 } }) },
    { type: 'Dual Shades', item: blind({ panels: [70, 90], height_cm: 140, material_price_per_sqm: 33.33, attributes: { back_material_price_per_sqm: 19.99 } }) },
```

and change the parity assertion to use the combined rate (identical for every other type, whose
attributes carry no back price):

```ts
  it.each(CASES)('$type: material leg equals usage x rate', ({ type, item }) => {
    const blindType = getBlindType(type);
    const usage = blindType.describeMaterialUsage(item);
    const leg = blindType.describeUnitCosts(item).material;
    // Dual Shades charges the same area at front + back rate; every other
    // type carries no back price, so this is the front rate alone.
    const rate = item.material_price_per_sqm + Number(item.attributes.back_material_price_per_sqm ?? 0);
    expect(usage.quantity * rate).toBeCloseTo(leg, 6);
  });
```

- [ ] **Step 2: Failing attribute tests** — in BOTH `attributes.test.ts`: append `'Dual Shades'` to
`CANONICAL` (comment: "the original ten plus Sheer and Dual Shades"), and add:

```ts
describe('Dual Shades attributes', () => {
  const t = getBlindType('Dual Shades');
  const BACK = '44444444-4444-4444-8444-444444444444';

  it('accepts a back fabric id and colour, and rejects a client-sent back price', () => {
    expect(t.attributeSchema.parse({ back_material_id: BACK, back_color: 'Grey' })).toEqual({
      back_material_id: BACK,
      back_color: 'Grey',
    });
    expect(() => t.attributeSchema.parse({ back_material_price_per_sqm: 1 })).toThrow();
    expect(() => t.attributeSchema.parse({ back_material_name: 'x' })).toThrow();
  });

  it('requires a back fabric and treats the back colour as display-only', () => {
    expect(t.missingRequiredAttribute({})).toEqual({ key: 'back_material_id', noun: 'back fabric' });
    expect(t.missingRequiredAttribute({ back_material_id: BACK })).toBeNull();
    expect(t.displayOnlyKeys).toEqual(['back_color']);
  });

  it('snapshots the back fabric from the materials catalog', () => {
    const out = t.resolveCatalogRefs({ back_material_id: BACK }, (table, id) =>
      table === 'materials' && id === BACK ? { name: 'Linen Grey', value: 30 } : undefined
    );
    expect(out).toEqual({
      back_material_id: BACK,
      back_material_name: 'Linen Grey',
      back_material_price_per_sqm: 30,
    });
  });

  it('describes the back fabric and colour for documents', () => {
    expect(t.describeAttributes({ back_material_name: 'Linen Grey', back_color: 'Grey' })).toEqual([
      { label: 'Back fabric', value: 'Linen Grey' },
      { label: 'Back color', value: 'Grey' },
    ]);
  });
});
```

Add to BOTH `apps/{api,web}/src/lib/lineItemCompleteness.test.ts` (use that file's existing scope
fixture/helpers; a scope whose `isKnownType` is false is enough, since required attributes are read
for any non-blank type):

```ts
  it('lists the Dual Shades back fabric as an open field until it is chosen', () => {
    const dual = {
      item_type: 'blind' as const,
      blinds_type: 'Dual Shades',
      panels: [100],
      height_cm: 200,
      material_id: '11111111-1111-4111-8111-111111111111',
      attributes: {},
    };
    const scope = { isKnownType: () => false, usesSlot: () => false };
    expect(missingFields(dual, scope)).toEqual(['back fabric']);
    expect(incompleteMessage(0, dual, ['back fabric'])).toBe('Item 1: choose a back fabric.');
    expect(
      missingFields({ ...dual, attributes: { back_material_id: '44444444-4444-4444-8444-444444444444' } }, scope)
    ).toEqual([]);
  });
```

And to BOTH `priceLock.test.ts` (inside `describe('pricingFingerprint — blinds')`):

```ts
  it("ignores a type's display-only attributes (Dual Shades back colour)", () => {
    const dual = (attributes: Record<string, string>) =>
      blind({ blinds_type: 'Dual Shades', attributes });
    const backId = '44444444-4444-4444-8444-444444444444';
    expect(pricingFingerprint(dual({ back_material_id: backId, back_color: 'White' }))).toBe(
      pricingFingerprint(dual({ back_material_id: backId, back_color: 'Grey' }))
    );
    // …while the back FABRIC is a real pricing input.
    expect(pricingFingerprint(dual({ back_material_id: backId }))).not.toBe(
      pricingFingerprint(dual({ back_material_id: '55555555-5555-4555-8555-555555555555' }))
    );
  });
```

- [ ] **Step 3: Run** both suites — Expected: FAIL (Dual resolves to the default type).

- [ ] **Step 4: Create `apps/api/src/lib/blindTypes/dualShades.ts`** (web twin identical except the
last header paragraph, which reads "Twin of the AUTHORITATIVE `apps/api/src/lib/blindTypes/dualShades.ts`…"):

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Dual Shades blind-type module — one headrail carrying TWO independent
 * rolls, a front and a back fabric, each with its own control and bottom
 * rail.
 *
 *   fabric   = area (minimums applied) x (front rate + back rate)
 *   control  = 2 x the control charge on its own basis
 *   rail     = 2 x the bottom-rail charge on its own basis
 *   cassette, installation = charged once, as for every other type
 *
 * The FRONT fabric is the ordinary `material_id` column, so every existing
 * surface (material snapshot columns, documents, bulk edit) keeps working.
 * The BACK fabric is `attributes.back_material_id`, a `catalogRefs` entry
 * pointing at the same `materials` table: the client sends only the id and
 * the Worker snapshots `back_material_name` and
 * `back_material_price_per_sqm` itself. Neither snapshot key is declared in
 * `attributeSchema`, so a client that sends one is rejected with a 400.
 *
 * The schema field is optional (every type must parse `{}`), so presence
 * is declared through `requiredAttributes`: `lib/lineItemCompleteness.ts`
 * then treats a Dual line without a back fabric as INCOMPLETE — savable on
 * a draft at $0, refused by every route that takes the order out of draft.
 *
 * `back_color` is free text, printed beside the back fabric and never
 * priced; it is listed in `displayOnlyKeys` so editing it does not break a
 * confirmed order's price lock.
 *
 * Material usage reports ONE roll's area (the base formula): the material
 * leg equals that quantity x (front + back rate), which is what the parity
 * table in both `pricing.test.ts` suites asserts. The Material usage panel
 * adds the same quantity to the back fabric's row through the generic
 * `materials` catalog-ref rule in `materialUsage.ts`.
 *
 * AUTHORITATIVE twin of `apps/web/src/lib/blindTypes/dualShades.ts`; the
 * mirrored `pricing.test.ts` suites fail on any drift.
 */

import { z } from 'zod';
import {
  BaseBlindType,
  type BlindAttributes,
  type BlindPricingInputs,
  type RequiredAttribute,
  type UnitCostBreakdown,
} from './base';

/**
 * Hardware legs a Dual Shade carries twice — one per roll. Cassette and
 * installation cover the whole headrail and are charged once.
 */
const DOUBLED_SLOTS = ['bottom_rail', 'control'] as const;

export class DualShadesBlindType extends BaseBlindType {
  readonly blindType = 'Dual Shades';
  readonly aliases = ['dual', 'dual shade'];

  readonly attributeSchema = BaseBlindType.attrs({
    back_material_id: z.string().uuid().optional(),
    back_color: z.string().trim().max(100).optional(),
  });

  readonly catalogRefs = [
    {
      attrKey: 'back_material_id',
      table: 'materials',
      valueColumn: 'price_per_sqm',
      nameKey: 'back_material_name',
      valueKey: 'back_material_price_per_sqm',
      noun: 'back fabric',
    },
  ] as const;

  /** Read by `lib/lineItemCompleteness.ts`: no back fabric = incomplete (draft-only, $0). */
  readonly requiredAttributes: readonly RequiredAttribute[] = [
    { key: 'back_material_id', noun: 'back fabric' },
  ];

  /** Printed, never priced: excluded from the price-lock fingerprint. */
  readonly displayOnlyKeys: readonly string[] = ['back_color'];

  /**
   * Back fabric (snapshot name) then back colour, each only when present.
   * The front fabric and colour print through the ordinary Material /
   * Color columns on every surface, so they are not repeated here.
   */
  describeAttributes(attrs: BlindAttributes): { label: string; value: string }[] {
    const out: { label: string; value: string }[] = [];
    if (attrs.back_material_name) out.push({ label: 'Back fabric', value: String(attrs.back_material_name) });
    if (attrs.back_color) out.push({ label: 'Back color', value: String(attrs.back_color) });
    return out;
  }

  /**
   * Both rolls cover the same minimised area, so the area is charged at
   * the SUM of the two rates. Kept as one expression in the base's own
   * shape (`w x h x rate / 10000`) so a zero back rate reproduces the base
   * leg bit-for-bit. A missing snapshot prices the back at 0, never NaN.
   */
  protected materialCost(item: BlindPricingInputs, widthCm: number, heightCm: number): number {
    const back = numericOr(item.attributes.back_material_price_per_sqm, 0);
    return (widthCm * heightCm * (item.material_price_per_sqm + back)) / 10000;
  }

  /**
   * The base breakdown with the control and bottom-rail legs doubled,
   * whatever basis their catalog rows declare (per unit, per panel, per m,
   * per m²). `calculateUnitPrice` sums this breakdown, so the price, the
   * line total and every per-option presentation carry the same doubled
   * figure and cannot disagree.
   */
  describeUnitCosts(item: BlindPricingInputs): UnitCostBreakdown {
    const legs = super.describeUnitCosts(item);
    for (const slot of DOUBLED_SLOTS) {
      const cost = legs[slot];
      if (cost !== undefined) legs[slot] = cost * 2;
    }
    return legs;
  }
}

/** A finite, non-negative number from a snapshot value, or `fallback`. */
function numericOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
```

Note: `Number(undefined)` is NaN → fallback 0. `describeAttributes` in the empty-blob test returns
`[]` — passes the existing `describes nothing for an empty blob` case.

- [ ] **Step 5: Register** in both `registry.ts` and export from both `index.ts` (see Files).

- [ ] **Step 6: Run** `pnpm --filter ./apps/api test` and `pnpm --filter ./apps/web test` — Expected:
PASS. Run `pnpm --filter ./apps/api check` and `pnpm --filter ./apps/web check` — 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib apps/web/src/lib
git commit -m "feat(pricing): Dual Shades — front + back fabric, doubled control and bottom rail"
```

---

### Task 4: Worker route tests — Dual line items end to end

No production code is expected to change: `resolveLineItems` is already driven by `catalogRefs`
(back-fabric lookup + snapshot) and by `lineItemCompleteness` (incomplete-on-draft). This task PROVES
that with route tests. If a test fails, fix the smallest thing in `orders.ts` and say so in the report.

**Files:**
- Test: `apps/api/src/routes/orders.routes.test.ts` (new describe after `Curtains line items`)

**Interfaces:**
- Consumes: Dual module (Task 3). The existing describes `incomplete draft items — saving` /
  `— leaving draft is gated` (around lines 3387–3510) show how a draft vs a sent order is set up;
  mirror them for the two incomplete cases.

- [ ] **Step 1: Failing route tests**

```ts
describe('Dual Shades line items', () => {
  const TYPE_DUAL = { id: '88888888-8888-4888-8888-888888888883', name: 'Dual Shades' };
  const BACK = { id: '99999999-9999-4999-8999-999999999991', name: 'Linen Grey', price_per_sqm: 45 };

  /** One Dual item; Roller-like hardware (cassette, rail, control). */
  function dualPayload(overrides: Record<string, unknown> = {}) {
    const p = payload() as unknown as { line_items: Record<string, unknown>[] };
    p.line_items = [
      {
        item_type: 'blind',
        room_name: 'Bedroom',
        blinds_type: 'Dual Shades',
        panels: [100],
        height_cm: 200,
        material_id: MATERIAL.id,
        cassette_id: CASSETTE.id,
        bottom_rail_id: BOTTOM_RAIL.id,
        control_id: CONTROL.id,
        color: 'White',
        note: '',
        attributes: { back_material_id: BACK.id, back_color: 'Grey' },
        quantity: 1,
        ...overrides,
      },
    ];
    return p;
  }

  function create(body: unknown) {
    db.orderInsertResults = [{ data: { id: 'd1', subtotal: 0 } }];
    return ordersApp.request(
      '/',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      ENV
    );
  }

  beforeEach(() => {
    // The fake returns the whole list for any `.in()` filter; both the
    // front lookup and the back catalog-ref lookup read it by id.
    db.responses['materials.select'] = [MATERIAL, BACK];
    db.responses['blind_types.select'] = [TYPE_ROLLER, TYPE_CURTAINS, TYPE_DUAL];
    db.responses['cassette_option_blind_types.select'] = [
      { cassette_option_id: CASSETTE.id, blind_type_id: TYPE_ROLLER.id },
      { cassette_option_id: CASSETTE.id, blind_type_id: TYPE_DUAL.id },
    ];
    db.responses['bottom_rail_option_blind_types.select'] = [
      { bottom_rail_option_id: BOTTOM_RAIL.id, blind_type_id: TYPE_ROLLER.id },
      { bottom_rail_option_id: BOTTOM_RAIL.id, blind_type_id: TYPE_DUAL.id },
    ];
    db.responses['control_option_blind_types.select'] = [
      { control_option_id: CONTROL.id, blind_type_id: TYPE_ROLLER.id },
      { control_option_id: CONTROL.id, blind_type_id: TYPE_CURTAINS.id },
      { control_option_id: CONTROL.id, blind_type_id: TYPE_DUAL.id },
    ];
  });

  it('snapshots the back fabric and prices both fabrics', async () => {
    const res = await create(dualPayload());
    expect(res.status).toBe(201);
    const rows = db.insertPayloads['line_items']?.[0] as Record<string, unknown>[];
    expect(rows[0].attributes).toEqual({
      back_material_id: BACK.id,
      back_color: 'Grey',
      back_material_name: 'Linen Grey',
      back_material_price_per_sqm: 45,
    });
    expect(rows[0].material_name).toBe('Blackout White');
    // 2 m² x (55 + 45) = 200; cassette per_m 20 x 1 m = 20; rail and
    // control are $0 (doubling covered by pricing.test.ts) → 220.
    expect(rows[0].unit_price).toBe(220);
  });

  it('saves a Dual draft without a back fabric as incomplete, charging nothing', async () => {
    // POST creates a DRAFT, where incomplete items are allowed (spec
    // 2026-11-02). Mirror the existing incomplete-draft tests if the
    // create route needs anything extra to be treated as a draft.
    const res = await create(dualPayload({ attributes: {} }));
    expect(res.status).toBe(201);
    const rows = db.insertPayloads['line_items']?.[0] as Record<string, unknown>[];
    expect(rows[0].unit_price).toBe(0);
    expect(rows[0].line_total).toBe(0);
  });

  it('refuses a Dual line without a back fabric on a sent order', async () => {
    // Copy the arrange step of `PUT on a sent order refuses an incomplete
    // item and writes nothing` (incomplete draft items — saving), swapping
    // its line item for dualPayload({ attributes: {} }).line_items[0].
    // Expected: 400, error === 'Item 1 (Bedroom): choose a back fabric.',
    // and no line_items write.
  });

  it('rejects a client-supplied back fabric price', async () => {
    const res = await create(
      dualPayload({ attributes: { back_material_id: BACK.id, back_material_price_per_sqm: 0 } })
    );
    expect(res.status).toBe(400);
    expect(db.calls).not.toContain('orders.insert');
  });
});
```

The sent-order test is written out in full by the implementer from the referenced existing test —
it must contain real assertions (status 400, the exact message, no write), not the comment above.

- [ ] **Step 2: Run** `pnpm --filter ./apps/api test -- orders.routes` — Expected: all PASS without
production changes. If the fake db lacks a response a Dual save needs, add the missing
`db.responses[...]` key in this describe's `beforeEach` (test-only change).

- [ ] **Step 3: Run** the full api suite and `pnpm --filter ./apps/api check` — PASS / 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/orders.routes.test.ts
git commit -m "test(api): Dual Shades line items — back fabric snapshot, incomplete on draft, refused when sent"
```

---

### Task 5: Editor — back-fabric resolver, Dual form, bulk-add picker

**Files:**
- Modify: `apps/web/src/pages/orders/lineItemDrafts.ts` (`catalogResolver` only)
- Modify: `apps/web/src/pages/orders/blindForms/fields.tsx`
- Create: `apps/web/src/pages/orders/blindForms/DualShadesForm.tsx`
- Modify: `apps/web/src/pages/orders/blindForms/index.ts`, `blindForms.test.ts`
- Modify: `apps/web/src/pages/orders/BulkAddSectionCard.tsx` (`SectionAttributes`)
- Test: `apps/web/src/pages/orders/lineItemDrafts.test.ts`

**Interfaces:**
- Consumes: Dual module (Task 3). Completeness is already handled: `draftMissingFields` lists
  "back fabric" and `blindDraftPrice` returns null for an incomplete draft — do NOT add guards to
  `blindDraftInputs` or `buildOrderPayload`.
- Produces: `AttributeMaterialAndColor` (fields.tsx) with props
  `BlindFormProps & { materialKey: string; colorKey: string; materialLabel: string; colorLabel: string }`.

- [ ] **Step 1: Failing draft tests** — in `lineItemDrafts.test.ts`, using that file's existing
catalog/draft fixtures (add a `Dual Shades` blind type and a second material linked to it if the
fixture lacks them):

```ts
describe('Dual Shades drafts', () => {
  it('prices the back fabric from the cached materials list', () => {
    const draft = dualDraft({ attributes: { back_material_id: 'm-back' } });
    const inputs = blindDraftInputs(draft, dualCatalogs());
    expect(inputs?.attributes.back_material_price_per_sqm).toBe(30);
  });

  it('reports the back fabric as open and shows no price until it is chosen', () => {
    const draft = dualDraft({ attributes: {} });
    expect(draftMissingFields(draft, dualCatalogs())).toEqual(['back fabric']);
    expect(blindDraftPrice(draft, dualCatalogs())).toBeNull();
  });
});
```

where `dualCatalogs()` = the file's catalog fixture plus
`{ id: 'bt-dual', name: 'Dual Shades', … }` in `blindTypes`, a front material `m-front`
($20, `blind_type_ids: ['bt-dual']`), a back material `m-back` ($30, same link), and the fixture's
cassette/rail/control linked to `bt-dual`; `dualDraft()` = the file's blind draft fixture with
`blinds_type: 'Dual Shades'`, `material_id: 'm-front'`. Write both helpers in the test file.

- [ ] **Step 2: Run** `pnpm --filter ./apps/web test -- lineItemDrafts` — Expected: the first test
FAILS (the resolver has no `materials` entry, so `blindDraftInputs` returns null); the second may
already pass (it pins existing behaviour for Dual).

- [ ] **Step 3: Implement in `lineItemDrafts.ts`.** In `catalogResolver`, before `return undefined;`:

```ts
    if (table === 'materials') {
      // Dual Shades' back fabric: a second material referenced from
      // attributes, priced from the same column as the front one.
      const hit = catalogs.materials.find((m) => m.id === id);
      return hit ? { name: hit.name, value: Number(hit.price_per_sqm) } : undefined;
    }
```

and update its JSDoc ("Pleat types and materials are the only entries…").

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Fields** — in `fields.tsx`:

(a) Give `MaterialAndColor` optional labels (defaults keep every other form unchanged):

```ts
export function MaterialAndColor({
  draft,
  catalogs,
  onChange,
  materialLabel = 'Material',
  colorLabel = 'Color',
}: BlindFormProps & { materialLabel?: string; colorLabel?: string }) {
```
and use `label={materialLabel}` / `<span className={LABEL}>{colorLabel}</span>`. Extend its JSDoc
with one sentence on the labels (Dual Shades renders it as "Front fabric" / "Front color").

(b) Add after `AttributeSelect`:

```tsx
/**
 * A second fabric + colour pair stored in the ATTRIBUTE blob rather than
 * the `material_id` / `color` columns — Dual Shades' back roll. Visually
 * identical to {@link MaterialAndColor} and listing the SAME type-scoped
 * materials, so front and back offer one fabric list.
 *
 * Writes only the material's ID: the Worker resolves its price through the
 * type's `catalogRefs` (table `materials`). `materialKey` and `colorKey`
 * MUST be declared in the type's `attributeSchema`, or the save is a 400.
 * Also rendered by the bulk-add sheet's `SectionAttributes`.
 */
export function AttributeMaterialAndColor({
  draft,
  catalogs,
  onChange,
  materialKey,
  colorKey,
  materialLabel,
  colorLabel,
}: BlindFormProps & {
  materialKey: string;
  colorKey: string;
  materialLabel: string;
  colorLabel: string;
}) {
  const set = (key: string, value: string) =>
    onChange({ ...draft, attributes: { ...draft.attributes, [key]: value } });
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3.5 sm:grid-cols-2">
      <OptionSelect
        label={materialLabel}
        value={draft.attributes[materialKey] ?? ''}
        onChange={(id) => set(materialKey, id)}
        options={materialsForType(catalogs, draft.blinds_type)}
        placeholder={draft.blinds_type ? 'Select…' : 'Pick a blind type first'}
      />
      <label className="min-w-0">
        <span className={LABEL}>{colorLabel}</span>
        <input
          placeholder="e.g. White, Oak, Charcoal"
          value={draft.attributes[colorKey] ?? ''}
          onChange={(e) => set(colorKey, e.target.value)}
          maxLength={100}
          className={INPUT}
        />
      </label>
    </div>
  );
}
```

`BlindFormProps` includes `footer`; if TS complains when `SectionAttributes` omits it, type the
props as `Pick<BlindFormProps, 'draft' | 'catalogs' | 'onChange'> & {…}` instead.

- [ ] **Step 6: Create `DualShadesForm.tsx`**

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Dual Shades blind form — the Roller layout with a second fabric.
 *
 * The Options section shows the FRONT fabric + colour (the ordinary
 * `material_id` / `color` columns, relabelled) and the BACK fabric +
 * colour (`attributes.back_material_id` / `back_color`, declared in
 * `lib/blindTypes/dualShades.ts`). Both dropdowns list the same Dual
 * Shades materials. The back fabric is required: the price stays blank
 * and the save is blocked until it is chosen.
 *
 * Hardware is the shared `HardwareRow`; the doubled control and bottom
 * rail are pricing, not UI, and live in the type module.
 */

import {
  AttributeMaterialAndColor,
  BlindTypeSelect,
  FormSection,
  FormSplitter,
  HardwareRow,
  HeightField,
  MaterialAndColor,
  NoteField,
  PanelWidths,
  QuantityStepper,
  RoomField,
  type BlindFormProps,
} from './fields';
import { blindDraftPrice } from '../lineItemDrafts';
import { PriceBlock } from './PriceBlock';

export default function DualShadesForm({ draft, catalogs, onChange, footer }: BlindFormProps) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <FormSection title="Basics">
        <BlindTypeSelect draft={draft} catalogs={catalogs} onChange={onChange} />
        <RoomField draft={draft} onChange={onChange} />
        <PanelWidths draft={draft} onChange={onChange} />
        <HeightField draft={draft} onChange={onChange} />
      </FormSection>

      <FormSplitter />

      <FormSection title="Options">
        <MaterialAndColor
          draft={draft}
          catalogs={catalogs}
          onChange={onChange}
          materialLabel="Front fabric"
          colorLabel="Front color"
        />
        <AttributeMaterialAndColor
          draft={draft}
          catalogs={catalogs}
          onChange={onChange}
          materialKey="back_material_id"
          colorKey="back_color"
          materialLabel="Back fabric"
          colorLabel="Back color"
        />
        <HardwareRow draft={draft} catalogs={catalogs} onChange={onChange} />
      </FormSection>

      <FormSplitter />

      <FormSection title="Details">
        <NoteField draft={draft} onChange={onChange} />
        <QuantityStepper draft={draft} onChange={onChange} />
        <PriceBlock
          price={blindDraftPrice(draft, catalogs)}
          adjustments={draft}
          canOverride
          onChange={(adj) => onChange({ ...draft, ...adj })}
        />
        {footer}
      </FormSection>
    </div>
  );
}
```

(Add a JSDoc above the default export if the repo's other form files have one; match `RollerForm.tsx`.)

- [ ] **Step 7: Register + test the form** — `index.ts`: `import DualShadesForm from './DualShadesForm';`
and `[normalizeBlindType('Dual Shades'), DualShadesForm],`. `blindForms.test.ts`: append
`'Dual Shades'` to `CANONICAL` and, in the aliases test,
`expect(getBlindForm('dual')).toBe(getBlindForm('Dual Shades'));` plus a new case:

```ts
  it('gives Dual Shades its own form', () => {
    expect(getBlindForm('Dual Shades')).not.toBe(getBlindForm('Roller'));
    expect(getBlindForm('Dual Shades')).not.toBe(DefaultForm);
  });
```

- [ ] **Step 8: Bulk add** — in `BulkAddSectionCard.tsx` `SectionAttributes`, replace the single
Curtains early-return with:

```tsx
  const blindType = getBlindType(config.blinds_type);
  if (blindType instanceof DualShadesBlindType) {
    return (
      <AttributeMaterialAndColor
        draft={config}
        catalogs={catalogs}
        onChange={onChange}
        materialKey="back_material_id"
        colorKey="back_color"
        materialLabel="Back fabric"
        colorLabel="Back color"
      />
    );
  }
  if (!(blindType instanceof CurtainsBlindType)) return null;
```

Import `DualShadesBlindType` beside `CurtainsBlindType` and `AttributeMaterialAndColor` from
`./blindForms/fields`. Update the component JSDoc: Curtains/Sheer (pleat) and Dual Shades (back
fabric) are the cases.

- [ ] **Step 9: Run** `pnpm --filter ./apps/web test`, `check`, `lint` — 0 errors / 0 warnings.

- [ ] **Step 10: Layout self-check (AI_GUIDELINES §11)** — read the classes you used against the real
containers: the item edit form (find where `getBlindForm(...)` output is mounted) and the bulk-add
section card, at a 343 px-wide card (375 px phone). `AttributeMaterialAndColor` copies
`MaterialAndColor`'s `grid-cols-1 sm:grid-cols-2` + `min-w-0` exactly, so a long fabric name must
truncate/wrap inside its select, never widen the row. Report the containers you found. Do NOT run
the real app (its `.env` points at the live database); the controller does the rendered check in
Task 7.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/pages/orders
git commit -m "feat(web): Dual Shades form with front and back fabric; required back fabric"
```

---

### Task 6: Material usage panel counts the back fabric

**Files:**
- Modify: `apps/web/src/pages/orders/materialUsage.ts` (`summarizeMaterialUsage`, `MaterialUsageLine.key` doc)
- Test: `apps/web/src/pages/orders/materialUsage.test.ts`

- [ ] **Step 1: Failing test** — add a Dual type to that file's fixtures and:

```ts
  it('adds a Dual window to both its front and its back fabric row', () => {
    const DUAL = { id: 'bt-dual', name: 'Dual Shades', active: true, sort_order: 2 };
    const cats = catalogs({
      blindTypes: [ROLLER, CURTAINS, DUAL],
      materials: [
        { id: 'm1', name: 'Blackout Ivory', price_per_sqm: 50, active: true, sort_order: 0, width_cm: null, blind_type_ids: [DUAL.id] },
        { id: 'm3', name: 'Linen Grey', price_per_sqm: 30, active: true, sort_order: 1, width_cm: null, blind_type_ids: [DUAL.id] },
      ],
      cassettes: [{ id: 'c1', name: 'Standard', price: 20, price_basis: 'per_m', active: true, sort_order: 0, blind_type_ids: [DUAL.id] }],
      bottomRails: [{ id: 'b1', name: 'Regular', price: 0, price_basis: 'per_m', active: true, sort_order: 0, blind_type_ids: [DUAL.id] }],
      controls: [{ id: 'ct1', name: 'Chain', price: 0, price_basis: 'per_panel', active: true, sort_order: 0, blind_type_ids: [DUAL.id] }],
    });
    const summary = summarizeMaterialUsage(
      [blind({ blinds_type: 'Dual Shades', attributes: { back_material_id: 'm3' } })],
      cats
    );
    const front = summary.rows.find((r) => r.materialId === 'm1');
    const back = summary.rows.find((r) => r.materialId === 'm3');
    expect(front?.quantity).toBeCloseTo(2.8, 10);
    expect(back?.quantity).toBeCloseTo(2.8, 10);
    expect(back?.rate).toBe(30);
    expect(back?.lines[0].key).toBe('d1:back_material_id');
    expect(summary.totals.sqm).toBeCloseTo(5.6, 10);
    // Line keys stay unique across the summary, so selection still works.
    expect(new Set(allUsageLineKeys(summary)).size).toBe(2);
  });
```

- [ ] **Step 2: Run** `pnpm --filter ./apps/web test -- materialUsage` — Expected: FAIL.

- [ ] **Step 3: Implement** — refactor the row-accumulate block of `summarizeMaterialUsage` into a
local closure and call it once for the front material and once per `materials` catalog ref:

```ts
    const blindType = getBlindType(item.blinds_type);
    const usage = blindType.describeMaterialUsage(inputs);
    const qty = inputs.quantity;
    const line = {
      label: item.room_name || `Blind ${index + 1}`,
      blindType: item.blinds_type,
      widthCm: inputs.panels.reduce((a, b) => a + b, 0),
      heightCm: inputs.height_cm,
      itemQuantity: qty,
      quantity: usage.quantity * qty,
    };

    /**
     * Adds this window's one usage reading to `mat`'s row. Called for the
     * front material and again for every extra fabric the type references
     * from the `materials` catalog (Dual Shades' back roll), which covers
     * the same area — so both rows get the same quantity.
     */
    const addTo = (mat: { id: string; name: string }, rate: number, key: string) => {
      const rowKey = materialRowKey(mat.id, usage.unit);
      const row = groups.get(rowKey) ?? {
        materialId: mat.id,
        materialName: mat.name,
        unit: usage.unit,
        quantity: 0,
        rate,
        lineCount: 0,
        lines: [],
      };
      row.lineCount += 1;
      row.quantity += usage.quantity * qty;
      row.lines.push({ key, ...line });
      groups.set(rowKey, row);
    };

    // Per `unit`, not per m²: for Curtains this column is dollars per
    // running metre (see `MaterialsForType`).
    addTo(material, inputs.material_price_per_sqm, item.key);
    for (const ref of blindType.catalogRefs) {
      if (ref.table !== 'materials') continue;
      const extra = catalogs.materials.find((m) => m.id === item.attributes[ref.attrKey]);
      // `blindDraftInputs` already resolved this id, so a miss is not
      // reachable; skipping keeps the summary total rather than throwing.
      if (!extra) continue;
      addTo(extra, Number(extra.price_per_sqm), `${item.key}:${ref.attrKey}`);
    }
```

Preserve the existing explanatory comments from the original block (move them onto the closure).
Update `MaterialUsageLine.key`'s JSDoc: the front line uses the draft key; an extra fabric's line
uses `<draft key>:<attrKey>`, keeping keys unique across the summary.

- [ ] **Step 4: Run** the web suite — PASS. `check`, `lint` — clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/orders/materialUsage.ts apps/web/src/pages/orders/materialUsage.test.ts
git commit -m "feat(web): material usage counts Dual Shades back fabric"
```

---

### Task 7: Verification, docs, migration apply

- [ ] **Step 1: Full checks**

```bash
pnpm --filter ./apps/api check && pnpm --filter ./apps/api test
pnpm --filter ./apps/web check && pnpm --filter ./apps/web test && pnpm --filter ./apps/web lint
```
Expected: 0 errors / 0 warnings, all tests pass.

- [ ] **Step 2: Rendered check (AI_GUIDELINES §11)** — throwaway `apps/web/harness.html` +
`apps/web/src/harness.tsx` (imports `./index.css`), served by the `web` launch config at
`/harness.html`, mounting `DualShadesForm` inside the same container classes as the real item editor
and the bulk-add section card with fixture catalogs. Widths: 375 px viewport and ≥1280 px desktop
(component at its real column width), plus ~768 px. Worst-case content: a long spaced fabric name,
a 60+ char unbroken fabric name, empty back fabric (price "—" + Incomplete listing "back fabric").
Measure `scrollWidth <= clientWidth` on the form rows; screenshot as proof; zero `/api` requests.
Delete both harness files before committing.

- [ ] **Step 3: Docs** — append a dated `## 2026-11-02 — "Dual Shades" blind type` entry to
`knowledge/history/engine_features.md` (pricing formula, doubled legs, catalogRef back fabric,
`requiredAttributes` / `displayOnlyKeys`, migration 51 + MUST-apply note, tests). Update
`memory-bank/systemPatterns.md` (blind-type section: Dual Shades, the two new extension points, the
`materials` catalog-ref rule in the usage panel), `activeContext.md` and `progress.md` (overwrite
current-state sections; link the history entry).

- [ ] **Step 4: Commit docs**

```bash
git add knowledge memory-bank
git commit -m "docs: Dual Shades — history and memory bank"
```

- [ ] **Step 5: Apply migration 51** to `lgbxxlwsdeuhdgzrjjen` via Supabase MCP `apply_migration`
— ONLY after the user explicitly approves. Then re-run the Task 1 Step 4 count query (without the
transaction) and record "migration 51 applied" in `engine_features.md` + commit.
