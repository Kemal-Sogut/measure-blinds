// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Customer link page — `/c/:token/*`, token-gated, NO authentication.
 *
 * Loads `GET /public/customer/:token` with a plain fetch (like
 * `CustomerView`) and decides what to show:
 *  - `/c/:token`: one visible item → that estimate directly; none → the
 *    "nothing to review" state; otherwise `PortalList`.
 *  - `/c/:token/<order-number>`: that item in `CustomerView` (its own
 *    order token) with "← All your estimates" when there is a list to
 *    return to. A number not in the payload (lapsed, drafted, foreign)
 *    shows the list with "That estimate is no longer available."
 *
 * One route element serves both paths so moving between them does not
 * remount; the list is re-fetched each time the customer returns to it,
 * so an estimate confirmed a moment ago shows under "Your orders".
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import CustomerView from './CustomerView';
import PortalList from './PortalList';
import { maintenanceMessage } from '../../lib/maintenance';
import { portalLanding, type PortalPayload } from '../../lib/portal';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

export default function CustomerPortal() {
  const { token = '', '*': rest = '' } = useParams();
  const orderNumber = rest ? decodeURIComponent(rest.split('/')[0]) : '';
  const [payload, setPayload] = useState<PortalPayload | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // Read inside the effect without making it a dependency: a detail page
  // reuses the list it already has instead of fetching again.
  const loaded = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/public/customer/${token}`);
      const body = await res.json().catch(() => null);
      const closed = maintenanceMessage(res, body);
      if (closed) setFailure(closed);
      else if (!res.ok) {
        setFailure((body as { error?: string } | null)?.error ?? 'We could not find your estimates.');
      } else {
        setPayload((body as { data: PortalPayload }).data);
        loaded.current = true;
      }
    } catch {
      setFailure('Could not load your estimates. Please try again.');
    }
  }, [token]);

  // On the list (and on first load) fetch; on a detail page reuse what we have.
  useEffect(() => {
    if (!orderNumber || !loaded.current) void load();
  }, [orderNumber, load]);

  if (failure) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-muted p-6">
        <p className="max-w-sm text-center text-[15px] text-text-secondary">{failure}</p>
      </div>
    );
  }
  if (!payload) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-muted p-6 text-text-muted">
        Loading…
      </div>
    );
  }

  const landing = portalLanding(payload.items);

  if (orderNumber) {
    const item = payload.items.find((i) => i.order_number === orderNumber);
    if (!item) {
      return (
        <PortalList payload={payload} token={token} notice="That estimate is no longer available." />
      );
    }
    return (
      <CustomerView
        key={item.public_token}
        token={item.public_token}
        backTo={landing.kind === 'list' ? `/c/${token}` : undefined}
      />
    );
  }
  if (landing.kind === 'single') {
    return <CustomerView key={landing.item.public_token} token={landing.item.public_token} />;
  }
  return <PortalList payload={payload} token={token} />;
}
