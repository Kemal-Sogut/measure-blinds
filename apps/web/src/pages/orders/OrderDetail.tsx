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
 * Every UNCONFIRMED stage (draft, sent, expired) offers a Present to
 * Customer action directly below Confirm, which saves and then navigates
 * to `/orders/:id/present` — the filterable, per-option view shown to the
 * customer in person.
 * Save (green), Send (blue), Download (gray) and Delete (icon-only,
 * red, saved orders) live in the TOP BAR
 * (PageHeader right slot, icon-only on phones) at every stage; the
 * action areas hold only the stage-specific actions. On mobile the
 * sticky action bar renders the stage's primary action full-width on
 * its own row and every other action as smaller inline buttons (max
 * three per row, max three rows). That bar slides out of the way while
 * the on-screen keyboard is up (`useKeyboardOpen`) and publishes its own
 * height as `--action-bar-h`, which the page reserves as bottom padding
 * — its height varies by stage, so a constant would bury the last line
 * item at some stages.
 *
 * Phone layout note: the line-item rows break onto two lines below `sm`
 * (identity above, price + row actions below). On one line the row's
 * fixed-width parts alone exceeded a phone's width, and since the page
 * root is `overflow-x-clip`, the edit/duplicate/delete buttons were not
 * merely cramped — they were unreachable.
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

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import PageHeader, { PAGE_CONTAINER } from '../../components/PageHeader';
import DatePicker from '../../components/DatePicker';
import StatusBadge from '../../components/StatusBadge';
import CustomerCreateModal from '../../components/CustomerCreateModal';
import CustomerEditModal from '../../components/CustomerEditModal';
import { CustomerCard, OrderDatesCard } from './OrderHeaderCards';
import { expiryFromPreset, presetFromDates, type ExpiryPresetId } from '../../lib/expiryTerms';
import type { CardAccent } from '../../components/ui';
import { calculateTotals } from '../../lib/totals';
import {
  useOrder,
  useCreateOrder,
  useUpdateOrder,
  useSendOrder,
  useSendInvoice,
  useConfirmOrder,
  useUnconfirmOrder,
  useResolveCancelRequest,
  useMarkReady,
  useMarkInstalled,
  useSetOrderStatus,
  useDeleteOrder,
  useDuplicateOrder,
  useRecordPayment,
  useSendReceipt,
  useSendWarranty,
  useDeletePayment,
  useUnmatchedEtransfers,
  useDismissEtransfer,
  useOrderLogs,
  useOrderEditRequests,
  useResolveEditRequest,
  useOrderPublicToken,
  downloadOrderPdf,
  downloadWarrantyPdf,
  type OrderInput,
  type LineItemInput,
  type AdjustmentInputFields,
  type ItemIdentityFields,
  type PendingEtransfer,
} from '../../hooks/useOrders';
import { useCustomer, useCustomerSearch } from '../../hooks/useCustomers';
import { displayName } from '../../lib/customerName';
import { useKeyboardOpen } from '../../hooks/useKeyboardOpen';
import {
  useBlindTypeDefaults,
  useCatalogList,
  useCompanySettings,
} from '../../hooks/useSettings';
import InstallationSection from './InstallationSection';
import {
  BlindEditForm,
  FlatEditForm,
  BulkEditForm,
} from './LineItemEditor';
import LineItemList from './LineItemList';
import { arrayMove } from '@dnd-kit/sortable';
import {
  blindDraftPrice,
  bulkEditSelection,
  canOverridePrice,
  flatDraftPrice,
  newBlindDraft,
  parseAddons,
  parseDraftAttributes,
  parseOverride,
  parsePositive,
  pruneSelection,
  slotsForType,
  NO_ADJUSTMENTS,
  type BlindDraft,
  type BlindDraftDefaults,
  type FlatDraft,
  type ItemDraft,
  type Catalogs,
  type PriceAdjustmentDraft,
} from './lineItemDrafts';
import { MaterialUsageDialog, MaterialUsageTrigger } from './MaterialUsageDialog';
import { applyGiveBackPart, summarizeMaterialUsage } from './materialUsage';
import { applyBulkPatch, type BulkEditState } from './lineItemBulk';
import BulkAddSheet from './BulkAddSheet';
import EditRequestsCard from './EditRequestsCard';
import { nextKey } from './draftKeys';
import type { Customer, Order, OrderStatus, Material, CassetteOption, BottomRailOption, ControlOption, PleatType, InstallationOption, BlindType, PresetLineItem, DiscountType, Payment, LineItem } from '../../types';

/**
 * Panel treatment shared by this screen's hand-rolled bottom sheets.
 *
 * Height is capped in `dvh`, not `vh`: iOS Safari resolves `vh` against
 * the LARGE viewport (URL toolbar hidden), so a `90vh` sheet is taller
 * than what is actually on screen and its footer buttons end up behind
 * the toolbar — which is what made these sheets look "too big", with
 * their edges off-screen. `dvh` tracks the toolbar as it collapses.
 * The bottom padding carries the home-indicator inset, and
 * `overscroll-contain` stops a flick at the end of a sheet from
 * scrolling the page underneath it.
 *
 * Callers append their own `lg:max-w-*`. These sheets predate the shared
 * `ui/Modal` and are deliberately NOT migrated onto it here — that is a
 * refactor; this only makes them fit a phone.
 */
const SHEET_PANEL =
  'max-h-[92dvh] w-full overflow-y-auto overscroll-contain rounded-t-2xl bg-surface p-4 ' +
  'pb-[max(1rem,env(safe-area-inset-bottom))] lg:max-h-[85vh] lg:rounded-2xl lg:pb-4';

/**
 * Overlay for the customer picker. On phone/tablet it anchors the panel 25%
 * down from the top instead of the bottom: the search field then sits around
 * the middle of the screen with its results directly underneath, so the
 * on-screen keyboard can't cover the (often single) match. Desktop keeps the
 * usual centered dialog.
 */
const CUSTOMER_SHEET_OVERLAY =
  'fixed inset-0 z-40 flex items-start justify-center bg-black/40 pt-[25dvh] ' +
  'lg:items-center lg:pt-0';

/** Panel for the customer picker — fully rounded and fits the space below the 25% offset. */
const CUSTOMER_SHEET_PANEL =
  'max-h-[calc(75dvh-1rem)] w-full overflow-y-auto overscroll-contain rounded-2xl bg-surface p-4 ' +
  'pb-[max(1rem,env(safe-area-inset-bottom))] lg:max-h-[85vh] lg:max-w-md lg:pb-4';

/** Icon-badge tint + ink per accent, mirroring `ui/Card`'s CardHeader. */
const SECTION_ACCENTS: Record<CardAccent, string> = {
  brand: 'bg-info-tint text-info',
  success: 'bg-success-tint text-success',
  warning: 'bg-warning-tint text-warning',
  danger: 'bg-danger-tint text-danger',
  scheduled: 'bg-scheduled-tint text-scheduled',
  neutral: 'bg-surface-sunken text-text-secondary',
};

/**
 * Hued icon badge for this screen's section headings.
 *
 * The sections here are hand-rolled `<section>` wrappers rather than the
 * `ui/Card` composition, because converting them would mean
 * restructuring the most complex screen in the app — a refactor the
 * redesign does not authorize. This reproduces CardHeader's badge alone
 * so the headings still read in the same semantic language as every
 * other card in the app.
 *
 * @param accent Semantic hue; must match what the section means
 *   elsewhere (warning for money owed, scheduled for installation).
 * @param d Space-`M`-separated SVG path data, split the same way the
 *   nav components split theirs.
 */
function SectionIcon({ accent, d }: { accent: CardAccent; d: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${SECTION_ACCENTS[accent]}`}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
        {d.split(' M').map((seg, i) => (
          <path
            key={i}
            d={(i === 0 ? '' : 'M') + seg}
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </span>
  );
}

/** Formats a Date as the API's YYYY-MM-DD. */
function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parses YYYY-MM-DD as a local Date (no UTC shift). */
function fromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Converts persisted line items into editable drafts. */
function toDrafts(order: Order): ItemDraft[] {
  return (order.line_items ?? []).map((li) => {
    if (li.item_type === 'blind') {
      return {
        key: nextKey(),
        uid: li.uid,
        hidden: li.hidden,
        item_type: 'blind',
        room_name: li.room_name,
        blinds_type: li.blinds_type,
        panels: li.panels.map(String),
        height_cm: String(li.height_cm ?? ''),
        material_id: li.material_id ?? '',
        cassette_id: li.cassette_id ?? '',
        bottom_rail_id: li.bottom_rail_id ?? '',
        control_id: li.control_id ?? '',
        installation_id: li.installation_id ?? '',
        color: li.color ?? '',
        note: li.note ?? '',
        // The persisted blob is typed; the draft holds strings.
        attributes: Object.fromEntries(
          Object.entries(li.attributes ?? {}).map(([k, v]) => [k, String(v)])
        ),
        quantity: String(li.quantity),
        ...toAdjustmentDraft(li),
      } satisfies BlindDraft;
    }
    return {
      key: nextKey(),
      uid: li.uid,
      hidden: li.hidden,
      item_type: li.item_type,
      title: li.title,
      description: li.description,
      preset_id: li.preset_id,
      quantity: String(li.quantity),
      // `unit_price` is the price CHARGED, so an overridden item's draft
      // must show the CALCULATED figure here and the charged one in the
      // override box. Reading `unit_price` into the base would silently
      // promote the override on every reopen and lose the original.
      unit_price: String(li.base_unit_price ?? li.unit_price),
      ...toAdjustmentDraft(li),
    } satisfies FlatDraft;
  });
}

/**
 * The three adjustment fields of a persisted item, as draft strings.
 *
 * An item is overridden exactly when `base_unit_price` is set, and the
 * charged `unit_price` is then what the consultant typed — so that is
 * what goes back into the override box.
 */
function toAdjustmentDraft(li: LineItem): PriceAdjustmentDraft {
  return {
    unit_price_override: li.base_unit_price === null ? '' : String(li.unit_price),
    show_original_price: li.show_original_price,
    addons: (li.addons ?? []).map((a) => ({
      key: nextKey(),
      label: a.label,
      price: String(a.price),
    })),
    // The price this item was confirmed at, carried into the editor so
    // the preview shows what the save will keep. Both columns move
    // together — half a lock is no lock.
    lock:
      li.locked_base_price !== null && li.locked_inputs_fingerprint
        ? { base: Number(li.locked_base_price), fingerprint: li.locked_inputs_fingerprint }
        : null,
  };
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
  customerView: (
    <ActionIcon>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </ActionIcon>
  ),
  duplicate: (
    <ActionIcon>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
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
  present: (
    <ActionIcon>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </ActionIcon>
  ),
  labels: (
    <ActionIcon>
      <path d="M3 7a2 2 0 0 1 2-2h9l6 6-9 9-8-8V7Z" />
      <path d="M7 9h.01" />
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

/**
 * How many activity-log rows the collapsed trail shows. The log grows
 * unbounded over an order's life (every lifecycle mutation appends a row),
 * so the newest slice is rendered by default and the rest stays behind the
 * "Show more" toggle to keep the bottom of the page short.
 */
const LOG_PREVIEW_COUNT = 10;

/** Every bulk-edit field on "no change" — shared by `bulkState`'s initial value and `openBulkEdit`'s reset so the two can never drift apart. */
const EMPTY_BULK_STATE: BulkEditState = { blinds_type: '', material_id: '', cassette_id: '', bottom_rail_id: '', control_id: '', installation_id: '', color: '' };

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: existing, isLoading: loadingExisting, error: loadError } = useOrder(id);
  const { data: logs } = useOrderLogs(id);
  const { data: editRequests } = useOrderEditRequests(id);

  // New-order customer pre-fill. An "Add order" link (e.g. from an
  // appointment's detail page) opens `/orders/new?customer=<id>`; the
  // customer is fetched and dropped into the picker so the consultant
  // starts on line items instead of re-finding a customer they were just
  // looking at. Only for a NEW order — an existing order hydrates its own
  // customer — and `useCustomer(undefined)` is disabled, so no request
  // fires when the param is absent or this is an edit.
  const prefillCustomerId = id ? undefined : searchParams.get('customer') ?? undefined;
  const prefillCustomerQ = useCustomer(prefillCustomerId);
  const prefillApplied = useRef(false);

  const materialsQ = useCatalogList<Material>('materials');
  const cassettesQ = useCatalogList<CassetteOption>('cassette-options');
  const bottomRailsQ = useCatalogList<BottomRailOption>('bottom-rail-options');
  const controlsQ = useCatalogList<ControlOption>('control-options');
  // Curtains-only catalogs. Fetched unconditionally: the blind type can
  // change mid-edit, and the preview must price the moment it does.
  const pleatTypesQ = useCatalogList<PleatType>('pleat-types');
  const installationQ = useCatalogList<InstallationOption>('installation-options');
  const blindTypesQ = useCatalogList<BlindType>('blind-types');
  const presetsQ = useCatalogList<PresetLineItem>('presets');
  const defaultsQ = useBlindTypeDefaults();
  const { data: company } = useCompanySettings();

  const createMut = useCreateOrder();
  const updateMut = useUpdateOrder();
  const sendMut = useSendOrder();
  const sendInvoiceMut = useSendInvoice();
  const confirmMut = useConfirmOrder();
  const unconfirmMut = useUnconfirmOrder();
  const resolveCancelMut = useResolveCancelRequest();
  const resolveEditMut = useResolveEditRequest();
  const readyMut = useMarkReady();
  const installedMut = useMarkInstalled();
  const setStatusMut = useSetOrderStatus();
  const deleteMut = useDeleteOrder();
  const duplicateMut = useDuplicateOrder();
  const paymentMut = useRecordPayment();
  const receiptMut = useSendReceipt();
  const warrantyMut = useSendWarranty();
  const deletePaymentMut = useDeletePayment();
  const pendingEtransfersQ = useUnmatchedEtransfers();
  const dismissEtransferMut = useDismissEtransfer();
  const publicTokenMut = useOrderPublicToken();

  // ── Editor state ────────────────────────────────────────────────
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orderDate, setOrderDate] = useState<Date>(new Date());
  const [expiryDate, setExpiryDate] = useState<Date | null>(null);
  const [expiryManual, setExpiryManual] = useState(false);
  // Expiry term chosen from the shortcut chips ("On receipt", 7 days…).
  // While set, the expiry date follows the order date; picking a date
  // directly clears it back to null.
  const [expiryPreset, setExpiryPreset] = useState<ExpiryPresetId | null>(null);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [discountType, setDiscountType] = useState<DiscountType>('fixed');
  const [discountValue, setDiscountValue] = useState('');
  // ── Material usage dialog ───────────────────────────────────────
  // All of this is lifted out of the dialog — see MaterialUsageDialogProps'
  // own JSDoc for why: `Modal` unmounts its children when closed, and the
  // trigger renders at two breakpoints that both stay mounted, so local
  // state would be wiped on dismissal and duplicated across widths.
  const [materialUsageOpen, setMaterialUsageOpen] = useState(false);
  const [sqmGiveBackRate, setSqmGiveBackRate] = useState('');
  const [runningGiveBackRate, setRunningGiveBackRate] = useState('');
  /** Per-material rate inputs, keyed by `materialRowKey`. */
  const [materialRateDrafts, setMaterialRateDrafts] = useState<Record<string, string>>({});
  /**
   * What each give-back instrument has already contributed to the fixed
   * discount. Session-only: nothing persists a per-material rate, so a
   * reload leaves a plain dollar discount and an empty map.
   */
  const [giveBackParts, setGiveBackParts] = useState<Record<string, number>>({});
  const [hydrated, setHydrated] = useState(false);
  const [sheet, setSheet] = useState<'none' | 'customer' | 'preset' | 'payment' | 'send' | 'receipt' | 'warranty' | 'editItem' | 'bulkEdit' | 'bulkAdd' | 'cancelDeny'>('none');

  // ── Line item selection / edit state ────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ItemDraft | null>(null);
  // Key of a just-added item whose editor is open for the first time;
  // canceling that editor discards the still-blank item.
  const [pendingNewKey, setPendingNewKey] = useState<string | null>(null);
  const [bulkState, setBulkState] = useState<BulkEditState>(EMPTY_BULK_STATE);
  const [customerTerm, setCustomerTerm] = useState('');
  const customersQ = useCustomerSearch(customerTerm);
  // Quick add-customer pop-up opened from the customer picker sheet.
  const [addingCustomer, setAddingCustomer] = useState(false);
  // Inline customer-record editor, opened by the pen on the customer card.
  // Separate from `addingCustomer` because the two dialogs edit different
  // things and may not both be open.
  const [editingCustomer, setEditingCustomer] = useState(false);

  // ── Mobile action bar geometry ──────────────────────────────────
  // The bar is `position: fixed`, which on iOS is positioned against the
  // LAYOUT viewport — so when the keyboard opens it stays where the
  // bottom of the screen used to be, on top of the field being typed
  // into. Hide it while typing; it slides back on blur.
  const keyboardOpen = useKeyboardOpen();
  const [actionBar, setActionBar] = useState<HTMLDivElement | null>(null);

  // Publish the bar's measured height as `--action-bar-h` so the page can
  // reserve exactly that much bottom padding. The bar is one to three
  // button rows depending on lifecycle stage, so any constant would leave
  // the last item row buried at some stage.
  useEffect(() => {
    if (!actionBar) return;
    const root = document.documentElement;
    const publish = () =>
      root.style.setProperty('--action-bar-h', `${actionBar.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(actionBar);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--action-bar-h');
    };
  }, [actionBar]);

  // ── Sticky head geometry ────────────────────────────────────────
  // The page header and the document-action toolbar pin together as one
  // block. The summary rail must stick directly below it, and the
  // block's height is not a constant: it grows when the document
  // actions wrap to a second row, and again at `lg` where the title
  // steps up a size. Measured and published as `--order-head-h` for the
  // same reason `--action-bar-h` exists — a hard-coded offset here was
  // already wrong at most widths.
  const [stickyHead, setStickyHead] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!stickyHead) return;
    const root = document.documentElement;
    const publish = () =>
      root.style.setProperty('--order-head-h', `${stickyHead.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(stickyHead);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--order-head-h');
    };
  }, [stickyHead]);

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

  // Send-warranty sheet: the optional personal message included in the
  // warranty email. There is no per-row state — one certificate covers
  // the whole order.
  const [warrantyMessage, setWarrantyMessage] = useState('');

  // Optional explanation emailed to the customer when DENYING their
  // cancellation request (accepting sends nothing).
  const [cancelDenyMessage, setCancelDenyMessage] = useState('');

  // Activity-log trail: collapsed to the newest LOG_PREVIEW_COUNT rows
  // until the reader expands it.
  const [logsExpanded, setLogsExpanded] = useState(false);

  // Installation propose/change sheet (lives in InstallationSection;
  // lifted here so the ready-status actions panel can open it too).
  const [installSheetOpen, setInstallSheetOpen] = useState(false);

  // Hydrate once from a loaded order.
  useEffect(() => {
    if (id && existing && !hydrated) {
      const savedOrderDate = fromIso(existing.order_date);
      const savedExpiry = fromIso(existing.expiry_date);
      setCustomer(existing.customer ?? null);
      setOrderDate(savedOrderDate);
      setExpiryDate(savedExpiry);
      setExpiryManual(true); // persisted expiry counts as chosen
      // Only the resolved dates are stored, so the term that produced
      // them is re-derived — otherwise re-opening a saved order shows an
      // empty chip row and the choice looks like it was lost.
      setExpiryPreset(presetFromDates(savedOrderDate, savedExpiry));
      setItems(toDrafts(existing));
      setDiscountType(existing.discount_type);
      setDiscountValue(existing.discount_value ? String(existing.discount_value) : '');
      setHydrated(true);
    }
  }, [id, existing, hydrated]);

  // Drop the pre-filled customer in once it arrives, and only if the
  // consultant hasn't already picked one — a later change or clear from
  // the picker is never undone. The ref keeps this to a single apply,
  // even though the effect re-runs as `customer` changes.
  useEffect(() => {
    if (id || prefillApplied.current) return;
    if (prefillCustomerQ.data && !customer) {
      setCustomer(prefillCustomerQ.data);
      prefillApplied.current = true;
    }
  }, [id, prefillCustomerQ.data, customer]);

  // Expiry follows the order date in two cases: a chip term is selected
  // (its offset is re-applied whenever the order date moves), or nothing
  // has been chosen yet and the company default_expiry_days applies. A
  // date picked straight from the expiry DatePicker clears the term and
  // sets `expiryManual`, which pins it.
  useEffect(() => {
    if (expiryPreset) {
      setExpiryDate(expiryFromPreset(orderDate, expiryPreset));
      return;
    }
    if (expiryManual) return;
    // An order being opened carries its own expiry: until it has
    // hydrated, the default must not write anything. Both effects can
    // fire in the SAME commit — `company` settling changes this one's
    // deps just as the order arrives — and this one runs second, so
    // without the guard the default overwrote the saved date. A chip
    // hid the damage by recomputing on the next pass; a hand-picked
    // date had nothing to restore it.
    if (id && !hydrated) return;
    const days = company?.default_expiry_days ?? 14;
    const d = new Date(orderDate);
    d.setDate(d.getDate() + days);
    setExpiryDate(d);
  }, [orderDate, company, expiryManual, expiryPreset, id, hydrated]);

  const catalogs: Catalogs = useMemo(
    () => ({
      materials: materialsQ.data ?? [],
      cassettes: cassettesQ.data ?? [],
      bottomRails: bottomRailsQ.data ?? [],
      controls: controlsQ.data ?? [],
      blindTypes: blindTypesQ.data ?? [],
      pleatTypes: pleatTypesQ.data ?? [],
      installationOptions: installationQ.data ?? [],
      defaults: defaultsQ.data ?? [],
    }),
    [
      materialsQ.data,
      cassettesQ.data,
      bottomRailsQ.data,
      controlsQ.data,
      blindTypesQ.data,
      pleatTypesQ.data,
      installationQ.data,
      defaultsQ.data,
    ]
  );

  /**
   * A brand-new blind starts with no hardware chosen: nothing is scoped
   * until a blind type is picked, so guessing a house default by NAME
   * here would just be overwritten (or wrong) once a type is selected.
   * The type dropdown (`BlindTypeSelect`, via `applyTypeDefaults`) fills
   * material and every hardware slot with that type's SAVED defaults from
   * Settings the moment a type is chosen. Used by the single-blind path
   * (`addBlind`) so a freshly added blind starts identically blank every
   * time.
   */
  const blindDefaults: BlindDraftDefaults = { cassette_id: '', bottom_rail_id: '', control_id: '' };

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
  // A hidden item keeps its price on screen — the consultant has to see
  // what is being left out — but never reaches the subtotal. Mirrors the
  // Worker, which filters its resolved rows the same way.
  const totals = useMemo(
    () =>
      calculateTotals({
        lineTotals: itemPrices.filter((_, i) => !items[i].hidden),
        discount_type: discountType,
        discount_value: Number(discountValue) || 0,
      }),
    [itemPrices, items, discountType, discountValue]
  );

  /**
   * Fabric usage for the Material usage dialog, computed HERE rather than
   * inside it because both the dialog and its trigger read it, and the
   * trigger renders at two breakpoints. One aggregation, one answer.
   */
  const materialUsage = useMemo(() => summarizeMaterialUsage(items, catalogs), [items, catalogs]);

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
  /**
   * Removes one line item and prunes it out of `selected` too.
   *
   * Without the prune, deleting a currently-selected row via its own
   * Delete button leaves a phantom key in the Set: the toolbar's "N
   * selected" count stays stale and a later bulk-delete would count, and
   * try to delete, a row that is already gone (`pruneSelection`, mirroring
   * `LineItemList`'s own pruning of its `expanded` Set on the identical
   * membership change).
   */
  function removeItem(key: string) {
    const next = items.filter((it) => it.key !== key);
    setItems(next);
    setSelected((prev) => pruneSelection(prev, next));
  }
  /**
   * Clones a line item (fresh key and identity, copied panels) right
   * after the original.
   *
   * The clone is a NEW row, so it must NOT inherit the source's `uid`:
   * two rows claiming one identity would make the Worker's visibility
   * diff ambiguous on save. Its `hidden` state is inherited, because a
   * copy of a hidden item is one too until told otherwise.
   */
  function duplicateItem(key: string) {
    setItems((list) => {
      const idx = list.findIndex((it) => it.key === key);
      if (idx === -1) return list;
      const src = list[idx];
      // `lock: null` for the same reason as `uid: null`: the copy is a
      // NEW item that no confirmation has ever priced, so it is quoted
      // from today's catalog rather than inheriting a frozen price it was
      // never given.
      const copy: ItemDraft =
        src.item_type === 'blind'
          ? { ...src, key: nextKey(), uid: null, lock: null, panels: [...src.panels] }
          : { ...src, key: nextKey(), uid: null, lock: null };
      const next = list.slice();
      next.splice(idx + 1, 0, copy);
      return next;
    });
  }
  /**
   * Flips one line item's visibility.
   *
   * A hidden item keeps its place and its price in the editor but leaves
   * the order total and every document — estimate, invoice, customer
   * page, warranty, labels, cut sheet. The caller must not offer this
   * once the order is confirmed: the Worker refuses the save with a 400,
   * and the button is disabled there for the same reason.
   */
  function toggleHidden(key: string) {
    setItems((list) =>
      list.map((it) => (it.key === key ? { ...it, hidden: !it.hidden } : it))
    );
  }
  /**
   * Moves a line item one position up (-1) or down (+1) in display order;
   * no-ops at either edge. Feeds `LineItemList`'s `onMove`, which
   * `LineItemRow`'s 3-dot menu calls from its Move up/down items — those
   * are themselves disabled at the first/last row, so the no-op here is a
   * backstop, not the only guard.
   */
  function moveItem(key: string, dir: -1 | 1) {
    setItems((list) => {
      const idx = list.findIndex((it) => it.key === key);
      const to = idx + dir;
      if (idx === -1 || to < 0 || to >= list.length) return list;
      const next = list.slice();
      const [row] = next.splice(idx, 1);
      next.splice(to, 0, row);
      return next;
    });
  }
  /**
   * Reorders line items by drag-and-drop: moves the item identified by
   * `activeKey` to the position of the item identified by `overKey`.
   * Feeds `LineItemList`'s `onReorder`, called from its `DndContext`'s
   * `onDragEnd` once a drag lands on a different row than it started on.
   *
   * Uses `arrayMove` from `@dnd-kit/sortable` rather than hand-rolling the
   * splice `moveItem` above uses, because a drag can land anywhere in the
   * list (not just one slot up or down) — `arrayMove` handles that
   * distance uniformly and immutably. No-ops (returns the same list) if
   * either key is not found, mirroring `moveItem`'s edge-case guard.
   *
   * This is the ENTIRE persistence story for the new order: nothing here
   * writes a `position` field. The Worker derives each line item's saved
   * position from its index in the save payload array, so reordering this
   * in-memory array is the whole job — the next save carries the new
   * order through untouched.
   */
  function reorderItems(activeKey: string, overKey: string) {
    setItems((list) => {
      const from = list.findIndex((it) => it.key === activeKey);
      const to = list.findIndex((it) => it.key === overKey);
      if (from === -1 || to === -1) return list;
      return arrayMove(list, from, to);
    });
  }
  function addBlind() {
    // Nothing is seeded yet — no blind type, no material, no hardware —
    // because nothing can be validated or scoped before a type is chosen.
    // The type dropdown (`BlindTypeSelect`) then applies that type's
    // SAVED defaults from Settings via `applyTypeDefaults`, which also
    // clears whichever slot the chosen type does not use and seeds
    // `attributes` from it. The factory also seeds the identity fields
    // (no uid until the first save, visible), so this path and the Bulk
    // Add sheet's own section factory (`newBulkSection` in `bulkAdd.ts`,
    // which calls this same `newBlindDraft`) cannot disagree on what a
    // blank draft looks like.
    const draft = newBlindDraft(nextKey(), blindDefaults);
    setItems((list) => [...list, draft]);
    openNewItemEdit(draft);
  }
  function addPreset(preset: PresetLineItem) {
    setItems((list) => [
      ...list,
      {
        key: nextKey(),
        uid: null,
        hidden: false,
        item_type: 'preset',
        // The catalog name becomes the headline and its description the
        // body. These used to be concatenated into one string, which left
        // no way to emphasise the name on a document.
        title: preset.name,
        description: preset.description ?? '',
        preset_id: preset.id,
        quantity: '1',
        unit_price: String(preset.unit_price),
        ...NO_ADJUSTMENTS,
      },
    ]);
    setSheet('none');
  }
  function addCustom() {
    const draft: FlatDraft = {
      key: nextKey(),
      uid: null,
      hidden: false,
      item_type: 'custom',
      title: '',
      description: '',
      preset_id: null,
      quantity: '1',
      unit_price: '',
      ...NO_ADJUSTMENTS,
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

  // ── Bulk edit (material / hardware slots of ONE blind type) ───────
  /**
   * Opens the bulk popup for a selection that has already been checked to
   * be blinds — of one shared type, of several, or of none yet; the form
   * asks for a type in the latter two cases. Every field starts empty
   * ("No change") on each open, so a previous run can never re-apply
   * itself.
   */
  function openBulkEdit() {
    if (!bulkEditSelection(items, selected).ok) return;
    setBulkState(EMPTY_BULK_STATE);
    setSheet('bulkEdit');
  }

  /**
   * Writes the current bulk-edit patch onto every selected item.
   *
   * What each item becomes is entirely `applyBulkPatch`'s call — it
   * already passes a non-blind item through untouched and re-scopes a
   * blind-type change per item, so this only has to map the selection
   * over it once; the rule is tested there and cannot drift from the note
   * the form shows.
   */
  function applyBulkEdit() {
    setItems((list) => list.map((it) => (selected.has(it.key) ? applyBulkPatch(it, bulkState, catalogs) : it)));
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

    /**
     * The three adjustment fields, validated once for any item type.
     * Returns a message string when the override does not parse, matching
     * this function's error convention.
     *
     * `unit_price_override` is left OFF the payload where the item cannot
     * be overridden — the Worker rejects the field on a custom item.
     */
    function adjustmentsFor(it: ItemDraft, index: number): AdjustmentInputFields | string {
      const override = parseOverride(it.unit_price_override);
      if (!override.valid) return `Item ${index + 1}: enter a valid override price.`;
      return {
        ...(canOverridePrice(it) ? { unit_price_override: override.value } : {}),
        show_original_price: it.show_original_price,
        addons: parseAddons(it.addons),
      };
    }
    /**
     * Identity and visibility, as the API expects them.
     *
     * `uid` is OMITTED for an item that has never been saved — the
     * Worker mints one then — and round-tripped verbatim otherwise, since
     * it is what the Worker diffs visibility against on a confirmed
     * order.
     */
    function identityFor(it: ItemDraft): ItemIdentityFields {
      return { ...(it.uid ? { uid: it.uid } : {}), hidden: it.hidden };
    }
    for (const [i, it] of items.entries()) {
      if (it.item_type === 'blind') {
        const panels = it.panels.map(parsePositive);
        const height = parsePositive(it.height_cm);
        const qty = parsePositive(it.quantity);
        if (panels.some((p) => p === null) || !panels.length)
          return `Item ${i + 1}: enter every panel width.`;
        if (!height) return `Item ${i + 1}: enter a height.`;
        // Which hardware a blind needs comes from the SCOPING, the same
        // rule the form renders from and the Worker validates against:
        // Curtains has no cassette scoped to it, and demanding one here
        // would make a curtain unsavable.
        const uses = slotsForType(catalogs, it.blinds_type);
        if (!it.material_id) return `Item ${i + 1}: choose a material.`;
        if (uses.has('cassette') && !it.cassette_id) return `Item ${i + 1}: choose a cassette.`;
        if (uses.has('bottom_rail') && !it.bottom_rail_id)
          return `Item ${i + 1}: choose a bottom rail.`;
        if (uses.has('control') && !it.control_id)
          return `Item ${i + 1}: choose a control option.`;
        if (uses.has('installation') && !it.installation_id)
          return `Item ${i + 1}: choose an installation option.`;
        if (!qty) return `Item ${i + 1}: enter a quantity.`;
        // Convert once, here. Failing now gives a readable message instead
        // of a 400 from the server's own re-parse.
        const attributes = parseDraftAttributes(it);
        if (attributes === null)
          return `Item ${i + 1}: check the ${it.blinds_type || 'blind'} options.`;
        const adj = adjustmentsFor(it, i);
        if (typeof adj === 'string') return adj;
        line_items.push({
          item_type: 'blind',
          room_name: it.room_name.trim(),
          blinds_type: it.blinds_type.trim(),
          panels: panels as number[],
          height_cm: height,
          material_id: it.material_id,
          // Null, not '' — the API accepts a uuid or null for a slot the
          // type does not use, and rejects an id for one it does not.
          cassette_id: it.cassette_id || null,
          bottom_rail_id: it.bottom_rail_id || null,
          control_id: it.control_id || null,
          installation_id: it.installation_id || null,
          color: it.color.trim(),
          note: it.note.trim(),
          attributes,
          quantity: Math.round(qty),
          ...adj,
          ...identityFor(it),
        });
      } else {
        const qty = parsePositive(it.quantity);
        const unit = Number(it.unit_price);
        if (!it.title.trim() && !it.description.trim())
          return `Item ${i + 1}: enter a title or a description.`;
        if (!qty) return `Item ${i + 1}: enter a quantity.`;
        const adj = adjustmentsFor(it, i);
        if (typeof adj === 'string') return adj;
        if (it.item_type === 'preset' && it.preset_id) {
          // Priced by the Worker from the catalog. Sending a figure would
          // be ignored, and sending one that disagreed would be a lie the
          // consultant could read on screen.
          line_items.push({
            item_type: 'preset',
            preset_id: it.preset_id,
            title: it.title.trim(),
            description: it.description.trim(),
            quantity: Math.round(qty),
            ...adj,
            ...identityFor(it),
          });
        } else if (it.item_type === 'preset') {
          // Legacy preset: no provenance, so its stored price still
          // travels and the Worker keeps honouring it.
          if (!Number.isFinite(unit) || unit < 0) return `Item ${i + 1}: enter a unit price.`;
          line_items.push({
            item_type: 'preset',
            preset_id: null,
            title: it.title.trim(),
            description: it.description.trim(),
            quantity: Math.round(qty),
            unit_price: unit,
            ...adj,
            ...identityFor(it),
          });
        } else {
          if (!Number.isFinite(unit) || unit < 0) return `Item ${i + 1}: enter a unit price.`;
          line_items.push({
            item_type: 'custom',
            title: it.title.trim(),
            description: it.description.trim(),
            quantity: Math.round(qty),
            unit_price: unit,
            ...adj,
            ...identityFor(it),
          });
        }
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

  /**
   * Opens the customer presentation view.
   *
   * Saves first, for the same reason `handleConfirm` does: the page reads
   * the SERVER row, so on a draft that has just been typed an unsaved
   * order would be presented empty or stale. Navigates in the SAME tab
   * rather than opening one — a `window.open` after an `await` is treated
   * as a popup and blocked, and handing one tablet across a table beats
   * juggling tabs anyway.
   */
  async function handlePresent() {
    const savedId = await save();
    if (!savedId) return;
    navigate(`/orders/${savedId}/present`);
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



  /**
   * Index of the order's current stage in {@link STAGES}. An `expired`
   * estimate has no node of its own and sits where a lapsed `sent`
   * estimate would — just past Sent — so the timeline can still show it
   * and offer every stage as a move. Shared by `handleSetStatus` (move
   * direction) and the timeline card (node styling).
   */
  const stageIndex = STAGES.findIndex((s) => s.key === status);
  const curIdx = status === 'expired' ? 2 : stageIndex;

  /**
   * Moves the order to any lifecycle stage — the team member's manual
   * override. Forward, backward, and across-stage moves all go through
   * the one Worker route, which reconciles the stage timestamps.
   *
   * This is a bookkeeping action and NEVER emails the customer: sending
   * the estimate is the exclusive job of the Send button in the top bar
   * (see `handleSendEstimate`). A backward move is destructive enough to
   * name its consequence in the prompt — an order dropping below Ready
   * loses its installation appointment.
   */
  async function handleSetStatus(to: OrderStatus) {
    if (!id) return;
    const label = STAGES.find((s) => s.key === to)?.label ?? to;
    const backward = STAGES.findIndex((s) => s.key === to) < curIdx;
    const prompt = backward
      ? `Move this order back to "${label}"? Later-stage progress is cleared.`
      : `Move this order to "${label}"?`;
    if (!window.confirm(prompt)) return;
    try {
      await setStatusMut.mutateAsync({ id, to });
      toast.success(`Status changed to ${label}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not change status.');
    }
  }

  /**
   * Copies this order into a new draft and opens it.
   *
   * The Worker duplicates from the DATABASE, so unsaved edits on screen
   * are not part of the copy — the confirm below says so rather than
   * silently dropping them.
   */
  async function handleDuplicateOrder() {
    if (!id) return;
    try {
      const copy = await duplicateMut.mutateAsync(id);
      toast.success(`Duplicated to ${copy.order_number}.`);
      // Hydration is keyed off the loaded order, so the editor must be
      // told to hydrate again for the copy it is about to show.
      setHydrated(false);
      navigate(`/orders/${copy.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Duplicate failed.');
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
   * Opens the send-warranty sheet. Same missing-email precedent as
   * `openReceipt`: block with a toast rather than open a sheet whose
   * email has nowhere to go. The certificate can still be DOWNLOADED in
   * that case — that action is separate and needs no address.
   */
  function openWarranty() {
    if (!customer?.email) return toast.error('This customer has no email address.');
    setWarrantyMessage('');
    setSheet('warranty');
  }

  /**
   * Submits the send-warranty sheet. The Worker recomputes the balance,
   * renders the certificate from the snapshotted coverage start, emails
   * it as a PDF attachment, stamps `warranty_sent_at`, and returns the
   * refreshed order so the panel's "Warranty issued" marker updates from
   * the cache. Server errors (409 balance outstanding / 400 no email /
   * 502 email service) surface as toasts, like the other send flows.
   */
  async function submitWarranty() {
    if (!id) return;
    if (!customer?.email) return toast.error('This customer has no email address.');
    try {
      await warrantyMut.mutateAsync({ id, message: warrantyMessage.trim() || undefined });
      toast.success(`Warranty certificate sent to ${customer.email}.`);
      setSheet('none');
      setWarrantyMessage('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send the warranty certificate.');
    }
  }

  /**
   * Downloads the staff copy of the warranty certificate. Sends nothing,
   * so it stays available for a customer with no email on file.
   */
  async function handleDownloadWarranty() {
    if (!id) return;
    try {
      await downloadWarrantyPdf(id, existing?.order_number ?? 'order');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not download the certificate.');
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

  /**
   * Marks one customer change request handled.
   *
   * No confirmation prompt: this is a to-do tick, not a state change to
   * the order, and the row survives in the activity trail either way. A
   * 409 ("already resolved") reaches the toast verbatim, which is the
   * right message when a colleague closed it out in another tab.
   */
  async function handleResolveEditRequest(requestId: string) {
    if (!id) return;
    try {
      await resolveEditMut.mutateAsync({ id, requestId });
      toast.success('Change request resolved.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not resolve the request.');
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

  /**
   * Opens the customer's own page in a new tab, exactly as they see it.
   *
   * The tab is opened SYNCHRONOUSLY and filled in afterwards: popup
   * blockers reject a `window.open` that happens after an `await`, and
   * the token may still need minting. `?preview=1` tells `CustomerView`
   * to render a draft, disable every mutating control, and skip the
   * "customer opened this" ping.
   */
  async function handleCustomerView() {
    if (!id) return;
    const tab = window.open('', '_blank');
    try {
      const { public_token } = await publicTokenMut.mutateAsync(id);
      const url = `/customer/${public_token}?preview=1`;
      if (tab) tab.location.href = url;
      // Blocker refused the tab — fall back to a fresh open rather than
      // leaving the click with no visible effect.
      else window.open(url, '_blank');
    } catch (e) {
      tab?.close();
      toast.error(e instanceof Error ? e.message : 'Could not open the customer view.');
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
          className="h-9 min-h-9 w-20 rounded-md border border-border-input bg-surface px-2 text-right font-mono text-[13px]"
          aria-label="Discount value"
        />
      </span>
    </div>
  );

  /**
   * Opens the internal fabric breakdown. Rendered above the discount
   * control at both breakpoints, and defined once for the same reason
   * `discountControl` is: two copies of this JSX would drift. The DIALOG
   * itself is rendered exactly once, further down beside the other
   * overlays — two would stack on top of each other when open.
   */
  const materialUsageTrigger = (
    <MaterialUsageTrigger summary={materialUsage} onOpen={() => setMaterialUsageOpen(true)} />
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
   * Warranty strip inside the Payments panel, shown ONLY once the
   * balance is settled — the warranty does not exist before then, and an
   * always-visible disabled control would just raise questions on every
   * part-paid order.
   *
   * The certificate is emailed automatically the moment a payment clears
   * the balance, so these are recovery actions: the caption says so, to
   * stop a consultant sending a duplicate out of uncertainty. Send is
   * disabled without a customer email (nothing to deliver to); Download
   * never is, because it delivers nothing.
   */
  const warrantyStrip = postConfirm && balance <= 0.005 && (
    <div className="mt-2 flex flex-col gap-1.5 border-t border-border-light pt-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-text-primary">Warranty</span>
        {existing?.warranty_sent_at ? (
          <span className="text-[11px] text-success" title="Warranty certificate emailed">
            ✓ Issued {new Date(existing.warranty_sent_at).toLocaleDateString()}
          </span>
        ) : (
          <span className="text-[11px] text-text-muted">Not sent yet</span>
        )}
      </div>
      <p className="text-[11px] leading-snug text-text-muted">
        The certificate is emailed automatically when the balance clears — 10 years on
        products, 2 years on motorised parts.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={openWarranty}
          disabled={warrantyMut.isPending || !customer?.email}
          title={customer?.email ? undefined : 'This customer has no email address.'}
          className="flex h-9 flex-1 items-center justify-center rounded-sm border border-border-light text-[12px] font-semibold text-text-primary hover:bg-surface-sunken disabled:opacity-40"
        >
          {existing?.warranty_sent_at ? 'Resend warranty' : 'Send warranty'}
        </button>
        <button
          type="button"
          onClick={handleDownloadWarranty}
          className="flex h-9 flex-1 items-center justify-center rounded-sm border border-border-light text-[12px] font-semibold text-text-primary hover:bg-surface-sunken"
        >
          Download
        </button>
      </div>
    </div>
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
    <section className="flex flex-col gap-2 rounded-xl border border-border-light bg-surface p-4 shadow-md">
      <div className="mb-1 flex items-center gap-2.5">
        <SectionIcon
          accent={status === 'awaiting_payment' ? 'warning' : 'success'}
          d="M2 8h20 M4 5h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7a2 2 0 012-2z M6 15h4"
        />
        <h2 className="flex-1 text-[15px] font-bold text-text-primary">Payments</h2>
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
              {/*
                Receipt glyph: a slip of paper with a torn (zig-zag) bottom
                edge and two item lines. Reads as "receipt" where the old
                envelope read as "email" — the action mails a receipt, but
                the thing being sent is what the icon should say.
              */}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17l-2.33-1.4-2.33 1.4-2.33-1.4-2.34 1.4-2.33-1.4-2.33 1.4Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path d="M9 8h6M9 12h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
      {warrantyStrip}
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
    <section className="rounded-xl border border-danger/30 bg-danger-tint p-4 shadow-md">
      <div className="mb-1 flex items-center gap-2.5">
        <SectionIcon
          accent="danger"
          d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z M12 9v4 M12 17h.01"
        />
        <h2 className="text-[15px] font-bold text-danger">Cancellation requested</h2>
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
          className="h-10 flex-1 rounded-md border border-border-input bg-surface text-[13px] font-medium text-text-secondary hover:bg-surface-sunken disabled:opacity-40"
        >
          Deny
        </button>
      </div>
    </section>
  );

  /** Progress timeline; every stage but the current one is a manual move. */
  const timelineCard = id && existing && (
    <section className="rounded-xl border border-border-light bg-surface p-4 shadow-md">
      <div className="mb-3 flex items-center gap-2.5">
        <SectionIcon
          accent={status === 'expired' ? 'danger' : 'scheduled'}
          d="M12 22a10 10 0 100-20 10 10 0 000 20z M12 6v6l4 2"
        />
        <h2 className="flex-1 text-[15px] font-bold text-text-primary">Progress</h2>
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
              {i !== curIdx ? (
                <button
                  type="button"
                  onClick={() => handleSetStatus(stage.key)}
                  disabled={setStatusMut.isPending}
                  title={i < curIdx ? `Move back to ${stage.label}` : `Move to ${stage.label}`}
                  aria-label={i < curIdx ? `Move back to ${stage.label}` : `Move to ${stage.label}`}
                  className={`flex h-6 w-6 items-center justify-center rounded-sm text-text-muted hover:bg-surface-sunken disabled:opacity-40 ${i < curIdx ? 'hover:text-brand-600' : 'hover:text-success'
                    }`}
                >
                  {i < curIdx ? (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M9 7 4 12l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M4 12h11a5 5 0 0 1 0 10h-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
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
    const present: StageAction = {
      key: 'present',
      icon: ICONS.present,
      label: 'Present to Customer',
      short: 'Present',
      onClick: handlePresent,
      disabled: !canAct || !customer || items.length === 0,
    };

    // Before Draft (unsaved) — nothing here; the top-bar Save is the
    // only available action.
    if (!id) return { primary: null, secondary: [] };

    // Draft — confirm the order (Send/Save live in the top bar).
    if (status === 'draft') return { primary: confirm, secondary: [present] };

    // Sent — confirm the order.
    if (status === 'sent') {
      return { primary: confirm, secondary: [present, overview] };
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
      const labels: StageAction = {
        key: 'labels',
        icon: ICONS.labels,
        label: 'Labels',
        short: 'Labels',
        onClick: () => window.open(`/orders/${id}/labels`, '_blank', 'noopener'),
      };
      return { primary: markReady, secondary: [manufacturer, labels, overview] };
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

    // Expired — the estimate lapsed but was never confirmed, so the
    // presentation view still applies here (Save/Send/Download are in the
    // top bar; send after updating the expiry date).
    return { primary: null, secondary: [present, overview] };
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
      'h-10 min-w-0 flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-border-input bg-surface px-1.5 text-[12px] font-medium text-text-secondary disabled:opacity-40';
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
  const docBtn =
    'inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-semibold disabled:opacity-40';

  /**
   * Document actions — Save, Send, Download, Customer View, Delete —
   * colour-coded per the design: Save green, Send blue, the rest
   * neutral, Delete red. Customer View is deliberately neutral like
   * Download so the toolbar keeps exactly two coloured actions and the
   * eye does not compete with Save/Send. It is disabled until the order
   * is saved: minting the capability token needs a row to mint against.
   *
   * These live in a toolbar at the top of the page BODY, not in
   * `PageHeader`'s right slot. In the header they were five buttons in
   * a `shrink-0` container: once labels appeared at `sm` they measured
   * roughly 470px inside a row that was itself capped at 512px, so the
   * last actions were pushed past the edge and silently swallowed by
   * the page's `overflow-x-clip` guard. Delete was the first to go —
   * the least recoverable action, made invisible by a layout accident.
   *
   * In the body they get the full content width and are free to WRAP
   * onto a second line instead of overflowing, which is why the row is
   * `flex-wrap` with no fixed widths. Labels still collapse below `sm`
   * (title/aria-label keep them accessible), so on a phone the set is
   * five ~44px icon buttons that fit one row at 320px.
   *
   * The row is rendered inside the page's sticky head block (see
   * `stickyHead` below), so on `md+` it stays reachable on a long
   * order without scrolling back to the top.
   */
  const docActions = (
    <div className={`${PAGE_CONTAINER} flex flex-wrap items-center gap-2 py-2.5`}>
      <button
        onClick={handleSaveDraft}
        disabled={!canAct}
        title={saving ? 'Saving…' : 'Save as Draft'}
        aria-label="Save as Draft"
        className={`${docBtn} bg-success text-white hover:bg-success/90 max-sm:w-11 max-sm:px-0`}
      >
        {ICONS.save}
        <span className="hidden sm:inline">{saving ? 'Saving…' : 'Save'}</span>
      </button>
      <button
        onClick={openSend}
        disabled={sendDisabled}
        title={isInvoice ? 'Send Invoice' : status === 'sent' ? 'Resend Estimate' : 'Send Estimate'}
        aria-label={isInvoice ? 'Send Invoice' : 'Send Estimate'}
        className={`${docBtn} bg-brand-600 text-white hover:bg-brand-700 max-sm:w-11 max-sm:px-0`}
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
        className={`${docBtn} border border-border-input bg-surface font-medium text-text-secondary hover:bg-surface-sunken max-sm:w-11 max-sm:px-0`}
      >
        {ICONS.download}
        <span className="hidden sm:inline">Download</span>
      </button>
      <button
        onClick={() => void handleCustomerView()}
        disabled={!id || saving || publicTokenMut.isPending}
        title="Open the page the customer sees"
        aria-label="Customer View"
        className={`${docBtn} border border-border-input bg-surface font-medium text-text-secondary hover:bg-surface-sunken max-sm:w-11 max-sm:px-0`}
      >
        {ICONS.customerView}
        <span className="hidden sm:inline">Customer View</span>
      </button>
      {/* Duplicate — only for a SAVED order: an unsaved one has no rows
          to copy, and the Worker duplicates from the database, not from
          whatever is on screen. */}
      {id && (
        <button
          onClick={handleDuplicateOrder}
          disabled={duplicateMut.isPending || saving}
          title="Create a new draft order with the same customer and items"
          aria-label="Duplicate Order"
          className={`${docBtn} border border-border-input bg-surface font-medium text-text-secondary hover:bg-surface-sunken max-sm:w-11 max-sm:px-0`}
        >
          {ICONS.duplicate}
          <span className="hidden sm:inline">
            {duplicateMut.isPending ? 'Duplicating…' : 'Duplicate'}
          </span>
        </button>
      )}
      {id && (
        <button
          onClick={handleDeleteOrder}
          disabled={deleteMut.isPending}
          title={deleteMut.isPending ? 'Deleting…' : 'Delete Order'}
          aria-label="Delete Order"
          className={`${docBtn} border border-border-input bg-surface font-medium text-danger hover:bg-surface-sunken max-sm:w-11 max-sm:px-0 sm:ml-auto`}
        >
          {ICONS.trash}
          <span className="hidden sm:inline">Delete</span>
        </button>
      )}
    </div>
  );

  return (
    // Bottom padding is the measured height of the fixed action bar
    // (`--action-bar-h`, published below), falling back to 10rem until
    // the first measurement lands. `overflow-x-clip` is a guard against
    // a future child overflowing, not a fix for one — nothing here is
    // supposed to exceed the viewport.
    // `--page-max` is set HERE, on the page root, rather than on each
    // container: every `.page-container` below — the sticky head, the
    // grid, and the fixed action bar — inherits it, so the header, the
    // body and the bar cannot end up on three different tracks. 1000px
    // caps the form column plus the summary rail together; past that the
    // whole block centres in whatever room the nav rail leaves.
    <div className="min-h-screen overflow-x-clip bg-surface-muted pb-[var(--action-bar-h,10rem)] [--page-max:1000px] xl:pb-8">
      {/*
        Sticky head: the page header and the document-action toolbar pin
        as ONE block, so the second never needs to know the first's
        height. Sticky only from `md` up — on a phone this block plus the
        bottom action bar would claim roughly a third of the screen, so
        there only `PageHeader`'s own `sticky top-0` applies and the
        toolbar scrolls away with the page.

        Its measured height is published as `--order-head-h` (same
        ResizeObserver pattern as `--action-bar-h`) because the summary
        rail has to stick BELOW it. Hard-coding that offset is how the
        old `top-[57px]` came to be wrong: the header's real height
        changes with the title's line count and with the `lg` type step.
      */}
      <div
        ref={setStickyHead}
        className="z-20 bg-surface-muted md:sticky md:top-0"
      >
        <PageHeader
          title={id ? existing?.order_number ?? 'Order' : 'New Order'}
          backTo="/"
          right={
            <span className="hidden sm:inline-flex">
              <StatusBadge status={status} />
            </span>
          }
        />
        <div className="border-b border-border-light bg-surface-muted">{docActions}</div>
      </div>

      {/*
        Two fluid columns from `xl` (1280px) up, one below.

        The page body used to be pinned to `max-w-lg` (512px) below `lg`
        and `max-w-6xl` above, which meant it never tracked the window:
        on a 768px tablet it rendered a 512px column between two 128px
        dead gutters. It now uses the shared `PAGE_CONTAINER` track —
        fluid, capped at 1600px — so main grows and shrinks with the
        window at every width, inside whatever space the nav rail leaves.

        `xl` rather than `lg` is where the summary rail appears because
        the rail is a THIRD column: at 1024px the shell is already
        spending up to 248px on navigation, and splitting the remaining
        ~776px into a form column plus a 360px rail leaves the form too
        narrow for its two-up date fields. `minmax(0,1fr)` on the form
        track is what allows it to shrink below its content's intrinsic
        width — without it a long line item name would push the grid
        wider than the viewport, which is the class of bug that made the
        cards run off the screen.
      */}
      <div
        className={`${PAGE_CONTAINER} pb-4 pt-4 md:pb-6 md:pt-6 xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start xl:gap-6 xl:pb-8 xl:pt-8`}
      >
        {/* ── Form column ── */}
        <div className="flex w-full min-w-0 flex-col gap-4">
          {/* Open cancellation request — needs an answer before anything else */}
          {cancelRequestBanner}

          {/*
            Customer change requests. Below the cancellation banner
            (which outranks everything) and above the timeline, so the
            instructions are read before the order is edited. Outside the
            read-only fieldset: resolving one is not an edit to the order.
          */}
          <EditRequestsCard
            requests={editRequests ?? []}
            onResolve={(requestId) => void handleResolveEditRequest(requestId)}
            resolvingId={resolveEditMut.isPending ? resolveEditMut.variables.requestId : null}
          />

          {/* Progress timeline (revert lives here — outside the disabled fieldset) */}
          {timelineCard}

          <fieldset disabled={readOnly} className="m-0 flex flex-col gap-4 border-0 p-0">
            {/* Customer card: picker title row + expandable detail panel */}
            <CustomerCard
              customer={customer}
              onPick={() => setSheet('customer')}
              onEdit={() => setEditingCustomer(true)}
              readOnly={readOnly}
            />

            {/* Dates card: order/expiry dates, expiry terms, order number */}
            <OrderDatesCard
              orderDate={orderDate}
              onOrderDate={setOrderDate}
              expiryDate={expiryDate}
              onExpiryDate={(d) => {
                setExpiryDate(d);
                setExpiryManual(true);
                setExpiryPreset(null);
              }}
              expiryPreset={expiryPreset}
              onExpiryPreset={(preset) => {
                setExpiryPreset(preset);
                setExpiryManual(true);
              }}
              orderNumber={existing?.order_number ?? null}
            />

            {/* Line items summary table */}
            {(items.length > 0 || !readOnly) && (
              <section className="overflow-hidden rounded-xl border border-border-light bg-surface shadow-md">
                {/* Bulk toolbar — only in edit mode */}
                {!readOnly && items.length > 0 && (() => {
                  // Bulk edit needs blinds, and its OPTION dropdowns need a
                  // single blind type to scope to — but a selection without
                  // one is no longer refused: the popup asks for the type
                  // and unifies the rows onto it. Only a non-blind row
                  // still blocks. The button says which of the two the
                  // selection is in rather than just greying out.
                  const bulkSelection = bulkEditSelection(items, selected);
                  const canBulkEdit = bulkSelection.ok;
                  const bulkEditHint = bulkSelection.ok
                    ? bulkSelection.blindsType
                      ? `Edit material and options for the selected ${bulkSelection.blindsType} items`
                      : bulkSelection.mixed
                        ? 'Move the selected blinds onto one type, or edit their colour'
                        : 'Set a blind type on the selected blinds and edit its options'
                    : bulkSelection.reason === 'empty'
                      ? 'Select blind items to bulk edit'
                      : 'Bulk edit is only available for blind items';
                  // The same verdict in a few words, for the count line —
                  // the shared type when there is one, else what stands in
                  // its place ("mixed types" is a state to resolve in the
                  // popup now, not a refusal).
                  const bulkCountNote = !bulkSelection.ok
                    ? 'not all blinds'
                    : bulkSelection.blindsType
                      ? bulkSelection.blindsType
                      : bulkSelection.mixed
                        ? 'mixed blind types'
                        : 'no blind type yet';
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
                      {/*
                        The reason bulk edit is unavailable rides on the
                        count line as well as on the button's `title`: a
                        phone has no hover, so a tooltip alone would leave
                        a disabled button with no explanation at all.
                      */}
                      <span className="min-w-0 flex-1 truncate text-[12px] text-text-muted">
                        {selected.size === 0
                          ? `${items.length} item${items.length !== 1 ? 's' : ''}`
                          : `${selected.size} selected · ${bulkCountNote}`}
                      </span>
                      <button
                        type="button"
                        onClick={openBulkEdit}
                        disabled={!canBulkEdit}
                        title={bulkEditHint}
                        className="flex h-8 items-center gap-1.5 rounded-md border border-border-input px-2.5 text-[12px] font-medium text-text-secondary hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40"
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
                        className="flex h-8 items-center gap-1.5 rounded-md border border-border-input px-2.5 text-[12px] font-medium text-text-secondary hover:bg-surface-sunken hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6h12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        Delete
                      </button>
                    </div>
                  );
                })()}

                <LineItemList
                  items={items}
                  catalogs={catalogs}
                  readOnly={readOnly}
                  postConfirm={postConfirm}
                  selected={selected}
                  onToggleSelect={toggleSelect}
                  onToggleHidden={toggleHidden}
                  onEdit={openEdit}
                  onDuplicate={duplicateItem}
                  onDelete={removeItem}
                  onMove={moveItem}
                  onReorder={reorderItems}
                />
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
                {/*
                  Bulk add: one shared config per blind type ("section"),
                  many measurement rows underneath it — the fast path for
                  a whole room or house of the SAME type.
                */}
                <button
                  onClick={() => setSheet('bulkAdd')}
                  className="flex h-11 items-center justify-center gap-2 rounded-sm border border-dashed border-border-input text-[13px] font-semibold text-brand-600"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M3 4h18v4H3z M3 10h18v4H3z M3 16h18v4H3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  </svg>
                  Bulk Add
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


            {/* Totals card for every width below `xl`, where the summary
                rail is not rendered. Same content, different container. */}
            <section className="flex flex-col gap-2 rounded-xl border border-border-light bg-surface p-4 shadow-md xl:hidden">
              {materialUsageTrigger}
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
            <section className="flex flex-col gap-2 rounded-xl border border-border-light bg-surface p-4 shadow-md">
              <div className="mb-2 flex items-center gap-2.5">
                <SectionIcon
                  accent="neutral"
                  d="M12 22a10 10 0 100-20 10 10 0 000 20z M12 6v6l4 2"
                />
                <h2 className="text-[15px] font-bold text-text-primary">Activity Log</h2>
              </div>
              {logs && logs.length === 0 && (
                <p className="text-[13px] text-text-muted">No activity recorded yet.</p>
              )}
              {logs && logs.length > 0 && (
                <>
                  {/*
                    Customer-sourced rows (page opened, estimate confirmed,
                    cancellation asked for or withdrawn) sit on the light-blue
                    info tint so staff can pick out what the customer did from
                    what the office did. Padding is applied to every row, not
                    just tinted ones, so the column alignment never shifts.
                  */}
                  <ul className="flex flex-col gap-2.5">
                    {(logsExpanded ? logs : logs.slice(0, LOG_PREVIEW_COUNT)).map((log) => (
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
                      onClick={() => setLogsExpanded((v) => !v)}
                      aria-expanded={logsExpanded}
                      className="mt-0.5 self-start py-1 text-[13px] font-medium text-brand-600 hover:underline"
                    >
                      {logsExpanded
                        ? 'Show less'
                        : `Show ${logs.length - LOG_PREVIEW_COUNT} more`}
                    </button>
                  )}
                </>
              )}
            </section>
          )}
        </div>

        {/*
          ── Summary rail (xl+) ──
          A card in the grid's second track rather than a full-bleed
          panel welded to the viewport edge: the grid now has a real
          gutter, and a bare `border-l` floating in that gutter read as
          a stray rule. `max-h` + `overflow-y-auto` on the body keep a
          40-item order's list scrollable inside the card while the
          totals and actions below it stay pinned.
        */}
        <aside className="sticky top-[calc(var(--order-head-h,7rem)+2rem)] hidden max-h-[calc(100dvh-var(--order-head-h,7rem)-4rem)] flex-col overflow-hidden rounded-xl border border-border-light bg-surface shadow-md xl:flex">
          <div className="border-b border-border-light px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              {postConfirm ? 'Order Summary' : 'Live Pricing'}
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {items.length === 0 && (
              <p className="text-[13px] text-text-muted">Add a line item to see pricing.</p>
            )}
            {items.map((it, i) => (
              <div key={it.key} className="mb-2.5 flex justify-between gap-3">
                {/* Wraps rather than truncates, for the same reason the
                    item rows do — the label is how two similar lines are
                    told apart. `wrap-anywhere` keeps the rail's own
                    intrinsic width from growing with the longest label. */}
                <span className="min-w-0 wrap-anywhere text-[13px] text-text-secondary">
                  {draftLabel(it, i)}
                </span>
                <span className="shrink-0 font-mono text-[13px] text-text-primary">
                  {itemPrices[i] ? `$${itemPrices[i].toFixed(2)}` : '—'}
                </span>
              </div>
            ))}
            <div className="mt-4 flex flex-col gap-2 border-t border-border-light pt-3.5">
              {materialUsageTrigger}
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
          {railActions && (
            <div className="border-t border-border-light px-5 py-4">{railActions}</div>
          )}
        </aside>
      </div>

      {/* ── Sticky action bar, below `xl` ──
          Carries the running total and the stage's actions at every
          width where the summary rail is absent — phones AND tablets,
          which previously got neither (the bar was `lg:hidden`, so a
          768–1023px tablet had a rail-less page and a hidden bar).

          `app-shell-main` gives it the same `--sidebar-w` inline-start
          padding as the page content, so on a tablet the bar starts
          where the nav rail ends instead of sliding underneath it. It
          is `fixed` rather than `sticky` because it must stay put while
          the page scrolls; it slides out of the way while the keyboard
          is up (see `keyboardOpen`) and reports its own height so the
          page above can reserve exactly that much room. */}
      <div
        ref={setActionBar}
        className={`app-shell-main fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] transition-transform duration-200 xl:hidden ${keyboardOpen ? 'pointer-events-none translate-y-full' : ''
          }`}
      >
        {/* Same container track as the page body, so the bar's edges
            line up with the card edges above it at every width. */}
        <div className={PAGE_CONTAINER}>
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
        <div className={CUSTOMER_SHEET_OVERLAY} onClick={() => setSheet('none')}>
          <div
            className={CUSTOMER_SHEET_PANEL}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex gap-2">
              <input
                autoFocus
                type="search"
                placeholder="Search customers…"
                value={customerTerm}
                onChange={(e) => setCustomerTerm(e.target.value)}
                className="h-11 min-w-0 flex-1 rounded-md border border-border-input bg-surface px-3 text-sm"
              />
              <button
                onClick={() => setAddingCustomer(true)}
                className="h-11 shrink-0 rounded-md border border-border-input bg-surface px-3 text-[13px] font-medium text-brand-600 hover:bg-surface-muted"
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
                      {displayName(cust)}
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

      {/* Internal fabric breakdown and its two discounting instruments.
          Rendered ONCE for the whole page — its trigger is what appears
          at each breakpoint. */}
      <MaterialUsageDialog
        open={materialUsageOpen}
        onClose={() => setMaterialUsageOpen(false)}
        summary={materialUsage}
        rateDrafts={materialRateDrafts}
        onRateDraftChange={(key, value) =>
          setMaterialRateDrafts((drafts) => ({ ...drafts, [key]: value }))
        }
        appliedParts={giveBackParts}
        // The ONE place a give-back turns into money. No line item is
        // touched: `applyGiveBackPart` composes this contribution on top
        // of the discount already in force, swapping whatever the same
        // key contributed before, so Apply is additive and Reset (amount
        // 0) is exact. A percentage discount has no dollar base to add
        // to, so it is replaced — the dialog warns before that happens.
        onApplyGiveBack={(key, amount) => {
          const base = discountType === 'fixed' ? Number(discountValue) || 0 : 0;
          const composed = applyGiveBackPart(giveBackParts, base, key, amount);
          setDiscountType('fixed');
          setDiscountValue(composed.discount.toFixed(2));
          setGiveBackParts(composed.parts);
        }}
        sqmRate={sqmGiveBackRate}
        onSqmRateChange={setSqmGiveBackRate}
        runningRate={runningGiveBackRate}
        onRunningRateChange={setRunningGiveBackRate}
        discountIsPercent={discountType === 'percent'}
      />

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

      {/*
        Inline customer-record editor. Mounted here, at the page tail,
        rather than beside the card — the card sits inside the
        `fieldset disabled={readOnly}` wrapper, and a dialog rendered in
        that subtree would inherit the disabled state and present a form
        nobody can type into. Writes the customer row only; the order is
        neither saved nor dirtied.
      */}
      {editingCustomer && customer && (
        <CustomerEditModal
          customer={customer}
          onClose={() => setEditingCustomer(false)}
          onSaved={(saved) => {
            setCustomer(saved);
            setEditingCustomer(false);
          }}
        />
      )}

      {/* Preset picker bottom sheet */}
      {sheet === 'preset' && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 lg:items-center" onClick={() => setSheet('none')}>
          <div
            className={`${SHEET_PANEL} lg:max-w-md`}
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
            className={`${SHEET_PANEL} lg:max-w-md`}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-sm font-semibold text-text-primary">Record payment</h2>
            <p className="mb-3 text-[13px] text-text-muted">
              Balance due <span className="font-mono">${balance.toFixed(2)}</span>
            </p>

            {/* Unmatched e-Transfers — tap one to autofill the form below */}
            {(pendingEtransfersQ.data?.length ?? 0) > 0 && (
              <div className="mb-3 rounded-md border border-border-light bg-surface-sunken p-2.5">
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
                  className="h-11 w-full rounded-md border border-border-input bg-surface px-3 text-right font-mono text-sm"
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
                  className="h-11 w-full rounded-md border border-border-input bg-surface px-3 text-sm"
                />
              </label>
              <div className="mt-1 flex gap-2">
                <button
                  onClick={() => setSheet('none')}
                  className="h-11 flex-1 rounded-md border border-border-input bg-surface text-[13px] font-medium text-text-secondary"
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
            className={`${SHEET_PANEL} lg:max-w-md`}
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
                  className="w-full rounded-md border border-border-input bg-surface px-3 py-2 text-sm"
                />
              </label>
              <div className="mt-1 flex gap-2">
                <button
                  onClick={() => setSheet('none')}
                  className="h-11 flex-1 rounded-md border border-border-input bg-surface text-[13px] font-medium text-text-secondary"
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
            className={`${SHEET_PANEL} lg:max-w-md`}
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
                  className="w-full rounded-md border border-border-input bg-surface px-3 py-2 text-sm"
                />
              </label>
              <div className="mt-1 flex gap-2">
                <button
                  onClick={() => setSheet('none')}
                  className="h-11 flex-1 rounded-md border border-border-input bg-surface text-[13px] font-medium text-text-secondary"
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
            className={`${SHEET_PANEL} lg:max-w-md`}
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
                  className="w-full rounded-md border border-border-input bg-surface px-3 py-2 text-sm"
                />
              </label>
              <div className="mt-1 flex gap-2">
                <button
                  onClick={() => setSheet('none')}
                  className="h-11 flex-1 rounded-md border border-border-input bg-surface text-[13px] font-medium text-text-secondary"
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

      {/* Send warranty bottom sheet (whole order, with optional message) */}
      {sheet === 'warranty' && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 lg:items-center" onClick={() => setSheet('none')}>
          <div
            className="w-full rounded-t-sm bg-surface p-4 lg:max-w-md lg:rounded-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-sm font-semibold text-text-primary">
              {existing?.warranty_sent_at ? 'Resend warranty' : 'Send warranty'}
            </h2>
            <p className="mb-3 text-[13px] text-text-muted">
              We&apos;ll email {customer?.email ?? 'the customer'} the warranty certificate for
              this order as a PDF. Coverage runs from the date the order was paid in full and
              the dates never change on a resend.
            </p>
            <div className="flex flex-col gap-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-text-secondary">
                  Message to include (optional)
                </span>
                <textarea
                  autoFocus
                  value={warrantyMessage}
                  onChange={(e) => setWarrantyMessage(e.target.value)}
                  maxLength={1000}
                  rows={4}
                  placeholder="e.g. Here's your warranty certificate — keep it somewhere safe."
                  className="w-full rounded-md border border-border-input bg-surface px-3 py-2 text-sm"
                />
              </label>
              <div className="mt-1 flex gap-2">
                <button
                  onClick={() => setSheet('none')}
                  className="h-11 flex-1 rounded-md border border-border-input bg-surface text-[13px] font-medium text-text-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={submitWarranty}
                  disabled={warrantyMut.isPending || !customer?.email}
                  className="h-11 flex-[2] rounded-sm bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
                >
                  {warrantyMut.isPending ? 'Sending…' : 'Send Warranty'}
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
        // Blind forms render these inside their own "Details" section (via
        // the `footer` prop); flat forms keep them under the whole form.
        const actions = (
          <div className="mt-4 flex gap-2">
            <button
              onClick={cancelEdit}
              className="h-11 flex-1 rounded-md border border-border-input bg-surface text-[13px] font-medium text-text-secondary"
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
        );
        return (
          <div
            className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 lg:items-center"
            onClick={cancelEdit}
          >
            <div
              className={`${SHEET_PANEL} lg:max-w-3xl`}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="mb-4 text-sm font-semibold text-text-primary">{title}</h2>
              {isBlind ? (
                <BlindEditForm
                  draft={editDraft as BlindDraft}
                  catalogs={catalogs}
                  onChange={(next) => setEditDraft(next)}
                  footer={actions}
                />
              ) : (
                <>
                  <FlatEditForm
                    draft={editDraft as FlatDraft}
                    onChange={(next) => setEditDraft(next)}
                  />
                  {actions}
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* Bulk edit popup — material and the hardware slots of ONE type */}
      {sheet === 'bulkEdit' && (() => {
        // The selection is live state; if it stopped being an all-blind
        // selection while the sheet was open there is nothing to edit, so
        // the sheet closes itself. A selection that merely lost its shared
        // TYPE stays open — the form re-renders scope-less and asks for a
        // type, which is a valid state here.
        const selection = bulkEditSelection(items, selected);
        if (!selection.ok) return null;
        const count = selection.keys.length;
        const plural = count !== 1 ? 's' : '';
        return (
          <div
            className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 lg:items-center"
            onClick={() => setSheet('none')}
          >
            <div
              className={`${SHEET_PANEL} lg:max-w-lg`}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="mb-1 text-sm font-semibold text-text-primary">Bulk edit options</h2>
              <p className="mb-4 text-[13px] text-text-muted">
                {selection.blindsType
                  ? `Editing ${count} ${selection.blindsType} item${plural}.`
                  : selection.mixed
                    ? `Editing ${count} item${plural} of different blind types.`
                    : `Editing ${count} item${plural} with no blind type yet.`}
              </p>
              <BulkEditForm
                state={bulkState}
                catalogs={catalogs}
                blindsType={selection.blindsType}
                mixed={selection.mixed}
                onChange={setBulkState}
              />
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => setSheet('none')}
                  className="h-11 flex-1 rounded-md border border-border-input bg-surface text-[13px] font-medium text-text-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={applyBulkEdit}
                  disabled={Object.values(bulkState).every((v) => !v)}
                  className="h-11 flex-[2] rounded-sm bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
                >
                  Apply to selected
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Bulk-add sheet — one shared config per blind type ("section"),
          many measurement rows underneath it. See `BulkAddSheet.tsx`.
          Mounted only while active (like every other sheet on this
          screen) rather than kept alive and toggled via `open`, so its
          internally-owned `sections` state cannot survive into a later
          reopened pass. */}
      {sheet === 'bulkAdd' && (
        <BulkAddSheet
          open
          catalogs={catalogs}
          onCancel={() => setSheet('none')}
          onAdd={(drafts) => {
            setItems((list) => [...list, ...drafts]);
            setSheet('none');
          }}
        />
      )}

    </div>

  );
}
