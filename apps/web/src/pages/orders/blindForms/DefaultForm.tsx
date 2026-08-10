// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The default blind form — the layout every type shared before the forms
 * were split per type, and the fallback for any blind type without its own
 * file: an inactive type, a legacy free-text `blinds_type` from before the
 * dropdown existed, or a newly added type whose form has not been written.
 *
 * Never delete this. `getBlindForm` resolves to it for every unrecognised
 * name, so an order saved years ago still opens.
 *
 * Three splitter-separated sections:
 *   1. Basics  — blind type, room, panel widths, height.
 *   2. Options — material + colour, then cassette + control + bottom rail.
 *   3. Details — note, quantity, the live price readout, and the host's
 *      action buttons.
 *
 * Designed to be embedded inside a modal. It owns no save logic: the host
 * passes its own Cancel/Save controls through `footer` so they land at the
 * end of the Details section instead of floating under the whole form.
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

export default function DefaultForm({ draft, catalogs, onChange, footer }: BlindFormProps) {
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
