// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Settings → Email Rules (`/settings/email-rules`).
 *
 * Shows whether the Titan sync is healthy (one line per folder, with the
 * last error if any) and manages the rules that sort NEW conversations
 * into Inbox tabs: field (other party's address or domain, subject,
 * message text) + comparison + value → category or Ignore. Rules run top
 * to bottom and the first match wins; up/down arrows change the order.
 * The same form adds a rule or, after "Edit", saves changes to one.
 * "Re-apply rules" re-sorts existing conversations, except those whose
 * category was picked by hand.
 */

import { useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import PageHeader from '../../components/PageHeader';
import { ListSkeleton } from '../../components/Skeleton';
import { Button, Card, CardBody, CardFooter, CardHeader, Field, inputClass } from '../../components/ui';
import {
  useCreateEmailRule,
  useDeleteEmailRule,
  useEmailRules,
  useInboxStatus,
  useReapplyEmailRules,
  useReorderEmailRules,
  useUpdateEmailRule,
} from '../../hooks/useInbox';
import type { EmailRule, EmailRuleAction, EmailRuleField, EmailRuleMatch } from '../../types';
import {
  RULE_ACTION_LABELS,
  RULE_FIELD_LABELS,
  RULE_MATCH_LABELS,
  describeRule,
  moveId,
  syncStatusLine,
} from '../inbox/inboxText';

/** The add/edit form's state. */
interface RuleDraft {
  field: EmailRuleField;
  match_type: EmailRuleMatch;
  value: string;
  action: EmailRuleAction;
}

const EMPTY_DRAFT: RuleDraft = { field: 'domain', match_type: 'equals', value: '', action: 'supplier' };

/** `<option>`s from a label map. */
function options<K extends string>(labels: Record<K, string>) {
  return (Object.entries(labels) as Array<[K, string]>).map(([value, label]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));
}

/** The Email Rules settings page. */
export default function EmailRules() {
  const rulesQuery = useEmailRules();
  const statusQuery = useInboxStatus();
  const createRule = useCreateEmailRule();
  const updateRule = useUpdateEmailRule();
  const deleteRule = useDeleteEmailRule();
  const reorder = useReorderEmailRules();
  const reapply = useReapplyEmailRules();

  const [draft, setDraft] = useState<RuleDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const rules = rulesQuery.data ?? [];

  function resetForm() {
    setDraft(EMPTY_DRAFT);
    setEditingId(null);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const input = { ...draft, value: draft.value.trim() };
    if (!input.value) {
      toast.error('Enter a value to match.');
      return;
    }
    const callbacks = {
      onSuccess: () => {
        toast.success(editingId ? 'Rule saved' : 'Rule added');
        resetForm();
      },
      onError: (err: Error) => toast.error(err.message),
    };
    if (editingId) updateRule.mutate({ id: editingId, input }, callbacks);
    else createRule.mutate(input, callbacks);
  }

  function startEdit(rule: EmailRule) {
    setEditingId(rule.id);
    setDraft({ field: rule.field, match_type: rule.match_type, value: rule.value, action: rule.action });
  }

  function move(index: number, delta: -1 | 1) {
    const ids = rules.map((r) => r.id);
    const next = moveId(ids, index, delta);
    if (next !== ids) reorder.mutate(next, { onError: (err) => toast.error(err.message) });
  }

  return (
    <div className="min-h-screen bg-surface-muted pb-16">
      <PageHeader eyebrow="Settings" title="Email Rules" backTo="/settings" />
      <div className="page-container flex flex-col gap-4 py-4 md:py-6 lg:py-8 [--page-max:48rem]">
        <Card>
          <CardHeader title="Mail sync" subtitle="info@blindsnisa.com is checked every 5 minutes" />
          <CardBody className="flex flex-col gap-1 text-[13px]">
            {statusQuery.isLoading && <p className="text-text-muted">Loading…</p>}
            {statusQuery.data?.length === 0 && <p className="text-text-muted">Not synced yet.</p>}
            {statusQuery.data?.map((s) => (
              <p key={s.folder} className={s.last_error ? 'text-danger' : 'text-text-secondary'}>
                {syncStatusLine(s)}
              </p>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Rules" subtitle="First match wins" />
          <CardBody flush>
            <p className="border-b border-border-light px-4 py-3 text-[13px] text-text-muted">
              Checked top to bottom for each new conversation. No match → Other.
            </p>
            {rulesQuery.isLoading && (
              <div className="p-4">
                <ListSkeleton rows={2} />
              </div>
            )}
            {!rulesQuery.isLoading && rules.length === 0 && (
              <p className="px-4 py-4 text-[13px] text-text-muted">No rules yet. Everything goes to Other until you add one.</p>
            )}
            <ul className="divide-y divide-border-light">
              {rules.map((rule, index) => (
                <li key={rule.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                  {/* Full width on a phone (buttons wrap below); shares the row from sm up. */}
                  <label className="flex min-h-11 w-full min-w-0 items-center gap-2 text-sm sm:w-auto sm:flex-1">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      aria-label="Rule enabled"
                      onChange={(e) =>
                        updateRule.mutate(
                          { id: rule.id, input: { enabled: e.target.checked } },
                          { onError: (err) => toast.error(err.message) }
                        )
                      }
                    />
                    <span className={`min-w-0 break-words ${rule.enabled ? 'text-text-primary' : 'text-text-muted line-through'}`}>
                      {describeRule(rule)}
                    </span>
                  </label>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" aria-label="Move rule up" disabled={index === 0} onClick={() => move(index, -1)}>
                      ↑
                    </Button>
                    <Button size="sm" variant="ghost" aria-label="Move rule down" disabled={index === rules.length - 1} onClick={() => move(index, 1)}>
                      ↓
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => startEdit(rule)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        deleteRule.mutate(rule.id, {
                          onSuccess: () => {
                            if (editingId === rule.id) resetForm();
                          },
                          onError: (err) => toast.error(err.message),
                        })
                      }
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
          <CardFooter>
            <Button
              loading={reapply.isPending}
              onClick={() =>
                reapply.mutate(undefined, {
                  onSuccess: (r) => toast.success(r.changed === 1 ? '1 conversation moved' : `${r.changed} conversations moved`),
                  onError: (err) => toast.error(err.message),
                })
              }
            >
              Re-apply rules
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader title={editingId ? 'Edit rule' : 'Add a rule'} />
          <form onSubmit={submit}>
            <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="When" htmlFor="rule-field">
                <select id="rule-field" className={`${inputClass} h-11`} value={draft.field} onChange={(e) => setDraft({ ...draft, field: e.target.value as EmailRuleField })}>
                  {options(RULE_FIELD_LABELS)}
                </select>
              </Field>
              <Field label="Comparison" htmlFor="rule-match">
                <select id="rule-match" className={`${inputClass} h-11`} value={draft.match_type} onChange={(e) => setDraft({ ...draft, match_type: e.target.value as EmailRuleMatch })}>
                  {options(RULE_MATCH_LABELS)}
                </select>
              </Field>
              <Field label="Value" htmlFor="rule-value">
                <input
                  id="rule-value"
                  className={`${inputClass} h-11`}
                  maxLength={200}
                  placeholder={draft.field === 'domain' ? 'e.g. supplier.com' : draft.field === 'address' ? 'e.g. orders@supplier.com' : 'e.g. quote'}
                  value={draft.value}
                  onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                />
              </Field>
              <Field label="Then" htmlFor="rule-action">
                <select id="rule-action" className={`${inputClass} h-11`} value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value as EmailRuleAction })}>
                  {options(RULE_ACTION_LABELS)}
                </select>
              </Field>
            </CardBody>
            <CardFooter>
              {editingId && (
                <Button type="button" variant="ghost" onClick={resetForm}>
                  Cancel
                </Button>
              )}
              <Button type="submit" variant="primary" loading={createRule.isPending || updateRule.isPending}>
                {editingId ? 'Save rule' : 'Add rule'}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
