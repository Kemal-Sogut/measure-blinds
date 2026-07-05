// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Order detail/editor — the most complex screen in the app.
 *
 * While an order is draft/sent it behaves as an estimate editor:
 * customer, dates, line items with live pricing, discount, totals, and
 * a Send Estimate / Save / Confirm / PDF action set.
 *
 * Once confirmed the order becomes read-only and grows a Payments panel
 * (balance = total − payments). Payments can be applied at ANY
 * post-confirmation stage. Stage actions:
 *   awaiting_payment → Record Payment, Reverse Confirmation (user only)
 *   in_progress      → Record Payment, Mark Ready
 *   ready            → Propose Installation, Mark Installed, Record Payment
 *   installed        → Record Payment, Download Invoice
 *
 * The generated PDF is an Estimate until the first payment is recorded,
 * after which it is an Invoice.
 *
 * All client-side money is a live preview from lib/pricing +
 * lib/totals; the Worker recomputes authoritatively on save.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import PageHeader from '../../components/PageHeader';
import DatePicker from '../../components/DatePicker';
import StatusBadge from '../../components/StatusBadge';
import { calculateTotals } from '../../lib/totals';
import {
  useOrder,
  useCreateOrder,
  useUpdateOrder,
  useSendOrder,
  useSendInvoice,
  useConfirmOrder,
  useUnconfirmOrder,
  useMarkReady,
  useMarkInstalled,
  useProposeInstallation,
  useCancelInstallation,
  useRevertOrder,
  useDeleteOrder,
  useRecordPayment,
  useDeletePayment,
  downloadOrderPdf,
  type OrderInput,
  type LineItemInput,
} from '../../hooks/useOrders';
import { useCustomerSearch } from '../../hooks/useCustomers';
import { useCatalogList, useCompanySettings } from '../../hooks/useSettings';
import {
  BlindEditForm,
  FlatEditForm,
  BulkEditForm,
  blindDraftPrice,
  flatDraftPrice,
  parsePositive,
  type BlindDraft,
  type FlatDraft,
  type ItemDraft,
  type Catalogs,
  type BulkEditState,
} from './LineItemEditor';
import type { Customer, Order, OrderStatus, Fabric, CassetteOption, ControlOption, PresetLineItem, DiscountType } from '../../types';

/** Formats a Date as the API's YYYY-MM-DD. */
function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parses YYYY-MM-DD as a local Date (no UTC shift). */
function fromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Unique keys for list rendering of drafts. */
let draftSeq = 0;
function nextKey(): string {
  return `d${++draftSeq}`;
}

/** Converts persisted line items into editable drafts. */
function toDrafts(order: Order): ItemDraft[] {
  return (order.line_items ?? []).map((li) => {
    if (li.item_type === 'blind') {
      return {
        key: nextKey(),
        item_type: 'blind',
        room_name: li.room_name,
        blinds_type: li.blinds_type,
        panels: li.panels.map(String),
        height_cm: String(li.height_cm ?? ''),
        fabric_id: li.fabric_id ?? '',
        cassette_id: li.cassette_id ?? '',
        control_id: li.control_id ?? '',
        quantity: String(li.quantity),
      } satisfies BlindDraft;
    }
    return {
      key: nextKey(),
      item_type: li.item_type,
      description: li.description,
      quantity: String(li.quantity),
      unit_price: String(li.unit_price),
    } satisfies FlatDraft;
  });
}

/** Short label for a draft in the live-pricing rail. */
function draftLabel(it: ItemDraft, index: number): string {
  if (it.item_type === 'blind') {
    return [it.room_name || `Blind ${index + 1}`, it.blinds_type].filter(Boolean).join(' — ');
  }
  return it.description || `Item ${index + 1}`;
}

const POST_CONFIRM = ['awaiting_payment', 'in_progress', 'ready', 'installed'] as const;

/** Linear lifecycle stages shown in the progress timeline. */
const STAGES: { key: OrderStatus; label: string }[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'sent', label: 'Sent' },
  { key: 'awaiting_payment', label: 'Awaiting Payment' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'ready', label: 'Ready' },
  { key: 'installed', label: 'Installed' },
];

/** Formats "HH:MM" (24h) as "2:00 PM". */
function to12Hour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/** "HH:MM:SS" or "HH:MM" → the one-hour window "2:00 PM – 3:00 PM". */
function installWindowText(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const end = `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return `${to12Hour(`${h}:${m}`)} – ${to12Hour(end)}`;
}

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: existing, isLoading: loadingExisting, error: loadError } = useOrder(id);

  const fabricsQ = useCatalogList<Fabric>('fabrics');
  const cassettesQ = useCatalogList<CassetteOption>('cassette-options');
  const controlsQ = useCatalogList<ControlOption>('control-options');
  const presetsQ = useCatalogList<PresetLineItem>('presets');
  const { data: company } = useCompanySettings();

  const createMut = useCreateOrder();
  const updateMut = useUpdateOrder();
  const sendMut = useSendOrder();
  const sendInvoiceMut = useSendInvoice();
  const confirmMut = useConfirmOrder();
  const unconfirmMut = useUnconfirmOrder();
  const readyMut = useMarkReady();
  const installedMut = useMarkInstalled();
  const proposeMut = useProposeInstallation();
  const cancelInstallMut = useCancelInstallation();
  const revertMut = useRevertOrder();
  const deleteMut = useDeleteOrder();
  const paymentMut = useRecordPayment();
  const deletePaymentMut = useDeletePayment();

  // ── Editor state ────────────────────────────────────────────────
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orderDate, setOrderDate] = useState<Date>(new Date());
  const [expiryDate, setExpiryDate] = useState<Date | null>(null);
  const [expiryManual, setExpiryManual] = useState(false);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [discountType, setDiscountType] = useState<DiscountType>('fixed');
  const [discountValue, setDiscountValue] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [sheet, setSheet] = useState<'none' | 'customer' | 'preset' | 'payment' | 'install' | 'send' | 'editItem' | 'bulkEdit'>('none');

  // ── Line item selection / edit state ────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ItemDraft | null>(null);
  // Key of a just-added item whose editor is open for the first time;
  // canceling that editor discards the still-blank item.
  const [pendingNewKey, setPendingNewKey] = useState<string | null>(null);
  const [bulkState, setBulkState] = useState<BulkEditState>({ fabric_id: '', cassette_id: '', control_id: '' });
  const [customerTerm, setCustomerTerm] = useState('');
  const customersQ = useCustomerSearch(customerTerm);

  // Payment entry form state (used by the Record Payment sheet).
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState<Date>(new Date());
  const [payNote, setPayNote] = useState('');

  // Installation proposal form state (Propose Installation sheet).
  const [installDate, setInstallDate] = useState<Date>(new Date());
  const [installTime, setInstallTime] = useState('09:00');
  const [installMessage, setInstallMessage] = useState('');

  // Send estimate/invoice sheet — optional note included in the email.
  const [sendMessage, setSendMessage] = useState('');

  // Hydrate once from a loaded order.
  useEffect(() => {
    if (id && existing && !hydrated) {
      setCustomer(existing.customer ?? null);
      setOrderDate(fromIso(existing.order_date));
      setExpiryDate(fromIso(existing.expiry_date));
      setExpiryManual(true); // persisted expiry counts as chosen
      setItems(toDrafts(existing));
      setDiscountType(existing.discount_type);
      setDiscountValue(existing.discount_value ? String(existing.discount_value) : '');
      setHydrated(true);
    }
  }, [id, existing, hydrated]);

  // Auto-default expiry = order date + default_expiry_days until the
  // consultant picks an expiry manually.
  useEffect(() => {
    if (expiryManual) return;
    const days = company?.default_expiry_days ?? 14;
    const d = new Date(orderDate);
    d.setDate(d.getDate() + days);
    setExpiryDate(d);
  }, [orderDate, company, expiryManual]);

  const catalogs: Catalogs = useMemo(
    () => ({
      fabrics: fabricsQ.data ?? [],
      cassettes: cassettesQ.data ?? [],
      controls: controlsQ.data ?? [],
    }),
    [fabricsQ.data, cassettesQ.data, controlsQ.data]
  );

  // ── Live totals (client preview; server recomputes on save) ────
  const itemPrices = useMemo(
    () =>
      items.map((it) =>
        it.item_type === 'blind'
          ? blindDraftPrice(it, catalogs)?.total ?? 0
          : flatDraftPrice(it)?.total ?? 0
      ),
    [items, catalogs]
  );
  const totals = useMemo(
    () =>
      calculateTotals({
        lineTotals: itemPrices,
        discount_type: discountType,
        discount_value: Number(discountValue) || 0,
      }),
    [itemPrices, discountType, discountValue]
  );

  const status = existing?.status ?? 'draft';
  const readOnly = Boolean(id) && !['draft', 'sent'].includes(status);
  const postConfirm = POST_CONFIRM.includes(status as (typeof POST_CONFIRM)[number]);
  const saving = createMut.isPending || updateMut.isPending;
  const canAct = !readOnly && !saving;

  // Estimate until confirmed; Invoice once confirmed. Drives the Send /
  // Download button labels and which email is sent.
  const isInvoice = postConfirm;
  const docLabel = isInvoice ? 'Invoice' : 'Estimate';

  // Authoritative money for confirmed orders comes from the server row.
  const orderTotal = Number(existing?.total ?? totals.total);
  const amountPaid = Number(existing?.amount_paid ?? 0);
  const balance = Math.round((orderTotal - amountPaid) * 100) / 100;

  // ── Draft list operations ───────────────────────────────────────
  function removeItem(key: string) {
    setItems((list) => list.filter((it) => it.key !== key));
  }
  function addBlind() {
    const draft: BlindDraft = {
      key: nextKey(),
      item_type: 'blind',
      room_name: '',
      blinds_type: '',
      panels: [''],
      height_cm: '',
      fabric_id: '',
      cassette_id: '',
      control_id: '',
      quantity: '1',
    };
    setItems((list) => [...list, draft]);
    openNewItemEdit(draft);
  }
  function addPreset(preset: PresetLineItem) {
    setItems((list) => [
      ...list,
      {
        key: nextKey(),
        item_type: 'preset',
        description: preset.description ? `${preset.name} — ${preset.description}` : preset.name,
        quantity: '1',
        unit_price: String(preset.unit_price),
      },
    ]);
    setSheet('none');
  }
  function addCustom() {
    const draft: FlatDraft = {
      key: nextKey(),
      item_type: 'custom',
      description: '',
      quantity: '1',
      unit_price: '',
    };
    setItems((list) => [...list, draft]);
    openNewItemEdit(draft);
  }

  /** Opens the edit popup for a freshly-added item (discarded on cancel). */
  function openNewItemEdit(draft: ItemDraft) {
    setEditDraft({ ...draft } as ItemDraft);
    setEditingKey(draft.key);
    setPendingNewKey(draft.key);
    setSheet('editItem');
  }

  // ── Selection helpers ─────────────────────────────────────────────
  function toggleSelect(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((it) => it.key)));
    }
  }

  function handleBulkDelete() {
    if (selected.size === 0) return;
    if (!window.confirm(`Delete ${selected.size} item${selected.size > 1 ? 's' : ''}?`)) return;
    setItems((list) => list.filter((it) => !selected.has(it.key)));
    setSelected(new Set());
  }

  // ── Individual item edit ──────────────────────────────────────────
  function openEdit(key: string) {
    const item = items.find((it) => it.key === key);
    if (!item) return;
    setEditDraft({ ...item } as ItemDraft);
    setEditingKey(key);
    setSheet('editItem');
  }

  function saveEdit() {
    if (!editDraft || !editingKey) return;
    setItems((list) => list.map((it) => (it.key === editingKey ? editDraft : it)));
    setEditDraft(null);
    setEditingKey(null);
    setPendingNewKey(null);
    setSheet('none');
  }

  function cancelEdit() {
    // A brand-new item that was never saved is removed on cancel.
    if (pendingNewKey) removeItem(pendingNewKey);
    setEditDraft(null);
    setEditingKey(null);
    setPendingNewKey(null);
    setSheet('none');
  }

  // ── Bulk edit (fabric / cassette / control only) ──────────────────
  function openBulkEdit() {
    setBulkState({ fabric_id: '', cassette_id: '', control_id: '' });
    setSheet('bulkEdit');
  }

  function applyBulkEdit() {
    setItems((list) =>
      list.map((it) => {
        if (!selected.has(it.key) || it.item_type !== 'blind') return it;
        const patch: Partial<BlindDraft> = {};
        if (bulkState.fabric_id) patch.fabric_id = bulkState.fabric_id;
        if (bulkState.cassette_id) patch.cassette_id = bulkState.cassette_id;
        if (bulkState.control_id) patch.control_id = bulkState.control_id;
        return { ...it, ...patch };
      })
    );
    setSelected(new Set());
    setSheet('none');
  }

  /**
   * Validates drafts and builds the API payload.
   * Returns a string error message when something is incomplete.
   */
  function buildPayload(): OrderInput | string {
    if (!customer) return 'Select a customer first.';
    if (!expiryDate) return 'Pick an expiry date.';
    const line_items: LineItemInput[] = [];
    for (const [i, it] of items.entries()) {
      if (it.item_type === 'blind') {
        const panels = it.panels.map(parsePositive);
        const height = parsePositive(it.height_cm);
        const qty = parsePositive(it.quantity);
        if (panels.some((p) => p === null) || !panels.length)
          return `Item ${i + 1}: enter every panel width.`;
        if (!height) return `Item ${i + 1}: enter a height.`;
        if (!it.fabric_id || !it.cassette_id || !it.control_id)
          return `Item ${i + 1}: choose fabric, cassette, and control.`;
        if (!qty) return `Item ${i + 1}: enter a quantity.`;
        line_items.push({
          item_type: 'blind',
          room_name: it.room_name.trim(),
          blinds_type: it.blinds_type.trim(),
          panels: panels as number[],
          height_cm: height,
          fabric_id: it.fabric_id,
          cassette_id: it.cassette_id,
          control_id: it.control_id,
          quantity: Math.round(qty),
        });
      } else {
        const qty = parsePositive(it.quantity);
        const unit = Number(it.unit_price);
        if (!it.description.trim()) return `Item ${i + 1}: enter a description.`;
        if (!qty) return `Item ${i + 1}: enter a quantity.`;
        if (!Number.isFinite(unit) || unit < 0) return `Item ${i + 1}: enter a unit price.`;
        line_items.push({
          item_type: it.item_type,
          description: it.description.trim(),
          quantity: Math.round(qty),
          unit_price: unit,
        });
      }
    }
    return {
      customer_id: customer.id,
      order_date: toIso(orderDate),
      expiry_date: toIso(expiryDate),
      discount_type: discountType,
      discount_value: Number(discountValue) || 0,
      line_items,
    };
  }

  /** Saves (create or update); resolves to the saved order id. */
  async function save(): Promise<string | null> {
    const payload = buildPayload();
    if (typeof payload === 'string') {
      toast.error(payload);
      return null;
    }
    try {
      const saved = id
        ? await updateMut.mutateAsync({ id, input: payload })
        : await createMut.mutateAsync(payload);
      if (!id) navigate(`/orders/${saved.id}`, { replace: true });
      return saved.id;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed.');
      return null;
    }
  }

  async function handleSaveDraft() {
    if (await save()) toast.success('Order saved.');
  }

  /** Opens the send sheet (message box) for the current mode. */
  function openSend() {
    if (!customer?.email) return toast.error('This customer has no email address.');
    setSendMessage('');
    setSheet('send');
  }

  /** Submits the send sheet — estimate or invoice depending on mode. */
  async function submitSend() {
    const message = sendMessage.trim() || undefined;
    if (isInvoice) {
      await handleSendInvoice(message);
    } else {
      await handleSendEstimate(message);
    }
  }

  async function handleSendEstimate(message?: string) {
    if (!customer?.email) return toast.error('This customer has no email address.');
    const savedId = await save();
    if (!savedId) return;
    try {
      await sendMut.mutateAsync({ id: savedId, message });
      toast.success(`Estimate sent to ${customer.email}.`);
      setSheet('none');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Send failed.');
    }
  }

  async function handleSendInvoice(message?: string) {
    if (!id) return;
    if (!customer?.email) return toast.error('This customer has no email address.');
    try {
      await sendInvoiceMut.mutateAsync({ id, message });
      toast.success(`Invoice sent to ${customer.email}.`);
      setSheet('none');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Send failed.');
    }
  }

  async function handleConfirm() {
    const savedId = await save();
    if (!savedId) return;
    try {
      await confirmMut.mutateAsync(savedId);
      toast.success('Order confirmed — awaiting payment.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Confirm failed.');
    }
  }

  async function handleReverse() {
    if (!id) return;
    try {
      await unconfirmMut.mutateAsync(id);
      toast.success('Confirmation reversed — back to sent.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reverse failed.');
    }
  }

  async function handleMarkReady() {
    if (!id) return;
    try {
      await readyMut.mutateAsync(id);
      toast.success('Order marked ready.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not mark ready.');
    }
  }

  async function handleMarkInstalled() {
    if (!id) return;
    try {
      await installedMut.mutateAsync(id);
      toast.success('Order marked installed.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not mark installed.');
    }
  }

  /** Opens the installation sheet, prefilled from an existing proposal. */
  function openInstallSheet() {
    if (existing?.install_date) setInstallDate(fromIso(existing.install_date));
    if (existing?.install_time) setInstallTime(existing.install_time.slice(0, 5));
    setInstallMessage('');
    setSheet('install');
  }

  async function submitInstallProposal() {
    if (!id) return;
    try {
      await proposeMut.mutateAsync({
        id,
        input: {
          install_date: toIso(installDate),
          install_time: installTime,
          message: installMessage.trim() || undefined,
        },
      });
      toast.success(`Installation time emailed to ${customer?.email ?? 'the customer'}.`);
      setSheet('none');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send proposal.');
    }
  }

  async function handleCancelInstall() {
    if (!id) return;
    if (!window.confirm('Remove the set installation time?')) return;
    try {
      await cancelInstallMut.mutateAsync(id);
      toast.success('Installation time removed.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove the time.');
    }
  }

  async function handleRevert(to: OrderStatus) {
    if (!id) return;
    const label = STAGES.find((s) => s.key === to)?.label ?? to;
    if (!window.confirm(`Revert this order back to "${label}"? Later-stage progress is cleared.`)) return;
    try {
      await revertMut.mutateAsync({ id, to });
      toast.success(`Reverted to ${label}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Revert failed.');
    }
  }

  async function handleDeleteOrder() {
    if (!id) return;
    if (!window.confirm('Delete this order permanently? Its line items and payments are removed.')) return;
    try {
      await deleteMut.mutateAsync(id);
      toast.success('Order deleted.');
      navigate('/orders');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed.');
    }
  }

  async function handleDeletePayment(paymentId: string) {
    if (!id) return;
    if (!window.confirm('Delete this payment? This cannot be undone.')) return;
    try {
      await deletePaymentMut.mutateAsync({ orderId: id, paymentId });
      toast.success('Payment deleted.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete payment.');
    }
  }

  /**
   * Which forward stages the current status may jump to directly.
   * Intermediate steps can be skipped (e.g. Awaiting Payment → Ready).
   * 'in_progress' is never a manual target — it is reached by recording
   * the first payment.
   */
  const ADVANCE_TARGETS: Record<string, OrderStatus[]> = {
    draft: ['sent', 'awaiting_payment'],
    sent: ['awaiting_payment'],
    awaiting_payment: ['ready', 'installed'],
    in_progress: ['ready', 'installed'],
    ready: ['installed'],
  };
  const canAdvanceTo = (target: OrderStatus): boolean =>
    (ADVANCE_TARGETS[status] ?? []).includes(target);

  /**
   * Advances the order forward to the given target stage. Any later
   * stage the backend supports may be chosen; skipped stages are simply
   * marked done.
   */
  async function handleAdvance(target: OrderStatus) {
    if (!id) return;
    const label = STAGES.find((s) => s.key === target)?.label ?? target;
    if (!window.confirm(`Advance this order to "${label}"?`)) return;
    try {
      if (target === 'sent') {
        await sendMut.mutateAsync({ id });
      } else if (target === 'awaiting_payment') {
        await confirmMut.mutateAsync(id);
      } else if (target === 'ready') {
        await readyMut.mutateAsync(id);
      } else if (target === 'installed') {
        await installedMut.mutateAsync(id);
      }
      toast.success(`Advanced to ${label}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not advance.');
    }
  }

  /** Opens the payment sheet with an empty amount. */
  function openPayment() {
    setPayAmount('');
    setPayDate(new Date());
    setPayNote('');
    setSheet('payment');
  }

  async function submitPayment() {
    if (!id) return;
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) return toast.error('Enter a payment amount.');
    try {
      await paymentMut.mutateAsync({
        id,
        input: { amount, paid_on: toIso(payDate), note: payNote.trim() },
      });
      toast.success('Payment recorded.');
      setSheet('none');
      setPayAmount('');
      setPayNote('');
      setPayDate(new Date());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record payment.');
    }
  }

  async function handlePdf() {
    const savedId = id ?? (await save());
    if (!savedId) return;
    try {
      await downloadOrderPdf(savedId, existing?.order_number ?? 'order');
      toast.success(`${docLabel} downloaded.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'PDF failed.');
    }
  }

  // ── Render ──────────────────────────────────────────────────────
  if (id && loadingExisting) {
    return (
      <div className="min-h-screen bg-surface-muted">
        <PageHeader title="Order" backTo="/orders" />
        <p className="p-4 text-text-muted">Loading…</p>
      </div>
    );
  }
  if (id && loadError) {
    return (
      <div className="min-h-screen bg-surface-muted">
        <PageHeader title="Order" backTo="/orders" />
        <p className="p-4 text-danger">{loadError.message}</p>
      </div>
    );
  }

  /** Shared discount control (mobile totals card + desktop rail). */
  const discountControl = (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[13px] text-text-secondary">Discount</span>
      <span className="flex items-center gap-2">
        <span className="flex rounded-sm bg-surface-sunken p-0.5">
          {(['fixed', 'percent'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setDiscountType(t)}
              className={`h-9 min-h-9 rounded-sm px-3 text-xs font-semibold ${
                discountType === t ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted'
              }`}
            >
              {t === 'fixed' ? '$' : '%'}
            </button>
          ))}
        </span>
        <input
          inputMode="decimal"
          value={discountValue}
          onChange={(e) => setDiscountValue(e.target.value)}
          placeholder="0"
          className="h-9 min-h-9 w-20 rounded-sm border border-border-input bg-surface px-2 text-right font-mono text-[13px]"
          aria-label="Discount value"
        />
      </span>
    </div>
  );

  /** Shared totals rows (subtotal → discount → taxable → HST → total). */
  const totalsRows = (
    <>
      <div className="flex justify-between">
        <span className="text-[13px] text-text-secondary">Subtotal</span>
        <span className="font-mono text-[13px] text-text-primary">${totals.subtotal.toFixed(2)}</span>
      </div>
      {totals.discount_amount > 0 && (
        <>
          <div className="flex justify-between text-text-muted">
            <span className="text-[13px]">Discount applied</span>
            <span className="font-mono text-[13px]">−${totals.discount_amount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[13px] text-text-secondary">Taxable amount</span>
            <span className="font-mono text-[13px] text-text-primary">
              ${totals.taxable_amount.toFixed(2)}
            </span>
          </div>
        </>
      )}
      <div className="flex justify-between">
        <span className="text-[13px] text-text-secondary">
          HST 13%
          {company?.hst_number && (
            <span className="ml-1 text-[10px] text-text-muted">HST# {company.hst_number}</span>
          )}
        </span>
        <span className="font-mono text-[13px] text-text-primary">${totals.tax_amount.toFixed(2)}</span>
      </div>
      <div className="flex items-baseline justify-between border-t border-border pt-2.5">
        <span className="text-sm font-semibold text-text-primary">Total</span>
        <span className="font-mono text-xl font-semibold text-text-primary">
          ${totals.total.toFixed(2)}
        </span>
      </div>
    </>
  );

  /** Payments + balance panel (confirmed orders only). */
  const paymentsPanel = postConfirm && (
    <section className="flex flex-col gap-2 rounded-sm border border-border bg-surface p-4">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary">Payments</h2>
        <StatusBadge status={status} />
      </div>
      <div className="flex justify-between">
        <span className="text-[13px] text-text-secondary">Order total</span>
        <span className="font-mono text-[13px] text-text-primary">${orderTotal.toFixed(2)}</span>
      </div>
      {(existing?.payments ?? []).map((p) => (
        <div key={p.id} className="flex items-center justify-between text-text-muted">
          <span className="text-[13px]">
            {p.paid_on}
            {p.note ? ` · ${p.note}` : ''}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[13px]">−${Number(p.amount).toFixed(2)}</span>
            <button
              type="button"
              onClick={() => handleDeletePayment(p.id)}
              disabled={deletePaymentMut.isPending}
              title="Delete payment"
              aria-label={`Delete payment of $${Number(p.amount).toFixed(2)}`}
              className="flex h-6 w-6 items-center justify-center rounded-sm text-text-muted hover:bg-surface-sunken hover:text-danger disabled:opacity-40"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6h12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </span>
        </div>
      ))}
      <div className="flex justify-between">
        <span className="text-[13px] text-text-secondary">Amount paid</span>
        <span className="font-mono text-[13px] text-text-primary">${amountPaid.toFixed(2)}</span>
      </div>
      <div className="flex items-baseline justify-between border-t border-border pt-2.5">
        <span className="text-sm font-semibold text-text-primary">Balance due</span>
        <span
          className={`font-mono text-xl font-semibold ${balance <= 0 ? 'text-success' : 'text-text-primary'}`}
        >
          ${balance.toFixed(2)}
        </span>
      </div>
    </section>
  );

  /** Installation schedule panel (ready/installed orders with a proposal). */
  const installStatus = existing?.install_status ?? 'unscheduled';
  const showInstall =
    (status === 'ready' || status === 'installed') && installStatus !== 'unscheduled';
  const responseLabel: Record<string, { text: string; cls: string }> = {
    proposed: { text: 'Awaiting customer', cls: 'text-warning' },
    confirmed: { text: 'Confirmed by customer', cls: 'text-success' },
    change_requested: { text: 'Change requested', cls: 'text-danger' },
  };
  const installPanel = showInstall && (
    <section className="flex flex-col gap-2 rounded-sm border border-border bg-surface p-4">
      <h2 className="mb-1 text-sm font-semibold text-text-primary">Installation</h2>
      {existing?.install_date && (
        <div className="flex justify-between gap-2">
          <span className="text-[13px] text-text-secondary">Proposed time</span>
          <span className="text-right font-mono text-[13px] text-text-primary">
            {existing.install_date}
            {existing.install_time ? ` · ${installWindowText(existing.install_time)}` : ''}
          </span>
        </div>
      )}
      <div className="flex justify-between">
        <span className="text-[13px] text-text-secondary">Customer response</span>
        <span className={`text-[13px] font-semibold ${responseLabel[installStatus]?.cls ?? ''}`}>
          {responseLabel[installStatus]?.text ?? installStatus}
        </span>
      </div>
      {installStatus === 'change_requested' && existing?.install_response_note && (
        <p className="rounded-sm bg-surface-sunken p-2 text-[13px] text-text-secondary">
          &ldquo;{existing.install_response_note}&rdquo;
        </p>
      )}
      {status === 'ready' && (
        <div className="mt-1 flex gap-2">
          <button
            onClick={openInstallSheet}
            disabled={proposeMut.isPending}
            className="h-10 flex-1 rounded-sm border border-border-input bg-surface text-[13px] font-medium text-text-secondary disabled:opacity-40"
          >
            Change time
          </button>
          <button
            onClick={handleCancelInstall}
            disabled={cancelInstallMut.isPending}
            className="h-10 flex-1 rounded-sm border border-border-input bg-surface text-[13px] font-medium text-danger disabled:opacity-40"
          >
            {cancelInstallMut.isPending ? 'Removing…' : 'Delete time'}
          </button>
        </div>
      )}
    </section>
  );

  /** Progress timeline with a per-stage revert control (earlier stages). */
  const stageIndex = STAGES.findIndex((s) => s.key === status);
  const curIdx = status === 'expired' ? 2 : stageIndex;
  const timelineCard = id && existing && (
    <section className="rounded-sm border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary">Progress</h2>
        {status === 'expired' && <StatusBadge status="expired" />}
      </div>
      <ol className="flex items-start gap-1">
        {STAGES.map((stage, i) => {
          const done = i < curIdx;
          const current = i === curIdx && status !== 'expired';
          const canRevert = i < curIdx;
          return (
            <li key={stage.key} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <div className="flex w-full items-center">
                <span className={`h-0.5 flex-1 ${i === 0 ? 'invisible' : done || current ? 'bg-brand-600' : 'bg-border'}`} />
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                    current
                      ? 'bg-brand-600 text-white'
                      : done
                        ? 'bg-brand-100 text-brand-600'
                        : 'bg-surface-sunken text-text-muted'
                  }`}
                >
                  {done ? '✓' : i + 1}
                </span>
                <span className={`h-0.5 flex-1 ${i === STAGES.length - 1 ? 'invisible' : i < curIdx ? 'bg-brand-600' : 'bg-border'}`} />
              </div>
              <span className={`text-center text-[10px] leading-tight ${current ? 'font-semibold text-text-primary' : 'text-text-muted'}`}>
                {stage.label}
              </span>
              {canRevert ? (
                <button
                  type="button"
                  onClick={() => handleRevert(stage.key)}
                  disabled={revertMut.isPending}
                  title={`Revert to ${stage.label}`}
                  aria-label={`Revert to ${stage.label}`}
                  className="flex h-6 w-6 items-center justify-center rounded-sm text-text-muted hover:bg-surface-sunken hover:text-brand-600 disabled:opacity-40"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M9 7 4 12l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M4 12h11a5 5 0 0 1 0 10h-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              ) : i > curIdx ? (
                <button
                  type="button"
                  onClick={() => handleAdvance(stage.key)}
                  disabled={
                    !canAdvanceTo(stage.key) ||
                    status === 'expired' ||
                    sendMut.isPending || confirmMut.isPending ||
                    readyMut.isPending || installedMut.isPending
                  }
                  title={
                    !canAdvanceTo(stage.key)
                      ? stage.key === 'in_progress'
                        ? 'Reached by recording a payment'
                        : 'Confirm the order first'
                      : `Advance to ${stage.label}`
                  }
                  aria-label={`Advance to ${stage.label}`}
                  className="flex h-6 w-6 items-center justify-center rounded-sm text-text-muted hover:bg-surface-sunken hover:text-success disabled:opacity-40"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              ) : (
                <span className="h-6" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );

  /** Status-aware action buttons (mobile bar + desktop rail). */
  const actions = (vertical: boolean) => {
    const box = vertical ? 'flex flex-col gap-2.5' : 'flex flex-wrap gap-2';
    const primary = `${vertical ? 'h-[46px]' : 'h-12 min-w-[140px] flex-[2]'} rounded-sm bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40`;
    const secondary = `${vertical ? 'h-10' : 'h-12 min-w-[120px] flex-1'} rounded-sm border border-border-input bg-surface text-[13px] font-medium text-text-secondary disabled:opacity-40`;

    const sendBusy = sendMut.isPending || sendInvoiceMut.isPending;
    const sendLabel = isInvoice
      ? 'Send Invoice'
      : status === 'sent'
        ? 'Resend Estimate'
        : 'Send Estimate';
    // Send + Download are always present and mode-labelled. Estimate mode
    // additionally needs a customer + at least one line item to send.
    const sendDisabled =
      sendBusy || saving || !customer || (!isInvoice && items.length === 0);
    const sendBtn = (cls: string) => (
      <button onClick={openSend} disabled={sendDisabled} className={cls}>
        {sendBusy ? 'Sending…' : sendLabel}
      </button>
    );
    const pdfBtn = (
      <button onClick={handlePdf} disabled={(!id && !customer) || saving} className={secondary}>
        Download {docLabel}
      </button>
    );
    const paymentBtn = (
      <button onClick={openPayment} disabled={paymentMut.isPending} className={secondary}>
        Record Payment
      </button>
    );

    // Draft / Sent — the estimate editor action set.
    if (!postConfirm && status !== 'expired') {
      return (
        <div className={box}>
          {sendBtn(primary)}
          <button onClick={handleSaveDraft} disabled={!canAct} className={secondary}>
            {saving ? 'Saving…' : 'Save as Draft'}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canAct || !customer || items.length === 0 || confirmMut.isPending}
            className={`${secondary} text-success`}
          >
            Confirm
          </button>
          {pdfBtn}
        </div>
      );
    }

    // Awaiting payment — record payment + reverse (user only).
    if (status === 'awaiting_payment') {
      return (
        <div className={box}>
          <button onClick={openPayment} disabled={paymentMut.isPending} className={primary}>
            Record Payment
          </button>
          {sendBtn(secondary)}
          <button onClick={handleReverse} disabled={unconfirmMut.isPending} className={secondary}>
            {unconfirmMut.isPending ? 'Reversing…' : 'Reverse Confirmation'}
          </button>
          {pdfBtn}
        </div>
      );
    }

    // In progress — record more payments + mark ready.
    if (status === 'in_progress') {
      return (
        <div className={box}>
          <button onClick={openPayment} disabled={paymentMut.isPending} className={primary}>
            Record Payment
          </button>
          {sendBtn(secondary)}
          <button
            onClick={handleMarkReady}
            disabled={readyMut.isPending}
            className={`${secondary} text-success`}
          >
            {readyMut.isPending ? 'Saving…' : 'Mark Ready'}
          </button>
          {pdfBtn}
        </div>
      );
    }

    // Ready — schedule the installation + mark installed (+ payment).
    if (status === 'ready') {
      return (
        <div className={box}>
          <button onClick={openInstallSheet} disabled={proposeMut.isPending} className={primary}>
            {existing?.install_status === 'unscheduled' ? 'Propose Installation' : 'Re-propose Time'}
          </button>
          {sendBtn(secondary)}
          <button
            onClick={handleMarkInstalled}
            disabled={installedMut.isPending}
            className={`${secondary} text-success`}
          >
            {installedMut.isPending ? 'Saving…' : 'Mark Installed'}
          </button>
          {paymentBtn}
          {pdfBtn}
        </div>
      );
    }

    // Installed — payments can still be applied; plus send/download.
    if (status === 'installed') {
      return (
        <div className={box}>
          <button onClick={openPayment} disabled={paymentMut.isPending} className={primary}>
            Record Payment
          </button>
          {sendBtn(secondary)}
          {pdfBtn}
        </div>
      );
    }

    // Expired — send (estimate) + document download.
    return (
      <div className={box}>
        {sendBtn(secondary)}
        {pdfBtn}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-surface-muted pb-40 lg:pb-8">
      <PageHeader
        title={id ? existing?.order_number ?? 'Order' : 'New Order'}
        backTo="/orders"
        right={<StatusBadge status={status} />}
      />

      <div className="mx-auto max-w-lg lg:grid lg:max-w-6xl lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-0">
        {/* ── Form column ── */}
        <div className="flex min-w-0 flex-col gap-4 p-4 lg:p-8">
          {/* Progress timeline (revert lives here — outside the disabled fieldset) */}
          {timelineCard}

          <fieldset disabled={readOnly} className="m-0 flex flex-col gap-4 border-0 p-0">
          {readOnly && (
            <p className="rounded-sm border border-border bg-surface p-3 text-sm text-text-secondary">
              This order is <StatusBadge status={status} /> and its estimate can no longer be edited.
            </p>
          )}

          {/* Header card: customer + dates */}
          <section className="flex flex-col gap-3.5 rounded-sm border border-border bg-surface p-4">
            <div>
              <span className="mb-1.5 block text-xs font-medium text-text-secondary">Customer</span>
              <button
                type="button"
                onClick={() => !readOnly && setSheet('customer')}
                className="flex h-11 w-full items-center justify-between rounded-sm border border-border-input bg-surface px-3 text-left"
              >
                <span className={`text-sm ${customer ? 'text-text-primary' : 'text-text-muted'}`}>
                  {customer ? `${customer.first_name} ${customer.last_name}` : 'Select customer…'}
                </span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3.5">
              <DatePicker label="Order date" value={orderDate} onChange={setOrderDate} />
              <DatePicker
                label="Expiry date"
                value={expiryDate}
                onChange={(d) => {
                  setExpiryDate(d);
                  setExpiryManual(true);
                }}
              />
            </div>

            <div className="text-xs text-text-muted">
              Order #:{' '}
              <span className="font-mono font-medium text-text-secondary">
                {existing?.order_number ?? 'assigned on save'}
              </span>
            </div>
          </section>

          {/* Line items summary table */}
          {(items.length > 0 || !readOnly) && (
            <section className="rounded-sm border border-border bg-surface">
              {/* Bulk toolbar — only in edit mode */}
              {!readOnly && items.length > 0 && (() => {
                const selectionHasNonBlind = [...selected].some(
                  (k) => items.find((it) => it.key === k)?.item_type !== 'blind'
                );
                const canBulkEdit = selected.size > 0 && !selectionHasNonBlind;
                const canBulkDelete = selected.size > 0;
                return (
                  <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                    <input
                      type="checkbox"
                      checked={items.length > 0 && selected.size === items.length}
                      ref={(el) => {
                        if (el) el.indeterminate = selected.size > 0 && selected.size < items.length;
                      }}
                      onChange={toggleAll}
                      aria-label="Select all items"
                      className="h-4 w-4 rounded-sm accent-brand-600"
                    />
                    <span className="flex-1 text-[12px] text-text-muted">
                      {selected.size > 0 ? `${selected.size} selected` : `${items.length} item${items.length !== 1 ? 's' : ''}`}
                    </span>
                    <button
                      type="button"
                      onClick={openBulkEdit}
                      disabled={!canBulkEdit}
                      title={
                        selected.size === 0
                          ? 'Select blind items to bulk edit'
                          : selectionHasNonBlind
                            ? 'Bulk edit is only available for blind items'
                            : 'Edit fabric, cassette and control for selected items'
                      }
                      className="flex h-8 items-center gap-1.5 rounded-sm border border-border-input px-2.5 text-[12px] font-medium text-text-secondary hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={handleBulkDelete}
                      disabled={!canBulkDelete}
                      className="flex h-8 items-center gap-1.5 rounded-sm border border-border-input px-2.5 text-[12px] font-medium text-text-secondary hover:bg-surface-sunken hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6h12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Delete
                    </button>
                  </div>
                );
              })()}

              {/* Item rows */}
              {items.length === 0 ? (
                <p className="p-4 text-[13px] text-text-muted">No items yet — add one below.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {items.map((it, i) => {
                    const price =
                      it.item_type === 'blind'
                        ? blindDraftPrice(it, catalogs)
                        : flatDraftPrice(it);
                    const typeBadge =
                      it.item_type === 'blind'
                        ? 'Blind'
                        : it.item_type === 'preset'
                          ? 'Preset'
                          : 'Custom';
                    const name =
                      it.item_type === 'blind'
                        ? [it.room_name || `Blind ${i + 1}`, it.blinds_type]
                            .filter(Boolean)
                            .join(' — ')
                        : it.description || `Item ${i + 1}`;

                    return (
                      <li key={it.key} className="flex items-center gap-2 px-3 py-2.5">
                        {/* Checkbox — hidden in read-only */}
                        {!readOnly && (
                          <input
                            type="checkbox"
                            checked={selected.has(it.key)}
                            onChange={() => toggleSelect(it.key)}
                            aria-label={`Select ${name}`}
                            className="h-4 w-4 shrink-0 rounded-sm accent-brand-600"
                          />
                        )}

                        {/* Type badge */}
                        <span className="w-12 shrink-0 rounded-sm bg-surface-sunken px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                          {typeBadge}
                        </span>

                        {/* Name */}
                        <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">
                          {name}
                        </span>

                        {/* Total */}
                        <span className="shrink-0 font-mono text-[13px] text-text-primary">
                          {price ? `$${price.total.toFixed(2)}` : '—'}
                        </span>

                        {/* Edit / Delete — hidden in read-only */}
                        {!readOnly && (
                          <span className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEdit(it.key)}
                              title={`Edit ${name}`}
                              className="flex h-8 w-8 items-center justify-center rounded-sm text-text-muted hover:bg-surface-sunken hover:text-brand-600"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => removeItem(it.key)}
                              title={`Delete ${name}`}
                              className="flex h-8 w-8 items-center justify-center rounded-sm text-text-muted hover:bg-surface-sunken hover:text-danger"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6h12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          {/* Add buttons */}
          {!readOnly && (
            <div className="flex flex-col gap-2">
              <button
                onClick={addBlind}
                className="flex h-[46px] items-center justify-center gap-2 rounded-sm border border-dashed border-border-input text-[13px] font-semibold text-brand-600"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                Add Standard Blind
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setSheet('preset')}
                  className="h-11 flex-1 rounded-sm border border-dashed border-border-input text-[13px] font-medium text-text-secondary"
                >
                  + Preset Item
                </button>
                <button
                  onClick={addCustom}
                  className="h-11 flex-1 rounded-sm border border-dashed border-border-input text-[13px] font-medium text-text-secondary"
                >
                  + Custom Item
                </button>
              </div>
            </div>
          )}


          {/* Mobile totals card (rail shows this on desktop) */}
          <section className="flex flex-col gap-2 rounded-sm border border-border bg-surface p-4 lg:hidden">
            {discountControl}
            {totalsRows}
          </section>
          </fieldset>

          {/* Payments panel (both breakpoints; confirmed orders) */}
          {paymentsPanel}

          {/* Installation schedule panel (ready/installed orders) */}
          {installPanel}

          {/* Meta line for sent orders */}
          {existing?.sent_at && (
            <p className="text-xs text-text-muted">
              Sent {format(new Date(existing.sent_at), 'MMM d, yyyy HH:mm')}
              {existing.confirmed_at &&
                ` · Confirmed ${format(new Date(existing.confirmed_at), 'MMM d, yyyy HH:mm')}`}
            </p>
          )}

          {/* Delete order (outside the disabled fieldset) */}
          {id && (
            <button
              onClick={handleDeleteOrder}
              disabled={deleteMut.isPending}
              className="h-11 rounded-sm border border-border-input bg-surface text-[13px] font-medium text-danger hover:bg-surface-muted disabled:opacity-40"
            >
              {deleteMut.isPending ? 'Deleting…' : 'Delete Order'}
            </button>
          )}
        </div>

        {/* ── Desktop live pricing rail ── */}
        <aside className="sticky top-[57px] hidden h-[calc(100vh-57px)] flex-col border-l border-border bg-surface-muted lg:flex">
          <div className="border-b border-border px-6 py-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              {postConfirm ? 'Order Summary' : 'Live Pricing'}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {items.length === 0 && (
              <p className="text-[13px] text-text-muted">Add a line item to see pricing.</p>
            )}
            {items.map((it, i) => (
              <div key={it.key} className="mb-2.5 flex justify-between gap-3">
                <span className="truncate text-[13px] text-text-secondary">{draftLabel(it, i)}</span>
                <span className="font-mono text-[13px] text-text-primary">
                  {itemPrices[i] ? `$${itemPrices[i].toFixed(2)}` : '—'}
                </span>
              </div>
            ))}
            <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3.5">
              {discountControl}
              {totalsRows}
              {postConfirm && (
                <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2.5">
                  <span className="text-[13px] text-text-secondary">Balance due</span>
                  <span
                    className={`font-mono text-sm font-semibold ${balance <= 0 ? 'text-success' : 'text-text-primary'}`}
                  >
                    ${balance.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="border-t border-border px-6 py-5">{actions(true)}</div>
        </aside>
      </div>

      {/* ── Mobile sticky action bar ── */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] lg:hidden">
        <div className="mx-auto max-w-lg">
          <div className="mb-2.5 flex items-baseline justify-between">
            <span className="text-[13px] text-text-secondary">
              {postConfirm ? 'Balance due' : 'Running total'}
            </span>
            <span className="font-mono text-xl font-semibold text-text-primary">
              ${(postConfirm ? balance : totals.total).toFixed(2)}
            </span>
          </div>
          {actions(false)}
        </div>
      </div>

      {/* Customer selector bottom sheet */}
      {sheet === 'customer' && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 lg:items-center" onClick={() => setSheet('none')}>
          <div
            className="max-h-[80vh] w-full overflow-y-auto rounded-t-sm bg-surface p-4 lg:max-w-md lg:rounded-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              type="search"
              placeholder="Search customers…"
              value={customerTerm}
              onChange={(e) => setCustomerTerm(e.target.value)}
              className="mb-3 h-11 w-full rounded-sm border border-border-input bg-surface px-3 text-sm"
            />
            <ul className="flex flex-col gap-1">
              {(customersQ.data ?? []).map((cust) => (
                <li key={cust.id}>
                  <button
                    onClick={() => {
                      setCustomer(cust);
                      setSheet('none');
                    }}
                    className="w-full rounded-sm p-3 text-left hover:bg-surface-sunken"
                  >
                    <span className="block text-sm font-medium text-text-primary">
                      {cust.first_name} {cust.last_name}
                    </span>
                    <span className="block text-[13px] text-text-muted">
                      {[cust.phone, cust.email].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
              {customersQ.data?.length === 0 && (
                <p className="p-3 text-sm text-text-muted">No customers found.</p>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* Preset picker bottom sheet */}
      {sheet === 'preset' && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 lg:items-center" onClick={() => setSheet('none')}>
          <div
            className="max-h-[70vh] w-full overflow-y-auto rounded-t-sm bg-surface p-4 lg:max-w-md lg:rounded-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-3 text-sm font-semibold text-text-primary">Add preset item</h2>
            <ul className="flex flex-col gap-1">
              {(presetsQ.data ?? [])
                .filter((p) => p.active)
                .map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => addPreset(p)}
                      className="flex w-full items-center justify-between rounded-sm p-3 text-left hover:bg-surface-sunken"
                    >
                      <span>
                        <span className="block text-sm font-medium text-text-primary">{p.name}</span>
                        {p.description && (
                          <span className="block text-[13px] text-text-muted">{p.description}</span>
                        )}
                      </span>
                      <span className="font-mono text-[13px] font-medium text-text-secondary">
                        ${Number(p.unit_price).toFixed(2)}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      )}

      {/* Record payment bottom sheet */}
      {sheet === 'payment' && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 lg:items-center" onClick={() => setSheet('none')}>
          <div
            className="w-full rounded-t-sm bg-surface p-4 lg:max-w-md lg:rounded-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-sm font-semibold text-text-primary">Record payment</h2>
            <p className="mb-3 text-[13px] text-text-muted">
              Balance due <span className="font-mono">${balance.toFixed(2)}</span>
            </p>
            <div className="flex flex-col gap-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-text-secondary">Amount</span>
                <input
                  autoFocus
                  inputMode="decimal"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder="0.00"
                  className="h-11 w-full rounded-sm border border-border-input bg-surface px-3 text-right font-mono text-sm"
                />
              </label>
              <DatePicker label="Payment date" value={payDate} onChange={(d) => d && setPayDate(d)} />
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-text-secondary">
                  Note (optional)
                </span>
                <input
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  placeholder="e.g. e-Transfer deposit"
                  className="h-11 w-full rounded-sm border border-border-input bg-surface px-3 text-sm"
                />
              </label>
              <div className="mt-1 flex gap-2">
                <button
                  onClick={() => setSheet('none')}
                  className="h-11 flex-1 rounded-sm border border-border-input bg-surface text-[13px] font-medium text-text-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={submitPayment}
                  disabled={paymentMut.isPending}
                  className="h-11 flex-[2] rounded-sm bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
                >
                  {paymentMut.isPending ? 'Saving…' : 'Record Payment'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Send estimate/invoice bottom sheet (with optional message) */}
      {sheet === 'send' && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 lg:items-center" onClick={() => setSheet('none')}>
          <div
            className="w-full rounded-t-sm bg-surface p-4 lg:max-w-md lg:rounded-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-sm font-semibold text-text-primary">
              Send {docLabel.toLowerCase()}
            </h2>
            <p className="mb-3 text-[13px] text-text-muted">
              We&apos;ll email {customer?.email ?? 'the customer'} the {docLabel.toLowerCase()} PDF
              {isInvoice ? ' and a link to view the order online.' : ' and a link to review and confirm online.'}
            </p>
            <div className="flex flex-col gap-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-text-secondary">
                  Message to include (optional)
                </span>
                <textarea
                  autoFocus
                  value={sendMessage}
                  onChange={(e) => setSendMessage(e.target.value)}
                  maxLength={1000}
                  rows={4}
                  placeholder="e.g. Thanks for your time today — let me know if you have any questions."
                  className="w-full rounded-sm border border-border-input bg-surface px-3 py-2 text-sm"
                />
              </label>
              <div className="mt-1 flex gap-2">
                <button
                  onClick={() => setSheet('none')}
                  className="h-11 flex-1 rounded-sm border border-border-input bg-surface text-[13px] font-medium text-text-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={submitSend}
                  disabled={sendMut.isPending || sendInvoiceMut.isPending}
                  className="h-11 flex-[2] rounded-sm bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
                >
                  {sendMut.isPending || sendInvoiceMut.isPending
                    ? 'Sending…'
                    : `Send ${docLabel}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Propose installation time bottom sheet */}
      {sheet === 'install' && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 lg:items-center" onClick={() => setSheet('none')}>
          <div
            className="w-full rounded-t-sm bg-surface p-4 lg:max-w-md lg:rounded-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-sm font-semibold text-text-primary">Propose installation time</h2>
            <p className="mb-3 text-[13px] text-text-muted">
              We&apos;ll email {customer?.email ?? 'the customer'} a one-hour arrival window and a link
              to confirm or request another time.
            </p>
            <div className="flex flex-col gap-3">
              <DatePicker
                label="Installation date"
                value={installDate}
                onChange={(d) => d && setInstallDate(d)}
              />
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-text-secondary">
                  Arrival time (start of the 1-hour window)
                </span>
                <input
                  type="time"
                  value={installTime}
                  onChange={(e) => setInstallTime(e.target.value)}
                  className="h-11 w-full rounded-sm border border-border-input bg-surface px-3 font-mono text-sm"
                />
              </label>
              <p className="text-[13px] text-text-secondary">
                Customer will see: <span className="font-medium">between {installWindowText(installTime)}</span> on{' '}
                {format(installDate, 'EEEE, MMMM d, yyyy')}.
              </p>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-text-secondary">
                  Message to include (optional)
                </span>
                <textarea
                  value={installMessage}
                  onChange={(e) => setInstallMessage(e.target.value)}
                  maxLength={1000}
                  rows={3}
                  placeholder="e.g. Please clear the window areas before we arrive. Call if the time doesn't work."
                  className="w-full rounded-sm border border-border-input bg-surface px-3 py-2 text-sm"
                />
              </label>
              <div className="mt-1 flex gap-2">
                <button
                  onClick={() => setSheet('none')}
                  className="h-11 flex-1 rounded-sm border border-border-input bg-surface text-[13px] font-medium text-text-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={submitInstallProposal}
                  disabled={proposeMut.isPending}
                  className="h-11 flex-[2] rounded-sm bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
                >
                  {proposeMut.isPending ? 'Sending…' : 'Send Proposal'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit item popup (individual) */}
      {sheet === 'editItem' && editDraft && (() => {
        const isBlind = editDraft.item_type === 'blind';
        const title = isBlind
          ? `Edit Blind — ${(editDraft as BlindDraft).room_name || 'Item'}`
          : `Edit ${editDraft.item_type === 'preset' ? 'Preset' : 'Custom'} Item`;
        return (
          <div
            className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 lg:items-center"
            onClick={cancelEdit}
          >
            <div
              className="max-h-[90vh] w-full overflow-y-auto rounded-t-sm bg-surface p-4 lg:max-w-lg lg:rounded-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="mb-4 text-sm font-semibold text-text-primary">{title}</h2>
              {isBlind ? (
                <BlindEditForm
                  draft={editDraft as BlindDraft}
                  catalogs={catalogs}
                  onChange={(next) => setEditDraft(next)}
                />
              ) : (
                <FlatEditForm
                  draft={editDraft as FlatDraft}
                  onChange={(next) => setEditDraft(next)}
                />
              )}
              <div className="mt-4 flex gap-2">
                <button
                  onClick={cancelEdit}
                  className="h-11 flex-1 rounded-sm border border-border-input bg-surface text-[13px] font-medium text-text-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={saveEdit}
                  className="h-11 flex-[2] rounded-sm bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700"
                >
                  Save changes
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Bulk edit popup (fabric / cassette / control only) */}
      {sheet === 'bulkEdit' && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 lg:items-center"
          onClick={() => setSheet('none')}
        >
          <div
            className="w-full rounded-t-sm bg-surface p-4 lg:max-w-lg lg:rounded-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-sm font-semibold text-text-primary">Bulk edit options</h2>
            <p className="mb-4 text-[13px] text-text-muted">
              Editing {[...selected].filter((k) => items.find((it) => it.key === k)?.item_type === 'blind').length} blind item(s).
            </p>
            <BulkEditForm
              state={bulkState}
              catalogs={catalogs}
              onChange={setBulkState}
            />
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setSheet('none')}
                className="h-11 flex-1 rounded-sm border border-border-input bg-surface text-[13px] font-medium text-text-secondary"
              >
                Cancel
              </button>
              <button
                onClick={applyBulkEdit}
                disabled={!bulkState.fabric_id && !bulkState.cassette_id && !bulkState.control_id}
                className="h-11 flex-[2] rounded-sm bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
              >
                Apply to selected
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

  );
}
