// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * TanStack Query hooks for the multi-estimate send.
 *
 * One action emails a customer a single link that covers several of their
 * estimates. `useSendableEstimates` feeds the send dialog's checklist (the
 * server has already applied every eligibility rule), and `useSendEstimates`
 * performs the send and refreshes whatever the send changed.
 *
 * Both talk to the `/api/customers/:id/...` route group and use the same
 * `{ data: T }` envelope convention as `useCustomers.ts`.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { SendableEstimate } from '../lib/estimateSelection';

/** API envelope: every customers endpoint returns `{ data: T }`. */
interface Envelope<T> {
  data: T;
}

/** Same key as `LIST_KEY` in `useOrders.ts`; a prefix of the flat and grouped lists. */
const ORDERS_LIST_KEY = ['orders', 'list'] as const;

/**
 * Cache key for one customer's sendable-estimates list. Shared by the query
 * and by the send mutation's invalidation so the two cannot drift apart.
 */
const sendableKey = (customerId: string | undefined) =>
  ['customers', customerId, 'sendable-estimates'] as const;

/**
 * Fetches the estimates the send dialog may offer for a customer
 * (`GET /api/customers/:id/sendable-estimates`), newest-created first.
 *
 * The server applies every eligibility rule, so the client never re-filters.
 * The query is inert until a customer id is provided, so the dialog can mount
 * before a customer is chosen. An unknown or soft-deleted customer surfaces as
 * a query error (the API answers 404).
 */
export function useSendableEstimates(
  customerId: string | undefined
): UseQueryResult<SendableEstimate[]> {
  return useQuery({
    queryKey: sendableKey(customerId),
    queryFn: async () =>
      (
        await apiFetch<Envelope<SendableEstimate[]>>(
          `/api/customers/${customerId}/sendable-estimates`
        )
      ).data,
    enabled: Boolean(customerId),
  });
}

/**
 * Result of `POST /api/customers/:id/send-estimates`.
 *
 * - `sent`: estimates marked as sent (status written) after the email went out.
 * - `announced`: estimates named in the email whose status was already `sent`,
 *   so nothing was written for them.
 * - `failed`: estimates the email named but whose row could not be marked.
 * - `customer_token`: the token of the customer link the email carried.
 */
export interface SendEstimatesResult {
  sent: string[];
  announced: string[];
  failed: Array<{ id: string; error: string }>;
  customer_token: string;
}

/**
 * Emails the customer one link covering the chosen estimates.
 *
 * A non-empty `failed` still comes back as HTTP 200 (the email went out, only
 * some rows were not marked), so `apiFetch` does not throw and the mutation
 * RESOLVES. Callers must inspect `failed` on the result rather than rely on
 * `onError`.
 *
 * On success this invalidates:
 * - the customer's sendable-estimates list, because sent estimates change what
 *   is eligible;
 * - the orders list prefix `['orders', 'list']`, which covers both the flat and
 *   the grouped Estimates page lists (status badges change);
 * - the detail and activity-log caches of every id in `sent` only. Ids in
 *   `announced` were not written, so nothing cached for them changed.
 */
export function useSendEstimates(): UseMutationResult<
  SendEstimatesResult,
  Error,
  { customerId: string; orderIds: string[]; message?: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ customerId, orderIds, message }) =>
      (
        await apiFetch<Envelope<SendEstimatesResult>>(
          `/api/customers/${customerId}/send-estimates`,
          {
            method: 'POST',
            body: JSON.stringify({ order_ids: orderIds, message }),
          }
        )
      ).data,
    onSuccess: (data, { customerId }) => {
      void qc.invalidateQueries({ queryKey: sendableKey(customerId) });
      void qc.invalidateQueries({ queryKey: ORDERS_LIST_KEY });
      for (const id of data.sent) {
        void qc.invalidateQueries({ queryKey: ['orders', 'detail', id] });
        void qc.invalidateQueries({ queryKey: ['orders', 'logs', id] });
      }
    },
  });
}
