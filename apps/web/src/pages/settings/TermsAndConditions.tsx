// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Terms & Conditions settings page.
 *
 * A single plain-text textarea persisted to the company_settings
 * singleton. Auto-saves 1.5s after the user stops typing (per the
 * plan), with a visible saved/saving indicator so the consultant
 * never wonders whether their edits stuck.
 */

import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import PageHeader from '../../components/PageHeader';
import { useCompanySettings, useUpdateCompanySettings } from '../../hooks/useSettings';

/** Delay after the last keystroke before auto-saving, in ms. */
const AUTOSAVE_DELAY_MS = 1500;

export default function TermsAndConditions() {
  const { data, isLoading, error } = useCompanySettings();
  const update = useUpdateCompanySettings();
  const [text, setText] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Populate once when data first arrives.
  useEffect(() => {
    if (data && text === null) setText(data.terms_and_conditions ?? '');
  }, [data, text]);

  // Debounced auto-save whenever the text changes after user input.
  useEffect(() => {
    if (!dirty || text === null) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      update.mutate(
        { terms_and_conditions: text },
        {
          onSuccess: () => setDirty(false),
          onError: (e) => toast.error(e.message),
        }
      );
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer.current);
    // `update` is stable per TanStack Query; text/dirty drive the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, dirty]);

  const status = update.isPending ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved';

  return (
    <div className="min-h-screen bg-surface-muted">
      <PageHeader title="Terms & Conditions" backTo="/settings" />
      <div className="mx-auto max-w-lg p-4">
        {isLoading || text === null ? (
          <p className="text-text-muted">{error ? error.message : 'Loading…'}</p>
        ) : (
          <>
            <div className="mb-2 text-right text-sm text-text-muted">{status}</div>
            <textarea
              rows={16}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setDirty(true);
              }}
              placeholder="Terms shown at the bottom of every estimate and PDF…"
              className="w-full rounded-xl border border-border bg-surface-elevated p-4 text-base text-text-primary"
            />
          </>
        )}
      </div>
    </div>
  );
}
