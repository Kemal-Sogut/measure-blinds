// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The "Send estimates" picker: emails one customer ONE link that covers
 * several of their estimates.
 *
 * Opened from a customer group on the Estimates page. It lists the
 * customer's sendable estimates (the server has already applied every
 * eligibility rule), all ticked, lets the consultant untick some, add an
 * optional note, and send. No PDF is attached — the customer link carries
 * everything — so the dialog says so rather than promising an attachment.
 *
 * Ticked set: not stored as a list of ticked ids. The component keeps only
 * the ids the consultant UNTICKED and derives the ticked set from the
 * fetched rows on every render (`initialSelection(rows)` minus the
 * unticked ids). A refetch that adds or drops rows therefore can never leave
 * a stale id in state or in the send button's count, and a newly eligible
 * row arrives ticked, consistent with sending being opt-out.
 *
 * A row already `sent` is listed and ticked like any other; its tick only
 * means "name it again in this email". Unticking it does NOT take it off the
 * customer's page, and there is deliberately no un-share control here.
 *
 * The send answers HTTP 200 even when some rows could not be recorded, so
 * the result's `failed` list is inspected: empty closes the dialog, non-empty
 * keeps it open with the user-facing `partialFailureMessage` (never the
 * server's raw error text).
 *
 * The copy-link field carries the CUSTOMER link (`/c/:token`): the token the
 * send returns once known, else one minted on open. A mint failure degrades
 * only that field — the email carries the link anyway, so it never blocks
 * the send.
 *
 * Render it conditionally (`{open && <SendEstimatesDialog … />}`); mounting
 * is what triggers the fetch and the link mint.
 */

import { useEffect, useId, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import CopyLinkField from '../../components/CopyLinkField';
import EmptyState from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { useCustomerPublicLink } from '../../hooks/useCustomers';
import { useSendableEstimates, useSendEstimates } from '../../hooks/useSendEstimates';
import {
  initialSelection,
  partialFailureMessage,
  sendButtonLabel,
  toggleSelection,
  type SendableEstimate,
} from '../../lib/estimateSelection';
import { customerLinkPath } from '../../lib/orderPath';

// Local copies of the formatters `EstimateGroup` keeps private, so the rows
// here print dates and totals exactly as the Estimates page does.
const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });

/** "Oct 20" from an ISO date (`YYYY-MM-DD`, read as local) or a timestamp. */
function shortDay(iso: string): string {
  return format(new Date(iso.length === 10 ? `${iso}T00:00:00` : iso), 'MMM d');
}

/**
 * Sheet panel treatment, mirroring the private `SHEET_PANEL` constant in
 * `OrderDetail.tsx`: a bottom sheet on phones, a centred card from `lg` up.
 */
const SHEET_PANEL =
  'max-h-[92dvh] w-full overflow-y-auto overscroll-contain rounded-t-2xl bg-surface p-4 ' +
  'pb-[max(1rem,env(safe-area-inset-bottom))] lg:max-h-[85vh] lg:max-w-lg lg:rounded-2xl lg:pb-4';

/** Props for {@link SendEstimatesDialog}. */
export interface SendEstimatesDialogProps {
  /** The customer whose estimates are offered and who receives the email. */
  customerId: string;
  /** Shown in the dialog's intro, e.g. "We'll email jane@x.com". Empty disables the send. */
  customerEmail: string;
  /** Called when the dialog should close (Cancel, backdrop, or a clean send). */
  onClose: () => void;
  /** Called after a send with no failures, just before `onClose`. */
  onSent?: () => void;
}

/**
 * Picker dialog for the multi-estimate send. See the file header for the
 * selection, failure and link-sourcing rules.
 *
 * @param props - See {@link SendEstimatesDialogProps}.
 */
export default function SendEstimatesDialog({
  customerId,
  customerEmail,
  onClose,
  onSent,
}: SendEstimatesDialogProps) {
  const titleId = useId();
  const sendable = useSendableEstimates(customerId);
  const send = useSendEstimates();
  const { mutate: mintLink, data: mintedToken, isError: mintFailed } = useCustomerPublicLink();

  /** Ids the consultant has unticked. The ticked set is derived from it each render. */
  const [unticked, setUnticked] = useState<string[]>([]);
  const [message, setMessage] = useState('');

  // Mint the customer link when the dialog opens (same call "Copy customer
  // link" makes). Failure only degrades the copy field, see below.
  useEffect(() => {
    mintLink(customerId);
  }, [customerId, mintLink]);

  const rows: SendableEstimate[] = sendable.data ?? [];
  const selected = initialSelection(rows).filter((id) => !unticked.includes(id));
  const hasEmail = customerEmail.trim() !== '';
  const hasSentRow = rows.some((r) => r.status === 'sent');

  const token = send.data?.customer_token ?? mintedToken;
  const linkValue = token ? `${window.location.origin}${customerLinkPath(token)}` : null;
  const linkError = !token && mintFailed ? 'Could not prepare the customer link.' : null;

  /** Ticks or unticks one row, re-expressed as the unticked-id list. */
  function toggle(id: string) {
    const next = toggleSelection(selected, id, rows);
    setUnticked(rows.filter((r) => !next.includes(r.id)).map((r) => r.id));
  }

  /** Closing mid-send would drop the result handlers, so it waits for the send. */
  function close() {
    if (!send.isPending) onClose();
  }

  function submit() {
    if (!hasEmail) return toast.error('This customer has no email address.');
    if (selected.length === 0) return;
    const count = selected.length;
    send.mutate(
      { customerId, orderIds: selected, message: message.trim() || undefined },
      {
        onSuccess: (result) => {
          if (result.failed.length > 0) {
            toast.error(partialFailureMessage(result.failed, rows));
            return;
          }
          toast.success(
            `${count === 1 ? 'Estimate' : `${count} estimates`} sent to ${customerEmail}.`
          );
          onSent?.();
          onClose();
        },
        onError: (e) => toast.error(e.message || 'Send failed.'),
      }
    );
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 lg:items-center"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={SHEET_PANEL}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="mb-1 text-sm font-semibold text-text-primary">
          Send estimates
        </h2>
        <p className="mb-3 text-[13px] text-text-muted">
          {hasEmail ? (
            <>
              We&apos;ll email {customerEmail} one link to the estimates you tick below. No PDF is
              attached — the link carries everything.
            </>
          ) : (
            'This customer has no email address, so there is nothing to send to.'
          )}
        </p>

        {sendable.isPending ? (
          <div className="flex flex-col gap-1.5" role="status" aria-label="Loading estimates">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : sendable.isError ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-[13px] text-danger">Could not load this customer&apos;s estimates.</p>
            <button
              type="button"
              onClick={() => void sendable.refetch()}
              className="h-11 rounded-md border border-border-input bg-surface px-3.5 text-[13px] font-semibold text-text-primary hover:bg-surface-sunken"
            >
              Try again
            </button>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No estimates ready to send"
            hint="An estimate needs at least one item and must not be expired before it can be sent."
          />
        ) : (
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-1.5">
              {rows.map((r) => (
                <li key={r.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border-light px-3 py-2.5 hover:bg-surface-sunken">
                    <input
                      type="checkbox"
                      checked={selected.includes(r.id)}
                      onChange={() => toggle(r.id)}
                      className="h-5 w-5 shrink-0 accent-brand-600"
                    />
                    <span className="min-w-0 flex-1">
                      {r.title && (
                        <span className="block truncate text-[14px] font-semibold text-text-primary">
                          {r.title}
                        </span>
                      )}
                      <span className="block text-[13px] text-text-secondary">
                        <span className="font-mono">{r.order_number}</span> · {shortDay(r.order_date)}
                      </span>
                      {r.status === 'sent' && (
                        <span className="block text-xs text-text-muted">Already on their page</span>
                      )}
                    </span>
                    <span className="shrink-0 font-mono text-[13px] font-semibold text-text-primary">
                      {money.format(Number(r.total))}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {hasSentRow && (
              <p className="text-[12px] text-text-muted">
                A tick names the estimate in this email. Unticking one that is already on their page
                does not remove it from the page.
              </p>
            )}

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-text-secondary">
                Message to include (optional)
              </span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={1000}
                rows={4}
                placeholder="e.g. Thanks for your time today — let me know if you have any questions."
                className="w-full rounded-md border border-border-input bg-surface px-3 py-2 text-sm"
              />
            </label>

            <CopyLinkField
              label="Customer link"
              value={linkValue}
              error={linkError}
              hint="Opens the customer's own page — anyone with this link can view it."
            />
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={close}
            disabled={send.isPending}
            className="h-11 flex-1 rounded-md border border-border-input bg-surface text-[13px] font-medium text-text-secondary disabled:opacity-40"
          >
            {rows.length === 0 && sendable.isSuccess ? 'Close' : 'Cancel'}
          </button>
          {rows.length > 0 && (
            <button
              type="button"
              onClick={submit}
              disabled={send.isPending || selected.length === 0 || !hasEmail}
              className="h-11 flex-[2] rounded-sm bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
            >
              {send.isPending ? 'Sending…' : sendButtonLabel(selected.length)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
