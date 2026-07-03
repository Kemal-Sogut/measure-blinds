// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * DatePicker — the app-wide date input (estimate date, expiry date).
 *
 * Renders a labeled ≥44px trigger button showing the formatted date;
 * tapping opens `react-day-picker` in a bottom-sheet on small screens
 * and a centered dialog on ≥640px screens (both are one overlay
 * implementation — CSS decides the placement, so behavior is
 * identical across browsers per plan §9.6 / Phase 10 item 10).
 *
 * Dates are passed as `Date` objects; the calling page owns
 * formatting to ISO for the API.
 */

import { useState } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import { format } from 'date-fns';

export default function DatePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Date | null;
  onChange: (date: Date) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <span className="block text-sm font-medium text-text-secondary">{label}</span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 flex h-11 w-full items-center justify-between rounded-lg border border-border bg-surface px-3 text-base text-text-primary"
      >
        {value ? format(value, 'MMM d, yyyy') : 'Select date'}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            className="text-text-muted"
          />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-label={`Choose ${label}`}
        >
          <div
            className="w-full rounded-t-2xl bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:w-auto sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold text-text-primary">{label}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-text-muted hover:bg-surface-muted"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <DayPicker
              mode="single"
              selected={value ?? undefined}
              defaultMonth={value ?? new Date()}
              onSelect={(d) => {
                if (d) {
                  onChange(d);
                  setOpen(false);
                }
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
