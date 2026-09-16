// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The order's activity trail — the order page's Logs section.
 *
 * Moved out of `OrderDetail` unchanged in behaviour when the page became
 * sectioned: newest rows first as the API returns them, collapsed to
 * `LOG_PREVIEW_COUNT` rows behind a Show more toggle (the trail grows
 * with every lifecycle mutation), and customer-sourced rows tinted so
 * staff can tell what the customer did from what the office did.
 *
 * Owns its own query and expand flag: nothing else on the page reads
 * either, and the section only mounts while it is selected.
 */

import { useState } from 'react';
import { format } from 'date-fns';
import { useOrderLogs } from '../../hooks/useOrders';

/**
 * How many rows the collapsed trail shows. The newest slice is enough to
 * answer "what just happened"; the rest stays one tap away.
 */
const LOG_PREVIEW_COUNT = 10;

/** @param orderId The saved order whose trail to show. */
export default function OrderActivityLog({ orderId }: { orderId: string }) {
  const { data: logs, isLoading, error } = useOrderLogs(orderId);
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border-light bg-surface p-4 shadow-md">
      {isLoading && <p className="text-[13px] text-text-muted">Loading activity…</p>}
      {error && <p className="text-[13px] text-danger">{error.message}</p>}
      {logs && logs.length === 0 && (
        <p className="text-[13px] text-text-muted">No activity recorded yet.</p>
      )}
      {logs && logs.length > 0 && (
        <>
          {/*
            Padding is applied to every row, not just tinted ones, so the
            column alignment never shifts between customer and staff rows.
          */}
          <ul className="flex flex-col gap-2.5">
            {(expanded ? logs : logs.slice(0, LOG_PREVIEW_COUNT)).map((log) => (
              <li
                key={log.id}
                className={`flex justify-between gap-3 rounded-md px-2 py-1 text-[13px] ${log.source === 'customer' ? 'bg-info-tint' : ''
                  }`}
              >
                <span className="min-w-0 break-words text-text-secondary">{log.message}</span>
                <span className="shrink-0 whitespace-nowrap font-mono text-xs text-text-muted">
                  {format(new Date(log.created_at), 'MMM d, yyyy HH:mm')}
                </span>
              </li>
            ))}
          </ul>
          {logs.length > LOG_PREVIEW_COUNT && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="mt-0.5 self-start py-1 text-[13px] font-medium text-brand-600 hover:underline"
            >
              {expanded ? 'Show less' : `Show ${logs.length - LOG_PREVIEW_COUNT} more`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
