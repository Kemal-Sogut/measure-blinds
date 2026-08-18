// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * "Default Options" settings page (`/settings/defaults`) — where the
 * per-blind-type starting picks consumed by `applyTypeDefaults` are
 * chosen.
 *
 * One card per ACTIVE blind type, each holding a Material select plus one
 * `OptionSelect` per hardware slot (Cassette / Control / Bottom rail /
 * Installation) that type actually uses. A field is rendered ONLY when it
 * has at least one option to offer — Material via `materialsForType`,
 * each hardware slot via `slotsForType`/`optionsForType` — the identical
 * scoping rule the order form's `HardwareRow`/`MaterialAndColor` render
 * from, so this page can never offer a pick the order form (or the
 * Worker's own validation) would refuse. A type with NOTHING scoped at
 * all shows a muted explanation instead of an empty-looking card.
 *
 * Every change PUTs the FULL row immediately via
 * `useUpdateBlindTypeDefaults` — the API replaces the whole row, so a
 * partial payload would silently clear every field this page omits. The
 * `''` "No default" placeholder value is converted to `null` in exactly
 * one place, `toPatch`, and every save routes through it. The mutation is
 * intentionally NOT optimistic (see its own JSDoc), so each card disables
 * its own fields (via a native `<fieldset disabled>`, no change needed to
 * the shared `OptionSelect`) while ITS save is in flight — without that, a
 * second edit fired before the first PUT's refetch lands would compute its
 * full-row patch from the stale pre-edit row and silently revert the first
 * change.
 */

import toast from 'react-hot-toast';
import PageHeader from '../../components/PageHeader';
import { OptionSelect } from '../orders/blindForms/fields';
import { materialsForType, optionsForType, slotsForType, type Catalogs } from '../orders/lineItemDrafts';
import {
  useBlindTypeDefaults,
  useCatalogList,
  useUpdateBlindTypeDefaults,
} from '../../hooks/useSettings';
import type { CatalogSlot } from '../../lib/blindTypes/base';
import type {
  BlindType,
  BottomRailOption,
  CassetteOption,
  ControlOption,
  InstallationOption,
  Material,
  BlindTypeDefaults as BlindTypeDefaultsRow,
} from '../../types';

/**
 * All-string mirror of a saved defaults row's five option fields, `''`
 * meaning "no default" — the shape every `OptionSelect` on this page
 * reads and writes. Kept separate from `BlindTypeDefaultsRow` (whose
 * fields are `string | null`) for the same reason every other draft in
 * this app is string-typed: a `<select>` cannot bind to `null`.
 */
interface DefaultsDraft {
  material_id: string;
  cassette_id: string;
  bottom_rail_id: string;
  control_id: string;
  installation_id: string;
}

/** A blank draft — every slot unset. Used when a type has no saved row yet. */
const EMPTY_DRAFT: DefaultsDraft = {
  material_id: '',
  cassette_id: '',
  bottom_rail_id: '',
  control_id: '',
  installation_id: '',
};

/**
 * Converts a saved row (or `undefined`, for a type that has never had
 * defaults saved) into the all-string shape this page's selects bind to.
 * Mirrors `BlindTypeDefaults`'s own doc: a missing row and an all-null row
 * are treated identically, so both resolve to `EMPTY_DRAFT`.
 */
function rowToDraft(row: BlindTypeDefaultsRow | undefined): DefaultsDraft {
  if (!row) return EMPTY_DRAFT;
  return {
    material_id: row.material_id ?? '',
    cassette_id: row.cassette_id ?? '',
    bottom_rail_id: row.bottom_rail_id ?? '',
    control_id: row.control_id ?? '',
    installation_id: row.installation_id ?? '',
  };
}

/**
 * Converts a `DefaultsDraft` into the PUT payload the API expects, where
 * "no default" is `null` rather than `''`. This is the ONLY place that
 * conversion happens on this page — every save (see `BlindTypeDefaultsCard`)
 * builds its full-row patch by calling this on a `DefaultsDraft`, so the
 * `''` → `null` rule cannot drift between the five fields or between cards.
 */
function toPatch(draft: DefaultsDraft): Omit<BlindTypeDefaultsRow, 'blind_type_id'> {
  const toNull = (value: string): string | null => (value === '' ? null : value);
  return {
    material_id: toNull(draft.material_id),
    cassette_id: toNull(draft.cassette_id),
    bottom_rail_id: toNull(draft.bottom_rail_id),
    control_id: toNull(draft.control_id),
    installation_id: toNull(draft.installation_id),
  };
}

/**
 * Minimal shape shared by all four hardware catalogs — enough for
 * `optionsForType`'s constraint and for `OptionSelect`'s `options` prop.
 * `hardwareCatalog` returns this rather than a per-slot union so the card
 * component can look the right list up in one line without a switch of
 * its own.
 */
type ScopedOption = { id: string; name: string; active: boolean; blind_type_ids: string[] };

/**
 * The one hardware catalog list a slot reads from, matching the four
 * `CatalogSlot` members `slotsForType` can return. The switch is
 * exhaustive over that union (TS would flag a missing case as "not all
 * code paths return a value"), so a fifth slot added later fails the
 * build here rather than silently falling through to `undefined`.
 */
function hardwareCatalog(catalogs: Catalogs, slot: CatalogSlot): ScopedOption[] {
  switch (slot) {
    case 'cassette':
      return catalogs.cassettes;
    case 'bottom_rail':
      return catalogs.bottomRails;
    case 'control':
      return catalogs.controls;
    case 'installation':
      return catalogs.installationOptions;
  }
}

/**
 * The four hardware slots in the same display order as the order form's
 * `HardwareRow`, paired with the `DefaultsDraft` field each one edits and
 * the label its `OptionSelect` shows. A single source for that pairing so
 * the slot enum, the draft field name and the visible label cannot drift
 * apart as fields are added or reordered.
 */
const HARDWARE_SLOTS: { slot: CatalogSlot; field: keyof DefaultsDraft; label: string }[] = [
  { slot: 'cassette', field: 'cassette_id', label: 'Cassette' },
  { slot: 'control', field: 'control_id', label: 'Control' },
  { slot: 'bottom_rail', field: 'bottom_rail_id', label: 'Bottom rail' },
  { slot: 'installation', field: 'installation_id', label: 'Installation' },
];

/**
 * One blind type's card: a Material select plus every hardware slot the
 * type uses, each bound to its saved default and saving the FULL row on
 * every change.
 *
 * A field renders only when it has something to offer — Material when
 * `materialsForType` is non-empty, a hardware slot when `slotsForType`
 * includes it — exactly mirroring the order form's own scoping so this
 * page never shows a pick the order form (or the Worker) would refuse.
 * When NEITHER Material nor any hardware slot has anything scoped, the
 * card shows a muted explanation instead of an otherwise-empty shell.
 *
 * `saving` disables every field in the card (via a `<fieldset>`, so
 * `OptionSelect` itself needs no `disabled` prop) while this card's own
 * PUT is in flight — see the module doc for why that matters given the
 * non-optimistic, full-row-replace mutation.
 */
function BlindTypeDefaultsCard({
  type,
  catalogs,
  row,
  saving,
  onSave,
}: {
  type: BlindType;
  catalogs: Catalogs;
  row: BlindTypeDefaultsRow | undefined;
  saving: boolean;
  onSave: (patch: Omit<BlindTypeDefaultsRow, 'blind_type_id'>) => void;
}) {
  const draft = rowToDraft(row);
  const materials = materialsForType(catalogs, type.name);
  const slots = slotsForType(catalogs, type.name);
  const hasMaterial = materials.length > 0;
  const visibleSlots = HARDWARE_SLOTS.filter(({ slot }) => slots.has(slot));

  /**
   * Handles one `OptionSelect`'s `onChange`: merges the new value into
   * this card's CURRENT draft (every other field unchanged), converts the
   * result through `toPatch`, and hands the full-row patch up to
   * `onSave`. Reads `draft` from the render closure rather than fresh
   * state, which is exactly why `saving` must gate a second edit before
   * this one's PUT has resolved — see the module doc.
   */
  function set(field: keyof DefaultsDraft, value: string) {
    onSave(toPatch({ ...draft, [field]: value }));
  }

  return (
    <section className="rounded-xl border border-border-light bg-surface shadow-md p-4">
      <h2 className="mb-3 text-[15px] font-bold text-text-primary">{type.name}</h2>
      {!hasMaterial && visibleSlots.length === 0 ? (
        <p className="text-sm text-text-muted">
          No options are scoped to this blind type yet — scope options in their catalog pages first.
        </p>
      ) : (
        <fieldset disabled={saving} className="contents">
          <div className="flex flex-col gap-3.5">
            {hasMaterial && (
              <OptionSelect
                label="Material"
                value={draft.material_id}
                onChange={(id) => set('material_id', id)}
                options={materials}
                placeholder="No default"
              />
            )}
            {visibleSlots.map(({ slot, field, label }) => (
              <OptionSelect
                key={slot}
                label={label}
                value={draft[field]}
                onChange={(id) => set(field, id)}
                options={optionsForType(hardwareCatalog(catalogs, slot), catalogs.blindTypes, type.name)}
                placeholder="No default"
              />
            ))}
          </div>
        </fieldset>
      )}
    </section>
  );
}

/**
 * "Default Options" settings page. Fetches every catalog the scoping
 * helpers need plus the saved defaults rows, assembles the local
 * `Catalogs` object those helpers expect (`pleatTypes: []` — pleat types
 * are not part of defaults), and renders one `BlindTypeDefaultsCard` per
 * ACTIVE blind type.
 *
 * A rejected save (the API 400s a default that is not an active option
 * scoped to that type) is surfaced verbatim via `react-hot-toast`, the
 * same pattern every other settings page uses for its own mutations —
 * never swallowed, so a stale/unlinked id is visible immediately rather
 * than silently failing to save.
 */
export default function BlindTypeDefaults() {
  const { data: blindTypes, isLoading: typesLoading, error: typesError } =
    useCatalogList<BlindType>('blind-types');
  const { data: materials, isLoading: materialsLoading, error: materialsError } =
    useCatalogList<Material>('materials');
  const { data: cassettes, isLoading: cassettesLoading, error: cassettesError } =
    useCatalogList<CassetteOption>('cassette-options');
  const { data: bottomRails, isLoading: bottomRailsLoading, error: bottomRailsError } =
    useCatalogList<BottomRailOption>('bottom-rail-options');
  const { data: controls, isLoading: controlsLoading, error: controlsError } =
    useCatalogList<ControlOption>('control-options');
  const { data: installationOptions, isLoading: installationLoading, error: installationError } =
    useCatalogList<InstallationOption>('installation-options');
  const { data: defaultsRows, isLoading: defaultsLoading, error: defaultsError } =
    useBlindTypeDefaults();
  const update = useUpdateBlindTypeDefaults();

  const isLoading =
    typesLoading ||
    materialsLoading ||
    cassettesLoading ||
    bottomRailsLoading ||
    controlsLoading ||
    installationLoading ||
    defaultsLoading;
  const error =
    typesError ?? materialsError ?? cassettesError ?? bottomRailsError ?? controlsError ??
    installationError ?? defaultsError;

  const catalogs: Catalogs = {
    materials: materials ?? [],
    cassettes: cassettes ?? [],
    bottomRails: bottomRails ?? [],
    controls: controls ?? [],
    blindTypes: blindTypes ?? [],
    pleatTypes: [],
    installationOptions: installationOptions ?? [],
    defaults: defaultsRows ?? [],
  };
  const activeTypes = catalogs.blindTypes.filter((t) => t.active);

  /**
   * Fires one card's full-row PUT via `useUpdateBlindTypeDefaults`. Not
   * optimistic (see that hook's own JSDoc), so the card stays showing its
   * pre-edit value — now disabled via `saving` — until the mutation
   * settles and the list is refetched. `onError` surfaces the Worker's
   * message verbatim (e.g. "Cassette default is not offered for this
   * blind type.") via toast rather than swallowing it, so a rejected id
   * is obvious immediately instead of looking like a save that silently
   * did nothing.
   */
  function handleSave(blindTypeId: string, patch: Omit<BlindTypeDefaultsRow, 'blind_type_id'>) {
    update.mutate({ blindTypeId, patch }, { onError: (e) => toast.error(e.message) });
  }

  return (
    <div className="min-h-screen bg-surface-muted">
      <PageHeader title="Default Options" backTo="/settings" />
      <div className="page-container py-4 md:py-6 [--page-max:48rem]">
        <p className="mb-4 text-sm text-text-muted">
          Pick the Material and hardware each blind type starts with when its type is chosen on an
          order. Leave a field on "No default" to start it blank.
        </p>

        {isLoading && <p className="p-4 text-text-muted">Loading…</p>}
        {error && <p className="p-4 text-danger">{error.message}</p>}
        {!isLoading && !error && activeTypes.length === 0 && (
          <p className="text-center text-text-muted">
            No active blind types yet — add one under Materials first.
          </p>
        )}

        <div className="flex flex-col gap-3">
          {activeTypes.map((type) => (
            <BlindTypeDefaultsCard
              key={type.id}
              type={type}
              catalogs={catalogs}
              row={catalogs.defaults.find((d) => d.blind_type_id === type.id)}
              saving={update.isPending && update.variables?.blindTypeId === type.id}
              onSave={(patch) => handleSave(type.id, patch)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
