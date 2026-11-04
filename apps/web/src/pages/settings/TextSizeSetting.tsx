// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Text size control on the Settings hub: a three-way segmented choice
 * (Default / Large / Extra large) that rescales every font in the app on
 * tap, with no save step — the change is visible at once, which is its
 * own confirmation. The choice is stored on this device only (see
 * `lib/fontSize.ts`); spacing, icons and tap targets do not change.
 *
 * Each option shows a sample "A" at a growing size so the choice reads
 * without the label. The sample sizes are fixed px (not the scaled
 * tokens) so the three samples keep their relative steps whatever size
 * is currently active.
 */

import { useState } from 'react';
import { FONT_SIZES, FONT_SIZE_LABELS, readStoredFontSize, saveFontSize, type FontSize } from '../../lib/fontSize';

/** Sample "A" size per option, fixed so the steps stay visible at any scale. */
const SAMPLE_PX: Record<FontSize, number> = { default: 14, large: 17, xlarge: 20 };

/** The Settings hub's Text size card. Stateless apart from mirroring the applied size. */
export default function TextSizeSetting() {
  const [size, setSize] = useState<FontSize>(readStoredFontSize);

  const choose = (next: FontSize) => {
    saveFontSize(next);
    setSize(next);
  };

  return (
    <div className="rounded-xl border border-border-light bg-surface p-4 shadow-sm sm:max-w-md">
      <p id="text-size-label" className="text-15px font-bold text-text-primary">
        Text size
      </p>
      <p className="mb-3 text-13px text-text-muted">Makes all text larger on this device</p>
      <div role="group" aria-labelledby="text-size-label" className="grid grid-cols-3 gap-2">
        {FONT_SIZES.map((s) => {
          const on = s === size;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              onClick={() => choose(s)}
              className={`flex min-w-0 flex-col items-center justify-center rounded-md border px-2 py-2 ${
                on
                  ? 'border-brand-600 bg-brand-100 text-brand-800'
                  : 'border-border-input bg-surface text-text-secondary hover:bg-surface-muted'
              }`}
            >
              <span aria-hidden="true" className="font-bold leading-none" style={{ fontSize: SAMPLE_PX[s] }}>
                A
              </span>
              <span className="mt-1 max-w-full text-center text-12px font-semibold leading-tight">
                {FONT_SIZE_LABELS[s]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
