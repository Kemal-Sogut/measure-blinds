// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Manufacturer Copy page (`/orders/:id/manufacturer`).
 *
 * The workshop-facing cut sheet for an order, opened in a NEW TAB from the
 * in-progress action panel on the order detail page. It fetches the order
 * (for its line items) and the Materials catalog (for each fabric's roll
 * width), runs the pure cut planner in `lib/manufacturing.ts`, and renders:
 *
 *   1. Aluminium cut list — per blind type (Roller / Zebra / Solar), the
 *      6 m bars and the cuts assigned to each, longest-first.
 *   2. Fabric cut list — per material roll, the full-width "courses" the
 *      cutting machine makes (cut height, the pieces taken across the
 *      width, and the side/top offcuts), plus a utilisation figure.
 *   3. Order as-is — every other blind type and preset/custom line, which
 *      is bought from the factory rather than built in-house.
 *
 * Width is read LIVE from the catalog (line items don't snapshot it — it
 * is a manufacturing input, not money); a material with no width set is
 * planned as a default 3 m roll. The page is print-friendly (a Print
 * button, hidden on paper, calls `window.print()`).
 */

import { useMemo, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import PageHeader from '../../components/PageHeader';
import { useOrder, useSetCutDone } from '../../hooks/useOrders';
import { useCatalogList } from '../../hooks/useSettings';
import type { Material } from '../../types';
import {
  buildManufacturingPlan,
  type AluminumGroup,
  type FabricGroup,
} from '../../lib/manufacturing';

/** Formats a cm length, dropping a trailing `.00` for whole numbers. */
function cm(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(2)} cm`;
}

/** Formats cm as metres to 2dp (for roll-length / bar totals). */
function meters(value: number): string {
  return `${(value / 100).toFixed(2)} m`;
}

/** Formats an ISO timestamp as a readable local date + time. */
function formatStamp(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

/** Card wrapper shared by every section. */
function Card({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 print:break-inside-avoid">
      {children}
    </section>
  );
}

/** Small labelled stat used in the section summaries. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wide text-text-muted">{label}</span>
      <span className="text-sm font-semibold text-text-primary">{value}</span>
    </div>
  );
}

/** Renders one blind type's aluminium bars. */
function AluminumSection({ group }: { group: AluminumGroup }) {
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-text-primary">{group.blindType} — aluminium</h3>
        <div className="flex gap-4">
          <Stat label="Cuts" value={String(group.cutCount)} />
          <Stat label="6 m bars" value={String(group.barCount)} />
          <Stat label="Used" value={meters(group.usedCm)} />
          <Stat label="Offcut" value={meters(group.wasteCm)} />
        </div>
      </div>
      <ul className="flex flex-col gap-2">
        {group.result.bars.map((bar) => (
          <li key={bar.index} className="rounded-md border border-border-light bg-surface-muted p-3">
            <div className="mb-1 flex items-center justify-between text-sm font-medium text-text-secondary">
              <span>Bar {bar.index} · 6 m</span>
              <span className="text-text-muted">offcut {cm(bar.leftover)}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {bar.cuts.map((c, i) => (
                <span
                  key={i}
                  className="rounded-sm border border-border bg-surface px-2 py-1 text-xs text-text-primary"
                  title={c.label}
                >
                  {cm(c.length)}
                </span>
              ))}
            </div>
            <ol className="mt-2 list-decimal pl-5 text-xs text-text-muted">
              {bar.cuts.map((c, i) => (
                <li key={i}>
                  {cm(c.length)} — {c.label}
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Renders one material roll's full-width fabric strips. */
function FabricSection({ group }: { group: FabricGroup }) {
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-text-primary">
          {group.materialName} — fabric
        </h3>
        <div className="flex flex-wrap gap-4">
          <Stat
            label="Roll width"
            value={group.assumedWidth ? `${cm(group.rollWidth)} (assumed)` : cm(group.rollWidth)}
          />
          <Stat label="Pieces" value={String(group.pieceCount)} />
          <Stat label="Courses" value={String(group.stripCount)} />
          <Stat label="Fabric used" value={meters(group.consumedCm)} />
          <Stat label="Utilisation" value={`${Math.round(group.utilization * 100)}%`} />
        </div>
      </div>
      <ul className="flex flex-col gap-2">
        {group.result.strips.map((strip) => (
          <li key={strip.index} className="rounded-md border border-border-light bg-surface-muted p-3">
            <p className="mb-2 text-sm font-medium text-text-secondary">
              Course {strip.index}: cut the full {cm(strip.rollWidth)} width at {cm(strip.height)}{' '}
              height, then cut these widths across it:
            </p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {strip.pieces.map((p, i) => (
                <span
                  key={i}
                  className="rounded-sm border border-border bg-surface px-2 py-1 text-xs text-text-primary"
                  title={p.label}
                >
                  {cm(p.width)} × {cm(p.height)}
                  <span className="text-text-muted"> · {p.label}</span>
                </span>
              ))}
            </div>
            {(strip.sideLeftover || strip.topLeftovers.length > 0) && (
              <p className="text-xs text-text-muted">
                Offcuts:{' '}
                {[
                  strip.sideLeftover
                    ? `${cm(strip.sideLeftover.width)} × ${cm(strip.sideLeftover.height)} (side)`
                    : null,
                  ...strip.topLeftovers.map(
                    (o) => `${cm(o.width)} × ${cm(o.height)} (top of ${o.label})`
                  ),
                ]
                  .filter(Boolean)
                  .join(', ')}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function ManufacturerCopy() {
  const { id } = useParams<{ id: string }>();
  const { data: order, isLoading, error } = useOrder(id);
  const { data: materials } = useCatalogList<Material>('materials');
  const cutDone = useSetCutDone();
  const isCutDone = Boolean(order?.cut_done_at);

  /** Flip the cut-done milestone on/off (reversible toggle). */
  function toggleCutDone() {
    if (!id || cutDone.isPending) return;
    const next = !isCutDone;
    cutDone.mutate(
      { id, done: next },
      {
        onSuccess: () => toast.success(next ? 'Marked as cut done.' : 'Cut-done cleared.'),
        onError: (e) => toast.error(e.message),
      }
    );
  }

  // material id → roll width (live from the catalog).
  const widthByMaterialId = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const m of materials ?? []) map.set(m.id, m.width_cm);
    return map;
  }, [materials]);

  const plan = useMemo(
    () => buildManufacturingPlan(order?.line_items ?? [], widthByMaterialId),
    [order?.line_items, widthByMaterialId]
  );

  const customerName = order?.customer
    ? `${order.customer.first_name} ${order.customer.last_name}`.trim()
    : '';

  const nothingToBuild =
    plan.aluminumGroups.length === 0 &&
    plan.fabricGroups.length === 0 &&
    plan.asIs.length === 0;

  // Only offer "Cut Done" when there is something to cut in-house.
  const hasCutWork = plan.aluminumGroups.length > 0 || plan.fabricGroups.length > 0;

  return (
    <div className="min-h-screen bg-surface-muted print:bg-white">
      <PageHeader
        title="Manufacturer Copy"
        backTo={id ? `/orders/${id}` : '/'}
        right={
          <button
            onClick={() => window.print()}
            className="flex h-9 items-center gap-1.5 rounded-sm border border-border-input bg-surface px-3 text-sm font-medium text-text-secondary hover:bg-surface-sunken print:hidden"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <path d="M6 14h12v8H6z" />
            </svg>
            Print
          </button>
        }
      />

      <div className="mx-auto max-w-3xl p-4 lg:p-8">
        {/* Order meta */}
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-text-primary">
            {order?.order_number ?? 'Order'}
          </h2>
          {(customerName || order?.order_date) && (
            <p className="text-sm text-text-muted">
              {[customerName, order?.order_date].filter(Boolean).join(' · ')}
            </p>
          )}
          <p className="mt-1 text-xs text-text-muted">
            Aluminium bars are 6 m. Fabric is cut across the full roll width — each course is cut to
            its tallest piece, then trimmed down.
          </p>
        </div>

        {isLoading && <p className="p-4 text-text-muted">Loading…</p>}
        {error && <p className="p-4 text-danger">{error.message}</p>}

        {order && (
          <div className="flex flex-col gap-4">
            {/* Warnings */}
            {plan.warnings.length > 0 && (
              <div className="rounded-lg border border-warning bg-warning-tint p-3 text-sm text-text-secondary">
                <p className="mb-1 font-semibold">Check these before cutting:</p>
                <ul className="list-disc pl-5">
                  {plan.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {nothingToBuild && (
              <p className="rounded-lg border border-border bg-surface p-4 text-text-muted">
                This order has no line items to manufacture yet.
              </p>
            )}

            {/* Aluminium */}
            {plan.aluminumGroups.map((g) => (
              <AluminumSection key={g.blindType} group={g} />
            ))}

            {/* Fabric */}
            {plan.fabricGroups.map((g) => (
              <FabricSection key={g.materialName} group={g} />
            ))}

            {/* Order as-is */}
            {plan.asIs.length > 0 && (
              <Card>
                <h3 className="mb-3 text-base font-semibold text-text-primary">
                  Order from factory (as-is)
                </h3>
                <ul className="flex flex-col divide-y divide-border-light">
                  {plan.asIs.map((item, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <span className="block truncate font-medium text-text-primary">
                          {item.label}
                        </span>
                        {item.detail && (
                          <span className="block truncate text-xs text-text-muted">{item.detail}</span>
                        )}
                      </div>
                      <span className="shrink-0 text-sm text-text-secondary">× {item.quantity}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {/* Cut-done milestone — reversible toggle; state persists on re-entry. */}
            {hasCutWork && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4 print:break-inside-avoid">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text-primary">Cut done</p>
                  <p className="text-xs text-text-muted">
                    {isCutDone && order.cut_done_at
                      ? `Cuts completed on ${formatStamp(order.cut_done_at)}`
                      : 'Turn on once the cutting is finished. You can turn it back off.'}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isCutDone}
                  aria-label="Cut done"
                  onClick={toggleCutDone}
                  disabled={cutDone.isPending}
                  className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                    isCutDone ? 'bg-success' : 'bg-border-input'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      isCutDone ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
