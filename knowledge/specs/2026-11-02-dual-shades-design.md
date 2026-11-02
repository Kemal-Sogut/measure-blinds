# Dual Shades blind type

**Date:** 2026-11-02
**Status:** Design approved in conversation.

## Problem

The shop now sells **Dual Shades**: one headrail carrying two independent rolls — a
**Front** fabric and a **Back** fabric — each with its own control and bottom rail.
Every existing blind type carries exactly one material, one control and one bottom rail,
so a Dual Shade cannot be quoted today.

## Goal

1. A new blind type **Dual Shades** in the editor, PDF, customer view, manufacturer copy
   and order rows.
2. Each Dual window picks a Front fabric + colour and a Back fabric + colour.
3. Price = shared area formula charged at **(front rate + back rate)**, with the
   **control and bottom rail charged twice**; cassette and installation once.
4. Dual Shades has its OWN fabric list. It starts as a copy of every Roller fabric, made
   by inserting NEW `materials` rows linked only to Dual Shades — no row is shared with
   Roller, so editing or deleting one never affects the other.
5. The internal Material usage panel counts both fabrics.

## Non-goals

- No new settings page: the existing per-type Materials page
  (`/settings/materials/:blindTypeId`) manages Dual fabrics once the type exists.
- No Worker-side check that a chosen fabric is linked to Dual Shades — the front
  material is not checked against its type today either; parity, not a new rule.
- No doubling of cassette or installation.

## Design

### 1. Data — migration 48 (`supabase/migrations/20261102000048_dual_shades_blind_type.sql`)

Modelled on migration 44 (Sheer). RE-RUNNABLE and ONE-SHOT: everything happens only on
the run that creates the `Dual Shades` row; once it exists a re-run is a no-op, so it can
never resurrect a fabric or link the shop has since removed.

- Insert `blind_types` row `Dual Shades`, `sort_order` 12.
- Copy Roller's CURRENT hardware scoping (`cassette_option_blind_types`,
  `bottom_rail_option_blind_types`, `control_option_blind_types`,
  `installation_option_blind_types`) and Roller's `blind_type_defaults` hardware ids to
  the new type, so Dual shows the same dropdowns as Roller on day one. The default
  MATERIAL is not copied (it would point at a Roller row); the shop can set one.
- **Fabric copy:** for every `materials` row linked to Roller via `material_blind_types`,
  insert a new `materials` row with the same `name`, `price_per_sqm`, `width_cm`,
  `active`, `sort_order`, then link ONLY the new row to Dual Shades. Implemented with a
  temp mapping (old id → new id) so each copy is linked exactly once.
- No Roller row (fresh database seeded differently): the type is created unscoped and
  with no fabrics; the shop configures it in Settings.

### 2. Pricing — `DualShadesBlindType` (twins: `apps/{api,web}/src/lib/blindTypes/dualShades.ts`)

Extends `BaseBlindType`. Label `'Dual Shades'`, aliases `['dual', 'dualshade']` (the
registry's normaliser strips non-alphanumerics and a trailing "blind").

- **Front fabric** = the existing `material_id` column (unchanged path, unchanged
  snapshot columns).
- **Back fabric** = `attributes.back_material_id`, declared in `attributeSchema` and in
  `catalogRefs`:
  `{ attrKey: 'back_material_id', table: 'materials', valueColumn: 'price_per_sqm',
  nameKey: 'back_material_name', valueKey: 'back_material_price_per_sqm',
  noun: 'back fabric' }`.
  The Worker resolves and snapshots name + price itself; a client sending
  `back_material_name` / `back_material_price_per_sqm` is a 400 from the strict schema.
  No change to `orders.ts` is needed — `resolveLineItems` is already driven by
  `catalogRefs`.
- `attributes.back_color`: optional free text, max 100 chars (matches the front Color
  field), no price effect.
- Schema fields are `.optional()` so `defaultAttributes()` (`{}`) round-trips. Presence of
  `back_material_id` is enforced separately:
  - Worker: `resolveLineItems` rejects a Dual line without a back fabric with a readable
    400 ("Pick a back fabric for the Dual Shades blind."). Implemented as a type-declared
    rule (`requiredAttributes(): string[]` on `BaseBlindType`, `[]` by default) so
    `orders.ts` gains no `blinds_type` branch.
  - Web: the editor's save guard uses the same `requiredAttributes()` so the button is
    blocked with the same message before the request.
- `materialCost(item, w, h)` = `(w × h × (front_rate + back_rate)) / 10000`, where
  `back_rate = numericOr(attributes.back_material_price_per_sqm, 0)`.
- `describeUnitCosts(item)` = `super.describeUnitCosts(item)` with the `control` and
  `bottom_rail` legs (when present) multiplied by 2 — whatever their basis yields
  (per unit: 2 × price; per panel: 2 × panels × price; per m / m²: 2 × that figure).
  `calculateUnitPrice` already sums this breakdown, so price, line total, order total and
  the per-option presentation all carry the doubled figure and cannot disagree.
- `describeMaterialUsage(item)` keeps the base `sqm` area (one roll's area). The material
  leg equals `usage.quantity × (front_rate + back_rate)`, so the parity table row uses the
  combined rate.

### 3. Documents

`describeAttributes` returns, in order: `Back fabric` (snapshot name) and, if set,
`Back color`. Front still prints through the existing Material / Color columns. Every
surface (PDF, customer view, manufacturer copy, order rows) already renders
`describeAttributes`, so no surface code changes.

### 4. Editor form — `apps/web/src/pages/orders/blindForms/DualShadesForm.tsx`

Same layout as `RollerForm`, with the Options section showing:

- **Front fabric** + **Front color** — the existing `material_id` / `color` fields,
  relabelled (`MaterialAndColor` gains optional label props; defaults unchanged).
- **Back fabric** + **Back color** — bound to `attributes.back_material_id` /
  `attributes.back_color`; the fabric list is `materialsForType(catalogs, 'Dual Shades')`,
  identical to the front list.
- `HardwareRow` unchanged.

Registered in `blindForms/index.ts`. `catalogResolver` in `lineItemDrafts.ts` (the only
table → list mapping on the client) gains a `materials` entry
(`{ name, value: Number(price_per_sqm) }` from `catalogs.materials`) so the keystroke
preview resolves the back fabric exactly as the Worker does.

### 5. Material usage panel (`apps/web/src/pages/orders/materialUsage.ts`)

For a line whose type declares a back fabric (`blindType instanceof DualShadesBlindType`
via a small exported helper, never a name compare), push the same `describeMaterialUsage`
quantity into a SECOND row keyed by the back material id. The back line's `key` is the line-draft key
suffixed with `:back`, so per-window selection stays unique and the
row-equals-sum-of-lines identity holds for both rows.

### 6. Tests

- Both `pricing.test.ts` suites:
  - Worked example: 1 panel, 100 × 100 cm (≥ minimums), front $20/m², back $30/m²,
    per-unit motor $150, per-unit bottom rail $10, per-unit cassette $25
    → material 50 + control 300 + rail 20 + cassette 25 = **$395**.
  - Per-panel control on a 2-panel Dual is doubled; cassette and installation are not.
  - Missing back price (old/absent snapshot) prices the back leg at 0, not NaN.
  - New row in the material-leg ≈ usage × rate parity table using the combined rate.
- `attributes.test.ts` (api): strict schema rejects a client-sent
  `back_material_price_per_sqm`; defaults round-trip; `requiredAttributes()` lists
  `back_material_id`.
- `blindForms.test.ts`: `Dual Shades` and `dual` resolve to `DualShadesForm`.
- `materialUsage` test: a Dual window adds its area to both the front and back rows.
- Worker: a Dual line without a back fabric → 400, tested at whichever level the existing
  suites already exercise `resolveLineItems` (determined in the plan).

### 7. Rollout

1. Apply migration 48 to `lgbxxlwsdeuhdgzrjjen` (via Supabase MCP, after review).
2. Deploy the Worker before the web app — an old web build cannot select Dual Shades, so
   ordering is safe either way, but the Worker must know the type before any Dual save.
3. Record in `knowledge/history/engine_features.md` and the memory bank.
