// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Display-name fallbacks for customers who have no first or last name.
 *
 * Since 2026-08-01 a customer can be created from a phone number or an
 * email alone (see `routes/customers.ts`), so every surface that used to
 * interpolate `first_name` directly would otherwise render an empty
 * string — "Hi ," in an email, a blank name block on a PDF.
 *
 * Two functions because the two contexts want different answers. A
 * document or a list needs the most identifying string available, even
 * if that is an email address; a greeting does not — "Hi a@b.com" reads
 * worse than "Hi there".
 *
 * Neither function escapes its output. Callers that interpolate into
 * email HTML must keep passing the result through `escapeHtml`, exactly
 * as they did with the raw column.
 *
 * `apps/web/src/lib/customerName.ts` is the browser twin of this module
 * and MUST be changed alongside it, following the same convention as
 * `pricing.ts` / `totals.ts`.
 */

/** The identifying fields, as they arrive from PostgREST (nullable text). */
export interface NameParts {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
}

/** Trims a nullable column to a usable string, or ''. */
function clean(v: string | null | undefined): string {
  return (v ?? '').trim();
}

/**
 * The best available identifying string: "First Last" (either half may
 * be absent), else the email, else the phone, else a stable placeholder.
 * Never returns '' — callers render it directly into documents and lists
 * where a blank would look like a bug.
 */
export function displayName(c: NameParts | null | undefined): string {
  if (!c) return 'Unnamed customer';
  const name = [clean(c.first_name), clean(c.last_name)].filter(Boolean).join(' ');
  return name || clean(c.email) || clean(c.phone) || 'Unnamed customer';
}

/**
 * What to put after "Hi" in an email. Prefers the first name, accepts
 * the last name, and otherwise gives up on personalisation entirely
 * rather than greeting someone by their email address or phone number.
 */
export function greetingName(c: NameParts | null | undefined): string {
  if (!c) return 'there';
  return clean(c.first_name) || clean(c.last_name) || 'there';
}
