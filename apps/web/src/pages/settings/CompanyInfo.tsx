// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Company Info settings page.
 *
 * Edits the company_settings singleton: name, contact details, HST
 * number, and default estimate expiry days, plus the logo (client-side
 * validated as image/* ≤2 MB, uploaded through the Worker to Supabase
 * Storage). Fields are loaded into local state once and saved
 * explicitly via the Save button — an explicit save suits a form this
 * size better than per-field autosave.
 *
 * The page also owns MAINTENANCE MODE, the switch that closes the
 * customer-facing `/public/*` surfaces (migration 40). It lives here
 * because it is one more field on the same singleton row, but it is the
 * one control that does NOT wait for the Save button: a kill switch a
 * user believes they flipped, while the app quietly kept serving
 * customers, is the worst possible failure for this feature. Toggling
 * persists immediately, carrying whatever message is currently typed so
 * the two halves can never drift; the Save button writes the message
 * too, for edits made while the switch is already in the wanted state.
 */

import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import PageHeader from '../../components/PageHeader';
import {
  useCompanySettings,
  useUpdateCompanySettings,
  useUploadLogo,
} from '../../hooks/useSettings';

/** Editable subset of company settings managed by this form. */
interface FormState {
  company_name: string;
  email: string;
  phone: string;
  address: string;
  hst_number: string;
  default_expiry_days: string;
  google_review_url: string;
  etransfer_email: string;
  etransfer_instructions: string;
  /**
   * Customer-facing maintenance wording. The FLAG is not held here — it
   * is read from (and written straight back to) the server row, so the
   * switch on screen always shows what customers are actually getting.
   */
  maintenance_message: string;
}

const INPUT_CLS =
  'h-11 w-full rounded-md border border-border-input bg-surface px-3 text-base text-text-primary';

export default function CompanyInfo() {
  const { data, isLoading, error } = useCompanySettings();
  const update = useUpdateCompanySettings();
  const uploadLogo = useUploadLogo();
  const fileInput = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<FormState | null>(null);

  // Populate the form once when data first arrives.
  useEffect(() => {
    if (data && !form) {
      setForm({
        company_name: data.company_name ?? '',
        email: data.email ?? '',
        phone: data.phone ?? '',
        address: data.address ?? '',
        hst_number: data.hst_number ?? '',
        default_expiry_days: String(data.default_expiry_days ?? 14),
        google_review_url: data.google_review_url ?? '',
        etransfer_email: data.etransfer_email ?? '',
        etransfer_instructions: data.etransfer_instructions ?? '',
        maintenance_message: data.maintenance_message ?? '',
      });
    }
  }, [data, form]);

  /** Field updater keeping the rest of the form intact. */
  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  /** Validates and saves the form via the settings API. */
  function handleSave() {
    if (!form) return;
    const days = Number(form.default_expiry_days);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return toast.error('Expiry days must be a whole number between 1 and 365.');
    }
    const reviewUrl = form.google_review_url.trim();
    if (reviewUrl && !/^https?:\/\//i.test(reviewUrl)) {
      return toast.error('The Google review link must start with http:// or https://.');
    }
    // The Worker rejects a malformed e-Transfer address with a 400; catch
    // it here so the message names the field instead of a Zod path.
    const etransferEmail = form.etransfer_email.trim();
    if (etransferEmail && !etransferEmail.includes('@')) {
      return toast.error('The e-Transfer email must be a valid email address.');
    }
    update.mutate(
      {
        company_name: form.company_name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        hst_number: form.hst_number.trim(),
        default_expiry_days: days,
        google_review_url: reviewUrl,
        etransfer_email: etransferEmail,
        etransfer_instructions: form.etransfer_instructions.trim(),
        maintenance_message: form.maintenance_message.trim(),
      },
      {
        onSuccess: () => toast.success('Company info saved.'),
        onError: (e) => toast.error(e.message),
      }
    );
  }

  /**
   * Opens or closes the customer surfaces immediately, without waiting
   * for the Save button (see the file header for why). The message
   * currently in the textarea rides along, so the wording customers see
   * always matches what the user was looking at when they flipped it.
   */
  function handleMaintenanceToggle(next: boolean) {
    if (!form) return;
    update.mutate(
      { maintenance_mode: next, maintenance_message: form.maintenance_message.trim() },
      {
        onSuccess: () =>
          toast.success(
            next
              ? 'Maintenance mode ON — customer links are closed.'
              : 'Maintenance mode off — customer links are live again.'
          ),
        onError: (e) => toast.error(e.message),
      }
    );
  }

  /** Client-side validation + upload for the logo picker. */
  function handleLogoChange(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('Logo must be an image.');
    if (file.size > 2 * 1024 * 1024) return toast.error('Logo must be 2 MB or smaller.');
    uploadLogo.mutate(file, {
      onSuccess: () => toast.success('Logo updated.'),
      onError: (e) => toast.error(e.message),
    });
  }

  if (isLoading || !form) {
    return (
      <div className="min-h-screen bg-surface-muted">
        <PageHeader title="Company Info" backTo="/settings" />
        <p className="p-4 text-text-muted">{error ? error.message : 'Loading…'}</p>
      </div>
    );
  }

  // The SERVER's flag, not form state: the switch must show what
  // customers are actually getting. The update mutation patches the
  // query cache optimistically, so it still flips instantly.
  const maintenanceOn = Boolean(data?.maintenance_mode);

  return (
    <div className="min-h-screen bg-surface-muted">
      <PageHeader title="Company Info" backTo="/settings" />
      <div className="page-container py-4 md:py-6 [--page-max:48rem]">
        {/* Logo */}
        <div className="mb-6 flex items-center gap-4 rounded-xl border border-border-light bg-surface shadow-md p-4">
          {data?.logo_url ? (
            <img
              src={data.logo_url}
              alt="Company logo"
              className="h-16 w-16 rounded-md border border-border-input-light object-contain"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-md bg-surface-muted text-xs text-text-muted">
              No logo
            </div>
          )}
          <div>
            <button
              onClick={() => fileInput.current?.click()}
              disabled={uploadLogo.isPending}
              className="h-11 rounded-md border border-border-input px-4 font-medium text-text-primary hover:bg-surface disabled:opacity-50"
            >
              {uploadLogo.isPending ? 'Uploading…' : 'Upload Logo'}
            </button>
            <p className="mt-1 text-xs text-text-muted">PNG/JPG/SVG, max 2 MB</p>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleLogoChange(e.target.files?.[0])}
            />
          </div>
        </div>

        {/* Fields */}
        <div className="flex flex-col gap-4 rounded-xl border border-border-light bg-surface shadow-md p-4">
          <label className="text-sm font-medium text-text-secondary">
            Company Name
            <input
              className={`mt-1 ${INPUT_CLS}`}
              value={form.company_name}
              onChange={(e) => set('company_name', e.target.value)}
            />
          </label>
          <label className="text-sm font-medium text-text-secondary">
            Email
            <input
              type="email"
              inputMode="email"
              className={`mt-1 ${INPUT_CLS}`}
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
            />
          </label>
          <label className="text-sm font-medium text-text-secondary">
            Phone
            <input
              type="tel"
              inputMode="tel"
              className={`mt-1 ${INPUT_CLS}`}
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
            />
          </label>
          <label className="text-sm font-medium text-text-secondary">
            Address
            <textarea
              rows={3}
              className="mt-1 w-full rounded-md border border-border-input bg-surface px-3 py-2 text-base text-text-primary"
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
            />
          </label>
          <label className="text-sm font-medium text-text-secondary">
            HST Number
            <input
              className={`mt-1 ${INPUT_CLS}`}
              value={form.hst_number}
              onChange={(e) => set('hst_number', e.target.value)}
            />
          </label>
          <label className="text-sm font-medium text-text-secondary">
            Default Expiry (days)
            <input
              inputMode="numeric"
              className={`mt-1 ${INPUT_CLS}`}
              value={form.default_expiry_days}
              onChange={(e) => set('default_expiry_days', e.target.value)}
            />
          </label>
          <label className="text-sm font-medium text-text-secondary">
            Google Review Link
            <input
              type="url"
              inputMode="url"
              placeholder="https://g.page/r/…/review"
              className={`mt-1 ${INPUT_CLS}`}
              value={form.google_review_url}
              onChange={(e) => set('google_review_url', e.target.value)}
            />
            <span className="mt-1 block text-xs font-normal text-text-muted">
              Customers are emailed a review request 2 days after their installation. Leave blank
              to turn this off.
            </span>
          </label>
          <label className="text-sm font-medium text-text-secondary">
            e-Transfer Email
            <input
              type="email"
              inputMode="email"
              placeholder="payments@example.com"
              className={`mt-1 ${INPUT_CLS}`}
              value={form.etransfer_email}
              onChange={(e) => set('etransfer_email', e.target.value)}
            />
            <span className="mt-1 block text-xs font-normal text-text-muted">
              Where customers send Interac e-Transfers. Shown on their order page once they
              confirm and still owe a balance. Leave blank to hide payment details entirely.
            </span>
          </label>
          <label className="text-sm font-medium text-text-secondary">
            e-Transfer Instructions
            <textarea
              rows={3}
              placeholder="e.g. A 50% deposit is due before production begins."
              className="mt-1 w-full rounded-md border border-border-input bg-surface px-3 py-2 text-base text-text-primary"
              value={form.etransfer_instructions}
              onChange={(e) => set('etransfer_instructions', e.target.value)}
            />
            <span className="mt-1 block text-xs font-normal text-text-muted">
              Optional note shown under the e-Transfer address.
            </span>
          </label>
          <button
            onClick={handleSave}
            disabled={update.isPending}
            className="h-12 rounded-md shadow-sm bg-brand-600 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>

        {/* Maintenance mode — customer surfaces only */}
        <div
          className={`mt-6 flex flex-col gap-4 rounded-xl border bg-surface shadow-md p-4 ${
            maintenanceOn ? 'border-warning' : 'border-border-light'
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold text-text-primary">Maintenance Mode</h2>
              <p className="mt-1 text-xs text-text-muted">
                Closes customer estimate and appointment links. Your own app keeps working.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={maintenanceOn}
              aria-label="Maintenance mode"
              disabled={update.isPending}
              onClick={() => handleMaintenanceToggle(!maintenanceOn)}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                maintenanceOn ? 'bg-warning' : 'bg-border-input'
              }`}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-[left] ${
                  maintenanceOn ? 'left-6' : 'left-1'
                }`}
              />
            </button>
          </div>
          {maintenanceOn && (
            <p className="rounded-md bg-warning-tint px-3 py-2 text-sm text-warning">
              Customers opening their estimate or appointment link right now see the message
              below instead of their order.
            </p>
          )}
          <label className="text-sm font-medium text-text-secondary">
            Message to Customers
            <textarea
              rows={3}
              placeholder="e.g. We're briefly offline for updates and will be back within the hour."
              className="mt-1 w-full rounded-md border border-border-input bg-surface px-3 py-2 text-base text-text-primary"
              value={form.maintenance_message}
              onChange={(e) => set('maintenance_message', e.target.value)}
            />
            <span className="mt-1 block text-xs font-normal text-text-muted">
              Saved with the switch and with Save. Leave blank to use the default wording.
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
