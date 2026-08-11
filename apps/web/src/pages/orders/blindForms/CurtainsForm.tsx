// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Curtains blind form — the first per-type form to diverge from
 * `DefaultForm`.
 *
 * Curtains have no cassette and no bottom rail, so `HardwareRow` is
 * replaced by a row of Installation / Pleat / Control. Dropping those two
 * pickers is safe because `lib/blindTypes/curtains.ts` declares
 * `requiredCatalogs = ['control']`: the save guard, the price preview and
 * the Worker all read that same declaration, so none of them waits on a
 * cassette this type does not have.
 *
 * The two new selects write only a catalog ROW ID into the draft. The
 * Worker resolves the pleat multiplier and the installation charge
 * itself, which is why neither number appears anywhere in this file.
 *
 * Both `attrKey` values below are declared in
 * `lib/blindTypes/curtains.ts`. Adding an input here without declaring it
 * there is a 400 on save.
 *
 * Height is still collected: it is a manufacturing measurement that
 * reaches the manufacturer copy, and it does NOT enter the price.
 */

import {
  AttributeSelect,
  BlindTypeSelect,
  FormSection,
  FormSplitter,
  HeightField,
  MaterialAndColor,
  NoteField,
  OptionSelect,
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
        <div className="grid min-w-0 grid-cols-1 gap-3.5 sm:grid-cols-3">
          <AttributeSelect
            draft={draft}
            onChange={onChange}
            attrKey="installation_id"
            label="Installation"
            options={catalogs.installationOptions}
          />
          <AttributeSelect
            draft={draft}
            onChange={onChange}
            attrKey="pleat_type_id"
            label="Pleat"
            options={catalogs.pleatTypes}
          />
          <OptionSelect
            label="Control"
            value={draft.control_id}
            onChange={(id) => onChange({ ...draft, control_id: id })}
            options={catalogs.controls}
          />
        </div>
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
