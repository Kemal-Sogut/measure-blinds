// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Materials settings page — CRUD list of Materials priced per square
 * meter, each scoped to zero or more blind types.
 *
 * Unlike the generic CatalogEditor entities (cassettes / controls /
 * presets), a Material carries a many-to-many blind-type link set
 * (`blind_type_ids`). It is edited here as a checkbox group: leaving
 * every box unchecked means the Material is offered for ALL blind types
 * in the line-item editor; checking some scopes it to just those types.
 * The link set rides along the standard catalog create/update mutations
 * (the Materials API syncs the `material_blind_types` join table).
 *
 * Numeric input uses inputMode="decimal" for mobile keyboards; all tap
 * targets are ≥44px.
 */

import { useState } from 'react';
import toast from 'react-hot-toast';
import PageHeader from '../../components/PageHeader';
import {
  useCatalogList,
  useCreateCatalogItem,
  useUpdateCatalogItem,
  useDeleteCatalogItem,
} from '../../hooks/useSettings';
import type { Material, BlindType } from '../../types';

/** Draft state for the add/edit forms. */
interface Draft {
  name: string;
  price: string;
  blind_type_ids: string[];
}

const EMPTY_DRAFT: Draft = { name: '', price: '', blind_type_ids: [] };

/** Parses a draft price string; returns null when invalid. */
function parsePrice(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/** Adds or removes an id from a selection array (immutably). */
function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export default function Materials() {
  const { data: materials, isLoading, error } = useCatalogList<Material>('materials');
  const { data: blindTypes } = useCatalogList<BlindType>('blind-types');
  const create = useCreateCatalogItem<Material>('materials');
  const update = useUpdateCatalogItem<Material>('materials');
  const remove = useDeleteCatalogItem('materials');

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);

  /** Active blind types offered as scope checkboxes. */
  const types = (blindTypes ?? []).filter((t) => t.active);

  /** Validates and submits the "add new" form. */
  function handleAdd() {
    if (!draft.name.trim()) return toast.error('Enter a name.');
    const price = parsePrice(draft.price);
    if (price === null) return toast.error('Enter a valid price.');
    create.mutate(
      {
        name: draft.name.trim(),
        price_per_sqm: price,
        blind_type_ids: draft.blind_type_ids,
      } as Partial<Material>,
      {
        onSuccess: () => setDraft(EMPTY_DRAFT),
        onError: (e) => toast.error(e.message),
      }
    );
  }

  /** Enters inline edit mode for one Material. */
  function startEdit(material: Material) {
    setEditingId(material.id);
    setEditDraft({
      name: material.name,
      price: String(material.price_per_sqm ?? ''),
      blind_type_ids: material.blind_type_ids ?? [],
    });
  }

  /** Validates and saves the inline edit form. */
  function handleSaveEdit(id: string) {
    if (!editDraft.name.trim()) return toast.error('Enter a name.');
    const price = parsePrice(editDraft.price);
    if (price === null) return toast.error('Enter a valid price.');
    update.mutate(
      {
        id,
        patch: {
          name: editDraft.name.trim(),
          price_per_sqm: price,
          blind_type_ids: editDraft.blind_type_ids,
        } as Partial<Material>,
      },
      {
        onSuccess: () => setEditingId(null),
        onError: (e) => toast.error(e.message),
      }
    );
  }

  /** Confirms then deletes a Material. */
  function handleDelete(material: Material) {
    if (!window.confirm(`Delete "${material.name}"? Existing estimates keep their prices.`)) return;
    remove.mutate(material.id, { onError: (e) => toast.error(e.message) });
  }

  /** Human-readable summary of a Material's blind-type scope. */
  function scopeLabel(material: Material): string {
    if (!material.blind_type_ids.length) return 'All blind types';
    const names = material.blind_type_ids
      .map((id) => (blindTypes ?? []).find((t) => t.id === id)?.name)
      .filter(Boolean);
    return names.length ? names.join(', ') : '—';
  }

  /** Checkbox group for choosing which blind types a Material appears under. */
  function TypePicker({ selected, onToggle }: { selected: string[]; onToggle: (id: string) => void }) {
    return (
      <div>
        <p className="mb-1 text-xs font-medium text-text-secondary">
          Blind types <span className="text-text-muted">(none = all)</span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {types.map((t) => {
            const on = selected.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onToggle(t.id)}
                aria-pressed={on}
                className={`min-h-8 rounded-lg border px-2.5 py-1 text-sm ${
                  on
                    ? 'border-brand-600 bg-brand-100 text-brand-800'
                    : 'border-border bg-surface text-text-secondary'
                }`}
              >
                {t.name}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-muted">
      <PageHeader title="Materials" backTo="/settings" />
      <div className="mx-auto max-w-lg p-4">
        {/* Add form */}
        <div className="mb-6 rounded-xl border border-border bg-surface-elevated p-4">
          <h2 className="mb-3 text-sm font-semibold text-text-secondary">Add material</h2>
          <div className="flex flex-col gap-2">
            <input
              placeholder="Name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="h-11 rounded-lg border border-border bg-surface px-3 text-base"
            />
            <input
              placeholder="Price / m²"
              inputMode="decimal"
              value={draft.price}
              onChange={(e) => setDraft({ ...draft, price: e.target.value })}
              className="h-11 rounded-lg border border-border bg-surface px-3 text-base"
            />
            <TypePicker
              selected={draft.blind_type_ids}
              onToggle={(id) => setDraft({ ...draft, blind_type_ids: toggleId(draft.blind_type_ids, id) })}
            />
            <button
              onClick={handleAdd}
              disabled={create.isPending}
              className="h-11 rounded-lg bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>

        {/* Rows */}
        {isLoading && <p className="p-4 text-text-muted">Loading…</p>}
        {error && <p className="p-4 text-danger">{error.message}</p>}
        {materials && materials.length === 0 && (
          <p className="text-center text-text-muted">No materials yet — add the first one above.</p>
        )}
        <ul className="flex flex-col gap-2">
          {materials?.map((material) => (
            <li
              key={material.id}
              className={`rounded-xl border border-border bg-surface-elevated p-3 ${material.active ? '' : 'opacity-60'}`}
            >
              {editingId === material.id ? (
                <div className="flex flex-col gap-2">
                  <input
                    value={editDraft.name}
                    onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                    className="h-11 rounded-lg border border-border bg-surface px-3 text-base"
                  />
                  <input
                    inputMode="decimal"
                    value={editDraft.price}
                    onChange={(e) => setEditDraft({ ...editDraft, price: e.target.value })}
                    className="h-11 rounded-lg border border-border bg-surface px-3 text-base"
                  />
                  <TypePicker
                    selected={editDraft.blind_type_ids}
                    onToggle={(id) =>
                      setEditDraft({ ...editDraft, blind_type_ids: toggleId(editDraft.blind_type_ids, id) })
                    }
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSaveEdit(material.id)}
                      className="h-11 flex-1 rounded-lg bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="h-11 rounded-lg border border-border px-4 text-text-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button onClick={() => startEdit(material)} className="min-w-0 flex-1 py-2 text-left">
                    <span className="block truncate font-medium text-text-primary">{material.name}</span>
                    <span className="text-sm text-text-secondary">
                      ${Number(material.price_per_sqm).toFixed(2)}{' '}
                      <span className="text-text-muted">per m²</span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-text-muted">{scopeLabel(material)}</span>
                  </button>
                  <button
                    aria-label={material.active ? 'Deactivate' : 'Activate'}
                    onClick={() =>
                      update.mutate(
                        { id: material.id, patch: { active: !material.active } as Partial<Material> },
                        { onError: (e) => toast.error(e.message) }
                      )
                    }
                    className={`h-11 rounded-lg px-3 text-sm font-medium ${
                      material.active
                        ? 'bg-surface-muted text-text-secondary'
                        : 'bg-brand-100 text-brand-800'
                    }`}
                  >
                    {material.active ? 'Active' : 'Inactive'}
                  </button>
                  <button
                    aria-label="Delete"
                    onClick={() => handleDelete(material)}
                    className="flex h-11 w-11 items-center justify-center rounded-lg text-danger hover:bg-red-50"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M3 6h18M8 6V4h8v2m-9 0v14a1 1 0 001 1h8a1 1 0 001-1V6"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
