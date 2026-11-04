// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Request schema for the public website lead form (`POST /intake/lead`,
 * `routes/leadIntake.ts`), posted by `apps/web/public/embed/lead-form.js`.
 *
 * The rules MIRROR the form's own client-side `RULES` (10-digit phone,
 * Canadian postal code, a province code, at least one covering), because
 * the form's validation is only a convenience for the visitor: anything can
 * POST here directly, so the Worker re-validates everything. If you change a
 * rule on one side, change the other, or the visitor will see "Some details
 * didn't go through" for input the form itself accepted.
 *
 * `.strict()`: unknown keys are a 400, never silently stripped (AI_GUIDELINES
 * §1 applies the same rule to every request schema in this Worker).
 *
 * Three fields are anti-spam signals, not lead data, and are never stored:
 *   - `website`: a honeypot input that people never see. A non-empty
 *     value means a bot.
 *   - `fill_ms`: milliseconds from the form rendering to the submit, as
 *     timed by the form. A four-step form filled in under
 *     `MIN_FILL_MS` was not filled in by a person.
 *   - `turnstile_token`: required only when the Worker has a `TURNSTILE_SECRET`.
 */

import { z } from 'zod';

/** Province / territory codes the form's dropdown offers (same as `customers.shipping_province`). */
export const PROVINCE_CODES = [
  'ON', 'QC', 'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'PE', 'SK', 'NT', 'NU', 'YT',
] as const;

/** Covering ids the form offers, in its display order. 'unsure' = "Not sure yet". */
export const COVERING_IDS = [
  'zebra', 'roller', 'solar', 'honeycomb', 'roman', 'shutters', 'drapery', 'smart', 'unsure',
] as const;

/** Window-count buckets the form offers. */
export const WINDOW_COUNTS = ['1-5', '5-15', '15+'] as const;

/**
 * Submissions faster than this are treated as bots. A person needs well over
 * three seconds just to read step 1, and the form has four steps.
 */
export const MIN_FILL_MS = 3000;

/** Canadian postal code, optional single space (the form inserts one). */
const POSTAL_RE = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d$/;

/** Digits of a phone number without a leading North American "1". */
export function phoneDigits(v: string): string {
  const d = v.replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
}

/** A required single-line text field, trimmed, 1..max characters. */
const required = (max: number, label: string) =>
  z.string().trim().min(1, `${label} is required.`).max(max, `${label} is too long.`);

/**
 * The full form payload. String fields are trimmed here so the route and
 * the customer matcher never see stray whitespace.
 */
export const leadInputSchema = z
  .object({
    first_name: required(100, 'First name'),
    last_name: required(100, 'Last name'),
    email: z.string().trim().toLowerCase().max(254).email('Enter a valid email address.'),
    phone: z
      .string()
      .trim()
      .max(30)
      .refine((v) => phoneDigits(v).length === 10, 'Enter a 10-digit phone number.'),
    street: z.string().trim().min(3, 'Street address is required.').max(200),
    unit: z.string().trim().max(50).default(''),
    city: required(100, 'City'),
    province: z.enum(PROVINCE_CODES),
    postal_code: z
      .string()
      .trim()
      .toUpperCase()
      .refine((v) => POSTAL_RE.test(v), 'Enter a postal code like K1A 0B1.'),
    coverings: z
      .array(z.enum(COVERING_IDS))
      .min(1, 'Pick at least one covering.')
      .max(COVERING_IDS.length)
      .refine((v) => new Set(v).size === v.length, 'Pick each covering only once.'),
    window_count: z.enum(WINDOW_COUNTS),
    message: z.string().trim().max(1000, 'Message is too long.').default(''),
    consent: z.literal(true, { errorMap: () => ({ message: 'Consent is required.' }) }),
    source_url: z.string().max(500).default(''),
    turnstile_token: z.string().max(4096).default(''),
    website: z.string().max(500).default(''),
    fill_ms: z.number().int().min(0).max(86_400_000).optional(),
  })
  .strict();

/** A validated lead payload (output of `leadInputSchema`, trimmed and defaulted). */
export type LeadInput = z.infer<typeof leadInputSchema>;

/**
 * True when the payload carries a bot signal: the honeypot is filled, or
 * the form reports being completed faster than `MIN_FILL_MS`. A missing
 * `fill_ms` (an older cached copy of the embed) is NOT treated as a bot,
 * so a deploy never turns away real visitors whose browser still has the
 * previous script.
 */
export function looksLikeBot(input: Pick<LeadInput, 'website' | 'fill_ms'>): boolean {
  if (input.website.trim() !== '') return true;
  return input.fill_ms !== undefined && input.fill_ms < MIN_FILL_MS;
}
