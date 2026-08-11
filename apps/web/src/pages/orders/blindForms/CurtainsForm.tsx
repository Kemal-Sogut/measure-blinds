// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Curtains blind form — the first per-type form to diverge from
 * `DefaultForm`.
 *
 * The only structural difference left is the Pleat picker. Curtains has
 * no cassette and no bottom rail, but nothing here says so: `HardwareRow`
 * renders whichever slots Settings has scoped to the selected type
 * (migration 35), so linking a cassette to Curtains would make one appear
 * without touching this file. Installation used to be a Curtains-only
 * attribute and is now one of those scoped slots.
 *
 * The Pleat select writes only a catalog ROW ID into the draft. The
 * Worker resolves the multiplier itself, which is why no number appears
 * anywhere in this file.
 *
 * The `attrKey` below is declared in `lib/blindTypes/curtains.ts`. Adding
 * an input here without declaring it there is a 400 on save.
 *
 * Height is still collected: it is a manufacturing measurement that
 * reaches the manufacturer copy, and it does NOT enter the price.
 */

import {
  AttributeSelect,
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

export default function CurtainsForm({ draft, catalogs, onChange, footer }: BlindFormProps) {
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
        <AttributeSelect
          draft={draft}
          onChange={onChange}
          attrKey="pleat_type_id"
          label="Pleat"
          options={catalogs.pleatTypes}
        />
        <HardwareRow draft={draft} catalogs={catalogs} onChange={onChange} />
      </FormSection>

      <FormSplitter />

      {/* ── 3. Details ──────────────────────────────────────────────── */}
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
