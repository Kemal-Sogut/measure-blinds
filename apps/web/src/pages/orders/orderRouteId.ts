// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * How an order page learns which order it shows.
 *
 * `/<customer-slug>/<order-number>` has no uuid in the URL, so
 * `OrderByNumberRoute` resolves the number and supplies the uuid through
 * `OrderRouteIdContext`. Pages call `useOrderRouteId()`, which prefers the
 * context and falls back to a `:id` route param, so `/orders/new` (no
 * provider, no param → `undefined`) keeps its create behaviour.
 *
 * Kept free of components so the order pages can import it without an
 * import cycle through `orderRoute.tsx`.
 */

import { createContext, useContext } from 'react';
import { useParams } from 'react-router-dom';

/** The resolved order uuid; `undefined` outside a by-number route. */
export const OrderRouteIdContext = createContext<string | undefined>(undefined);

/** The current order's uuid: from the context, else the `:id` param. */
export function useOrderRouteId(): string | undefined {
  const fromContext = useContext(OrderRouteIdContext);
  const { id } = useParams<{ id: string }>();
  return fromContext ?? id;
}
