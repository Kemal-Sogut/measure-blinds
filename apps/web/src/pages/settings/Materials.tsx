// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Materials landing page — the entry to the two-level Materials flow.
 *
 * This page lists the BLIND TYPES (Roller, Zebra, …); tapping one opens
 * that type's Material list (`/settings/materials/:blindTypeId`, the
 * MaterialsForType page) where its Materials are added/edited. Blind
 * types themselves are also managed here (add / rename / activate /
 * delete) — there is no separate "Blind Types" settings page; this is
 * the single place for both.
 *
 * Each row shows how many Materials are linked to that type. Deleting a
 * type removes its Material links (DB cascade) but never the Material
 * rows; a Material left with no links simply stops appearing until it is
 * re-linked to a type. All tap targets are ≥44px.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import PageHeader from '../../components/PageHeader';
import {
  useCatalogList,
  useCreateCatalogItem,
  useUpdateCatalogItem,
  useDeleteCatalogItem,
} from '../../hooks/useSettings';
import type { BlindType, Material } from '../../types';

export default function Materials() {
  const { data: types, isLoading, error } = useCatalogList<BlindType>('blind-types');
  const { data: materials } = useCatalogList<Material>('materials');
  const create = useCreateCatalogItem<BlindType>('blind-types');
  const update = useUpdateCatalogItem<BlindType>('blind-types');
  const remove = useDeleteCatalogItem('blind-types');

  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  /** Number of Materials linked to a given blind type. */
  function materialCount(typeId: string): number {
    return (materials ?? []).filter((m) => m.blind_type_ids.includes(typeId)).length;
  }

  /** Validates and creates a new blind type. */
  function handleAdd() {
    if (!name.trim()) return toast.error('Enter a name.');
    create.mutate({ name: name.trim() } as Partial<BlindType>, {
      onSuccess: () => setName(''),
      onError: (e) => toast.error(e.message),
    });
  }

  /** Saves an inline blind-type rename. */
  function handleSaveEdit(id: string) {
    if (!editName.trim()) return toast.error('Enter a name.');
    update.mutate(
      { id, patch: { name: editName.trim() } as Partial<BlindType> },
      { onSuccess: () => setEditingId(null), onError: (e) => toast.error(e.message) }
    );
  }

  /** Confirms then deletes a blind type (its Material links cascade). */
  function handleDelete(type: BlindType) {
    if (
      !window.confirm(
        `Delete blind type "${type.name}"? Its Material links are removed; the Materials themselves stay in the system.`
      )
    )
      return;
    remove.mutate(type.id, { onError: (e) => toast.error(e.message) });
  }

  return (
    <div className="min-h-screen bg-surface-muted">
      <PageHeader title="Materials" backTo="/settings" />
      <div className="mx-auto max-w-lg p-4">
        <p className="mb-4 text-sm text-text-muted">
          Choose a blind type to manage its materials, or add a new type below.
        </p>

        {/* Add blind type */}
        <div className="mb-6 rounded-xl border border-border bg-surface-elevated p-4">
          <h2 className="mb-3 text-sm font-semibold text-text-secondary">Add blind type</h2>
          <div className="flex gap-2">
            <input
              placeholder="e.g. Roller"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
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

        {/* Blind types */}
        {isLoading && <p className="p-4 text-text-muted">Loading…</p>}
        {error && <p className="p-4 text-danger">{error.message}</p>}
        {types && types.length === 0 && (
          <p className="text-center text-text-muted">No blind types yet — add the first one above.</p>
        )}
        <ul className="flex flex-col gap-2">
          {types?.map((type) => (
            <li
              key={type.id}
              className={`rounded-xl border border-border bg-surface-elevated ${type.active ? '' : 'opacity-60'}`}
            >
              {editingId === type.id ? (
                <div className="flex flex-col gap-2 p-3">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-11 rounded-lg border border-border bg-surface px-3 text-base"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSaveEdit(type.id)}
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
                <div className="flex items-center gap-1 p-1.5">
                  <Link
                    to={`/settings/materials/${type.id}`}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 hover:bg-surface-muted"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-text-primary">{type.name}</span>
                      <span className="text-sm text-text-muted">
                        {materialCount(type.id)} material{materialCount(type.id) === 1 ? '' : 's'}
                      </span>
                    </span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="m9 18 6-6-6-6"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-text-muted"
                      />
                    </svg>
                  </Link>
                  <button
                    aria-label="Rename"
                    onClick={() => {
                      setEditingId(type.id);
                      setEditName(type.name);
                    }}
                    className="flex h-11 w-11 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <button
                    aria-label={type.active ? 'Deactivate' : 'Activate'}
                    onClick={() =>
                      update.mutate(
                        { id: type.id, patch: { active: !type.active } as Partial<BlindType> },
                        { onError: (e) => toast.error(e.message) }
                      )
                    }
                    className={`h-11 rounded-lg px-3 text-sm font-medium ${
                      type.active ? 'bg-surface-muted text-text-secondary' : 'bg-brand-100 text-brand-800'
                    }`}
                  >
                    {type.active ? 'Active' : 'Inactive'}
                  </button>
                  <button
                    aria-label="Delete"
                    onClick={() => handleDelete(type)}
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
