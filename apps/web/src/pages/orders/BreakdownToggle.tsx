// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The price-breakdown switch on the order view's title row.
 *
 * ON is the SELLING state: it reveals what each individual choice cost
 * ("the cassette added $40, the motor $180"), which is what justifies a
 * price to a customer looking at the screen. The consultant flips it on
 * deliberately, with the tablet already turned around.
 *
 * It never governs a line total or an order total — those are on screen
 * in both states — so turning it off cannot make the page disagree with
 * the estimate the customer was sent. See `PresentationTable` for what it
 * does reach.
 *
 * `print:hidden` applies to the control alone, not its effect: whatever
 * state is on screen is what prints, because this page is now the only
 * printable order view and both states are legitimate paper.
 */
export default function BreakdownToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className="flex items-center gap-2 print:hidden"
    >
      <span className="text-[13px] font-medium text-text-secondary">Price breakdown</span>
      <span
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
          value ? 'bg-brand-600' : 'bg-border-input'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            value ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </span>
    </button>
  );
}
