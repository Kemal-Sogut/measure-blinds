// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Zebra blind form.
 *
 * Composes the same fields, in the same order, as `DefaultForm` — the
 * scaffold state. This type has not diverged yet.
 *
 * Diverge here freely: reorder the sections, drop a field this type does
 * not use, or add an `<AttributeText>` bound to a key that
 * `lib/blindTypes/zebra.ts` declares in its `attributeSchema`. Nothing
 * outside this file and that module needs to change, and no other blind
 * type is affected.
 *
 * A new input must be declared in BOTH places or it will not persist: the
 * schema is what the Worker validates against, and an undeclared key is
 * rejected with a 400. Declare numeric fields with `z.coerce.number()` —
 * the value arriving from a draft is a string.
 */

import {
  BlindTypeSelect,
  FormSection,
  FormSplitter,
  HardwareRow,
  HeightField,
  MaterialAndColor,
  NoteField,
  PanelWidths,
  PriceReadout,
  QuantityStepper,
  RoomField,
  type BlindFormProps,
} from './fields';

export default function ZebraForm({ draft, catalogs, onChange, footer }: BlindFormProps) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* ── 1. Basics ───────────────────────────────────────────────── */}
      <FormSection title="Basics">
        <BlindTypeSelect draft={draft} catalogs={catalogs} onChange={onChange} />
        <RoomField draft={draft} onChange={onChange} />
        <PanelWidths draft={draft} onChange={onChange} />
        <HeightField draft={draft} onChange={onChange} />
      </FormSection>

      <FormSplitter />

      {/* ── 2. Options ──────────────────────────────────────────────── */}
      <FormSection title="Options">
        <MaterialAndColor draft={draft} catalogs={catalogs} onChange={onChange} />
        <HardwareRow draft={draft} catalogs={catalogs} onChange={onChange} />
      </FormSection>

      <FormSplitter />

      {/* ── 3. Details ──────────────────────────────────────────────── */}
      <FormSection title="Details">
        <NoteField draft={draft} onChange={onChange} />
        <QuantityStepper draft={draft} onChange={onChange} />
        <PriceReadout draft={draft} catalogs={catalogs} />
        {footer}
      </FormSection>
    </div>
  );
}
