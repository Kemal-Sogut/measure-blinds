// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Estimate title rules (migration 47, `orders.title`).
 *
 * A title is an optional consultant label ("Option A – Roller blinds")
 * that tells two estimates for the same customer apart on the Estimates
 * page, the customer's link, the estimate email subject and the PDF.
 * NULL means "no title": every surface renders nothing rather than a
 * fallback, so normalising blank input to NULL here is what keeps an
 * empty box from printing an empty heading.
 *
 * Whitespace is collapsed (not just trimmed) because the title is placed
 * in an email subject, where a pasted newline would be a header-injection
 * shaped bug even though Resend rejects it.
 */

/** Matches the DB check `char_length(title) <= 120`. */
export const ORDER_TITLE_MAX = 120;

/**
 * Normalises a title from a request body.
 *
 * @returns `undefined` when the field was absent (leave the stored value
 *          alone), `null` when blank, otherwise the cleaned string.
 */
export function normalizeOrderTitle(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  const cleaned = (v ?? '').replace(/\s+/g, ' ').trim();
  return cleaned === '' ? null : cleaned;
}

/**
 * The `title` fragment for an UPDATE: `{}` when the client did not send
 * the field, so an older client that never heard of titles cannot wipe
 * one on save.
 */
export function titlePatch(v: string | null | undefined): { title?: string | null } {
  const t = normalizeOrderTitle(v);
  return t === undefined ? {} : { title: t };
}
