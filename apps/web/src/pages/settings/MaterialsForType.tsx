// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Per-blind-type Materials page (`/settings/materials/:blindTypeId`).
 *
 * Second level of the Materials flow: shows only the Materials LINKED to
 * the blind type chosen on the Materials landing page, and lets the user
 * add new Materials (created and linked to THIS type), rename/reprice
 * them, toggle active, or delete them.
 *
 * A Material is stored once (shared table) but scoped to types via the
 * `material_blind_types` join. Adding here sends `blind_type_ids:
 * [thisType]`; editing name/price omits `blind_type_ids` so existing
 * links to other types are preserved. Deleting removes the Material
 * everywhere (existing estimates keep their snapshotted prices). All tap
 * targets are ≥44px.
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import PageHeader from '../../components/PageHeader';
import {
  useCatalogList,
  useCreateCatalogItem,
  useUpdateCatalogItem,
  useDeleteCatalogItem,
} from '../../hooks/useSettings';
import type { BlindType, Material } from '../../types';

/** Draft state for the add/edit forms. */
interface Draft {
  name: string;
  price: string;
}

const EMPTY_DRAFT: Draft = { name: '', price: '' };

/** Parses a draft price string; returns null when invalid. */
function parsePrice(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export default function MaterialsForType() {
  const { blindTypeId = '' } = useParams<{ blindTypeId: string }>();
  const { data: types } = useCatalogList<BlindType>('blind-types');
  const { data: materials, isLoading, error } = useCatalogList<Material>('materials');
  const create = useCreateCatalogItem<Material>('materials');
  const update = useUpdateCatalogItem<Material>('materials');
  const remove = useDeleteCatalogItem('materials');

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);

  const type = (types ?? []).find((t) => t.id === blindTypeId);
  /** Materials scoped to this blind type (linked-only). */
  const scoped = (materials ?? []).filter((m) => m.blind_type_ids.includes(blindTypeId));

  /** Validates and creates a Material linked to this blind type. */
  function handleAdd() {
    if (!draft.name.trim()) return toast.error('Enter a name.');
    const price = parsePrice(draft.price);
    if (price === null) return toast.error('Enter a valid price.');
    create.mutate(
      {
        name: draft.name.trim(),
        price_per_sqm: price,
        blind_type_ids: [blindTypeId],
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
    setEditDraft({ name: material.name, price: String(material.price_per_sqm ?? '') });
  }

  /**
   * Saves name/price only — `blind_type_ids` is intentionally omitted so
   * the Material's links (including to other types) are left untouched.
   */
  function handleSaveEdit(id: string) {
    if (!editDraft.name.trim()) return toast.error('Enter a name.');
    const price = parsePrice(editDraft.price);
    if (price === null) return toast.error('Enter a valid price.');
    update.mutate(
      { id, patch: { name: editDraft.name.trim(), price_per_sqm: price } as Partial<Material> },
      { onSuccess: () => setEditingId(null), onError: (e) => toast.error(e.message) }
    );
  }

  /** Confirms then deletes a Material entirely. */
  function handleDelete(material: Material) {
    if (!window.confirm(`Delete "${material.name}"? Existing estimates keep their prices.`)) return;
    remove.mutate(material.id, { onError: (e) => toast.error(e.message) });
  }

  return (
    <div className="min-h-screen bg-surface-muted">
      <PageHeader title={type ? type.name : 'Materials'} backTo="/settings/materials" />
      <div className="mx-auto max-w-lg p-4">
        <p className="mb-4 text-sm text-text-muted">
          Materials available for {type ? type.name : 'this'} blinds.
        </p>

        {/* Add material (linked to this type) */}
        <div className="mb-6 rounded-xl border border-border bg-surface-elevated p-4">
          <h2 className="mb-3 text-sm font-semibold text-text-secondary">Add material</h2>
          <div className="flex flex-col gap-2">
            <input
              placeholder="Name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="h-11 rounded-lg border border-border bg-surface px-3 text-base"
            />
            <div className="flex gap-2">
              <input
                placeholder="Price / m²"
                inputMode="decimal"
                value={draft.price}
                onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-base"
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
        </div>

        {/* Materials for this type */}
        {isLoading && <p className="p-4 text-text-muted">Loading…</p>}
        {error && <p className="p-4 text-danger">{error.message}</p>}
        {materials && scoped.length === 0 && (
          <p className="text-center text-text-muted">
            No materials for this type yet — add the first one above.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {scoped.map((material) => (
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
                  <div className="flex gap-2">
                    <input
                      inputMode="decimal"
                      value={editDraft.price}
                      onChange={(e) => setEditDraft({ ...editDraft, price: e.target.value })}
                      className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-base"
                    />
                    <button
                      onClick={() => handleSaveEdit(material.id)}
                      className="h-11 rounded-lg bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700"
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
