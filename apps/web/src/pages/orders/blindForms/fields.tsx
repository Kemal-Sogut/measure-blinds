// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Shared field components for the per-type blind forms.
 *
 * Each blind type owns its own form file (`./<Type>Form.tsx`) and composes
 * these in whatever order suits it — that is the whole point of the split.
 * Anything a type is likely to reuse belongs here; anything peculiar to one
 * type belongs in that type's file.
 *
 * Every component takes `draft` + `onChange` and nothing else it does not
 * need, so a form can drop or reorder fields without rewiring state. They
 * read and write draft STRINGS only and never parse — the two conversion
 * points are `parseDraftAttributes` and the payload builder in OrderDetail.
 *
 * Every container and control here carries `min-w-0`, deliberately. A
 * `<select>`'s min-content width is the width of its LONGEST option, and
 * grid/flex children default to `min-width: auto` — so one catalog entry
 * named "Blackout Premium Charcoal 3000" is enough to push a column, and
 * then the whole popup, past the edge of a phone screen. `min-w-0` lets
 * the control shrink and clip its own label instead. Do not remove it.
 */

import type { ReactNode } from 'react';
import {
  applyTypeDefaults,
  materialsForType,
  optionsForType,
  parsePositive,
  slotsForType,
  type BlindDraft,
  type Catalogs,
} from '../lineItemDrafts';
import { clearPriceOverride } from '../lineItemBulk';

/* ------------------------------------------------------------------ */
/* Tokens                                                              */
/* ------------------------------------------------------------------ */

/**
 * Every input token EXCEPT a width, for the rare control whose width
 * comes from its container instead — a grid track or a flex `flex-1`.
 *
 * Composing `INPUT` with another width class does NOT work: both are
 * width utilities of equal specificity, so which one applies is decided
 * by their order in the generated stylesheet, not by the order they were
 * written in the class attribute. Reach for this instead.
 */
export const INPUT_BASE =
  'h-11 min-w-0 rounded-md border border-border-input bg-surface px-3 text-sm text-text-primary';
export const INPUT = `${INPUT_BASE} w-full`;
export const LABEL = 'mb-1.5 block text-xs font-medium text-text-secondary';

/** Props every per-type blind form receives. */
export interface BlindFormProps {
  draft: BlindDraft;
  catalogs: Catalogs;
  onChange: (next: BlindDraft) => void;
  /** Action buttons rendered at the bottom of the Details section. */
  footer?: ReactNode;
}

/** The shape `getBlindForm` resolves to. */
export type BlindFormComponent = (props: BlindFormProps) => ReactNode;

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

/**
 * One titled block of the blind popup (Basics / Options / Details).
 *
 * Purely presentational: it renders a small uppercase caption above a
 * vertical stack of fields. Consecutive sections are separated by
 * `<FormSplitter />` rather than by borders on the section itself, so a
 * section can be reordered or dropped without leaving a stray rule.
 */
export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Hairline rule between two form sections, drawn in the neutral
 * `border-light` token (the same tone used for rows inside a card) so it
 * reads as a natural pause rather than a second card edge.
 */
export function FormSplitter() {
  return <hr className="border-0 border-t border-border-light" />;
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

/** Native select bound to active catalog options. */
export function OptionSelect({
  label,
  value,
  onChange,
  options,
  placeholder = 'Select…',
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  options: { id: string; name: string; active: boolean }[];
  placeholder?: string;
}) {
  return (
    <label className="min-w-0 flex-1">
      <span className={LABEL}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={INPUT}>
        <option value="">{placeholder}</option>
        {options
          .filter((o) => o.active || o.id === value)
          .map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
      </select>
    </label>
  );
}

/**
 * Blind-type dropdown. Offers the active types, plus the current value
 * when it is inactive or a legacy free-text entry not in the list, so an
 * old order never silently loses its type.
 *
 * Changing the type delegates to `applyTypeDefaults(draft, blinds_type,
 * catalogs, { keepValid: true })` — the same helper the bulk-edit and
 * bulk-add flows use, so the three cannot drift — which does three
 * clean-ups the caller must not have to remember, each of which would
 * otherwise be a 400 on save:
 *
 * 1. It sets Material and every hardware slot to the new type's SAVED
 *    defaults from Settings (`catalogs.defaults`) — UNLESS the current
 *    pick is still valid for the new type, in which case that deliberate
 *    choice survives instead of being overwritten (`keepValid: true`).
 * 2. It CLEARS every hardware id the new type does not use, per the
 *    SCOPING (`slotsForType`), not per any declaration on the type's
 *    module. Switching a Roller to Curtains would otherwise carry the
 *    cassette across, and the Worker rejects an id for a slot the type
 *    has no option scoped to.
 * 3. It RESEEDS `attributes` from the new type's `defaultAttributes()`.
 *    Without this the draft keeps the previous type's keys, which the new
 *    type's schema does not declare.
 * 4. It CLEARS a stale `unit_price_override` via `clearPriceOverride`
 *    (`../lineItemBulk`) — the same function `applyBulkPatch` uses for
 *    the identical rule on its own write path. A type change is
 *    unconditionally price-feeding (material and hardware are reset or
 *    re-scoped by step 1 above), so a hand-typed override set against the
 *    OLD options must not keep winning over the freshly recalculated
 *    price. This was the one cleanup missing before this function existed
 *    here — bulk edit already cleared it, this dropdown did not.
 */
export function BlindTypeSelect({ draft, catalogs, onChange }: BlindFormProps) {
  const typeInList = catalogs.blindTypes.some((t) => t.name === draft.blinds_type);
  return (
    <label className="block min-w-0">
      <span className={LABEL}>Blind type</span>
      <select
        value={draft.blinds_type}
        onChange={(e) =>
          onChange(
            clearPriceOverride(applyTypeDefaults(draft, e.target.value, catalogs, { keepValid: true }))
          )
        }
        className={INPUT}
      >
        <option value="">Select…</option>
        {draft.blinds_type && !typeInList && (
          <option value={draft.blinds_type}>{draft.blinds_type}</option>
        )}
        {catalogs.blindTypes
          .filter((t) => t.active || t.name === draft.blinds_type)
          .map((t) => (
            <option key={t.id} value={t.name}>
              {t.name}
            </option>
          ))}
      </select>
    </label>
  );
}

/** Free-text room label ("Living Room"). */
export function RoomField({ draft, onChange }: Pick<BlindFormProps, 'draft' | 'onChange'>) {
  return (
    <label>
      <span className={LABEL}>Room</span>
      <input
        placeholder="Living Room"
        value={draft.room_name}
        onChange={(e) => onChange({ ...draft, room_name: e.target.value })}
        className={INPUT}
      />
    </label>
  );
}

/**
 * The panel-width row: one input per panel (85% of the width), a running
 * total in the caption, a remove affordance on each panel once there is
 * more than one, and the "+ Panel" button (15%).
 *
 * The effective width of the blind is the SUM of the panels, which is why
 * the total is surfaced here rather than left for the user to add up.
 */
export function PanelWidths({ draft, onChange }: Pick<BlindFormProps, 'draft' | 'onChange'>) {
  const panelSum = draft.panels.reduce((a, p) => a + (parsePositive(p) ?? 0), 0);

  function setPanel(i: number, value: string) {
    const panels = draft.panels.slice();
    panels[i] = value;
    onChange({ ...draft, panels });
  }

  return (
    <div>
      <span className={LABEL}>
        Width (cm) — panels total:{' '}
        <span className="font-mono">{panelSum > 0 ? panelSum : '—'}</span>
      </span>
      <div className="mt-1 flex items-stretch gap-2">
        <div className="flex min-w-0 flex-1 gap-2">
          {draft.panels.map((p, i) => (
            <div key={i} className="relative min-w-0 flex-1">
              <input
                inputMode="decimal"
                value={p}
                onChange={(e) => setPanel(i, e.target.value)}
                className="h-11 w-full rounded-md border border-border-input bg-surface px-2 text-center font-mono text-sm"
                aria-label={`Panel ${i + 1} width`}
              />
              {draft.panels.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    onChange({ ...draft, panels: draft.panels.filter((_, j) => j !== i) })
                  }
                  aria-label={`Remove panel ${i + 1}`}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border-input bg-surface text-[10px] text-text-muted hover:text-danger"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onChange({ ...draft, panels: [...draft.panels, ''] })}
          className="h-11 w-[15%] shrink-0 rounded-sm border border-dashed border-border-input text-[13px] font-medium text-brand-600"
        >
          + Panel
        </button>
      </div>
    </div>
  );
}

/** Height measurement in cm. */
export function HeightField({ draft, onChange }: Pick<BlindFormProps, 'draft' | 'onChange'>) {
  return (
    <label>
      <span className={LABEL}>Height (cm)</span>
      <input
        inputMode="decimal"
        value={draft.height_cm}
        onChange={(e) => onChange({ ...draft, height_cm: e.target.value })}
        className={`${INPUT} font-mono`}
      />
    </label>
  );
}

/**
 * Material + Color on one row. Colour is free text with no price effect;
 * it is shown on the item, the PDF and the customer view. The Material
 * list is scoped to the selected blind type, so it reads as empty with a
 * "Pick a blind type first" hint until a type is chosen.
 */
export function MaterialAndColor({ draft, catalogs, onChange }: BlindFormProps) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3.5 sm:grid-cols-2">
      <OptionSelect
        label="Material"
        value={draft.material_id}
        onChange={(id) => onChange({ ...draft, material_id: id })}
        options={materialsForType(catalogs, draft.blinds_type)}
        placeholder={draft.blinds_type ? 'Select…' : 'Pick a blind type first'}
      />
      <label className="min-w-0">
        <span className={LABEL}>Color</span>
        <input
          placeholder="e.g. White, Oak, Charcoal"
          value={draft.color}
          onChange={(e) => onChange({ ...draft, color: e.target.value })}
          maxLength={100}
          className={INPUT}
        />
      </label>
    </div>
  );
}

/**
 * Cassette / Control / Bottom rail / Installation — the priced hardware
 * options.
 *
 * WHICH of them appear is decided in Settings, not here and not by the
 * blind type's module: a slot is rendered exactly when at least one
 * ACTIVE option is scoped to the selected type (`slotsForType`). A type
 * with nothing scoped renders nothing at all. The same rule decides what
 * the save requires, so the form can never offer — or omit — a choice the
 * Worker disagrees with.
 *
 * Each dropdown lists only the options scoped to that type, so a cassette
 * meant for Roller cannot be chosen on a Zebra. `OptionSelect` still
 * keeps a selected-but-no-longer-offered value visible, so re-opening an
 * old order never silently drops its hardware.
 */
export function HardwareRow({ draft, catalogs, onChange }: BlindFormProps) {
  const uses = slotsForType(catalogs, draft.blinds_type);
  if (uses.size === 0) return null;
  const forType = <T extends { active: boolean; blind_type_ids: string[] }>(list: T[]) =>
    optionsForType(list, catalogs.blindTypes, draft.blinds_type);
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
      {uses.has('cassette') && (
        <OptionSelect
          label="Cassette"
          value={draft.cassette_id}
          onChange={(id) => onChange({ ...draft, cassette_id: id })}
          options={forType(catalogs.cassettes)}
        />
      )}
      {uses.has('control') && (
        <OptionSelect
          label="Control"
          value={draft.control_id}
          onChange={(id) => onChange({ ...draft, control_id: id })}
          options={forType(catalogs.controls)}
        />
      )}
      {uses.has('bottom_rail') && (
        <OptionSelect
          label="Bottom rail"
          value={draft.bottom_rail_id}
          onChange={(id) => onChange({ ...draft, bottom_rail_id: id })}
          options={forType(catalogs.bottomRails)}
        />
      )}
      {uses.has('installation') && (
        <OptionSelect
          label="Installation"
          value={draft.installation_id}
          onChange={(id) => onChange({ ...draft, installation_id: id })}
          options={forType(catalogs.installationOptions)}
        />
      )}
    </div>
  );
}

/** Free-text note, shown to the customer under the item. */
export function NoteField({ draft, onChange }: Pick<BlindFormProps, 'draft' | 'onChange'>) {
  return (
    <label>
      <span className={LABEL}>Note</span>
      <textarea
        value={draft.note}
        onChange={(e) => onChange({ ...draft, note: e.target.value })}
        maxLength={1000}
        rows={2}
        placeholder="e.g. Inside mount, motor on the left"
        className="w-full rounded-md border border-border-input bg-surface px-3 py-2 text-sm text-text-primary"
      />
    </label>
  );
}

/** −/value/+ quantity stepper, floored at 1. */
export function QuantityStepper({ draft, onChange }: Pick<BlindFormProps, 'draft' | 'onChange'>) {
  const qty = parsePositive(draft.quantity) ?? 1;
  const stepBtn =
    'flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border-input bg-surface text-lg font-semibold text-text-secondary hover:bg-surface-sunken';

  function setQuantity(next: number) {
    onChange({ ...draft, quantity: String(Math.max(1, next)) });
  }

  return (
    <div>
      <span className={LABEL}>Quantity</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setQuantity(Math.floor(qty) - 1)}
          aria-label="Decrease quantity"
          className={stepBtn}
        >
          −
        </button>
        <input
          inputMode="numeric"
          value={draft.quantity}
          onChange={(e) => onChange({ ...draft, quantity: e.target.value })}
          aria-label="Quantity"
          className="h-11 w-16 rounded-md border border-border-input bg-surface px-2 text-center font-mono text-sm"
        />
        <button
          type="button"
          onClick={() => setQuantity(Math.floor(qty) + 1)}
          aria-label="Increase quantity"
          className={stepBtn}
        >
          +
        </button>
      </div>
    </div>
  );
}

/**
 * One labelled text input bound to a single attribute key — the building
 * block for a blind type's own inputs.
 *
 * Reads and writes the draft's RAW STRING; the value is typed later, once,
 * by `parseDraftAttributes`. `suffix` renders a unit hint ("cm", "mm") in
 * the label rather than in the value, so nothing has to be stripped back
 * off before parsing.
 *
 * The key must also be declared in that type's `attributeSchema`
 * (`lib/blindTypes/<type>.ts`) or the save is rejected with a 400 — the
 * schema is the contract, this is only the input.
 */
export function AttributeText({
  draft,
  onChange,
  attrKey,
  label,
  placeholder,
  suffix,
}: Pick<BlindFormProps, 'draft' | 'onChange'> & {
  attrKey: string;
  label: string;
  placeholder?: string;
  suffix?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className={LABEL}>{suffix ? `${label} (${suffix})` : label}</span>
      <input
        inputMode="decimal"
        placeholder={placeholder}
        value={draft.attributes[attrKey] ?? ''}
        onChange={(e) =>
          onChange({ ...draft, attributes: { ...draft.attributes, [attrKey]: e.target.value } })
        }
        className={`${INPUT} font-mono`}
      />
    </label>
  );
}

/**
 * Catalog-backed dropdown bound to one attribute key — the sibling of
 * `AttributeText` for a value that comes from a settings list rather
 * than the keyboard.
 *
 * Writes the chosen row's ID into the draft, never its price. The Worker
 * resolves that id against the catalog itself and snapshots the name and
 * value (see the blind type's `catalogRefs`), which is what keeps pricing
 * server-authoritative even when the value is a multiplier.
 *
 * `attrKey` MUST be a key the type's `attributeSchema` declares, or the
 * save is rejected with a 400.
 */
export function AttributeSelect({
  draft,
  onChange,
  attrKey,
  label,
  options,
  placeholder,
}: Pick<BlindFormProps, 'draft' | 'onChange'> & {
  attrKey: string;
  label: string;
  options: { id: string; name: string; active: boolean }[];
  placeholder?: string;
}) {
  return (
    <OptionSelect
      label={label}
      value={draft.attributes[attrKey] ?? ''}
      onChange={(id) => onChange({ ...draft, attributes: { ...draft.attributes, [attrKey]: id } })}
      options={options}
      placeholder={placeholder}
    />
  );
}
