# Blind color code — design

**Date:** 2026-07-12
**Status:** Approved (pending spec review)

## Summary

Add an optional free-text **color code** to blind line items. It has **no
pricing effect**. It displays as a `Color: <value>` attribute everywhere blind
attributes already appear — the PDF estimate/invoice, the customer's online
order view, and the internal order detail. It supports bulk edit like
fabric/cassette/control. The field mirrors the existing `note` field almost
exactly, so this follows a well-worn path through the codebase.

## Decisions

1. **Field type:** free-text input (e.g. `"White 02"`, `"RAL 9010"`). No colors
   catalog, no dropdown, no snapshotting.
2. **Visibility:** everywhere `note` shows — PDF, customer online view, internal
   order detail. Only rendered when non-empty.
3. **Bulk edit:** supported, using the existing "non-empty = apply, empty =
   leave unchanged" convention.

## Data model

New migration `20260712000021_line_items_color.sql` (next in sequence after
`20260709000020_appointments_table.sql`), shaped identically to migration 15
(`line_items_note.sql`):

```sql
alter table public.line_items
  add column color text not null default '';
```

Only meaningful for `item_type = 'blind'`; preset/custom rows keep `''`.

## API (`apps/api`)

- **`orders.ts` `blindItemSchema`:** add `color: z.string().max(100).default('')`
  (a code, so 100 chars is ample vs. note's 1000).
- **Blind insert:** map `color: it.color`.
- **Preset/custom insert:** set `color: ''` (matching how `note: ''` is handled
  there).
- **`PdfDocumentData.line_items` type (`pdf.ts`):** add `color?: string | null`.
  The `getDocumentData` mapping already spreads `...li`, so the value flows
  through once the type allows it.

## PDF (`pdf.ts`)

In `itemContent`, add to the blind `attrs` array, **after Control, before
Note**, only when non-empty:

```
Color: <value>
```

## Web (`apps/web`)

- **`types/index.ts` `LineItem`:** add `color: string`.
- **`LineItemEditor.tsx`:**
  - `BlindDraft` gains `color: string`.
  - `BlindEditForm` renders a text input labeled **"Color code"** placed right
    below the Fabric/Cassette/Control grid and above the Note field.
  - `BulkEditState` gains `color: string`.
  - `BulkEditForm` renders a **"Color code"** text input below the
    fabric/cassette/control grid with placeholder **"No change"**.
- **`OrderDetail.tsx`:**
  - Draft-from-item hydration includes `color: li.color ?? ''`.
  - New-blind default includes `color: ''`.
  - Save payload includes `color: it.color.trim()`.
  - `openBulkEdit` resets `color: ''`.
  - `applyBulkEdit`: `if (bulkState.color.trim()) patch.color = bulkState.color.trim();`.
  - Apply button disabled guard extends to `&& !bulkState.color.trim()`.
- **`CustomerView.tsx` (online view):** add `color` to its row type and a
  `Color: <value>` attr line, same position as the PDF (after Control, before
  Note), only when non-empty.

## Out of scope (YAGNI)

- No colors catalog / settings page / dropdown.
- No pricing effect anywhere.
- No changes to `blindDraftPrice`, pricing, or totals.
- No email-template changes beyond what already renders line-item attributes.

## Testing

- Extend `pdf.test.ts`: assert the `Color:` line renders when `color` is set and
  is omitted when empty.
- Existing API/order/pricing tests must continue to pass (color is additive and
  carries a DB default, so existing insert paths remain valid).
