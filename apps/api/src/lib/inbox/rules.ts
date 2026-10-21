// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Staff-editable filter rules for the Titan inbox (Settings → Email
 * Rules), and the pure function that applies them.
 *
 * A rule tests one field — the conversation's other party's address or
 * domain, the subject, or the new message's trimmed text — with
 * contains / equals / ends-with, case-insensitively, and either assigns
 * a category or says "ignore" (never store the conversation). Enabled
 * rules run in `position` order and the first match wins; no match
 * means `other`. Rules run only when a message starts a new
 * conversation (and on "Re-apply rules"); later messages inherit the
 * thread's category. The constants mirror migration 45's CHECKs and are
 * reused by the route's Zod schemas.
 */

import { EMAIL_CATEGORIES, type EmailCategory } from './types';

/** What a rule looks at. `address`/`domain` mean the counterpart, not the raw From. */
export const RULE_FIELDS = ['address', 'domain', 'subject', 'body'] as const;
/** How the value is compared. */
export const RULE_MATCH_TYPES = ['contains', 'equals', 'ends_with'] as const;
/** A category, or `ignore`. */
export const RULE_ACTIONS = [...EMAIL_CATEGORIES, 'ignore'] as const;

/** One of {@link RULE_FIELDS}. */
export type RuleField = (typeof RULE_FIELDS)[number];
/** One of {@link RULE_MATCH_TYPES}. */
export type RuleMatchType = (typeof RULE_MATCH_TYPES)[number];
/** One of {@link RULE_ACTIONS}. */
export type RuleAction = (typeof RULE_ACTIONS)[number];

/** An `email_rules` row as the classifier needs it. */
export interface EmailRule {
  id: string;
  position: number;
  field: RuleField;
  match_type: RuleMatchType;
  value: string;
  action: RuleAction;
  enabled: boolean;
}

/** The classifier's verdict. */
export type Classification = { action: 'category'; category: EmailCategory } | { action: 'ignore' };

/** What rules are tested against: counterpart address, subject, new message text. */
export interface ClassifyInput {
  counterpart: string;
  subject: string;
  body: string;
}

/** The text a field refers to. */
function fieldText(field: RuleField, input: ClassifyInput): string {
  switch (field) {
    case 'address':
      return input.counterpart;
    case 'domain':
      return input.counterpart.split('@')[1] ?? '';
    case 'subject':
      return input.subject;
    case 'body':
      return input.body;
  }
}

/** True when `rule` matches `input` (case-insensitive; a blank value never matches). */
export function ruleMatches(rule: EmailRule, input: ClassifyInput): boolean {
  const needle = rule.value.trim().toLowerCase();
  if (!needle) return false;
  const haystack = fieldText(rule.field, input).trim().toLowerCase();
  switch (rule.match_type) {
    case 'contains':
      return haystack.includes(needle);
    case 'equals':
      return haystack === needle;
    case 'ends_with':
      return haystack.endsWith(needle);
  }
}

/** First enabled matching rule by position decides; otherwise `other`. */
export function classify(input: ClassifyInput, rules: EmailRule[]): Classification {
  const ordered = rules.filter((r) => r.enabled).sort((a, b) => a.position - b.position);
  for (const rule of ordered) {
    if (!ruleMatches(rule, input)) continue;
    return rule.action === 'ignore' ? { action: 'ignore' } : { action: 'category', category: rule.action };
  }
  return { action: 'category', category: 'other' };
}
