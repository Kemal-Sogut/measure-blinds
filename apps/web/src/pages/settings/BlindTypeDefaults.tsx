// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * "Default Options" settings page (`/settings/defaults`) — where the
 * per-blind-type starting picks consumed by `applyTypeDefaults` are
 * chosen.
 *
 * One card per ACTIVE blind type. The Material select is ALWAYS present —
 * disabled with an explanatory placeholder when nothing is scoped —
 * mirroring `MaterialAndColor` in the order form, which never hides
 * Material either, only relabels its placeholder. Each hardware slot
 * (Cassette / Control / Bottom rail / Installation) renders only when
 * `slotsForType` says the type uses it, mirroring `HardwareRow`, which
 * hides itself the same way. A type with NOTHING scoped anywhere (no
 * Material, no hardware slot) additionally shows a muted explanation
 * below its (disabled) Material select.
 *
 * Every change PUTs the FULL row immediately via
 * `useUpdateBlindTypeDefaults` — the API replaces the whole row, so a
 * partial payload would silently clear every field this page omits. Two
 * conversions guard every save, both applied in order:
 *
 * 1. `sanitizeDraftForType` clears any field that is no longer a valid
 *    pick for the type UNDER THE CURRENT CATALOGS, not just whatever the
 *    in-memory draft happens to hold. A saved default can go stale
 *    without this page ever touching it: another settings page can
 *    deactivate or unlink the option it points at, at which point the
 *    card stops RENDERING that field (the same scoping rule that decided
 *    to render it), but the draft still carries the old id. Applied both
 *    when building `draft` (so the UI never shows a value that no longer
 *    matches anything selectable) and again before every save (cheap and
 *    idempotent when nothing changed) — without the second application, a
 *    card could become permanently unsavable: `toPatch` always resends
 *    every field, so the stale id would 400 forever with no field left to
 *    clear it from.
 * 2. `toPatch` converts the sanitized draft's `''` ("no default") into
 *    `null`, the API's spelling for the same thing.
 *
 * The mutation is intentionally NOT optimistic (see its own JSDoc), so
 * `BlindTypeDefaultsCard.set` tracks, per card, which FIELDS have an
 * unconfirmed save in flight (`pendingWrites`) and folds those into every
 * new patch it builds via `nextDraftForSave`, instead of computing a patch
 * from only the render closure's (possibly stale) `draft`. That merge is
 * what actually closes the race a naive "read `draft`, patch one field"
 * implementation would have: without it, editing field B while field A's
 * PUT is still in flight would compute B's full-row patch from the
 * PRE-edit value of A and silently revert A the moment B's PUT lands —
 * A's own edit is never lost even though B's request may resolve first.
 * `set` unconditionally drops a field from `pendingWrites` once ITS OWN
 * save settles — success or failure — so a rejected pick cannot go on
 * contaminating saves fired for OTHER fields afterward; see
 * `nextDraftForSave`'s JSDoc for the exact guarantee and its one
 * acknowledged limit (a save already in flight for another field when the
 * rejection lands cannot be un-sent). Each field ALSO disables itself (via
 * its own `<fieldset>` — no `disabled` prop was added to the shared
 * `OptionSelect`) while its OWN save is in flight; that lock is narrower
 * than `pendingWrites` and exists only to stop a second edit to the SAME
 * field from firing before the first settles, which could otherwise
 * complete out of order and leave a value the user did not pick last.
 * Locking is therefore per-field, not per-card — the natural workflow on a
 * phone is picking several fields on one card in quick succession, and
 * nothing about the race requires blocking that.
 */

import { useState } from 'react';
import toast from 'react-hot-toast';
import PageHeader from '../../components/PageHeader';
import { materialsForType, optionsForType, slotsForType, type Catalogs } from '../orders/lineItemDrafts';
import { OptionSelect } from '../orders/blindForms/fields';
import { nextDraftForSave, sanitizeDraftForType, type DefaultsDraft } from './blindTypeDefaultsDraft';
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
 * builds its full-row patch by calling this on an already-sanitized
 * `DefaultsDraft`, so the `''` → `null` rule cannot drift between the five
 * fields or between cards.
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
 * One blind type's card: a Material select (always present) plus every
 * hardware slot the type uses, each bound to its saved default and saving
 * the FULL row on every change.
 *
 * Material is unconditionally rendered — disabled, with a placeholder
 * explaining why, when `materialsForType` is empty — mirroring
 * `MaterialAndColor`'s own never-hide behaviour in the order form. Each
 * hardware slot renders only when `slotsForType` includes it, mirroring
 * `HardwareRow`, which hides itself the same way. When NEITHER Material
 * nor any hardware slot has anything scoped, a muted explanation appears
 * below the (disabled) Material select — see the module doc for why the
 * Material select itself is never omitted.
 *
 * `pendingWrites` and the per-field `<fieldset>` locks are the race guard
 * described in the module doc; see `set` for how they combine.
 */
function BlindTypeDefaultsCard({
  type,
  catalogs,
  row,
  onSave,
}: {
  type: BlindType;
  catalogs: Catalogs;
  row: BlindTypeDefaultsRow | undefined;
  onSave: (patch: Omit<BlindTypeDefaultsRow, 'blind_type_id'>) => Promise<void>;
}) {
  const draft = sanitizeDraftForType(rowToDraft(row), catalogs, type.name);
  // `materialsForType` does not itself filter on `active` (a documented,
  // pre-existing asymmetry with the hardware catalogs' `optionsForType` —
  // see that function's own JSDoc). `sanitizeDraftForType` DOES require
  // `active` for `material_id` (matching the API's `DEFAULT_LINKS` check),
  // so offering an inactive-but-still-linked material here would let the
  // consultant pick something the very next sanitize pass discards back to
  // "No default" — a save that returns 200 while silently doing nothing.
  // Filtering here keeps the offered list exactly the set of picks that
  // can actually be saved.
  const materials = materialsForType(catalogs, type.name).filter((m) => m.active);
  const slots = slotsForType(catalogs, type.name);
  const hasMaterial = materials.length > 0;
  const visibleSlots = HARDWARE_SLOTS.filter(({ slot }) => slots.has(slot));
  const nothingScoped = !hasMaterial && visibleSlots.length === 0;

  /**
   * Fields with a save in flight whose result has not yet been confirmed
   * by a refetch, keyed by `DefaultsDraft` field name and holding the
   * value that was last SENT for that field. This is what lets a
   * concurrent edit to a DIFFERENT field merge in the just-picked,
   * not-yet-confirmed value instead of the stale server-derived `draft` —
   * see the module doc.
   */
  const [pendingWrites, setPendingWrites] = useState<Partial<DefaultsDraft>>({});

  /**
   * Handles one `OptionSelect`'s `onChange`. Delegates the next full draft
   * to `nextDraftForSave` (server-truth `draft` overlaid with any OTHER
   * fields still mid-save and this field's new value, re-sanitized for
   * the current scoping — see its own JSDoc for exactly why each layer
   * matters), marks `field` pending, fires the save, and unconditionally
   * clears `field` from `pendingWrites` once it settles — success OR
   * failure, via `finally`, never leaving a rejected value sitting in
   * `pendingWrites` as if it had been accepted. That unconditional clear
   * is what gives `nextDraftForSave` its guarantee: a save fired for a
   * DIFFERENT field AFTER this one's rejection is already known is
   * computed purely from `draft` (the last value the server actually
   * accepted) for this field, never from the rejected pick — a single bad
   * id cannot block the rest of the card once its own save has settled.
   * (A save fired for another field WHILE this one is still mid-flight
   * can still carry the not-yet-known-bad value in its own outgoing PUT —
   * see `nextDraftForSave`'s JSDoc for why no local cleanup can undo an
   * already-sent request.) `onSave` itself never rejects (see
   * `handleSave`), so this `finally` always runs promptly rather than
   * waiting on an unhandled rejection.
   */
  async function set(field: keyof DefaultsDraft, value: string) {
    const sanitized = nextDraftForSave(draft, pendingWrites, field, value, catalogs, type.name);
    setPendingWrites((w) => ({ ...w, [field]: value }));
    try {
      await onSave(toPatch(sanitized));
    } finally {
      setPendingWrites((w) => {
        const next = { ...w };
        delete next[field];
        return next;
      });
    }
  }

  return (
    <section className="rounded-xl border border-border-light bg-surface shadow-md p-4">
      <h2 className="mb-3 text-[15px] font-bold text-text-primary">{type.name}</h2>
      <div className="flex flex-col gap-3.5">
        <fieldset disabled={!hasMaterial || 'material_id' in pendingWrites} className="contents">
          <OptionSelect
            label="Material"
            value={hasMaterial ? draft.material_id : ''}
            onChange={(id) => void set('material_id', id)}
            options={materials}
            placeholder={hasMaterial ? 'No default' : 'No materials scoped to this type'}
          />
        </fieldset>
        {visibleSlots.map(({ slot, field, label }) => (
          <fieldset key={slot} disabled={field in pendingWrites} className="contents">
            <OptionSelect
              label={label}
              value={draft[field]}
              onChange={(id) => void set(field, id)}
              options={optionsForType(hardwareCatalog(catalogs, slot), catalogs.blindTypes, type.name)}
              placeholder="No default"
            />
          </fieldset>
        ))}
      </div>
      {nothingScoped && (
        <p className="mt-3 text-sm text-text-muted">
          No options are scoped to this blind type yet — scope options in their catalog pages first.
        </p>
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
   * Fires one card's full-row PUT via `useUpdateBlindTypeDefaults`'s
   * `mutateAsync`. NOT optimistic (see that hook's own JSDoc), so the
   * card keeps showing its pre-edit value — now disabled for the field
   * that changed, via `pendingWrites` — until the mutation settles and
   * the list is refetched. Deliberately never REJECTS: a 400/500 is
   * caught here and surfaced via toast with the Worker's own message
   * (e.g. "Cassette default is not offered for this blind type."), so a
   * rejected id is obvious immediately rather than looking like a save
   * that silently did nothing — and `BlindTypeDefaultsCard.set`'s
   * `finally` can rely on this promise always resolving, never throwing.
   */
  async function handleSave(
    blindTypeId: string,
    patch: Omit<BlindTypeDefaultsRow, 'blind_type_id'>
  ): Promise<void> {
    try {
      await update.mutateAsync({ blindTypeId, patch });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save defaults.');
    }
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
              onSave={(patch) => handleSave(type.id, patch)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
