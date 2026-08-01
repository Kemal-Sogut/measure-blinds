// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Display-name fallbacks for customers who have no first or last name.
 *
 * Since 2026-08-01 a customer can be created from a phone number or an
 * email alone, so every surface that used to interpolate
 * `first_name last_name` directly would otherwise render an empty
 * string — a nameless row in the customer list, a blank calendar chip, a
 * printed label with no addressee.
 *
 * This is the browser twin of `apps/api/src/lib/customerName.ts` and
 * MUST be changed alongside it, following the same convention as
 * `pricing.ts` / `totals.ts`. Only `displayName` is mirrored: the
 * Worker's `greetingName` exists for email salutations, and nothing in
 * the browser writes those.
 */

/** The identifying fields, as they arrive from the API (nullable text). */
export interface NameParts {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
}

/** Trims a nullable field to a usable string, or ''. */
function clean(v: string | null | undefined): string {
  return (v ?? '').trim();
}

/**
 * The best available identifying string: "First Last" (either half may
 * be absent), else the email, else the phone, else a stable placeholder.
 * Never returns '' — callers render it straight into lists and headings
 * where a blank would look like a bug.
 */
export function displayName(c: NameParts | null | undefined): string {
  if (!c) return 'Unnamed customer';
  const name = [clean(c.first_name), clean(c.last_name)].filter(Boolean).join(' ');
  return name || clean(c.email) || clean(c.phone) || 'Unnamed customer';
}
