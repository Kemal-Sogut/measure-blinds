// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Estimate detail/editor — the most complex screen in the app.
 *
 * One scrollable page: header (searchable customer selector, estimate
 * date, expiry date that auto-follows estimate_date + default expiry
 * days until manually overridden, read-only order number), line item
 * cards with live per-keystroke pricing, add buttons (+ Standard
 * Blind, + Preset via bottom sheet, + Custom), a totals section with
 * fixed/percent discount toggle and HST line, and a sticky action bar
 * (Save Draft / Send / Confirm / PDF).
 *
 * All client-side money is a live preview from lib/pricing +
 * lib/totals; the Worker recomputes authoritatively on save and its
 * response replaces local state. Confirmed/expired estimates render
 * read-only.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import PageHeader from '../../components/PageHeader';
import DatePicker from '../../components/DatePicker';
import { calculateTotals } from '../../lib/totals';
import {
  useEstimate,
  useCreateEstimate,
  useUpdateEstimate,
  useSendEstimate,
  useConfirmEstimate,
  downloadEstimatePdf,
  type EstimateInput,
  type LineItemInput,
} from '../../hooks/useEstimates';
import { useCustomerSearch } from '../../hooks/useCustomers';
import { useCatalogList, useCompanySettings } from '../../hooks/useSettings';
import {
  BlindItemCard,
  FlatItemCard,
  blindDraftPrice,
  flatDraftPrice,
  parsePositive,
  type BlindDraft,
  type FlatDraft,
  type ItemDraft,
  type Catalogs,
} from './LineItemEditor';
import type { Customer, Estimate, Fabric, CassetteOption, ControlOption, PresetLineItem, DiscountType } from '../../types';

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
function toDrafts(estimate: Estimate): ItemDraft[] {
  return (estimate.line_items ?? []).map((li) => {
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

export default function EstimateDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: existing, isLoading: loadingExisting, error: loadError } = useEstimate(id);

  const fabricsQ = useCatalogList<Fabric>('fabrics');
  const cassettesQ = useCatalogList<CassetteOption>('cassette-options');
  const controlsQ = useCatalogList<ControlOption>('control-options');
  const presetsQ = useCatalogList<PresetLineItem>('presets');
  const { data: company } = useCompanySettings();

  const createMut = useCreateEstimate();
  const updateMut = useUpdateEstimate();
  const sendMut = useSendEstimate();
  const confirmMut = useConfirmEstimate();

  // ── Editor state ────────────────────────────────────────────────
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [estimateDate, setEstimateDate] = useState<Date>(new Date());
  const [expiryDate, setExpiryDate] = useState<Date | null>(null);
  const [expiryManual, setExpiryManual] = useState(false);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [discountType, setDiscountType] = useState<DiscountType>('fixed');
  const [discountValue, setDiscountValue] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [sheet, setSheet] = useState<'none' | 'customer' | 'preset'>('none');
  const [customerTerm, setCustomerTerm] = useState('');
  const customersQ = useCustomerSearch(customerTerm);

  // Hydrate once from a loaded estimate.
  useEffect(() => {
    if (id && existing && !hydrated) {
      setCustomer(existing.customer ?? null);
      setEstimateDate(fromIso(existing.estimate_date));
      setExpiryDate(fromIso(existing.expiry_date));
      setExpiryManual(true); // persisted expiry counts as chosen
      setItems(toDrafts(existing));
      setDiscountType(existing.discount_type);
      setDiscountValue(existing.discount_value ? String(existing.discount_value) : '');
      setHydrated(true);
    }
  }, [id, existing, hydrated]);

  // Auto-default expiry = estimate date + default_expiry_days until
  // the consultant picks an expiry manually (§ Phase 7 header rules).
  useEffect(() => {
    if (expiryManual) return;
    const days = company?.default_expiry_days ?? 14;
    const d = new Date(estimateDate);
    d.setDate(d.getDate() + days);
    setExpiryDate(d);
  }, [estimateDate, company, expiryManual]);

  const catalogs: Catalogs = useMemo(
    () => ({
      fabrics: fabricsQ.data ?? [],
      cassettes: cassettesQ.data ?? [],
      controls: controlsQ.data ?? [],
    }),
    [fabricsQ.data, cassettesQ.data, controlsQ.data]
  );

  // ── Live totals (client preview; server recomputes on save) ────
  const totals = useMemo(() => {
    const lineTotals = items.map((it) =>
      it.item_type === 'blind'
        ? blindDraftPrice(it, catalogs)?.total ?? 0
        : flatDraftPrice(it)?.total ?? 0
    );
    return calculateTotals({
      lineTotals,
      discount_type: discountType,
      discount_value: Number(discountValue) || 0,
    });
  }, [items, catalogs, discountType, discountValue]);

  const status = existing?.status ?? 'draft';
  const readOnly = Boolean(id) && !['draft', 'sent'].includes(status);
  const saving = createMut.isPending || updateMut.isPending;

  // ── Draft list operations ───────────────────────────────────────
  function updateItem(next: ItemDraft) {
    setItems((list) => list.map((it) => (it.key === next.key ? next : it)));
  }
  function removeItem(key: string) {
    setItems((list) => list.filter((it) => it.key !== key));
  }
  function addBlind() {
    setItems((list) => [
      ...list,
      {
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
      },
    ]);
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
    setItems((list) => [
      ...list,
      { key: nextKey(), item_type: 'custom', description: '', quantity: '1', unit_price: '' },
    ]);
  }

  /**
   * Validates drafts and builds the API payload.
   * Returns a string error message when something is incomplete.
   */
  function buildPayload(): EstimateInput | string {
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
      estimate_date: toIso(estimateDate),
      expiry_date: toIso(expiryDate),
      discount_type: discountType,
      discount_value: Number(discountValue) || 0,
      line_items,
    };
  }

  /** Saves (create or update); resolves to the saved estimate id. */
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
      if (!id) navigate(`/estimates/${saved.id}`, { replace: true });
      return saved.id;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed.');
      return null;
    }
  }

  async function handleSaveDraft() {
    if (await save()) toast.success('Estimate saved.');
  }

  async function handleSend() {
    if (!customer?.email) return toast.error('This customer has no email address.');
    const savedId = await save();
    if (!savedId) return;
    try {
      await sendMut.mutateAsync(savedId);
      toast.success(`Estimate sent to ${customer.email}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Send failed.');
    }
  }

  async function handleConfirm() {
    const savedId = await save();
    if (!savedId) return;
    try {
      await confirmMut.mutateAsync(savedId);
      toast.success('Estimate confirmed.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Confirm failed.');
    }
  }

  async function handlePdf() {
    const savedId = await save();
    if (!savedId) return;
    try {
      await downloadEstimatePdf(savedId, existing?.order_number ?? 'estimate');
      toast.success('PDF downloaded.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'PDF failed.');
    }
  }

  // ── Render ──────────────────────────────────────────────────────
  if (id && loadingExisting) {
    return (
      <div className="min-h-screen bg-surface-muted">
        <PageHeader title="Estimate" backTo="/estimates" />
        <p className="p-4 text-text-muted">Loading…</p>
      </div>
    );
  }
  if (id && loadError) {
    return (
      <div className="min-h-screen bg-surface-muted">
        <PageHeader title="Estimate" backTo="/estimates" />
        <p className="p-4 text-danger">{loadError.message}</p>
      </div>
    );
  }

  const canAct = !readOnly && !saving;

  return (
    <div className="min-h-screen bg-surface-muted pb-28">
      <PageHeader title={id ? existing?.order_number ?? 'Estimate' : 'New Estimate'} backTo="/estimates" />
      <fieldset disabled={readOnly} className="mx-auto flex max-w-lg flex-col gap-4 p-4">
        {readOnly && (
          <p className="rounded-xl bg-surface-elevated p-3 text-sm text-text-secondary">
            This estimate is <strong className="capitalize">{status}</strong> and can no longer
            be edited.
          </p>
        )}

        {/* Header */}
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface-elevated p-4">
          <button
            type="button"
            onClick={() => !readOnly && setSheet('customer')}
            className="flex h-12 w-full items-center justify-between rounded-lg border border-border bg-surface px-3 text-left"
          >
            <span className={customer ? 'text-text-primary' : 'text-text-muted'}>
              {customer ? `${customer.first_name} ${customer.last_name}` : 'Select customer…'}
            </span>
            <span className="text-text-muted">▾</span>
          </button>

          <div className="grid grid-cols-2 gap-3">
            <DatePicker label="Estimate date" value={estimateDate} onChange={setEstimateDate} />
            <DatePicker
              label="Expiry date"
              value={expiryDate}
              onChange={(d) => {
                setExpiryDate(d);
                setExpiryManual(true);
              }}
            />
          </div>

          <div className="text-sm text-text-muted">
            Order #:{' '}
            <span className="font-medium text-text-secondary">
              {existing?.order_number ?? 'assigned on save'}
            </span>
          </div>
        </section>

        {/* Line items */}
        {items.map((it) =>
          it.item_type === 'blind' ? (
            <BlindItemCard
              key={it.key}
              draft={it}
              catalogs={catalogs}
              onChange={updateItem}
              onRemove={() => removeItem(it.key)}
            />
          ) : (
            <FlatItemCard
              key={it.key}
              draft={it}
              onChange={updateItem}
              onRemove={() => removeItem(it.key)}
            />
          )
        )}

        {/* Add buttons */}
        {!readOnly && (
          <div className="flex flex-col gap-2">
            <button onClick={addBlind} className="h-12 rounded-xl border border-dashed border-brand-400 font-medium text-brand-700">
              + Standard Blind
            </button>
            <div className="flex gap-2">
              <button onClick={() => setSheet('preset')} className="h-12 flex-1 rounded-xl border border-dashed border-border font-medium text-text-secondary">
                + Preset Item
              </button>
              <button onClick={addCustom} className="h-12 flex-1 rounded-xl border border-dashed border-border font-medium text-text-secondary">
                + Custom Item
              </button>
            </div>
          </div>
        )}

        {/* Totals */}
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface-elevated p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-text-secondary">Subtotal</span>
            <span className="font-medium">${totals.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-text-secondary">Discount</span>
            <span className="flex items-center gap-2">
              <span className="flex rounded-lg bg-surface p-0.5">
                {(['fixed', 'percent'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setDiscountType(t)}
                    className={`h-9 rounded-md px-3 text-xs font-medium ${
                      discountType === t ? 'bg-brand-600 text-white' : 'text-text-secondary'
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
                className="h-9 w-20 rounded-lg border border-border bg-surface px-2 text-right"
                aria-label="Discount value"
              />
            </span>
          </div>
          {totals.discount_amount > 0 && (
            <div className="flex justify-between text-text-muted">
              <span>Discount applied</span>
              <span>−${totals.discount_amount.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-text-secondary">Taxable amount</span>
            <span>${totals.taxable_amount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-secondary">
              HST 13%
              {company?.hst_number && (
                <span className="ml-1 text-[10px] text-text-muted">HST# {company.hst_number}</span>
              )}
            </span>
            <span>${totals.tax_amount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between border-t border-border-light pt-2 text-base font-semibold text-text-primary">
            <span>Total</span>
            <span>${totals.total.toFixed(2)}</span>
          </div>
        </section>
      </fieldset>

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface-elevated p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-lg gap-2">
          <button
            onClick={handleSaveDraft}
            disabled={!canAct}
            className="h-12 flex-1 rounded-xl border border-border bg-surface font-medium text-text-primary disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={handleSend}
            disabled={!canAct || !customer || items.length === 0 || sendMut.isPending}
            className="h-12 flex-1 rounded-xl bg-brand-600 font-semibold text-white disabled:opacity-40"
          >
            {sendMut.isPending ? 'Sending…' : status === 'sent' ? 'Resend' : 'Send'}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canAct || !customer || items.length === 0 || confirmMut.isPending}
            className="h-12 flex-1 rounded-xl border border-border bg-surface font-medium text-success disabled:opacity-40"
          >
            Confirm
          </button>
          <button
            onClick={handlePdf}
            disabled={(!id && !customer) || saving}
            className="h-12 w-14 rounded-xl border border-border bg-surface text-sm font-medium text-text-secondary disabled:opacity-40"
          >
            PDF
          </button>
        </div>
      </div>

      {/* Customer selector bottom sheet */}
      {sheet === 'customer' && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/40" onClick={() => setSheet('none')}>
          <div
            className="max-h-[80vh] w-full overflow-y-auto rounded-t-2xl bg-surface p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              type="search"
              placeholder="Search customers…"
              value={customerTerm}
              onChange={(e) => setCustomerTerm(e.target.value)}
              className="mb-3 h-12 w-full rounded-xl border border-border bg-surface-elevated px-4 text-base"
            />
            <ul className="flex flex-col gap-1">
              {(customersQ.data ?? []).map((cust) => (
                <li key={cust.id}>
                  <button
                    onClick={() => {
                      setCustomer(cust);
                      setSheet('none');
                    }}
                    className="w-full rounded-lg p-3 text-left hover:bg-surface-elevated"
                  >
                    <span className="block font-medium text-text-primary">
                      {cust.first_name} {cust.last_name}
                    </span>
                    <span className="block text-sm text-text-muted">
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
        <div className="fixed inset-0 z-40 flex items-end bg-black/40" onClick={() => setSheet('none')}>
          <div
            className="max-h-[70vh] w-full overflow-y-auto rounded-t-2xl bg-surface p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-3 font-semibold text-text-primary">Add preset item</h2>
            <ul className="flex flex-col gap-1">
              {(presetsQ.data ?? [])
                .filter((p) => p.active)
                .map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => addPreset(p)}
                      className="flex w-full items-center justify-between rounded-lg p-3 text-left hover:bg-surface-elevated"
                    >
                      <span>
                        <span className="block font-medium text-text-primary">{p.name}</span>
                        {p.description && (
                          <span className="block text-sm text-text-muted">{p.description}</span>
                        )}
                      </span>
                      <span className="font-medium text-text-secondary">
                        ${Number(p.unit_price).toFixed(2)}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      )}

      {/* Meta line for sent estimates */}
      {existing?.sent_at && (
        <p className="mx-auto max-w-lg px-4 pb-4 text-xs text-text-muted">
          Sent {format(new Date(existing.sent_at), 'MMM d, yyyy HH:mm')}
          {existing.confirmed_at &&
            ` · Confirmed ${format(new Date(existing.confirmed_at), 'MMM d, yyyy HH:mm')}`}
        </p>
      )}
    </div>
  );
}
