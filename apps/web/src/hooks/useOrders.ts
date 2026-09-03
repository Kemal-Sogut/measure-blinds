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
 * detail and list caches. `downloadOrderPdf` and `downloadWarrantyPdf`
 * stream the Estimate/Invoice and the warranty certificate through the
 * authenticated download helper and trigger a browser save.
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
import type { Order, OrderLog, OrderEditRequest, OrderStatus, DiscountType } from '../types';

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

/** One flat-priced extra sent with a line item. */
export interface AddonInput {
  label: string;
  price: number;
}

/**
 * The adjustment fields every line item may send.
 *
 * `unit_price_override` and `addons[].price` are, alongside a custom
 * item's own `unit_price`, the only money a client may dictate. The
 * Worker clamps both and writes every change to the order's activity
 * log — sending them is a declared exception to server-authoritative
 * pricing, not a hole in it.
 */
export interface AdjustmentInputFields {
  unit_price_override?: number | null;
  show_original_price?: boolean;
  addons?: AddonInput[];
}

/**
 * Identity and visibility, carried by every line-item payload.
 *
 * `uid` is omitted for an item that has never been saved — the Worker
 * mints one and returns it. Sending back the uid of a saved item is what
 * lets the Worker diff visibility across the wholesale line-item
 * replace, so it must round-trip untouched; position cannot stand in for
 * it, because it moves whenever items are added, removed or reordered.
 */
export interface ItemIdentityFields {
  uid?: string;
  hidden: boolean;
}

/** Blind line item payload — measurements + option ids, no base price. */
export interface BlindItemInput extends AdjustmentInputFields, ItemIdentityFields {
  item_type: 'blind';
  room_name: string;
  blinds_type: string;
  panels: number[];
  height_cm: number;
  material_id: string;
  /**
   * Hardware slots, each null when the selected blind type has no option
   * of that catalog scoped to it in Settings — which is also when the
   * form hides the dropdown. Sending an id for an unused slot is a 400,
   * and so is omitting one for a used slot (see `resolveLineItems`).
   */
  cassette_id: string | null;
  bottom_rail_id: string | null;
  control_id: string | null;
  installation_id: string | null;
  color: string;
  note: string;
  /** Typed per-type inputs; `{}` when the type declares none. */
  attributes: Record<string, string | number | boolean>;
  quantity: number;
}

/** Preset line item payload — a catalog reference the Worker prices. */
export interface PresetItemInput extends AdjustmentInputFields, ItemIdentityFields {
  item_type: 'preset';
  /** Null only for legacy rows saved before provenance existed. */
  preset_id: string | null;
  title: string;
  description: string;
  quantity: number;
  /** Sent ONLY when `preset_id` is null; otherwise the catalog wins. */
  unit_price?: number;
}

/**
 * Custom line item payload — free text and a freely typed price.
 *
 * `unit_price_override` is deliberately omitted from the inherited
 * fields: the Worker rejects it on a custom item with a 400, and letting
 * the type carry it would make that a runtime surprise instead of a
 * compile error.
 */
export interface CustomItemInput
  extends Omit<AdjustmentInputFields, 'unit_price_override'>,
    ItemIdentityFields {
  item_type: 'custom';
  title: string;
  description: string;
  quantity: number;
  unit_price: number;
}

export type LineItemInput = BlindItemInput | PresetItemInput | CustomItemInput;

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

/**
 * The customer's change requests for one order, newest first (disabled
 * until id). Includes resolved rows — the card filters to the open ones,
 * and keeping both in a single cache means resolving never refetches.
 */
export function useOrderEditRequests(
  id: string | undefined
): UseQueryResult<OrderEditRequest[]> {
  return useQuery({
    queryKey: ['orders', 'edit-requests', id],
    queryFn: async () =>
      (await apiFetch<Envelope<OrderEditRequest[]>>(`/api/orders/${id}/edit-requests`)).data,
    enabled: Boolean(id),
  });
}

/**
 * Marks one change request handled.
 *
 * The Worker answers with the order's REFRESHED list, which is written
 * straight into the query cache — the card re-renders from server truth
 * in one round-trip instead of refetching and flickering through a
 * loading state. The activity trail is invalidated too, since resolving
 * appends an entry to it.
 *
 * Nothing about the order itself changes, so the order detail cache is
 * deliberately left alone.
 */
export function useResolveEditRequest(): UseMutationResult<
  OrderEditRequest[],
  Error,
  { id: string; requestId: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, requestId }) =>
      (
        await apiFetch<Envelope<OrderEditRequest[]>>(
          `/api/orders/${id}/edit-requests/${requestId}/resolve`,
          { method: 'POST' }
        )
      ).data,
    onSuccess: (list, { id }) => {
      qc.setQueryData(['orders', 'edit-requests', id], list);
      void qc.invalidateQueries({ queryKey: ['orders', 'logs', id] });
    },
  });
}

/**
 * Fetches the order's public capability token, minting one server-side
 * if it has none. Backs the "Customer View" button, which must work on
 * a draft that was never sent (and therefore has no token yet).
 *
 * A mutation rather than a query because the call can create state. It
 * is idempotent, so retrying is always safe, and it invalidates the
 * order's log cache since a first mint appends a trail entry.
 */
export function useOrderPublicToken(): UseMutationResult<{ public_token: string }, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) =>
      (
        await apiFetch<Envelope<{ public_token: string }>>(`/api/orders/${id}/public-token`, {
          method: 'POST',
        })
      ).data,
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: ['orders', 'logs', id] });
    },
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

/**
 * Duplicates an order into a new draft and returns the COPY.
 *
 * Not built on `useLifecycleMutation` despite the identical call shape:
 * that helper caches the order it receives and invalidates that order's
 * logs, which here are the copy's. The source order also gains a trail
 * entry ("Duplicated to …"), so its log is invalidated explicitly —
 * otherwise coming back to it would show a stale trail.
 *
 * The caller navigates to `data.id`; this hook does no routing.
 */
export function useDuplicateOrder(): UseMutationResult<Order, Error, string> {
  const qc = useQueryClient();
  const cache = useCacheOrder();
  return useMutation({
    mutationFn: async (id) =>
      (await apiFetch<Envelope<Order>>(`/api/orders/${id}/duplicate`, { method: 'POST' })).data,
    onSuccess: (copy, sourceId) => {
      cache(copy);
      void qc.invalidateQueries({ queryKey: ['orders', 'logs', sourceId] });
    },
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

/**
 * Answers a customer's cancellation request (the red banner above the
 * order's Progress card).
 *
 * `accept: true` grants it — the Worker clears the request AND reverses
 * the confirmation (awaiting_payment → sent), refusing with 409 once a
 * payment exists. No email is sent; the customer's public page simply
 * shows the estimate with its Confirm button again.
 *
 * `accept: false` denies it — the request is cleared, the status is left
 * alone, and the customer is emailed. `message` is the optional
 * explanation shown in that email and is ignored when accepting. Denial
 * is email-then-persist, so a 502 leaves the request open for a retry
 * rather than dropping it silently.
 *
 * Either way the refreshed order detail replaces the cached order, so
 * the banner disappears without a manual refetch.
 */
export function useResolveCancelRequest(): UseMutationResult<
  Order,
  Error,
  { id: string; accept: boolean; message?: string }
> {
  const cache = useCacheOrder();
  return useMutation({
    mutationFn: async ({ id, accept, message }) =>
      (
        await apiFetch<Envelope<Order>>(`/api/orders/${id}/cancel-request/resolve`, {
          method: 'POST',
          body: JSON.stringify(accept ? { accept } : { accept, message }),
        })
      ).data,
    onSuccess: cache,
  });
}

/** Mark a ready order installed — the terminal state. */
export function useMarkInstalled() {
  return useLifecycleMutation((id) => `/api/orders/${id}/installed`);
}

/**
 * Sets an order to ANY lifecycle stage — the manual override behind the
 * Progress timeline, where a team member may jump forward, backward, or
 * across stages in one action.
 *
 * The Worker reconciles the order's stage timestamps and clears a stale
 * installation appointment, so the order it returns is authoritative and
 * goes straight into the detail cache (which also refreshes the list and
 * the activity log, since the move writes a log line).
 */
export function useSetOrderStatus(): UseMutationResult<
  Order,
  Error,
  { id: string; to: OrderStatus }
> {
  const cache = useCacheOrder();
  return useMutation({
    mutationFn: async ({ id, to }) =>
      (
        await apiFetch<Envelope<Order>>(`/api/orders/${id}/status`, {
          method: 'POST',
          body: JSON.stringify({ to }),
        })
      ).data,
    onSuccess: cache,
  });
}

/**
 * Deletes an order and everything attached to it — line items, activity
 * log, payments, change requests and the installation visit. The
 * customer and their estimate visits are kept.
 *
 * Three caches move, not one: the order's own detail entry is dropped
 * outright, the list reloads without it, and BOTH the calendar (its
 * installation visit is gone) and the pending e-Transfer inbox (any
 * transfer applied to this order is released back into it, server-side)
 * are invalidated — otherwise a consultant would still see a visit for
 * an order that no longer exists, or miss the freed transfer.
 */
export function useDeleteOrder(): UseMutationResult<{ id: string }, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) =>
      (await apiFetch<Envelope<{ id: string }>>(`/api/orders/${id}`, { method: 'DELETE' })).data,
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: ['orders', 'detail', id] });
      void qc.invalidateQueries({ queryKey: LIST_KEY });
      void qc.invalidateQueries({ queryKey: ['appointments'] });
      void qc.invalidateQueries({ queryKey: ETRANSFERS_KEY });
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

/**
 * Emails (or re-emails) the warranty certificate for a fully paid order,
 * with an optional consultant note.
 *
 * The certificate is normally sent automatically the moment a payment
 * clears the balance, so this backs a recovery action rather than the
 * happy path: a send that failed, an email address added after the fact,
 * a $0 order that never had a payment to trigger on, or a customer who
 * lost the email. The Worker rejects it with 409 while any balance is
 * outstanding, so the caller must only offer it on a settled order.
 */
export function useSendWarranty(): UseMutationResult<
  Order,
  Error,
  { id: string; message?: string }
> {
  const cache = useCacheOrder();
  return useMutation({
    mutationFn: async ({ id, message }) =>
      (
        await apiFetch<Envelope<Order>>(`/api/orders/${id}/warranty`, {
          method: 'POST',
          body: JSON.stringify({ message }),
        })
      ).data,
    onSuccess: cache,
  });
}

/**
 * Downloads the warranty certificate PDF — the staff copy of exactly
 * what the customer was emailed — as `{orderNumber}-warranty.pdf`.
 *
 * Sends nothing, so it works for a customer with no email on file. Like
 * the send action it is only valid once the order is paid in full; the
 * Worker answers 409 otherwise.
 */
export async function downloadWarrantyPdf(id: string, orderNumber: string): Promise<void> {
  const blob = await apiDownload(`/api/orders/${id}/warranty-pdf`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${orderNumber.replace(/[^\w-]/g, '_')}-warranty.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
