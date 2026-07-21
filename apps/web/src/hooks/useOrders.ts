// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * TanStack Query hooks for the Orders module.
 *
 * The list hook combines a status tab with a debounced search term.
 * Create/update send measurements + option IDs only — the Worker
 * computes all money authoritatively and its response becomes the
 * cached detail. Lifecycle mutations (send estimate, confirm, reverse
 * confirmation, record payment, send receipt, complete) refresh both
 * detail and list caches. `downloadOrderPdf` streams the Estimate/Invoice PDF through
 * the authenticated download helper and triggers a browser save.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiFetch, apiDownload } from '../lib/api';
import { useDebouncedValue } from './useDebouncedValue';
import type { Order, OrderLog, OrderStatus, DiscountType } from '../types';

/** API envelope: every orders endpoint returns `{ data: T }`. */
interface Envelope<T> {
  data: T;
}

/** Status tabs shown on the orders list page. */
export type OrderTab =
  | 'all'
  | 'active'
  | 'awaiting_payment'
  | 'in_progress'
  | 'ready'
  | 'installed'
  | 'expired';

/** Blind line item payload — measurements + option ids, no prices. */
export interface BlindItemInput {
  item_type: 'blind';
  room_name: string;
  blinds_type: string;
  panels: number[];
  height_cm: number;
  material_id: string;
  cassette_id: string;
  control_id: string;
  color: string;
  note: string;
  quantity: number;
}

/** Preset/custom line item payload. */
export interface FlatItemInput {
  item_type: 'preset' | 'custom';
  description: string;
  quantity: number;
  unit_price: number;
}

export type LineItemInput = BlindItemInput | FlatItemInput;

/** Payload for POST /api/orders and PUT /api/orders/:id. */
export interface OrderInput {
  customer_id: string;
  order_date?: string;
  expiry_date?: string;
  discount_type: DiscountType;
  discount_value: number;
  line_items: LineItemInput[];
}

/** Payload for POST /api/orders/:id/payments. */
export interface PaymentInput {
  amount: number;
  paid_on?: string;
  note?: string;
  /** When applying a pending e-Transfer, its id (marks it resolved). */
  etransfer_id?: string;
}

/** An unmatched e-Transfer awaiting manual assignment to an order. */
export interface PendingEtransfer {
  id: string;
  amount: number;
  sender: string;
  reference_message: string;
  received_at: string;
  raw_snippet: string;
}

const LIST_KEY = ['orders', 'list'] as const;
const ETRANSFERS_KEY = ['payments', 'pending'] as const;

/** Order list filtered by status tab + debounced search term. */
export function useOrderList(tab: OrderTab, term: string): UseQueryResult<Order[]> {
  const q = useDebouncedValue(term.trim(), 300);
  return useQuery({
    queryKey: [...LIST_KEY, tab, q],
    queryFn: async () => {
      const params = new URLSearchParams({ status: tab });
      if (q) params.set('q', q);
      return (await apiFetch<Envelope<Order[]>>(`/api/orders?${params}`)).data;
    },
    placeholderData: keepPreviousData,
  });
}

/** One order with line items + customer + payments (disabled until id). */
export function useOrder(id: string | undefined): UseQueryResult<Order> {
  return useQuery({
    queryKey: ['orders', 'detail', id],
    queryFn: async () => (await apiFetch<Envelope<Order>>(`/api/orders/${id}`)).data,
    enabled: Boolean(id),
  });
}

/** An order's activity trail, newest first (disabled until id). */
export function useOrderLogs(id: string | undefined): UseQueryResult<OrderLog[]> {
  return useQuery({
    queryKey: ['orders', 'logs', id],
    queryFn: async () => (await apiFetch<Envelope<OrderLog[]>>(`/api/orders/${id}/logs`)).data,
    enabled: Boolean(id),
  });
}

/** Shared onSuccess: cache the server's authoritative order. */
function useCacheOrder() {
  const qc = useQueryClient();
  return (data: Order) => {
    qc.setQueryData(['orders', 'detail', data.id], data);
    void qc.invalidateQueries({ queryKey: LIST_KEY });
    void qc.invalidateQueries({ queryKey: ['orders', 'logs', data.id] });
  };
}

/** Creates an order; the Worker assigns order number + totals. */
export function useCreateOrder(): UseMutationResult<Order, Error, OrderInput> {
  const cache = useCacheOrder();
  return useMutation({
    mutationFn: async (input) =>
      (
        await apiFetch<Envelope<Order>>('/api/orders', {
          method: 'POST',
          body: JSON.stringify(input),
        })
      ).data,
    onSuccess: cache,
  });
}

/** Updates a draft/sent order with full server recalculation. */
export function useUpdateOrder(): UseMutationResult<Order, Error, { id: string; input: OrderInput }> {
  const cache = useCacheOrder();
  return useMutation({
    mutationFn: async ({ id, input }) =>
      (
        await apiFetch<Envelope<Order>>(`/api/orders/${id}`, {
          method: 'PUT',
          body: JSON.stringify(input),
        })
      ).data,
    onSuccess: cache,
  });
}

/** Small helper for the id-only lifecycle POST mutations. */
function useLifecycleMutation(path: (id: string) => string): UseMutationResult<Order, Error, string> {
  const cache = useCacheOrder();
  return useMutation({
    mutationFn: async (id) =>
      (await apiFetch<Envelope<Order>>(path(id), { method: 'POST' })).data,
    onSuccess: cache,
  });
}

/** Emails the estimate to the customer (status → sent on success). */
export function useSendOrder(): UseMutationResult<Order, Error, { id: string; message?: string }> {
  const cache = useCacheOrder();
  return useMutation({
    mutationFn: async ({ id, message }) =>
      (
        await apiFetch<Envelope<Order>>(`/api/orders/${id}/send`, {
          method: 'POST',
          body: JSON.stringify({ message }),
        })
      ).data,
    onSuccess: cache,
  });
}

/** Emails the invoice for a confirmed order — no stage change. */
export function useSendInvoice(): UseMutationResult<Order, Error, { id: string; message?: string }> {
  const cache = useCacheOrder();
  return useMutation({
    mutationFn: async ({ id, message }) =>
      (
        await apiFetch<Envelope<Order>>(`/api/orders/${id}/send-invoice`, {
          method: 'POST',
          body: JSON.stringify({ message }),
        })
      ).data,
    onSuccess: cache,
  });
}

/** User confirm (status → awaiting_payment). */
export function useConfirmOrder() {
  return useLifecycleMutation((id) => `/api/orders/${id}/confirm`);
}

/** Reverse a confirmation — user only (awaiting_payment → sent). */
export function useUnconfirmOrder() {
  return useLifecycleMutation((id) => `/api/orders/${id}/unconfirm`);
}

/** Move an awaiting-payment order to in-progress without a payment. */
export function useMarkInProgress() {
  return useLifecycleMutation((id) => `/api/orders/${id}/in-progress`);
}

/** Mark an in-progress order ready (goods ready to install). */
export function useMarkReady() {
  return useLifecycleMutation((id) => `/api/orders/${id}/ready`);
}

/**
 * Toggle the order's workshop "cuts done" milestone (Manufacturer Copy).
 * REVERSIBLE — pass `{ done: true }` to stamp it, `{ done: false }` to
 * clear it. The cached order comes back with `cut_done_at` set/cleared so
 * the page's switch reflects the new state immediately and on reload.
 */
export function useSetCutDone(): UseMutationResult<Order, Error, { id: string; done: boolean }> {
  const cache = useCacheOrder();
  return useMutation({
    mutationFn: async ({ id, done }) =>
      (
        await apiFetch<Envelope<Order>>(`/api/orders/${id}/cut-done`, {
          method: 'POST',
          body: JSON.stringify({ done }),
        })
      ).data,
    onSuccess: cache,
  });
}

/** Mark a ready order installed — the terminal state. */
export function useMarkInstalled() {
  return useLifecycleMutation((id) => `/api/orders/${id}/installed`);
}

/** Reverts an order to an earlier lifecycle stage (manual override). */
export function useRevertOrder(): UseMutationResult<
  Order,
  Error,
  { id: string; to: OrderStatus }
> {
  const cache = useCacheOrder();
  return useMutation({
    mutationFn: async ({ id, to }) =>
      (
        await apiFetch<Envelope<Order>>(`/api/orders/${id}/revert`, {
          method: 'POST',
          body: JSON.stringify({ to }),
        })
      ).data,
    onSuccess: cache,
  });
}

/** Deletes an order (and its line items + payments). */
export function useDeleteOrder(): UseMutationResult<{ id: string }, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) =>
      (await apiFetch<Envelope<{ id: string }>>(`/api/orders/${id}`, { method: 'DELETE' })).data,
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: ['orders', 'detail', id] });
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

/** Records a payment against an order (first one → in_progress). */
export function useRecordPayment(): UseMutationResult<
  Order,
  Error,
  { id: string; input: PaymentInput }
> {
  const cache = useCacheOrder();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }) =>
      (
        await apiFetch<Envelope<Order>>(`/api/orders/${id}/payments`, {
          method: 'POST',
          body: JSON.stringify(input),
        })
      ).data,
    onSuccess: (data) => {
      cache(data);
      // An applied e-Transfer leaves the pending inbox.
      void qc.invalidateQueries({ queryKey: ETRANSFERS_KEY });
    },
  });
}

/** Lists unmatched e-Transfers awaiting manual assignment. */
export function useUnmatchedEtransfers(): UseQueryResult<PendingEtransfer[]> {
  return useQuery({
    queryKey: ETRANSFERS_KEY,
    queryFn: async () =>
      (await apiFetch<Envelope<PendingEtransfer[]>>('/api/payments/pending')).data,
  });
}

/** Dismisses a pending e-Transfer (duplicate / refund / not ours). */
export function useDismissEtransfer(): UseMutationResult<{ id: string }, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) =>
      (
        await apiFetch<Envelope<{ id: string }>>(`/api/payments/${id}/dismiss`, {
          method: 'POST',
        })
      ).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ETRANSFERS_KEY }),
  });
}

/**
 * Emails the customer a branded receipt for one recorded payment
 * (POST /api/orders/:orderId/payments/:paymentId/receipt). The Worker
 * computes all money figures (paid-to-date, balance) itself, stamps
 * `receipt_sent_at` on the payment only after the email succeeds, and
 * returns the refreshed order detail, which replaces the cached order.
 * Fails with 400 when the customer has no email and 502 when the email
 * service errors — the payment row is unchanged on failure. Resending
 * is always allowed; a resend simply re-stamps `receipt_sent_at`.
 */
export function useSendReceipt(): UseMutationResult<
  Order,
  Error,
  { orderId: string; paymentId: string; message?: string }
> {
  const cache = useCacheOrder();
  return useMutation({
    mutationFn: async ({ orderId, paymentId, message }) =>
      (
        await apiFetch<Envelope<Order>>(`/api/orders/${orderId}/payments/${paymentId}/receipt`, {
          method: 'POST',
          body: JSON.stringify({ message }),
        })
      ).data,
    onSuccess: cache,
  });
}

/** Deletes a recorded payment from the ledger (auto-reverts status if needed). */
export function useDeletePayment(): UseMutationResult<
  Order,
  Error,
  { orderId: string; paymentId: string }
> {
  const cache = useCacheOrder();
  return useMutation({
    mutationFn: async ({ orderId, paymentId }) =>
      (
        await apiFetch<Envelope<Order>>(`/api/orders/${orderId}/payments/${paymentId}`, {
          method: 'DELETE',
        })
      ).data,
    onSuccess: cache,
  });
}

/**
 * Downloads the order document PDF (Estimate, or Invoice once paid) and
 * saves it as `{orderNumber}.pdf` via a temporary object URL (works in
 * iOS Safari and Android Chrome).
 */
export async function downloadOrderPdf(id: string, orderNumber: string): Promise<void> {
  const blob = await apiDownload(`/api/orders/${id}/pdf`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${orderNumber.replace(/[^\w-]/g, '_')}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
