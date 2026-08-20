// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Bulk-add bottom sheet — "configure one section, type many rows" line-item
 * entry, opened from `OrderDetail.tsx`'s "Bulk add" button.
 *
 * A consultant measuring a house one window at a time re-picks the same
 * blind type, material and hardware for every window in a room. This sheet
 * flips that: pick a blind TYPE once per section (`SectionCard`'s config
 * half), then rattle off a measurement ROW per window underneath it (room
 * name, panel widths, height) — one `BlindDraft` line item per row on
 * confirm. Several sections can exist side by side, one per blind type, so
 * a whole house can be measured in one pass even when it mixes types.
 *
 * All state (`sections`, which section is expanded, the inline error) is
 * local to this component and reset on every open — `OrderDetail.tsx`
 * mounts this sheet conditionally (`{sheet === 'bulkAdd' && <BulkAddSheet
 * .../>}`), so a cancelled or confirmed pass never reappears half-typed.
 * The `open` prop is a defensive second gate (renders nothing if false)
 * rather than the ONLY gate, so this component behaves correctly even if a
 * future caller keeps it mounted and toggles `open` instead of unmounting.
 *
 * This file holds ONLY the sheet's outer chrome (header, section list,
 * "+ Add section", the inline error line, and the Cancel/confirm footer)
 * plus the accordion and Enter-to-add-row focus-management state. ONE
 * section's own card — its config fields, its rows, the two field
 * reimplementations that could not reuse `blindForms/fields.tsx` as-is —
 * lives in the sibling `BulkAddSectionCard.tsx` (split out once this file
 * passed the ~500-line single-responsibility guideline; see that file's own
 * doc for exactly what moved and why). Every rule about what makes a
 * section/row valid or how they expand into `BlindDraft`s lives in
 * `./bulkAdd.ts` (`validateBulkSections`, `expandBulkSections`) — this
 * component calls those and never re-implements their logic, so the two
 * cannot drift.
 */

import { useEffect, useRef, useState } from 'react';
import {
  bulkAddHasContent,
  bulkRowHasContent,
  expandBulkSections,
  newBulkRow,
  newBulkSection,
  validateBulkSections,
  type BulkSection,
} from './bulkAdd';
import type { BlindDraft, Catalogs } from './lineItemDrafts';
import { SectionCard } from './BulkAddSectionCard';

/**
 * Sheet panel treatment, mirroring the private `SHEET_PANEL` constant in
 * `OrderDetail.tsx` byte-for-byte (see that file's own doc comment for why
 * `dvh` and the safe-area padding matter). Duplicated rather than imported:
 * `OrderDetail.tsx` does not export it, and importing it back would invert
 * the dependency (`OrderDetail.tsx` imports THIS component, not the other
 * way around). `lg:max-w-5xl` is wider than the other hand-rolled sheets'
 * `lg:max-w-lg` (and wider still than the single blind item popup's own
 * `lg:max-w-3xl`) — this one carries a multi-column `HardwareRow` grid PLUS
 * a whole rows table, stacked several sections deep, and the narrower width
 * left all of it cramped on tablet/desktop. Unprefixed (no `max-w-*` below
 * `lg:`), so a phone still gets the sheet at full width, exactly as before.
 */
const SHEET_PANEL =
  'max-h-[92dvh] w-full overflow-y-auto overscroll-contain rounded-t-2xl bg-surface p-4 ' +
  'pb-[max(1rem,env(safe-area-inset-bottom))] lg:max-h-[85vh] lg:max-w-5xl lg:rounded-2xl lg:pb-4';

/**
 * Props for {@link BulkAddSheet}. `onAdd` receives the already-expanded
 * `BlindDraft[]` (via `expandBulkSections`) — the caller only has to append
 * them to its own item list, never re-derive them from `sections`.
 */
interface BulkAddSheetProps {
  /** Whether the sheet should render. `false` renders nothing. */
  open: boolean;
  catalogs: Catalogs;
  /** Discards every section/row and closes the sheet. */
  onCancel: () => void;
  /** Called with the expanded drafts once `validateBulkSections` passes. */
  onAdd: (drafts: BlindDraft[]) => void;
}

/**
 * Bulk-add bottom sheet. See the module doc comment for the feature this
 * implements and where its pieces live.
 *
 * Owns three pieces of state: `sections` (the sections/rows being built),
 * `openKey` (which ONE section is expanded — an accordion, not independent
 * toggles, so a long list of sections does not all sit open on a phone at
 * once), and `error` (the last validation message, cleared on every edit so
 * a fixed problem does not linger on screen after the consultant corrects
 * it). `pendingFocusRowKey` + `roomInputRefs` implement the Enter-to-add-row
 * focus hop: `addRow` mints the new row and records its key as "wants
 * focus"; the effect below runs after that row has actually rendered (refs
 * are attached during commit, before passive effects run) and focuses it,
 * then clears the pending key so it does not re-fire. `roomInputRefs`
 * itself is populated by each `SectionCard`'s `RowFields` via the
 * `registerRoomInput` callback threaded down below.
 *
 * Confirming calls `validateBulkSections` first — its message is shown
 * inline (matching how other pages on this screen surface a blocking
 * problem, e.g. `OrderOverview`'s `{error && <p className="text-danger">}`)
 * and the sheet stays open; only a `null` result calls `expandBulkSections`
 * and hands the drafts to `onAdd`. Every section/row mutation goes through
 * the shared `mutate` helper specifically so the stale error banner cannot
 * survive an edit that may have fixed it.
 *
 * Cancelling — the backdrop tap AND the Cancel button, both routed through
 * `handleCancel` so the guard cannot be bypassed by either path — confirms
 * first whenever `bulkAddHasContent(sections)` is true: a backdrop tap is
 * easy to make by accident on a tablet, and this sheet can hold
 * measurements for a whole house — the most expensive, hardest to redo
 * state in the app — so a stray tap must not be able to discard it
 * silently.
 */
export default function BulkAddSheet({ open, catalogs, onCancel, onAdd }: BulkAddSheetProps) {
  const [sections, setSections] = useState<BulkSection[]>(() => [newBulkSection()]);
  const [openKey, setOpenKey] = useState<string | null>(() => sections[0]?.key ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pendingFocusRowKey, setPendingFocusRowKey] = useState<string | null>(null);
  const roomInputRefs = useRef(new Map<string, HTMLInputElement>());

  useEffect(() => {
    if (!pendingFocusRowKey) return;
    roomInputRefs.current.get(pendingFocusRowKey)?.focus();
    setPendingFocusRowKey(null);
  }, [pendingFocusRowKey]);

  if (!open) return null;

  // Counts the same rows `expandBulkSections` will actually turn into
  // items (`bulkRowHasContent`), not the raw row count — an untouched
  // sheet's default blank row must count as zero, or the confirm button
  // below would read "Add 1 item", stay enabled, and confirm would expand
  // to an empty array and close with nothing added.
  const itemCount = sections.reduce((n, s) => n + s.rows.filter(bulkRowHasContent).length, 0);

  /** Applies a sections update and clears any stale validation message. */
  function mutate(fn: (secs: BulkSection[]) => BulkSection[]) {
    setSections(fn);
    setError(null);
  }

  /** Appends a blank section and expands it, collapsing whichever was open. */
  function addSection() {
    const next = newBulkSection();
    mutate((secs) => [...secs, next]);
    setOpenKey(next.key);
  }

  /** Removes a section; collapses the accordion if it was the open one. */
  function removeSection(key: string) {
    mutate((secs) => secs.filter((s) => s.key !== key));
    setOpenKey((cur) => (cur === key ? null : cur));
  }

  /** Appends a blank row to one section and queues focus onto its Room input. */
  function addRow(sectionKey: string) {
    const row = newBulkRow();
    mutate((secs) =>
      secs.map((s) => (s.key === sectionKey ? { ...s, rows: [...s.rows, row] } : s))
    );
    setPendingFocusRowKey(row.key);
  }

  /**
   * Discards the sheet and closes it — confirming first if anything has
   * been typed or picked (`bulkAddHasContent`). Shared by the backdrop
   * and the Cancel button (see the component doc) so neither can discard
   * a measuring pass without the same guard the other one gets.
   */
  function handleCancel() {
    if (bulkAddHasContent(sections) && !window.confirm('Discard this bulk add?')) return;
    onCancel();
  }

  /**
   * Validates, then expands and hands the drafts up; blocks on the first
   * error. The empty-result check is a defensive second gate alongside
   * `disabled={itemCount === 0}` on the confirm button below (itself now
   * driven by `bulkRowHasContent`, the same predicate `expandBulkSections`
   * filters by) — validation alone cannot rule this out, since an
   * all-blank-rows section trips no width/height/attribute check and
   * still has a non-zero `rows.length`. Without this, a confirm reached
   * some other way (a stale disabled state, a future caller) would call
   * `onAdd([])`, silently closing the sheet with nothing added and no
   * explanation — the exact dead end this guard exists to rule out.
   */
  function handleConfirm() {
    const message = validateBulkSections(sections, catalogs);
    if (message) {
      setError(message);
      return;
    }
    const drafts = expandBulkSections(sections);
    if (drafts.length === 0) {
      setError('Add at least one row before confirming.');
      return;
    }
    onAdd(drafts);
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 lg:items-center"
      onClick={handleCancel}
    >
      <div className={SHEET_PANEL} onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-sm font-semibold text-text-primary">Bulk add blinds</h2>
        <p className="mb-4 text-[13px] text-text-muted">
          Configure a section per blind type, then add a row for every window that shares it. Type,
          material and hardware can be left blank for now, but the order can't be saved until
          they're filled in.
          {itemCount > 0 && ` ${itemCount} item${itemCount !== 1 ? 's' : ''} so far.`}
        </p>

        <div className="flex flex-col gap-4">
          {sections.map((section, i) => (
            <SectionCard
              key={section.key}
              section={section}
              index={i}
              open={openKey === section.key}
              catalogs={catalogs}
              onToggle={() => setOpenKey((cur) => (cur === section.key ? null : section.key))}
              onRemove={() => removeSection(section.key)}
              onConfigChange={(next) =>
                mutate((secs) =>
                  secs.map((s) => (s.key === section.key ? { ...s, config: next } : s))
                )
              }
              onAddRow={() => addRow(section.key)}
              onRowChange={(rowKey, next) =>
                mutate((secs) =>
                  secs.map((s) =>
                    s.key === section.key
                      ? { ...s, rows: s.rows.map((r) => (r.key === rowKey ? next : r)) }
                      : s
                  )
                )
              }
              onRemoveRow={(rowKey) =>
                mutate((secs) =>
                  secs.map((s) =>
                    s.key === section.key
                      ? { ...s, rows: s.rows.filter((r) => r.key !== rowKey) }
                      : s
                  )
                )
              }
              onEnterHeight={() => addRow(section.key)}
              registerRoomInput={(rowKey) => (el) => {
                if (el) roomInputRefs.current.set(rowKey, el);
                else roomInputRefs.current.delete(rowKey);
              }}
            />
          ))}

          <button
            type="button"
            onClick={addSection}
            className="flex h-11 items-center justify-center gap-2 rounded-sm border border-dashed border-border-input text-[13px] font-semibold text-brand-600"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Add section
          </button>
        </div>

        {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}

        <div className="mt-4 flex gap-2">
          <button
            onClick={handleCancel}
            className="h-11 flex-1 rounded-md border border-border-input bg-surface text-[13px] font-medium text-text-secondary"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={itemCount === 0}
            className="h-11 flex-[2] rounded-sm bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
          >
            {`Add ${itemCount} item${itemCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
