// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Dual Shades blind form — the Roller layout with a second fabric.
 *
 * The Options section shows the FRONT fabric + colour (the ordinary
 * `material_id` / `color` columns, relabelled) and the BACK fabric +
 * colour (`attributes.back_material_id` / `back_color`, declared in
 * `lib/blindTypes/dualShades.ts`). Both dropdowns list the same Dual
 * Shades materials. The back fabric is required: until it is chosen the
 * price stays blank and, on a draft, the line saves as INCOMPLETE ($0,
 * Incomplete marker); Send, stage moves and the PDF are refused.
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

/**
 * Renders the Dual Shades editor for one blind draft: Basics, Options (front
 * and back fabric pairs plus hardware) and Details with the live price.
 * Controlled — every edit goes through `onChange` with a whole new draft;
 * `footer` is the host's save/cancel row, rendered last. Resolved by
 * `getBlindForm('Dual Shades')`.
 */
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
