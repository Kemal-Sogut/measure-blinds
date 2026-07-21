// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Order detail/editor — the most complex screen in the app.
 *
 * While an order is draft/sent it behaves as an estimate editor:
 * customer, dates, line items with live pricing, discount, totals, and
 * a Send Estimate / Save / Confirm / PDF action set. The editor stays
 * live at every later stage too — customer, dates, and line items can
 * always be changed and saved; the Worker recalculates totals on every
 * save regardless of status.
 *
 * Once confirmed the order also grows a Payments panel (balance = total
 * − payments). Payments can be applied at ANY post-confirmation stage,
 * and "Record Payment" lives in that panel's body rather than in the
 * stage action set — the button sits with the ledger it changes. Each
 * payment row also carries a Send Receipt icon action that opens a
 * confirmation sheet (recipient, amount/date, optional message) and
 * emails the customer a branded receipt; once sent the row shows a
 * muted "✓ Receipt sent" marker and the action becomes Resend receipt.
 * Stage actions:
 *   awaiting_payment → Reverse Confirmation (user only)
 *   in_progress      → Mark Ready, Cut Sheet
 *   ready            → Propose Installation (opens the Installation
 *                      section's sheet), Mark Installed
 *   installed        → (none beyond the Overview)
 * Every post-draft stage additionally offers an Order Overview action
 * that opens `/orders/:id/overview` in a NEW TAB — a read-only,
 * itemised listing of the line items (sizes, options, notes, totals).
 * Save (green), Send (blue), Download (gray) and Delete (icon-only,
 * red, saved orders) live in the TOP BAR
 * (PageHeader right slot, icon-only on phones) at every stage; the
 * action areas hold only the stage-specific actions. On mobile the
 * sticky action bar renders the stage's primary action full-width on
 * its own row and every other action as smaller inline buttons (max
 * three per row, max three rows).
 *
 * Ready/installed orders also show the Installation panel
 * (`InstallationSection`): the scheduled window, the customer's
 * response, and change / staff-confirm / delete actions.
 *
 * The generated PDF is an Estimate until the first payment is recorded,
 * after which it is an Invoice.
 *
 * Email invariant: the top-bar Send button is the ONLY control that
 * emails the customer their "Estimate Ready" mail. The Progress
 * timeline's advance arrows are bookkeeping only — advancing to "Sent"
 * calls the status-only `mark-sent` route, never `send`.
 *
 * All client-side money is a live preview from lib/pricing +
 * lib/totals; the Worker recomputes authoritatively on save.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import PageHeader from '../../components/PageHeader';
import DatePicker from '../../components/DatePicker';
import StatusBadge from '../../components/StatusBadge';
import CustomerCreateModal from '../../components/CustomerCreateModal';
import { calculateTotals } from '../../lib/totals';
import {
  useOrder,
  useCreateOrder,
  useUpdateOrder,
  useSendOrder,
  useMarkSent,
  useSendInvoice,
  useConfirmOrder,
  useUnconfirmOrder,
  useResolveCancelRequest,
  useMarkInProgress,
  useMarkReady,
  useMarkInstalled,
  useRevertOrder,
  useDeleteOrder,
  useRecordPayment,
  useSendReceipt,
  useDeletePayment,
  useUnmatchedEtransfers,
  useDismissEtransfer,
  useOrderLogs,
  downloadOrderPdf,
  type OrderInput,
  type LineItemInput,
  type PendingEtransfer,
} from '../../hooks/useOrders';
import { useCustomerSearch } from '../../hooks/useCustomers';
import { useCatalogList, useCompanySettings } from '../../hooks/useSettings';
import InstallationSection from './InstallationSection';
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
import type { Customer, Order, OrderStatus, Material, CassetteOption, ControlOption, BlindType, PresetLineItem, DiscountType, Payment } from '../../types';

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
        material_id: li.material_id ?? '',
        cassette_id: li.cassette_id ?? '',
        control_id: li.control_id ?? '',
        color: li.color ?? '',
        note: li.note ?? '',
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

/**
 * Finds an active catalog option's id by name — exact match preferred,
 * otherwise the first case-insensitive substring match. Returns '' when
 * nothing matches so the field stays unset. Used to pre-select sensible
 * defaults (e.g. "Regular" cassette, "Chain" control) on a new blind.
 */
function findOptionIdByName(
  options: { id: string; name: string; active: boolean }[],
  needle: string
): string {
  const lower = needle.toLowerCase();
  const active = options.filter((o) => o.active);
  const exact = active.find((o) => o.name.toLowerCase() === lower);
  if (exact) return exact.id;
  return active.find((o) => o.name.toLowerCase().includes(lower))?.id ?? '';
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

/** 16px action-button icon; paths inherit the button's text colour. */
function ActionIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

/** Named icons, one per action, reused across the action panel. */
const ICONS = {
  save: (
    <ActionIcon>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </ActionIcon>
  ),
  send: (
    <ActionIcon>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </ActionIcon>
  ),
  confirm: (
    <ActionIcon>
      <path d="M20 6 9 17l-5-5" />
    </ActionIcon>
  ),
  payment: (
    <ActionIcon>
      <line x1="12" x2="12" y1="2" y2="22" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </ActionIcon>
  ),
  ready: (
    <ActionIcon>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </ActionIcon>
  ),
  install: (
    <ActionIcon>
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18M8 2v4M16 2v4" />
    </ActionIcon>
  ),
  installed: (
    <ActionIcon>
      <path d="M21.8 10A10 10 0 1 1 17 3.3" />
      <path d="m9 11 3 3L22 4" />
    </ActionIcon>
  ),
  reverse: (
    <ActionIcon>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </ActionIcon>
  ),
  download: (
    <ActionIcon>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </ActionIcon>
  ),
  manufacturer: (
    <ActionIcon>
      <path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
      <path d="M17 18h1M12 18h1M7 18h1" />
    </ActionIcon>
  ),
  overview: (
    <ActionIcon>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </ActionIcon>
  ),
  trash: (
    <ActionIcon>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6M14 11v6" />
    </ActionIcon>
  ),
};

/**
 * One status-aware action rendered by both the desktop pricing-rail
 * footer and the mobile sticky bar. `label` is the full wording (used
 * on desktop rows and on the primary button); `short` is the compact
 * wording used by the mobile inline grid where up to three buttons
 * share one row. `tone` optionally recolours the button text (e.g. the
 * success-green Confirm / Mark Installed secondaries).
 */
type StageAction = {
  key: string;
  icon: ReactNode;
  label: string;
  short: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: string;
};

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: existing, isLoading: loadingExisting, error: loadError } = useOrder(id);
  const { data: logs } = useOrderLogs(id);

  const materialsQ = useCatalogList<Material>('materials');
  const cassettesQ = useCatalogList<CassetteOption>('cassette-options');
  const controlsQ = useCatalogList<ControlOption>('control-options');
  const blindTypesQ = useCatalogList<BlindType>('blind-types');
  const presetsQ = useCatalogList<PresetLineItem>('presets');
  const { data: company } = useCompanySettings();

  const createMut = useCreateOrder();
  const updateMut = useUpdateOrder();
  const sendMut = useSendOrder();
  const markSentMut = useMarkSent();
  const sendInvoiceMut = useSendInvoice();
  const confirmMut = useConfirmOrder();
  const unconfirmMut = useUnconfirmOrder();
  const resolveCancelMut = useResolveCancelRequest();
  const inProgressMut = useMarkInProgress();
  const readyMut = useMarkReady();
  const installedMut = useMarkInstalled();
  const revertMut = useRevertOrder();
  const deleteMut = useDeleteOrder();
  const paymentMut = useRecordPayment();
  const receiptMut = useSendReceipt();
  const deletePaymentMut = useDeletePayment();
  const pendingEtransfersQ = useUnmatchedEtransfers();
  const dismissEtransferMut = useDismissEtransfer();

  // ── Editor state ────────────────────────────────────────────────
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orderDate, setOrderDate] = useState<Date>(new Date());
  const [expiryDate, setExpiryDate] = useState<Date | null>(null);
  const [expiryManual, setExpiryManual] = useState(false);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [discountType, setDiscountType] = useState<DiscountType>('fixed');
  const [discountValue, setDiscountValue] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [sheet, setSheet] = useState<'none' | 'customer' | 'preset' | 'payment' | 'send' | 'receipt' | 'editItem' | 'bulkEdit' | 'cancelDeny'>('none');

  // ── Line item selection / edit state ────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ItemDraft | null>(null);
  // Key of a just-added item whose editor is open for the first time;
  // canceling that editor discards the still-blank item.
  const [pendingNewKey, setPendingNewKey] = useState<string | null>(null);
  const [bulkState, setBulkState] = useState<BulkEditState>({ material_id: '', cassette_id: '', control_id: '' });
  const [customerTerm, setCustomerTerm] = useState('');
  const customersQ = useCustomerSearch(customerTerm);
  // Quick add-customer pop-up opened from the customer picker sheet.
  const [addingCustomer, setAddingCustomer] = useState(false);

  // Payment entry form state (used by the Record Payment sheet).
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState<Date>(new Date());
  const [payNote, setPayNote] = useState('');
  // The pending e-Transfer being applied by this payment, if any.
  const [payEtransferId, setPayEtransferId] = useState<string | null>(null);

  // Send estimate/invoice sheet — optional note included in the email.
  const [sendMessage, setSendMessage] = useState('');

  // Send-receipt sheet state: the payment row being receipted and the
  // optional personal message included in the receipt email.
  const [receiptPayment, setReceiptPayment] = useState<Payment | null>(null);
  const [receiptMessage, setReceiptMessage] = useState('');

  // Optional explanation emailed to the customer when DENYING their
  // cancellation request (accepting sends nothing).
  const [cancelDenyMessage, setCancelDenyMessage] = useState('');

  // Installation propose/change sheet (lives in InstallationSection;
  // lifted here so the ready-status actions panel can open it too).
  const [installSheetOpen, setInstallSheetOpen] = useState(false);

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
      materials: materialsQ.data ?? [],
      cassettes: cassettesQ.data ?? [],
      controls: controlsQ.data ?? [],
      blindTypes: blindTypesQ.data ?? [],
    }),
    [materialsQ.data, cassettesQ.data, controlsQ.data, blindTypesQ.data]
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
  // Orders are editable at every lifecycle stage — the Worker recomputes
  // totals authoritatively on every save, regardless of status.
  const readOnly = false;
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
  /** Clones a line item (fresh key, copied panels) right after the original. */
  function duplicateItem(key: string) {
    setItems((list) => {
      const idx = list.findIndex((it) => it.key === key);
      if (idx === -1) return list;
      const src = list[idx];
      const copy: ItemDraft =
        src.item_type === 'blind'
          ? { ...src, key: nextKey(), panels: [...src.panels] }
          : { ...src, key: nextKey() };
      const next = list.slice();
      next.splice(idx + 1, 0, copy);
      return next;
    });
  }
  function addBlind() {
    const draft: BlindDraft = {
      key: nextKey(),
      item_type: 'blind',
      room_name: '',
      blinds_type: '',
      panels: [''],
      height_cm: '',
      material_id: '',
      // Sensible defaults from the catalog (fall back to unset if absent).
      cassette_id: findOptionIdByName(catalogs.cassettes, 'Regular'),
      control_id: findOptionIdByName(catalogs.controls, 'Chain'),
      color: '',
      note: '',
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
      if (next.has(key)) next.delete(key);
      else next.add(key);
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

  // ── Bulk edit (material / cassette / control only) ────────────────
  function openBulkEdit() {
    setBulkState({ material_id: '', cassette_id: '', control_id: '' });
    setSheet('bulkEdit');
  }

  function applyBulkEdit() {
    setItems((list) =>
      list.map((it) => {
        if (!selected.has(it.key) || it.item_type !== 'blind') return it;
        const patch: Partial<BlindDraft> = {};
        if (bulkState.material_id) patch.material_id = bulkState.material_id;
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
        if (!it.material_id || !it.cassette_id || !it.control_id)
          return `Item ${i + 1}: choose material, cassette, and control.`;
        if (!qty) return `Item ${i + 1}: enter a quantity.`;
        line_items.push({
          item_type: 'blind',
          room_name: it.room_name.trim(),
          blinds_type: it.blinds_type.trim(),
          panels: panels as number[],
          height_cm: height,
          material_id: it.material_id,
          cassette_id: it.cassette_id,
          control_id: it.control_id,
          color: it.color.trim(),
          note: it.note.trim(),
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
      navigate('/');
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
    awaiting_payment: ['in_progress', 'ready', 'installed'],
    in_progress: ['ready', 'installed'],
    ready: ['installed'],
  };
  const canAdvanceTo = (target: OrderStatus): boolean =>
    (ADVANCE_TARGETS[status] ?? []).includes(target);

  /**
   * Advances the order forward to the given target stage. Any later
   * stage the backend supports may be chosen; skipped stages are simply
   * marked done.
   *
   * Advancing is a bookkeeping action and NEVER emails the customer —
   * the "sent" target uses the status-only `mark-sent` route, not the
   * emailing `send` route. Emailing the estimate is the exclusive job of
   * the Send button in the top bar (see `handleSendEstimate`).
   */
  async function handleAdvance(target: OrderStatus) {
    if (!id) return;
    const label = STAGES.find((s) => s.key === target)?.label ?? target;
    if (!window.confirm(`Advance this order to "${label}"?`)) return;
    try {
      if (target === 'sent') {
        await markSentMut.mutateAsync(id);
      } else if (target === 'awaiting_payment') {
        await confirmMut.mutateAsync(id);
      } else if (target === 'in_progress') {
        await inProgressMut.mutateAsync(id);
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
    setPayEtransferId(null);
    setSheet('payment');
  }

  /** Autofills the payment form from a pending e-Transfer (one tap). */
  function applyEtransfer(t: PendingEtransfer) {
    setPayAmount(t.amount.toFixed(2));
    setPayDate(t.received_at ? new Date(t.received_at) : new Date());
    setPayNote(
      `e-Transfer${t.sender ? ` from ${t.sender}` : ''}${t.reference_message ? ` — ${t.reference_message}` : ''
        }`.slice(0, 200)
    );
    setPayEtransferId(t.id);
  }

  async function submitPayment() {
    if (!id) return;
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) return toast.error('Enter a payment amount.');
    try {
      await paymentMut.mutateAsync({
        id,
        input: {
          amount,
          paid_on: toIso(payDate),
          note: payNote.trim(),
          etransfer_id: payEtransferId ?? undefined,
        },
      });
      toast.success('Payment recorded.');
      setSheet('none');
      setPayAmount('');
      setPayNote('');
      setPayDate(new Date());
      setPayEtransferId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record payment.');
    }
  }

  /**
   * Opens the send-receipt confirmation sheet for one recorded payment.
   * Follows the send-estimate/invoice precedent for a missing customer
   * email (`openSend`): block here with a toast instead of opening the
   * sheet, since the receipt cannot be delivered anywhere.
   */
  function openReceipt(p: Payment) {
    if (!customer?.email) return toast.error('This customer has no email address.');
    setReceiptPayment(p);
    setReceiptMessage('');
    setSheet('receipt');
  }

  /**
   * Submits the send-receipt sheet. The Worker emails the branded
   * receipt (computing paid-to-date/balance itself), stamps
   * `receipt_sent_at`, and returns the refreshed order, so the row's
   * "Receipt sent" indicator updates from the cache. Server errors
   * (400 no email / 502 email service) surface as toasts, matching the
   * other send flows.
   */
  async function submitReceipt() {
    if (!id || !receiptPayment) return;
    if (!customer?.email) return toast.error('This customer has no email address.');
    try {
      await receiptMut.mutateAsync({
        orderId: id,
        paymentId: receiptPayment.id,
        message: receiptMessage.trim() || undefined,
      });
      toast.success(`Receipt sent to ${customer.email}.`);
      setSheet('none');
      setReceiptPayment(null);
      setReceiptMessage('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send the receipt.');
    }
  }

  /**
   * Grants the customer's cancellation request. This REVERSES the
   * confirmation (awaiting_payment → sent), so it is gated behind a
   * confirm dialog like every other backward move, and the Worker
   * refuses it outright once a payment exists. No email is sent — the
   * customer's public page shows the estimate with its Confirm button
   * again, which speaks for itself.
   */
  async function handleAcceptCancel() {
    if (!id) return;
    if (
      !window.confirm(
        'Cancel this confirmation? The order goes back to Sent and the customer can confirm again.'
      )
    ) {
      return;
    }
    try {
      await resolveCancelMut.mutateAsync({ id, accept: true });
      toast.success('Cancellation accepted — order returned to Sent.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not accept the request.');
    }
  }

  /** Opens the deny sheet, where the optional explanation is written. */
  function openCancelDeny() {
    setCancelDenyMessage('');
    setSheet('cancelDeny');
  }

  /**
   * Denies the request. Unlike accepting, this DOES email the customer —
   * they asked for something and did not get it — so it goes through a
   * sheet offering an optional explanation. The Worker sends first and
   * clears the request second, so a 502 leaves the banner up for a retry
   * instead of dropping the request silently.
   */
  async function submitCancelDeny() {
    if (!id) return;
    try {
      await resolveCancelMut.mutateAsync({
        id,
        accept: false,
        message: cancelDenyMessage.trim() || undefined,
      });
      toast.success(
        customer?.email ? `Request denied — ${customer.email} notified.` : 'Request denied.'
      );
      setSheet('none');
      setCancelDenyMessage('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not deny the request.');
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
        <PageHeader title="Order" backTo="/" />
        <p className="p-4 text-text-muted">Loading…</p>
      </div>
    );
  }
  if (id && loadError) {
    return (
      <div className="min-h-screen bg-surface-muted">
        <PageHeader title="Order" backTo="/" />
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
              className={`h-9 min-h-9 rounded-sm px-3 text-xs font-semibold ${discountType === t ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted'
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
      <div className="flex items-baseline justify-between border-t border-border-light pt-2.5">
        <span className="text-sm font-semibold text-text-primary">Total</span>
        <span className="font-mono text-xl font-semibold text-text-primary">
          ${totals.total.toFixed(2)}
        </span>
      </div>
    </>
  );

  /**
   * Payments + balance panel (confirmed orders only).
   *
   * Lists the ledger the way it is stored — order total, then ONE row
   * per recorded payment (date · note, amount, send/resend receipt,
   * delete), then amount paid and the balance — and owns the "Record
   * Payment" button, which
   * opens the payment sheet. That button used to live in the sticky
   * action bar / pricing rail; it sits in the panel body so the action
   * is next to the numbers it changes. Rendered at every
   * post-confirmation stage, which is exactly where the old action was
   * offered, so no stage lost the ability to record a payment.
   */
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
        <div key={p.id} className="flex items-center justify-between gap-2 text-text-muted">
          <span className="min-w-0 flex-1 truncate text-[13px]">
            {p.paid_on}
            {p.note ? ` · ${p.note}` : ''}
            {p.receipt_sent_at && (
              <span className="text-[11px]" title="Receipt sent"> · ✓ Receipt sent</span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="font-mono text-[13px]">−${Number(p.amount).toFixed(2)}</span>
            <button
              type="button"
              onClick={() => openReceipt(p)}
              disabled={receiptMut.isPending}
              title={p.receipt_sent_at ? 'Resend receipt' : 'Send receipt'}
              aria-label={`${p.receipt_sent_at ? 'Resend' : 'Send'} receipt for payment of $${Number(p.amount).toFixed(2)}`}
              className="flex h-6 w-6 items-center justify-center rounded-sm text-text-muted hover:bg-surface-sunken hover:text-brand-600 disabled:opacity-40"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
                <path d="m22 7-10 6L2 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
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
      <div className="flex items-baseline justify-between border-t border-border-light pt-2.5">
        <span className="text-sm font-semibold text-text-primary">Balance due</span>
        <span
          className={`font-mono text-xl font-semibold ${balance <= 0 ? 'text-success' : 'text-text-primary'}`}
        >
          ${balance.toFixed(2)}
        </span>
      </div>
      <button
        type="button"
        onClick={openPayment}
        disabled={paymentMut.isPending}
        className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-sm bg-brand-600 text-[13px] font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
      >
        {ICONS.payment}
        Record Payment
      </button>
    </section>
  );

  /**
   * Red warning shown above the Progress card while the customer has an
   * open cancellation request (raised from their public page; it changes
   * no status by itself).
   *
   * Red is deliberate — this is the one thing on the page that needs an
   * answer before anything else proceeds. The customer's own page shows
   * the same request in a neutral style, where red would read as an
   * error rather than a call to act.
   *
   * Confirm reverses the confirmation; Deny keeps it and emails the
   * customer. Both are disabled together while either call is in flight.
   */
  const cancelRequestBanner = existing?.cancel_requested_at && (
    <section className="rounded-sm border border-danger bg-danger/10 p-4">
      <div className="mb-1 flex items-center gap-2">
        <span aria-hidden="true">⚠️</span>
        <h2 className="text-sm font-semibold text-danger">Cancellation requested</h2>
      </div>
      <p className="text-[13px] text-text-secondary">
        The customer asked to cancel their confirmation on{' '}
        {new Date(existing.cancel_requested_at).toLocaleDateString()}.
      </p>
      {existing.cancel_request_note?.trim() && (
        <p className="mt-2 rounded-sm bg-surface p-2.5 text-[13px] break-words whitespace-pre-wrap text-text-secondary">
          {existing.cancel_request_note.trim()}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={handleAcceptCancel}
          disabled={resolveCancelMut.isPending}
          className="h-10 flex-1 rounded-sm bg-danger text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={openCancelDeny}
          disabled={resolveCancelMut.isPending}
          className="h-10 flex-1 rounded-sm border border-border-input bg-surface text-[13px] font-medium text-text-secondary hover:bg-surface-sunken disabled:opacity-40"
        >
          Deny
        </button>
      </div>
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
      {/*
        Equal-width grid tracks (NOT flex): a flex item's automatic
        minimum size is its longest word, so on a narrow phone the six
        stage labels ("Awaiting", "Progress", …) forced this row — and
        with it the whole page — wider than the screen. `minmax(0, 1fr)`
        tracks stay inside the card no matter how long a label is.
      */}
      <ol
        className="grid items-start gap-1"
        style={{ gridTemplateColumns: `repeat(${STAGES.length}, minmax(0, 1fr))` }}
      >
        {STAGES.map((stage, i) => {
          const done = i < curIdx;
          const current = i === curIdx && status !== 'expired';
          const canRevert = i < curIdx;
          return (
            <li key={stage.key} className="flex min-w-0 flex-col items-center gap-1.5">
              <div className="flex w-full items-center">
                <span className={`h-0.5 flex-1 ${i === 0 ? 'invisible' : done || current ? 'bg-brand-600' : 'bg-border'}`} />
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${current
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
              <span className={`w-full break-words text-center text-[10px] leading-tight ${current ? 'font-semibold text-text-primary' : 'text-text-muted'}`}>
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
                    sendMut.isPending || markSentMut.isPending ||
                    confirmMut.isPending ||
                    inProgressMut.isPending ||
                    readyMut.isPending || installedMut.isPending
                  }
                  title={
                    !canAdvanceTo(stage.key)
                      ? 'Confirm the order first'
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

  /**
   * Builds the status-aware action set consumed by both layouts.
   *
   * `primary` is the single key action for the current stage (null when
   * the stage has none). `secondary` are the remaining stage-specific
   * actions. Save, Send and Download are NOT part of this set — they
   * live permanently in the top bar (see `headerActions`), and Record
   * Payment lives in the Payments panel body (see `paymentsPanel`).
   * The Order Overview action is included at every post-draft stage and
   * opens `/orders/:id/overview` in a new tab.
   */
  const stageActions = (): {
    primary: StageAction | null;
    secondary: StageAction[];
  } => {
    const overview: StageAction = {
      key: 'overview',
      icon: ICONS.overview,
      label: 'Order Overview',
      short: 'Overview',
      onClick: () => window.open(`/orders/${id}/overview`, '_blank', 'noopener'),
    };
    const confirm: StageAction = {
      key: 'confirm',
      icon: ICONS.confirm,
      label: 'Confirm',
      short: 'Confirm',
      onClick: handleConfirm,
      disabled: !canAct || !customer || items.length === 0 || confirmMut.isPending,
    };

    // Before Draft (unsaved) — nothing here; the top-bar Save is the
    // only available action.
    if (!id) return { primary: null, secondary: [] };

    // Draft — confirm the order (Send/Save live in the top bar).
    if (status === 'draft') return { primary: confirm, secondary: [] };

    // Sent — confirm the order.
    if (status === 'sent') {
      return { primary: confirm, secondary: [overview] };
    }

    // Awaiting payment — the payment itself is recorded from the
    // Payments panel, so only the step-back remains here.
    if (status === 'awaiting_payment') {
      const reverse: StageAction = {
        key: 'reverse',
        icon: ICONS.reverse,
        label: unconfirmMut.isPending ? 'Reversing…' : 'Reverse Confirmation',
        short: unconfirmMut.isPending ? 'Reversing…' : 'Reverse',
        onClick: handleReverse,
        disabled: unconfirmMut.isPending,
      };
      return { primary: null, secondary: [reverse, overview] };
    }

    // In progress — mark the order ready; open the workshop cut sheet.
    if (status === 'in_progress') {
      const markReady: StageAction = {
        key: 'ready',
        icon: ICONS.ready,
        label: readyMut.isPending ? 'Saving…' : 'Mark Ready',
        short: 'Ready',
        onClick: handleMarkReady,
        disabled: readyMut.isPending,
      };
      const manufacturer: StageAction = {
        key: 'manufacturer',
        icon: ICONS.manufacturer,
        label: 'Cut Sheet',
        short: 'Cut Sheet',
        onClick: () => window.open(`/orders/${id}/manufacturer`, '_blank', 'noopener'),
      };
      return { primary: markReady, secondary: [manufacturer, overview] };
    }

    // Ready — propose the installation (emails the customer).
    if (status === 'ready') {
      const propose: StageAction = {
        key: 'install',
        icon: ICONS.install,
        label: 'Propose Installation',
        short: 'Install',
        onClick: () => setInstallSheetOpen(true),
      };
      const markInstalled: StageAction = {
        key: 'installed',
        icon: ICONS.installed,
        label: installedMut.isPending ? 'Saving…' : 'Mark Installed',
        short: 'Installed',
        onClick: handleMarkInstalled,
        disabled: installedMut.isPending,
        tone: 'text-success',
      };
      return { primary: propose, secondary: [markInstalled, overview] };
    }

    // Installed — nothing left to advance; payments (still allowed) are
    // recorded from the Payments panel.
    if (status === 'installed') {
      return { primary: null, secondary: [overview] };
    }

    // Expired — only the Overview remains here (Save/Send/Download are
    // in the top bar; send after updating the expiry date).
    return { primary: null, secondary: [overview] };
  };

  /**
   * Renders the stage's action set for one breakpoint. Returns null
   * when the stage has no panel actions at all (e.g. an unsaved order,
   * where the only actions are the top-bar Save/Send/Download).
   *
   * `vertical` (desktop pricing-rail footer): the primary button, then
   * every secondary full-width. Otherwise (mobile sticky bar): the
   * primary action alone on its own full-width row, and the secondaries
   * as smaller inline buttons with compact labels, packed up to three
   * per row, so the bar never exceeds three button rows.
   */
  const actions = (vertical: boolean) => {
    const { primary, secondary } = stageActions();
    if (!primary && secondary.length === 0) return null;
    const shared = 'inline-flex items-center justify-center gap-2 rounded-sm disabled:opacity-40';
    const primaryCls = `${vertical ? 'h-[46px]' : 'h-12'} w-full ${shared} bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700`;

    const fullBtn = (a: StageAction, cls: string) => (
      <button key={a.key} onClick={a.onClick} disabled={a.disabled} className={`${cls}${a.tone ? ` ${a.tone}` : ''}`}>
        {a.icon}
        {a.label}
      </button>
    );

    if (vertical) {
      const secondaryCls = `h-10 w-full ${shared} border border-border-input bg-surface text-[13px] font-medium text-text-secondary`;
      return (
        <div className="flex flex-col gap-2.5">
          {primary && fullBtn(primary, primaryCls)}
          {secondary.map((a) => fullBtn(a, secondaryCls))}
        </div>
      );
    }

    // Mobile: pack secondaries into inline rows of ≤3 (2+2 reads better
    // than 3+1 when there are exactly four).
    const inline = secondary;
    const perRow = inline.length === 4 ? 2 : 3;
    const rows: StageAction[][] = [];
    for (let i = 0; i < inline.length; i += perRow) rows.push(inline.slice(i, i + perRow));
    const compactCls =
      'h-10 min-w-0 flex-1 inline-flex items-center justify-center gap-1.5 rounded-sm border border-border-input bg-surface px-1.5 text-[12px] font-medium text-text-secondary disabled:opacity-40';
    return (
      <div className="flex flex-col gap-2">
        {primary && fullBtn(primary, primaryCls)}
        {rows.map((row) => (
          <div key={row[0].key} className="flex gap-2">
            {row.map((a) => (
              <button
                key={a.key}
                onClick={a.onClick}
                disabled={a.disabled}
                className={`${compactCls}${a.tone ? ` ${a.tone}` : ''}`}
              >
                {a.icon}
                <span className="truncate">{a.short}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    );
  };

  // Desktop rail footer content (null when the stage has no panel
  // actions, so the empty bordered strip is not rendered).
  const railActions = actions(true);

  const sendBusy = sendMut.isPending || sendInvoiceMut.isPending;
  const sendDisabled = sendBusy || saving || !customer || (!isInvoice && items.length === 0);
  const headerBtn =
    'inline-flex h-9 items-center justify-center gap-1.5 rounded-sm px-2.5 text-[13px] font-semibold disabled:opacity-40 sm:px-3';

  /**
   * Permanent top-bar document actions in the PageHeader's right slot,
   * colour-coded per the design: Save green, Send blue, Download gray,
   * Delete red (icon-only, saved orders only).
   * Icon-only on phones (labels appear from sm: up; title/aria-label
   * keep them accessible). Enable rules match the old panel buttons.
   *
   * The StatusBadge is hidden below sm: — "AWAITING PAYMENT" alone is
   * ~130px, which pushed this row past a phone's width and made the
   * whole page scroll sideways. On phones the status is already on the
   * Progress card (and the Payments panel), so nothing is lost.
   */
  const headerActions = (
    <div className="flex items-center gap-1.5">
      <span className="hidden sm:inline-flex">
        <StatusBadge status={status} />
      </span>
      <button
        onClick={handleSaveDraft}
        disabled={!canAct}
        title={saving ? 'Saving…' : 'Save as Draft'}
        aria-label="Save as Draft"
        className={`${headerBtn} bg-success text-white hover:bg-success/90`}
      >
        {ICONS.save}
        <span className="hidden sm:inline">{saving ? 'Saving…' : 'Save'}</span>
      </button>
      <button
        onClick={openSend}
        disabled={sendDisabled}
        title={isInvoice ? 'Send Invoice' : status === 'sent' ? 'Resend Estimate' : 'Send Estimate'}
        aria-label={isInvoice ? 'Send Invoice' : 'Send Estimate'}
        className={`${headerBtn} bg-brand-600 text-white hover:bg-brand-700`}
      >
        {ICONS.send}
        <span className="hidden sm:inline">
          {sendBusy ? 'Sending…' : status === 'sent' ? 'Resend' : 'Send'}
        </span>
      </button>
      <button
        onClick={handlePdf}
        disabled={(!id && !customer) || saving}
        title={`Download ${docLabel}`}
        aria-label={`Download ${docLabel}`}
        className={`${headerBtn} border border-border-input bg-surface font-medium text-text-secondary hover:bg-surface-sunken`}
      >
        {ICONS.download}
        <span className="hidden sm:inline">Download</span>
      </button>
      {id && (
        <button
          onClick={handleDeleteOrder}
          disabled={deleteMut.isPending}
          title={deleteMut.isPending ? 'Deleting…' : 'Delete Order'}
          aria-label="Delete Order"
          className={`${headerBtn} border border-border-input bg-surface font-medium text-danger hover:bg-surface-sunken`}
        >
          {ICONS.trash}
        </button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen overflow-x-clip bg-surface-muted pb-40 lg:pb-8">
      <PageHeader
        title={id ? existing?.order_number ?? 'Order' : 'New Order'}
        backTo="/"
        right={headerActions}
      />

      <div className="mx-auto w-full max-w-lg lg:grid lg:max-w-6xl lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-0">
        {/* ── Form column ── */}
        <div className="flex w-full min-w-0 flex-col gap-4 p-4 lg:p-8">
          {/* Open cancellation request — needs an answer before anything else */}
          {cancelRequestBanner}

          {/* Progress timeline (revert lives here — outside the disabled fieldset) */}
          {timelineCard}

          <fieldset disabled={readOnly} className="m-0 flex flex-col gap-4 border-0 p-0">
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
                    <div className="flex items-center gap-2 border-b border-border-light px-3 py-2">
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
                              : 'Edit material, cassette and control for selected items'
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
                  <ul className="divide-y divide-border-light">
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
                        <li key={it.key} className="flex min-w-0 items-center gap-2 px-3 py-2.5">
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
                                onClick={() => duplicateItem(it.key)}
                                title={`Duplicate ${name}`}
                                className="flex h-8 w-8 items-center justify-center rounded-sm text-text-muted hover:bg-surface-sunken hover:text-brand-600"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                  <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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

          {/* Installation panel + sheet (ready/installed orders) */}
          {id && (
            <InstallationSection
              orderId={id}
              orderStatus={status}
              customerEmail={customer?.email}
              sheetOpen={installSheetOpen}
              onOpenSheet={() => setInstallSheetOpen(true)}
              onCloseSheet={() => setInstallSheetOpen(false)}
            />
          )}

          {/* Payments panel (both breakpoints; confirmed orders) */}
          {paymentsPanel}

          {/* Activity log (very bottom of the page) */}
          {id && (
            <section className="flex flex-col gap-2 rounded-sm border border-border bg-surface p-4">
              <h2 className="mb-1 text-sm font-semibold text-text-primary">Activity Log</h2>
              {logs && logs.length === 0 && (
                <p className="text-[13px] text-text-muted">No activity recorded yet.</p>
              )}
              {logs && logs.length > 0 && (
                <ul className="flex flex-col gap-2.5">
                  {logs.map((log) => (
                    <li key={log.id} className="flex justify-between gap-3 text-[13px]">
                      <span className="min-w-0 break-words text-text-secondary">{log.message}</span>
                      <span className="shrink-0 whitespace-nowrap font-mono text-xs text-text-muted">
                        {format(new Date(log.created_at), 'MMM d, yyyy HH:mm')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
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
            <div className="mt-4 flex flex-col gap-2 border-t border-border-light pt-3.5">
              {discountControl}
              {totalsRows}
              {postConfirm && (
                <div className="mt-2 flex items-baseline justify-between border-t border-border-light pt-2.5">
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
          {railActions && <div className="border-t border-border px-6 py-5">{railActions}</div>}
        </aside>
      </div>

      {/* ── Mobile sticky action bar ── */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] lg:hidden">
        {/* Same max-w-lg + 16px gutter as the page body, so the bar's
            edges line up with the card edges above it. */}
        <div className="mx-auto w-full max-w-lg px-4">
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
            <div className="mb-3 flex gap-2">
              <input
                autoFocus
                type="search"
                placeholder="Search customers…"
                value={customerTerm}
                onChange={(e) => setCustomerTerm(e.target.value)}
                className="h-11 min-w-0 flex-1 rounded-sm border border-border-input bg-surface px-3 text-sm"
              />
              <button
                onClick={() => setAddingCustomer(true)}
                className="h-11 shrink-0 rounded-sm border border-border-input bg-surface px-3 text-[13px] font-medium text-brand-600 hover:bg-surface-muted"
              >
                + Add customer
              </button>
            </div>
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

      {/* Quick add-customer pop-up; the new customer is auto-selected. */}
      {addingCustomer && (
        <CustomerCreateModal
          onClose={() => setAddingCustomer(false)}
          onCreated={(created) => {
            setCustomer(created);
            setAddingCustomer(false);
            setSheet('none');
          }}
        />
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

            {/* Unmatched e-Transfers — tap one to autofill the form below */}
            {(pendingEtransfersQ.data?.length ?? 0) > 0 && (
              <div className="mb-3 rounded-sm border border-border bg-surface-muted p-2.5">
                <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  Received e-Transfers ({pendingEtransfersQ.data!.length})
                </p>
                <ul className="flex flex-col gap-1.5">
                  {pendingEtransfersQ.data!.map((t) => {
                    const selected = payEtransferId === t.id;
                    return (
                      <li
                        key={t.id}
                        className={`flex items-center gap-2 rounded-sm border bg-surface px-2.5 py-2 ${selected ? 'border-brand-600' : 'border-border-input'
                          }`}
                      >
                        <button
                          type="button"
                          onClick={() => applyEtransfer(t)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="font-mono text-[13px] font-semibold text-text-primary">
                              ${t.amount.toFixed(2)}
                            </span>
                            <span className="truncate text-[12px] text-text-secondary">
                              {t.sender || 'Unknown sender'}
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-text-muted">
                            {new Date(t.received_at).toLocaleDateString()}
                            {t.reference_message ? ` · ${t.reference_message}` : ''}
                          </span>
                        </button>
                        {selected && (
                          <span className="shrink-0 rounded-sm bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">
                            Selected
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => dismissEtransferMut.mutate(t.id)}
                          disabled={dismissEtransferMut.isPending}
                          aria-label={`Dismiss e-Transfer of $${t.amount.toFixed(2)}`}
                          title="Dismiss"
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-text-muted hover:bg-surface-sunken hover:text-danger disabled:opacity-40"
                        >
                          ✕
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 px-1 text-[11px] text-text-muted">
                  Tap one to fill this form, then Record payment.
                </p>
              </div>
            )}

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

      {/* Deny cancellation request (with optional explanation emailed) */}
      {sheet === 'cancelDeny' && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 lg:items-center" onClick={() => setSheet('none')}>
          <div
            className="w-full rounded-t-sm bg-surface p-4 lg:max-w-md lg:rounded-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-sm font-semibold text-text-primary">
              Deny cancellation request
            </h2>
            <p className="mb-3 text-[13px] text-text-muted">
              {customer?.email
                ? `The order stays confirmed and we'll email ${customer.email} to let them know.`
                : 'The order stays confirmed. This customer has no email address on file, so they will not be notified.'}
            </p>
            <div className="flex flex-col gap-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-text-secondary">
                  Explanation to include (optional)
                </span>
                <textarea
                  autoFocus
                  value={cancelDenyMessage}
                  onChange={(e) => setCancelDenyMessage(e.target.value)}
                  maxLength={1000}
                  rows={4}
                  placeholder="e.g. Your blinds are already in production, so we're unable to cancel at this stage."
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
                  onClick={submitCancelDeny}
                  disabled={resolveCancelMut.isPending}
                  className="h-11 flex-[2] rounded-sm bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
                >
                  {resolveCancelMut.isPending ? 'Sending…' : 'Deny request'}
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

      {/* Send receipt bottom sheet (per payment, with optional message) */}
      {sheet === 'receipt' && receiptPayment && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 lg:items-center" onClick={() => setSheet('none')}>
          <div
            className="w-full rounded-t-sm bg-surface p-4 lg:max-w-md lg:rounded-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-sm font-semibold text-text-primary">
              {receiptPayment.receipt_sent_at ? 'Resend receipt' : 'Send receipt'}
            </h2>
            <p className="mb-3 text-[13px] text-text-muted">
              We&apos;ll email {customer?.email ?? 'the customer'} a receipt for the{' '}
              <span className="font-mono">${Number(receiptPayment.amount).toFixed(2)}</span> payment
              received on {receiptPayment.paid_on}, with the order&apos;s balance summary.
            </p>
            <div className="flex flex-col gap-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-text-secondary">
                  Message to include (optional)
                </span>
                <textarea
                  autoFocus
                  value={receiptMessage}
                  onChange={(e) => setReceiptMessage(e.target.value)}
                  maxLength={1000}
                  rows={4}
                  placeholder="e.g. Thank you for your payment — we'll be in touch about next steps."
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
                  onClick={submitReceipt}
                  disabled={receiptMut.isPending || !customer?.email}
                  className="h-11 flex-[2] rounded-sm bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
                >
                  {receiptMut.isPending ? 'Sending…' : 'Send Receipt'}
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

      {/* Bulk edit popup (material / cassette / control only) */}
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
                disabled={!bulkState.material_id && !bulkState.cassette_id && !bulkState.control_id}
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
