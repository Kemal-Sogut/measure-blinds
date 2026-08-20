// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The Order Presentation filter bar — a stack of `[field] [value] [remove]`
 * rows plus an "Add filter" button.
 *
 * Fully controlled: the page owns the filter array and this component only
 * reports edits, so the table, the totals and the bar can never disagree
 * about what is being shown.
 *
 * Both dropdowns are built from `facets`, which is harvested from the
 * order's own line items — a consultant can only ever build a filter that
 * matches something, and each value carries the number of blinds behind it
 * ("Cordless (3)") because that count is the sentence being read aloud to
 * the customer.
 *
 * A freshly added row has no value chosen, and a valueless row matches
 * everything, so adding a filter never blanks the table mid-gesture.
 */

import { Button } from '../../components/ui';
import {
  FILTER_FIELD_LABELS,
  type Facet,
  type FilterField,
  type PresentationFilter,
} from './presentationFilters';

/**
 * Shared select styling. `h-11` rather than a smaller control because the
 * app's 44px tap minimum applies here too — this bar is driven with a
 * fingertip while a customer watches.
 */
const SELECT_CLASS =
  'h-11 min-w-0 flex-1 rounded-md border border-border-input bg-surface px-3 text-sm text-text-primary';

export default function PresentationFilterBar({
  facets,
  filters,
  onChange,
}: {
  facets: Facet[];
  filters: PresentationFilter[];
  onChange: (next: PresentationFilter[]) => void;
}) {
  // An order with nothing to distinguish its blinds gets no filter bar at
  // all, rather than a control that can only ever be a no-op.
  if (facets.length === 0) return null;

  /** Appends an empty row on the first field that has values to offer. */
  function addFilter() {
    const field = facets[0].field;
    onChange([...filters, { id: `${field}-${Date.now()}-${filters.length}`, field, value: '' }]);
  }

  /** Changing the FIELD clears the value — it belonged to the old field. */
  function setField(id: string, field: FilterField) {
    onChange(filters.map((f) => (f.id === id ? { ...f, field, value: '' } : f)));
  }

  function setValue(id: string, value: string) {
    onChange(filters.map((f) => (f.id === id ? { ...f, value } : f)));
  }

  function removeFilter(id: string) {
    onChange(filters.filter((f) => f.id !== id));
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-3 print:hidden">
      <div className="flex flex-col gap-2">
        {filters.map((filter) => {
          const facet = facets.find((f) => f.field === filter.field);
          return (
            <div key={filter.id} className="flex items-center gap-2">
              <select
                aria-label="Filter by"
                className={SELECT_CLASS}
                value={filter.field}
                onChange={(e) => setField(filter.id, e.target.value as FilterField)}
              >
                {facets.map((f) => (
                  <option key={f.field} value={f.field}>
                    {FILTER_FIELD_LABELS[f.field]}
                  </option>
                ))}
              </select>
              <select
                aria-label="Matching"
                className={SELECT_CLASS}
                value={filter.value}
                onChange={(e) => setValue(filter.id, e.target.value)}
              >
                <option value="">Any</option>
                {facet?.values.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.value} ({v.count})
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label="Remove filter"
                onClick={() => removeFilter(filter.id)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border-input text-text-muted hover:bg-surface-sunken"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
      <div className={`flex gap-2 ${filters.length > 0 ? 'mt-2' : ''}`}>
        <Button variant="secondary" size="sm" onClick={addFilter}>
          + Add filter
        </Button>
        {filters.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onChange([])}>
            Clear
          </Button>
        )}
      </div>
    </section>
  );
}
