// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Line-item edit-form components.
 *
 * The old inline BlindItemCard / FlatItemCard have been replaced by
 * BlindEditForm and FlatEditForm which live inside popup modals rather
 * than expanded inline in the page.  BulkEditForm lets the user change
 * only material, cassette, bottom rail, control and installation across
 * the selected blind items without touching any measurement or quantity
 * field. It is scoped to ONE blind type — the caller only opens it for a
 * selection that shares a type — so it renders and filters its options
 * exactly like the per-item form.
 *
 * `BlindEditForm` is now only a dispatcher: the blind markup lives in
 * `./blindForms/`, one file per type, so a type's layout can change
 * without touching any other type. Shared controls are in
 * `./blindForms/fields.tsx`.
 *
 * The draft models and every pure function over them live in
 * `./lineItemDrafts.ts`, deliberately apart: this file exports only
 * components, which is what lets React Fast Refresh hot-swap a form edit
 * instead of reloading the page. Do not move plain functions back in
 * here. Forms read and write draft STRINGS and never parse — the two
 * conversion points are `parseDraftAttributes` and the payload builder.
 *
 * Every container and control here carries `min-w-0`, deliberately. A
 * `<select>`'s min-content width is the width of its LONGEST option, and
 * grid/flex children default to `min-width: auto` — so one catalog entry
 * named "Blackout Premium Charcoal 3000" is enough to push a column, and
 * then the whole popup, past the edge of a phone screen. `min-w-0` lets
 * the control shrink and clip its own label instead. Do not remove it
 * when editing these forms.
 */

import { getBlindForm } from './blindForms';
import { INPUT, LABEL, OptionSelect, type BlindFormProps } from './blindForms/fields';
import { PriceBlock } from './blindForms/PriceBlock';
import {
  canOverridePrice,
  flatDraftPrice,
  materialsForType,
  optionsForType,
  slotsForType,
  type Catalogs,
  type FlatDraft,
} from './lineItemDrafts';
import type { BulkEditState } from './lineItemBulk';

/* ------------------------------------------------------------------ */
/* Edit forms (used inside popup modals)                               */
/* ------------------------------------------------------------------ */

/**
 * Blind editing form — a DISPATCHER, not a layout.
 *
 * Resolves the draft's blind type to that type's own form component and
 * renders it. Every type owns its fields and their order in
 * `./blindForms/<Type>Form.tsx`; unknown and legacy free-text types fall
 * back to `DefaultForm`.
 *
 * The props are unchanged from when this component held the markup, so
 * hosts (OrderDetail's edit popup) are unaffected by the split.
 */
export function BlindEditForm({ draft, catalogs, onChange, footer }: BlindFormProps) {
  const Form = getBlindForm(draft.blinds_type);
  return <Form draft={draft} catalogs={catalogs} onChange={onChange} footer={footer} />;
}

/**
 * Full preset/custom editing form.
 *
 * A preset carrying catalog provenance shows its price READ-ONLY: the
 * Worker prices it from `preset_line_items`, so a figure typed here would
 * be ignored on save and the field would be lying. Changing such a price
 * is what the override inside `PriceBlock` is for.
 */
export function FlatEditForm({
  draft,
  onChange,
}: {
  draft: FlatDraft;
  onChange: (next: FlatDraft) => void;
}) {
  const price = flatDraftPrice(draft);
  const fromCatalog = draft.item_type === 'preset' && draft.preset_id !== null;
  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      <label className="block min-w-0">
        <span className={LABEL}>Title</span>
        <input
          placeholder="Title"
          value={draft.title}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
          className={INPUT}
        />
      </label>
      <label className="block min-w-0">
        <span className={LABEL}>Description</span>
        {/*
          A textarea, not an input: the description prints as separate
          lines on the estimate, the customer page and the manufacturer
          copy, so the consultant has to be able to see and type those
          line breaks while writing it.
        */}
        <textarea
          rows={4}
          placeholder="Description — one line per point"
          value={draft.description}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
          className="w-full min-w-0 rounded-md border border-border-input bg-surface px-3 py-2 text-sm text-text-primary"
        />
      </label>
      <div className="grid min-w-0 grid-cols-2 gap-3.5">
        <label className="min-w-0">
          <span className={LABEL}>Quantity</span>
          <input
            inputMode="numeric"
            value={draft.quantity}
            onChange={(e) => onChange({ ...draft, quantity: e.target.value })}
            className={`${INPUT} font-mono`}
          />
        </label>
        <label className="min-w-0">
          <span className={LABEL}>Unit price ($)</span>
          <input
            inputMode="decimal"
            readOnly={fromCatalog}
            value={draft.unit_price}
            onChange={(e) => onChange({ ...draft, unit_price: e.target.value })}
            className={`${INPUT} font-mono ${fromCatalog ? 'bg-surface-sunken text-text-muted' : ''}`}
          />
        </label>
      </div>
      <PriceBlock
        price={price}
        adjustments={draft}
        canOverride={canOverridePrice(draft)}
        onChange={(adj) => onChange({ ...draft, ...adj })}
      />
    </div>
  );
}

/**
 * Bulk-edit form.
 *
 * `blindsType` is the ONE type every selected item currently shares — the
 * caller has already refused a mixed or non-blind selection
 * (`bulkEditSelection`). The form's own Blind type dropdown (ACTIVE types
 * only) lets the consultant additionally MOVE the whole selection onto a
 * different type; while `state.blinds_type` is empty the form renders
 * exactly what it always has for `blindsType`, and once a new type is
 * chosen every option control below re-scopes to it instead:
 *
 * - Materials are the ones LINKED to the effective type (`materialsForType`).
 * - A hardware dropdown appears only when the effective type uses that
 *   slot (`slotsForType`) and lists only the options scoped to it
 *   (`optionsForType`) — the same rule the Worker validates the save
 *   against, so a bulk edit can never write an id the server rejects.
 *
 * A type with no hardware scoped to it (Curtains has neither cassette nor
 * bottom rail) renders those dropdowns not at all rather than greyed out:
 * a control that can only be a no-op is noise on a phone screen.
 *
 * The intro explains that choosing a blind type resets each touched
 * item's options to that type's saved defaults before anything else here
 * applies, and that applying clears a manual price override on an item
 * ONLY when the change actually feeds its price — a new type, material or
 * hardware slot (`applyBulkPatch`), never a colour-only change — the
 * consultant has to know before choosing, because an override is usually
 * a figure they quoted.
 */
export function BulkEditForm({
  state,
  catalogs,
  blindsType,
  onChange,
}: {
  state: BulkEditState;
  catalogs: Catalogs;
  blindsType: string;
  onChange: (next: BulkEditState) => void;
}) {
  // The type option controls scope to: the one just picked in this form,
  // else the type the whole selection already shares.
  const effectiveType = state.blinds_type || blindsType;
  const uses = slotsForType(catalogs, effectiveType);
  const forType = <T extends { active: boolean; blind_type_ids: string[] }>(list: T[]) =>
    optionsForType(list, catalogs.blindTypes, effectiveType);
  const materials = materialsForType(catalogs, effectiveType);
  const activeTypes = catalogs.blindTypes.filter((t) => t.active);
  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      <p className="text-[13px] text-text-muted">
        Only the selected fields will be changed; leave one on "No change" to keep each item's
        current value. Choosing a blind type resets each item's options to that type's defaults
        before anything else here is applied. Changing the type, material or a hardware option
        on an item also <span className="font-medium text-text-secondary">clears</span> any
        manual price override on it, so it prices from the new options — a colour-only change
        never touches an override.
      </p>
      <div className="grid min-w-0 grid-cols-1 gap-3.5 sm:grid-cols-2">
        <label className="min-w-0">
          <span className={LABEL}>Blind type</span>
          <select
            value={state.blinds_type}
            onChange={(e) => onChange({ ...state, blinds_type: e.target.value })}
            className={INPUT}
          >
            <option value="">No change</option>
            {activeTypes.map((t) => (
              <option key={t.id} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <span className={LABEL}>Color</span>
          <input
            placeholder="No change"
            value={state.color}
            onChange={(e) => onChange({ ...state, color: e.target.value })}
            className={INPUT}
          />
        </label>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <OptionSelect
          label="Material"
          value={state.material_id}
          onChange={(id) => onChange({ ...state, material_id: id })}
          options={materials}
          placeholder="No change"
        />
        {uses.has('cassette') && (
          <OptionSelect
            label="Cassette"
            value={state.cassette_id}
            onChange={(id) => onChange({ ...state, cassette_id: id })}
            options={forType(catalogs.cassettes)}
            placeholder="No change"
          />
        )}
        {uses.has('bottom_rail') && (
          <OptionSelect
            label="Bottom rail"
            value={state.bottom_rail_id}
            onChange={(id) => onChange({ ...state, bottom_rail_id: id })}
            options={forType(catalogs.bottomRails)}
            placeholder="No change"
          />
        )}
        {uses.has('control') && (
          <OptionSelect
            label="Control"
            value={state.control_id}
            onChange={(id) => onChange({ ...state, control_id: id })}
            options={forType(catalogs.controls)}
            placeholder="No change"
          />
        )}
        {uses.has('installation') && (
          <OptionSelect
            label="Installation"
            value={state.installation_id}
            onChange={(id) => onChange({ ...state, installation_id: id })}
            options={forType(catalogs.installationOptions)}
            placeholder="No change"
          />
        )}
      </div>
      {materials.length === 0 && uses.size === 0 && (
        <p className="text-[13px] text-text-muted">
          No materials or options are set up for {effectiveType || 'this blind type'} — add them
          under Settings first.
        </p>
      )}
    </div>
  );
}
