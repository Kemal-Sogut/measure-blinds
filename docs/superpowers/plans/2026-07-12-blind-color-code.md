# Blind Color Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional free-text color code to blind line items that carries no pricing effect and displays wherever blind attributes already appear (PDF, customer online view, internal order detail), including bulk edit.

**Architecture:** The `color` field mirrors the existing `note` field end-to-end: a `text not null default ''` DB column, a Zod string field on the blind schema, a snapshotted column on insert, an attribute line in both the PDF and the customer online view, and a form input in both the single-item and bulk editors. No new tables, dropdowns, or pricing logic.

**Tech Stack:** TypeScript, React, Hono (Cloudflare Workers), Supabase/Postgres, pdf-lib, Zod, Vitest, Tailwind.

## Global Constraints

- Every source file starts with the two-line SPDX header:
  `// SPDX-License-Identifier: GPL-3.0-only` and
  `// Copyright (c) 2026 Blinds Nisa. All rights reserved.` (`.sql` files use `--` comments). Do NOT add headers to files that lack them; match each file's existing convention.
- `color` is a free-text code, max 100 chars, `text not null default ''` in DB.
- `color` has NO pricing effect — never touch `blindDraftPrice`, `calculateBlindUnitPrice`, pricing, or totals.
- `color` renders only when non-empty (trimmed), positioned **after Control, before Note** in every attribute list.
- Bulk edit uses the existing convention: an empty bulk color field means "leave unchanged"; a non-empty value applies to all selected blind items. There is intentionally no bulk-clear.
- API typecheck: `pnpm --filter api check`. API tests: `pnpm --filter api test`.
- Web build/typecheck: `pnpm --filter web build`. Web tests: `pnpm --filter web test`.

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260712000021_line_items_color.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: a `color text not null default ''` column on `public.line_items`.

- [ ] **Step 1: Create the migration file**

Modeled exactly on `supabase/migrations/20260705000015_line_items_note.sql`.

```sql
-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 21: line_items.color.
-- Optional free-text color code captured per blind line item and shown to
-- the customer under the item on the estimate/invoice (PDF + online view).
-- No pricing effect. Non-null with a '' default so bulk inserts keep a
-- uniform column set.

alter table public.line_items
  add column color text not null default '';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260712000021_line_items_color.sql
git commit -m "feat(db): add color column to line_items"
```

---

### Task 2: PDF color attribute line (TDD)

**Files:**
- Modify: `apps/api/src/lib/pdf.ts` (the `PdfDocumentData` type ~line 55-69, `itemContent` ~line 130-149)
- Test: `apps/api/src/lib/pdf.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: exported `itemContent(li)` returning `{ title: string; attrs: string[] }`; a `Color: <value>` entry in `attrs` after Control and before Note; a new optional `color?: string | null` field on `PdfDocumentData['line_items'][number]`.

- [ ] **Step 1: Make `itemContent` exportable and add the color type field**

In `apps/api/src/lib/pdf.ts`, add `color?: string | null;` to the `line_items` array element type (place it right after `control_name: string | null;`):

```ts
    fabric_name: string | null;
    cassette_name: string | null;
    control_name: string | null;
    color?: string | null;
    description: string | null;
    note?: string | null;
```

Change the `itemContent` declaration from `function itemContent(` to `export function itemContent(` so it can be unit-tested.

- [ ] **Step 2: Write the failing test**

Add to `apps/api/src/lib/pdf.test.ts`:

```ts
import { buildDocumentPdf, itemContent, type PdfDocumentData } from './pdf';

describe('itemContent color', () => {
  const blind: PdfDocumentData['line_items'][number] = {
    item_type: 'blind',
    room_name: 'Living Room',
    blinds_type: 'Roller',
    panels: [70, 70],
    height_cm: 200,
    fabric_name: 'Blackout White',
    cassette_name: 'Standard Cassette',
    control_name: 'Chain Control',
    color: 'White 02',
    note: 'Inside mount',
    description: '',
    quantity: 1,
    unit_price: 0,
    line_total: 0,
  };

  it('places the Color line after Control and before Note when set', () => {
    const { attrs } = itemContent(blind);
    const controlIdx = attrs.findIndex((a) => a.startsWith('Control:'));
    const colorIdx = attrs.findIndex((a) => a === 'Color: White 02');
    const noteIdx = attrs.findIndex((a) => a.startsWith('Note:'));
    expect(colorIdx).toBeGreaterThan(controlIdx);
    expect(noteIdx).toBeGreaterThan(colorIdx);
  });

  it('omits the Color line when empty or whitespace', () => {
    expect(itemContent({ ...blind, color: '' }).attrs.some((a) => a.startsWith('Color:'))).toBe(false);
    expect(itemContent({ ...blind, color: '   ' }).attrs.some((a) => a.startsWith('Color:'))).toBe(false);
  });
});
```

Note: change the existing top import line to include `itemContent` (shown above).

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter api test`
Expected: FAIL — `itemContent` renders no `Color:` line, so the first test's `colorIdx` is `-1`.

- [ ] **Step 4: Add the Color attribute line**

In `itemContent`, insert the color entry between the control line and the note line:

```ts
      li.control_name ? `Control: ${li.control_name}` : null,
      li.color?.trim() ? `Color: ${li.color.trim()}` : null,
      li.note?.trim() ? `Note: ${li.note.trim()}` : null,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter api test`
Expected: PASS (all pdf tests, including the two new ones).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/pdf.ts apps/api/src/lib/pdf.test.ts
git commit -m "feat(pdf): render color code on blind line items"
```

---

### Task 3: API — accept, persist, and expose color

**Files:**
- Modify: `apps/api/src/routes/orders.ts` (`blindItemSchema` ~line 79-92; blind insert object ~line 242-263)
- Modify: `apps/api/src/routes/public.ts` (line-item mapping ~line 118-131)

**Interfaces:**
- Consumes: the `color` DB column (Task 1); the PDF path already reads `color` via the existing `...li` spread in `getDocumentData`.
- Produces: `color` accepted on POST/PUT blind items, snapshotted onto the row, and returned by the public online-view endpoint.

- [ ] **Step 1: Add `color` to the blind schema**

In `apps/api/src/routes/orders.ts`, in `blindItemSchema`, add after the `note` line:

```ts
    note: z.string().max(1000).default(''),
    color: z.string().max(100).default(''),
    quantity: z.number().int().min(1).max(999),
```

- [ ] **Step 2: Snapshot `color` on blind insert**

In the blind insert object (the `return { item_type: 'blind', ... }`), add after the `note: it.note,` line:

```ts
      note: it.note,
      color: it.color,
      quantity: it.quantity,
```

- [ ] **Step 3: Expose `color` from the public endpoint**

In `apps/api/src/routes/public.ts`, in the `line_items` mapping, add after the `note: li.note,` line:

```ts
        note: li.note,
        color: li.color,
        quantity: li.quantity,
```

- [ ] **Step 4: Typecheck and run API tests**

Run: `pnpm --filter api check && pnpm --filter api test`
Expected: PASS — color is additive with a DB default, so existing order/public tests stay green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/orders.ts apps/api/src/routes/public.ts
git commit -m "feat(api): accept, persist, and expose blind color code"
```

---

### Task 4: Web — single-item color field

**Files:**
- Modify: `apps/web/src/types/index.ts` (`LineItem` ~line 199-216)
- Modify: `apps/web/src/pages/orders/LineItemEditor.tsx` (`BlindDraft` ~line 26-38; `BlindEditForm` fabric/cassette/control grid ~line 269-302)
- Modify: `apps/web/src/pages/orders/OrderDetail.tsx` (draft hydration ~line 105-117; `addBlind` default ~line 373-385; save payload ~line 513-524)

**Interfaces:**
- Consumes: `color` on the API line-item shape (Task 3).
- Produces: `BlindDraft.color: string`; `LineItem.color: string`; a "Color code" input in `BlindEditForm`; `color` carried through hydrate/new/save in `OrderDetail`.

- [ ] **Step 1: Add `color` to the `LineItem` type**

In `apps/web/src/types/index.ts`, add after the `note: string;` line in the `LineItem` interface:

```ts
  note: string;
  color: string;
```

- [ ] **Step 2: Add `color` to `BlindDraft`**

In `apps/web/src/pages/orders/LineItemEditor.tsx`, in the `BlindDraft` interface, add after `note: string;`:

```ts
  note: string;
  color: string;
  quantity: string;
```

- [ ] **Step 3: Render the color input in `BlindEditForm`**

In `BlindEditForm`, immediately after the closing `</div>` of the Fabric / Cassette / Control grid and before the `{/* Note ... */}` label, add:

```tsx
      {/* Color code (free text, no pricing effect) */}
      <label>
        <span className={LABEL}>Color code</span>
        <input
          value={draft.color}
          onChange={(e) => onChange({ ...draft, color: e.target.value })}
          maxLength={100}
          placeholder="e.g. White 02"
          className={INPUT}
        />
      </label>
```

- [ ] **Step 4: Carry `color` through `OrderDetail` hydrate / new / save**

In `apps/web/src/pages/orders/OrderDetail.tsx`:

Draft hydration (the `item_type: 'blind'` mapping), add after `note: li.note ?? '',`:

```ts
        note: li.note ?? '',
        color: li.color ?? '',
        quantity: String(li.quantity),
```

`addBlind` default draft, add after `note: '',`:

```ts
      note: '',
      color: '',
      quantity: '1',
```

Save payload (the `line_items.push({ item_type: 'blind', ... })`), add after `note: it.note.trim(),`:

```ts
          note: it.note.trim(),
          color: it.color.trim(),
          quantity: Math.round(qty),
```

- [ ] **Step 5: Typecheck / build the web app**

Run: `pnpm --filter web build`
Expected: PASS — no type errors; `BlindDraft` and `LineItem` now agree with every construction site.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/types/index.ts apps/web/src/pages/orders/LineItemEditor.tsx apps/web/src/pages/orders/OrderDetail.tsx
git commit -m "feat(web): color code field on blind editor"
```

---

### Task 5: Web — bulk-edit color

**Files:**
- Modify: `apps/web/src/pages/orders/LineItemEditor.tsx` (`BulkEditState` ~line 400-404; `BulkEditForm` ~line 406-446)
- Modify: `apps/web/src/pages/orders/OrderDetail.tsx` (`bulkState` init ~line 276; `openBulkEdit` ~line 474-477; `applyBulkEdit` ~line 479-490; Apply button disabled guard ~line 1865)

**Interfaces:**
- Consumes: `BlindDraft.color` (Task 4).
- Produces: `BulkEditState.color: string`; a "Color code" input in `BulkEditForm`; color applied to selected blind items only when non-empty.

- [ ] **Step 1: Add `color` to `BulkEditState`**

In `apps/web/src/pages/orders/LineItemEditor.tsx`:

```ts
export interface BulkEditState {
  fabric_id: string;
  cassette_id: string;
  control_id: string;
  color: string;
}
```

- [ ] **Step 2: Render the bulk color input**

In `BulkEditForm`, after the closing `</div>` of the fabric/cassette/control grid (the `<div className="grid ...">` block) and before the component's closing `</div>`, add:

```tsx
      <label>
        <span className={LABEL}>Color code</span>
        <input
          value={state.color}
          onChange={(e) => onChange({ ...state, color: e.target.value })}
          maxLength={100}
          placeholder="No change"
          className={INPUT}
        />
      </label>
```

- [ ] **Step 3: Wire `color` through `OrderDetail` bulk state**

In `apps/web/src/pages/orders/OrderDetail.tsx`:

`bulkState` initial value:

```ts
  const [bulkState, setBulkState] = useState<BulkEditState>({ fabric_id: '', cassette_id: '', control_id: '', color: '' });
```

`openBulkEdit` reset:

```ts
    setBulkState({ fabric_id: '', cassette_id: '', control_id: '', color: '' });
```

`applyBulkEdit`, add after the `control_id` patch line:

```ts
        if (bulkState.control_id) patch.control_id = bulkState.control_id;
        if (bulkState.color.trim()) patch.color = bulkState.color.trim();
```

Apply button `disabled` guard — extend the condition:

```tsx
                disabled={!bulkState.fabric_id && !bulkState.cassette_id && !bulkState.control_id && !bulkState.color.trim()}
```

- [ ] **Step 4: Typecheck / build the web app**

Run: `pnpm --filter web build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/orders/LineItemEditor.tsx apps/web/src/pages/orders/OrderDetail.tsx
git commit -m "feat(web): bulk-edit color code across selected blinds"
```

---

### Task 6: Web — color on the customer online view

**Files:**
- Modify: `apps/web/src/pages/customer-view/CustomerView.tsx` (`PublicLineItem` ~line 28-42; blind `attrs` builder ~line 78-90)

**Interfaces:**
- Consumes: `color` returned by the public endpoint (Task 3).
- Produces: a `Color: <value>` attribute line in the online order view, after Control and before Note.

- [ ] **Step 1: Add `color` to `PublicLineItem`**

In `apps/web/src/pages/customer-view/CustomerView.tsx`, add after `control_name: string | null;`:

```ts
  control_name: string | null;
  color: string | null;
  description: string | null;
  note: string | null;
```

- [ ] **Step 2: Add the Color attr line**

In the blind branch's `attrs` array, insert between the control line and the note line:

```ts
        li.control_name ? `Control: ${li.control_name}` : '',
        li.color?.trim() ? `Color: ${li.color.trim()}` : '',
        li.note?.trim() ? `Note: ${li.note.trim()}` : '',
```

- [ ] **Step 3: Typecheck / build the web app**

Run: `pnpm --filter web build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/customer-view/CustomerView.tsx
git commit -m "feat(web): show color code on customer online view"
```

---

## Final verification

- [ ] Run `pnpm --filter api check && pnpm --filter api test && pnpm --filter web build` — all green.
- [ ] Manual smoke (optional): create a blind with a color code, confirm it appears in the order detail, the PDF, and the online view; bulk-edit a color across two selected blinds and confirm both change while an empty bulk field leaves them untouched.

## Notes on coverage vs. spec

- The spec named `CustomerView.tsx` for the online view but not `public.ts`; because `public.ts` maps line-item fields explicitly (it does not spread), `color` must be added there too (Task 3, Step 3) or the online view would always receive `null`. The PDF path in `orders.ts` (`getDocumentData`) spreads `...li`, so it needs no change.
