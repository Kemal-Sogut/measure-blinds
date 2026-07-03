// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Generic CRUD editor for settings catalog entities (fabrics, cassette
 * options, control options, presets).
 *
 * All four entities are "name + one price + active flag (+ optional
 * description)" lists, so one component handles them: an add form at
 * the top, then a card per row with inline edit, active toggle, and
 * delete (with confirm). The price column key/label and description
 * support are configured per page — the pages themselves stay ~20
 * lines each, keeping one file per responsibility.
 *
 * Numeric inputs use inputMode="decimal" for mobile keyboards; all
 * tap targets are ≥44px.
 */

import { useState } from 'react';
import toast from 'react-hot-toast';
import {
  useCatalogList,
  useCreateCatalogItem,
  useUpdateCatalogItem,
  useDeleteCatalogItem,
  type CatalogPath,
  type CatalogRow,
} from '../hooks/useSettings';

/** Per-entity configuration provided by each settings page. */
export interface CatalogEditorConfig {
  /** API path segment under /api/settings */
  path: CatalogPath;
  /** Column that stores the price (e.g. 'price_per_sqm') */
  priceKey: string;
  /** Label shown for the price input (e.g. 'Price / m²') */
  priceLabel: string;
  /** Noun for empty state and add button (e.g. 'fabric') */
  noun: string;
  /** Whether the entity has a description field (presets only) */
  hasDescription?: boolean;
}

/** Catalog row with the dynamic price column and optional description. */
type Row = CatalogRow & Record<string, unknown>;

/** Draft state for the add/edit forms. */
interface Draft {
  name: string;
  price: string;
  description: string;
}

const EMPTY_DRAFT: Draft = { name: '', price: '', description: '' };

/** Parses a draft price string; returns null when invalid. */
function parsePrice(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export default function CatalogEditor({ config }: { config: CatalogEditorConfig }) {
  const { data: rows, isLoading, error } = useCatalogList<Row>(config.path);
  const create = useCreateCatalogItem<Row>(config.path);
  const update = useUpdateCatalogItem<Row>(config.path);
  const remove = useDeleteCatalogItem(config.path);

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);

  /** Validates and submits the "add new" form. */
  function handleAdd() {
    const price = parsePrice(draft.price);
    if (!draft.name.trim()) return toast.error('Enter a name.');
    if (price === null) return toast.error('Enter a valid price.');
    create.mutate(
      {
        name: draft.name.trim(),
        [config.priceKey]: price,
        ...(config.hasDescription ? { description: draft.description.trim() } : {}),
      } as Partial<Row>,
      {
        onSuccess: () => setDraft(EMPTY_DRAFT),
        onError: (e) => toast.error(e.message),
      }
    );
  }

  /** Enters inline edit mode for one row. */
  function startEdit(row: Row) {
    setEditingId(row.id);
    setEditDraft({
      name: row.name,
      price: String(row[config.priceKey] ?? ''),
      description: String(row.description ?? ''),
    });
  }

  /** Validates and saves the inline edit form. */
  function handleSaveEdit(id: string) {
    const price = parsePrice(editDraft.price);
    if (!editDraft.name.trim()) return toast.error('Enter a name.');
    if (price === null) return toast.error('Enter a valid price.');
    update.mutate(
      {
        id,
        patch: {
          name: editDraft.name.trim(),
          [config.priceKey]: price,
          ...(config.hasDescription ? { description: editDraft.description.trim() } : {}),
        } as Partial<Row>,
      },
      {
        onSuccess: () => setEditingId(null),
        onError: (e) => toast.error(e.message),
      }
    );
  }

  /** Confirms then deletes a row. */
  function handleDelete(row: Row) {
    if (!window.confirm(`Delete "${row.name}"? Existing estimates keep their prices.`)) return;
    remove.mutate(row.id, { onError: (e) => toast.error(e.message) });
  }

  if (isLoading) return <p className="p-4 text-text-muted">Loading…</p>;
  if (error) return <p className="p-4 text-danger">{error.message}</p>;

  return (
    <div className="mx-auto max-w-lg p-4">
      {/* Add form */}
      <div className="mb-6 rounded-xl border border-border bg-surface-elevated p-4">
        <h2 className="mb-3 text-sm font-semibold text-text-secondary">
          Add {config.noun}
        </h2>
        <div className="flex flex-col gap-2">
          <input
            placeholder="Name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="h-11 rounded-lg border border-border bg-surface px-3 text-base"
          />
          {config.hasDescription && (
            <input
              placeholder="Description"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="h-11 rounded-lg border border-border bg-surface px-3 text-base"
            />
          )}
          <div className="flex gap-2">
            <input
              placeholder={config.priceLabel}
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

      {/* Rows */}
      {rows && rows.length === 0 && (
        <p className="text-center text-text-muted">No {config.noun}s yet — add the first one above.</p>
      )}
      <ul className="flex flex-col gap-2">
        {rows?.map((row) => (
          <li
            key={row.id}
            className={`rounded-xl border border-border bg-surface-elevated p-3 ${row.active ? '' : 'opacity-60'}`}
          >
            {editingId === row.id ? (
              <div className="flex flex-col gap-2">
                <input
                  value={editDraft.name}
                  onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                  className="h-11 rounded-lg border border-border bg-surface px-3 text-base"
                />
                {config.hasDescription && (
                  <input
                    value={editDraft.description}
                    onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })}
                    className="h-11 rounded-lg border border-border bg-surface px-3 text-base"
                  />
                )}
                <div className="flex gap-2">
                  <input
                    inputMode="decimal"
                    value={editDraft.price}
                    onChange={(e) => setEditDraft({ ...editDraft, price: e.target.value })}
                    className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-base"
                  />
                  <button
                    onClick={() => handleSaveEdit(row.id)}
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
                <button onClick={() => startEdit(row)} className="min-w-0 flex-1 py-2 text-left">
                  <span className="block truncate font-medium text-text-primary">{row.name}</span>
                  {config.hasDescription && row.description ? (
                    <span className="block truncate text-sm text-text-muted">
                      {String(row.description)}
                    </span>
                  ) : null}
                  <span className="text-sm text-text-secondary">
                    ${Number(row[config.priceKey]).toFixed(2)}{' '}
                    <span className="text-text-muted">{config.priceLabel}</span>
                  </span>
                </button>
                <button
                  aria-label={row.active ? 'Deactivate' : 'Activate'}
                  onClick={() =>
                    update.mutate(
                      { id: row.id, patch: { active: !row.active } as Partial<Row> },
                      { onError: (e) => toast.error(e.message) }
                    )
                  }
                  className={`h-11 rounded-lg px-3 text-sm font-medium ${
                    row.active
                      ? 'bg-surface-muted text-text-secondary'
                      : 'bg-brand-100 text-brand-800'
                  }`}
                >
                  {row.active ? 'Active' : 'Inactive'}
                </button>
                <button
                  aria-label="Delete"
                  onClick={() => handleDelete(row)}
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
  );
}
