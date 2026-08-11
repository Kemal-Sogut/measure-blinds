// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Generic CRUD editor for simple settings catalog entities (cassette
 * options, control options, pleat types, installation options, presets,
 * blind types). Materials are NOT handled here — they carry blind-type
 * links and have their own page.
 *
 * All these entities are "name + one number + active flag (+ optional
 * description)" lists, so one component handles them: an add form at
 * the top, then a card per row with inline edit, active toggle, and
 * delete (with confirm). The numeric column's key, label, unit, minimum
 * and description support are configured per page — the pages themselves
 * stay ~20 lines each, keeping one file per responsibility.
 *
 * That number is not always money. Pleat types store a fullness RATIO,
 * rendered `2.50×` rather than `$2.50` and required to be positive, so
 * `priceUnit`/`priceMin` exist to keep one component honest about both.
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
  /** Column that stores the price (e.g. 'price_per_sqm'); omit for a
   *  price-less catalog such as blind types. */
  priceKey?: string;
  /** Label shown for the price input (e.g. 'Price / m²') */
  priceLabel?: string;
  /** Noun for empty state and add button (e.g. 'cassette option') */
  noun: string;
  /** Whether the entity has a description field (presets only) */
  hasDescription?: boolean;
  /**
   * How the numeric column is displayed and validated. 'currency' (the
   * default) renders `$12.00`; 'plain' renders `2.50×` for a value that
   * is a ratio rather than money. Pleat multipliers use 'plain'.
   */
  priceUnit?: 'currency' | 'plain';
  /**
   * Smallest accepted value, defaulting to 0. The pleat catalog sets
   * 0.01 because a 0 multiplier would zero the whole curtain line.
   */
  priceMin?: number;
  /** Standing note rendered under the add form. */
  note?: string;
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

/**
 * Parses a draft numeric string; returns null when it is not a finite
 * number or falls below `min`. The minimum is configurable because not
 * every catalog's numeric column is money: a price of 0 is legitimate
 * (both shipped bottom rails ship at 0), but a pleat multiplier of 0
 * would zero the whole curtain line.
 */
function parseAmount(value: string, min: number): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? Math.round(n * 100) / 100 : null;
}

export default function CatalogEditor({ config }: { config: CatalogEditorConfig }) {
  const hasPrice = Boolean(config.priceKey);
  const { data: rows, isLoading, error } = useCatalogList<Row>(config.path);
  const create = useCreateCatalogItem<Row>(config.path);
  const update = useUpdateCatalogItem<Row>(config.path);
  const remove = useDeleteCatalogItem(config.path);

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const priceMin = config.priceMin ?? 0;
  const invalidAmount =
    config.priceUnit === 'plain' ? 'Enter a multiplier greater than 0.' : 'Enter a valid price.';

  /** Validates and submits the "add new" form. */
  function handleAdd() {
    if (!draft.name.trim()) return toast.error('Enter a name.');
    let price: number | null = null;
    if (hasPrice) {
      price = parseAmount(draft.price, priceMin);
      if (price === null) return toast.error(invalidAmount);
    }
    create.mutate(
      {
        name: draft.name.trim(),
        ...(hasPrice ? { [config.priceKey as string]: price } : {}),
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
      price: hasPrice ? String(row[config.priceKey as string] ?? '') : '',
      description: String(row.description ?? ''),
    });
  }

  /** Validates and saves the inline edit form. */
  function handleSaveEdit(id: string) {
    if (!editDraft.name.trim()) return toast.error('Enter a name.');
    let price: number | null = null;
    if (hasPrice) {
      price = parseAmount(editDraft.price, priceMin);
      if (price === null) return toast.error(invalidAmount);
    }
    update.mutate(
      {
        id,
        patch: {
          name: editDraft.name.trim(),
          ...(hasPrice ? { [config.priceKey as string]: price } : {}),
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
    <div className="page-container py-4 md:py-6 [--page-max:48rem]">
      {/* Add form */}
      <div className="mb-6 rounded-xl border border-border-light bg-surface shadow-md p-4">
        <h2 className="mb-3 text-[15px] font-bold text-text-primary">
          Add {config.noun}
        </h2>
        <div className="flex flex-col gap-2">
          <input
            placeholder="Name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="h-11 rounded-md border border-border-input bg-surface px-3 text-base"
          />
          {config.hasDescription && (
            <input
              placeholder="Description"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="h-11 rounded-md border border-border-input bg-surface px-3 text-base"
            />
          )}
          <div className="flex gap-2">
            {hasPrice && (
              <input
                placeholder={config.priceLabel}
                inputMode="decimal"
                value={draft.price}
                onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                className="h-11 min-w-0 flex-1 rounded-md border border-border-input bg-surface px-3 text-base"
              />
            )}
            <button
              onClick={handleAdd}
              disabled={create.isPending}
              className={`h-11 rounded-md shadow-sm bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700 disabled:opacity-50 ${
                hasPrice ? '' : 'flex-1'
              }`}
            >
              Add
            </button>
          </div>
        </div>
        {config.note && <p className="mt-2 text-xs text-text-muted">{config.note}</p>}
      </div>

      {/* Rows */}
      {rows && rows.length === 0 && (
        <p className="text-center text-text-muted">No {config.noun}s yet — add the first one above.</p>
      )}
      <ul className="flex flex-col gap-2">
        {rows?.map((row) => (
          <li
            key={row.id}
            className={`rounded-xl border border-border-light bg-surface shadow-md p-3 ${row.active ? '' : 'opacity-60'}`}
          >
            {editingId === row.id ? (
              <div className="flex flex-col gap-2">
                <input
                  value={editDraft.name}
                  onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                  className="h-11 rounded-md border border-border-input bg-surface px-3 text-base"
                />
                {config.hasDescription && (
                  <input
                    value={editDraft.description}
                    onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })}
                    className="h-11 rounded-md border border-border-input bg-surface px-3 text-base"
                  />
                )}
                <div className="flex gap-2">
                  {hasPrice && (
                    <input
                      inputMode="decimal"
                      value={editDraft.price}
                      onChange={(e) => setEditDraft({ ...editDraft, price: e.target.value })}
                      className="h-11 min-w-0 flex-1 rounded-md border border-border-input bg-surface px-3 text-base"
                    />
                  )}
                  <button
                    onClick={() => handleSaveEdit(row.id)}
                    className={`h-11 rounded-md shadow-sm bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700 ${
                      hasPrice ? '' : 'flex-1'
                    }`}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="h-11 rounded-md border border-border-input px-4 text-text-secondary"
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
                  {hasPrice && (
                    <span className="text-sm text-text-secondary">
                      {config.priceUnit === 'plain'
                        ? `${Number(row[config.priceKey as string]).toFixed(2)}×`
                        : `$${Number(row[config.priceKey as string]).toFixed(2)}`}{' '}
                      <span className="text-text-muted">{config.priceLabel}</span>
                    </span>
                  )}
                </button>
                <button
                  aria-label={row.active ? 'Deactivate' : 'Activate'}
                  onClick={() =>
                    update.mutate(
                      { id: row.id, patch: { active: !row.active } as Partial<Row> },
                      { onError: (e) => toast.error(e.message) }
                    )
                  }
                  className={`h-11 rounded-md px-3 text-sm font-medium ${
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
                  className="flex h-11 w-11 items-center justify-center rounded-md text-danger hover:bg-danger-tint"
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
