// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Customer-facing order progress tracker for the public order summary.
 *
 * Pure presentational: it takes an order status and renders four steps.
 * It owns no fetching, no state and no actions — `CustomerView.tsx`
 * decides whether to mount it at all.
 *
 * This tracker is why the app sends NO status-update emails to
 * customers: the same token'd link they confirmed through keeps working
 * as a live view of where their order stands.
 *
 * The four steps are deliberately NOT the internal statuses. Internal
 * names (`draft`, `sent`, `awaiting_payment`) are never shown to a
 * customer — `awaiting_payment` in particular would read as a demand
 * rather than a milestone, so it maps to "Confirmed" and the money
 * question is handled separately by the payment block.
 *
 * Only mounted once an order is confirmed, so `draft`/`sent`/`expired`
 * never reach it (an expired order is caught by a terminal message card
 * before this renders).
 */

/** One customer-facing milestone. */
interface Step {
  /** Internal statuses that place the customer on this step. */
  match: string[];
  label: string;
}

/**
 * Milestones in order. `installed` is terminal, so reaching it marks
 * every step complete rather than leaving the last one "current".
 */
const STEPS: Step[] = [
  { match: ['awaiting_payment'], label: 'Confirmed' },
  { match: ['in_progress'], label: 'In Production' },
  { match: ['ready'], label: 'Ready' },
  { match: ['installed'], label: 'Installed' },
];

/**
 * Renders the tracker for `status`.
 *
 * An unrecognised status yields index 0 rather than -1, so an order in
 * an unexpected state still renders sensibly instead of showing every
 * step as incomplete.
 */
export default function OrderProgress({ status }: { status: string }) {
  const idx = Math.max(
    0,
    STEPS.findIndex((s) => s.match.includes(status))
  );
  const allDone = status === 'installed';

  return (
    <section className="mb-4 rounded-2xl bg-surface-elevated p-4">
      <h2 className="mb-3 text-xs font-semibold text-text-muted">ORDER PROGRESS</h2>
      {/*
        Equal-width grid tracks, NOT flex: a flex item's automatic minimum
        size is its longest word, so labels like "In Production" would
        force this row — and the whole page — wider than a narrow phone.
        Same fix as the staff Progress timeline in OrderDetail.tsx.
      */}
      <ol
        className="grid items-start gap-1"
        style={{ gridTemplateColumns: `repeat(${STEPS.length}, minmax(0, 1fr))` }}
      >
        {STEPS.map((step, i) => {
          const done = allDone || i < idx;
          const current = !allDone && i === idx;
          return (
            <li key={step.label} className="flex min-w-0 flex-col items-center gap-1.5">
              <div className="flex w-full items-center">
                <span
                  className={`h-0.5 flex-1 ${
                    i === 0 ? 'invisible' : done || current ? 'bg-brand-600' : 'bg-border'
                  }`}
                />
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                    current
                      ? 'bg-brand-600 text-white'
                      : done
                        ? 'bg-brand-100 text-brand-600'
                        : 'bg-surface-sunken text-text-muted'
                  }`}
                >
                  {done ? '✓' : i + 1}
                </span>
                <span
                  className={`h-0.5 flex-1 ${
                    i === STEPS.length - 1 ? 'invisible' : done ? 'bg-brand-600' : 'bg-border'
                  }`}
                />
              </div>
              <span
                className={`w-full break-words text-center text-[10px] leading-tight ${
                  current ? 'font-semibold text-text-primary' : 'text-text-muted'
                }`}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
