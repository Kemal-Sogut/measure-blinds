// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Routing glue for staff order URLs (spec 2026-10-20).
 *
 * `/<customer-slug>/<order-number>[/<sub>]` is resolved here: the order
 * is loaded BY NUMBER, a non-canonical slug is `replace`-redirected (the
 * slug is cosmetic), and the existing page renders inside an
 * `OrderRouteIdContext` provider (see `orderRouteId.ts`) so it keeps
 * working with the order's uuid exactly as before. `/orders/:id[...]` and
 * `/estimates/:id` are kept as redirects, so ids in notifications, the
 * calendar, the inbox and old bookmarks still land on the right order.
 */

import { Navigate, useLocation, useParams } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import { ListSkeleton } from '../../components/Skeleton';
import { useOrder, useOrderByNumber } from '../../hooks/useOrders';
import { ORDER_SUB_PAGES, customerSlug, orderPath, type OrderSubPage } from '../../lib/orderPath';
import OrderDetail from './OrderDetail';
import OrderPresentation from './OrderPresentation';
import OrderLabels from './OrderLabels';
import ManufacturerCopy from './ManufacturerCopy';
import { OrderRouteIdContext } from './orderRouteId';

/** Not-found state shared by both resolvers. */
function OrderNotFound() {
  return (
    <div className="p-6">
      <EmptyState title="Order not found" hint="It may have been deleted, or the link is mistyped." />
    </div>
  );
}

/** Resolves `/<customer-slug>/<order-number>[/<sub>]` and renders the page. */
export default function OrderByNumberRoute() {
  const { customerSlug: urlSlug = '', orderNumber = '', sub } = useParams();
  const location = useLocation();
  const { data: order, isLoading, error } = useOrderByNumber(orderNumber);

  if (sub !== undefined && !(ORDER_SUB_PAGES as readonly string[]).includes(sub)) {
    return <OrderNotFound />;
  }
  if (isLoading) return <ListSkeleton />;
  if (error || !order) return <OrderNotFound />;

  const page = sub as OrderSubPage | undefined;
  if (urlSlug !== customerSlug(order.customer)) {
    return <Navigate to={`${orderPath(order, page)}${location.search}`} replace />;
  }

  return (
    <OrderRouteIdContext.Provider value={order.id}>
      {page === 'present' ? (
        <OrderPresentation key={order.id} />
      ) : page === 'labels' ? (
        <OrderLabels key={order.id} />
      ) : page === 'manufacturer' ? (
        <ManufacturerCopy key={order.id} />
      ) : (
        <OrderDetail key={order.id} />
      )}
    </OrderRouteIdContext.Provider>
  );
}

/** `/orders/:id[/<sub>]` → canonical URL, keeping the query string. */
export function LegacyOrderRedirect({ sub }: { sub?: OrderSubPage }) {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const { data: order, error } = useOrder(id);
  if (error) return <OrderNotFound />;
  if (!order) return <ListSkeleton />;
  return <Navigate to={`${orderPath(order, sub)}${location.search}`} replace />;
}
