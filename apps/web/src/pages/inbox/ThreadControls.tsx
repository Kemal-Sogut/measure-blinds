// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Triage card at the top of a conversation: category select, Mark
 * handled / Mark as new, customer link (search existing customers, or
 * open / unlink the linked one), and — once a customer is linked — an
 * order select listing that customer's orders, and Delete conversation
 * (app only — Titan keeps the mail; asks first, then `onDeleted`).
 *
 * Every change is one `PUT /api/inbox/:id`; the server applies the link
 * rules (an order brings its customer; changing the customer clears the
 * order; a hand-picked category is locked against "Re-apply rules").
 * Errors surface as toasts; the thread query refetches on success.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Button, Card, CardBody, Field, inputClass } from '../../components/ui';
import { useCustomerSearch } from '../../hooks/useCustomers';
import { useDeleteInboxThread, useUpdateInboxThread, type ThreadUpdate } from '../../hooks/useInbox';
import { displayName } from '../../lib/customerName';
import { statusLabel } from '../../lib/statusStyles';
import type { EmailCategory, EmailThreadDetail } from '../../types';
import { CATEGORY_LABELS, CATEGORY_ORDER } from './inboxText';

/** Triage controls for one conversation; `onDeleted` runs after a successful delete. */
export default function ThreadControls({ thread, onDeleted }: { thread: EmailThreadDetail; onDeleted: () => void }) {
  const update = useUpdateInboxThread();
  const remove = useDeleteInboxThread();
  const [term, setTerm] = useState('');
  const search = useCustomerSearch(term);
  const results = term.trim() ? (search.data ?? []).slice(0, 5) : [];

  function save(patch: ThreadUpdate, successMessage?: string) {
    update.mutate(
      { id: thread.id, update: patch },
      {
        onSuccess: () => {
          if (successMessage) toast.success(successMessage);
        },
        onError: (e) => toast.error(e.message),
      }
    );
  }

  function handleDelete() {
    if (
      !window.confirm(
        'Delete this conversation from the app? It stays in Titan. A new reply will start a new conversation.'
      )
    )
      return;
    remove.mutate(thread.id, {
      onSuccess: () => {
        toast.success('Conversation deleted');
        onDeleted();
      },
      onError: (e) => toast.error(e.message),
    });
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[10rem]">
            <Field label="Category" htmlFor="thread-category">
              <select
                id="thread-category"
                className={`${inputClass} h-11`}
                value={thread.category}
                onChange={(e) => save({ category: e.target.value as EmailCategory })}
              >
                {CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="ml-auto">
            {thread.status === 'new' ? (
              <Button variant="primary" loading={update.isPending} onClick={() => save({ status: 'handled' }, 'Marked as handled')}>
                Mark handled
              </Button>
            ) : (
              <Button loading={update.isPending} onClick={() => save({ status: 'new' })}>
                Mark as new
              </Button>
            )}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold text-text-secondary">Customer</p>
          {thread.customer ? (
            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/customers/${thread.customer.id}`} className="text-sm font-semibold text-brand-700 underline">
                {displayName(thread.customer)}
              </Link>
              <Button size="sm" variant="ghost" onClick={() => save({ customer_id: null })}>
                Unlink
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <input
                className={`${inputClass} h-11`}
                placeholder="Search customers by name, email or phone"
                aria-label="Search customers to link"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
              {results.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-border-light bg-surface px-3 py-2 text-left text-sm hover:bg-surface-muted"
                  onClick={() => {
                    save({ customer_id: c.id }, 'Customer linked');
                    setTerm('');
                  }}
                >
                  <span className="truncate font-medium text-text-primary">{displayName(c)}</span>
                  <span className="truncate text-[12px] text-text-muted">{c.email}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {thread.customer && (
          <Field label="Order" htmlFor="thread-order">
            <div className="flex flex-wrap items-center gap-2">
              <select
                id="thread-order"
                className={`${inputClass} h-11 max-w-xs`}
                value={thread.order_id ?? ''}
                onChange={(e) => save({ order_id: e.target.value || null })}
              >
                <option value="">No order</option>
                {thread.customer_orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.order_number} · {statusLabel(o.status)}
                  </option>
                ))}
              </select>
              {thread.order && (
                <Link to={`/orders/${thread.order.id}`} className="text-sm font-semibold text-brand-700 underline">
                  Open {thread.order.order_number}
                </Link>
              )}
            </div>
          </Field>
        )}

        <div className="flex justify-end border-t border-border-light pt-3">
          <Button size="sm" variant="ghost" loading={remove.isPending} onClick={handleDelete}>
            Delete conversation
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
