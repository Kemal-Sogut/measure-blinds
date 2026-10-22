// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Capability tokens behind the customer link (`/c/:token`, migration 47)
 * and the per-order tokens the link hands out.
 *
 * Both are minted lazily and never regenerated, so every link a customer
 * was ever emailed keeps working. Minting uses an `is(public_token, null)`
 * guard on the UPDATE: two concurrent mints produce one stored token, and
 * the loser reads the winner back rather than returning a token that was
 * never persisted (which would put a dead link in an email).
 *
 * Minting a token is NOT covered by the email-then-persist rule
 * (AI_GUIDELINES §2): it announces nothing and changes no status — the
 * `/pdf` download already mints order tokens the same way.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** The customer-facing link for a customer token. */
export function customerLinkUrl(appUrl: string, token: string): string {
  return `${appUrl}/c/${token}`;
}

/**
 * Returns the customer's link token, minting one if absent.
 *
 * @returns the token, or `null` when the customer does not exist.
 * @throws  on a database error, so callers never email a link that
 *          failed to persist.
 */
export async function ensureCustomerToken(
  sb: SupabaseClient,
  customerId: string
): Promise<string | null> {
  const { data: row, error } = await sb
    .from('customers')
    .select('id, public_token')
    .eq('id', customerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;
  if (row.public_token) return row.public_token as string;

  const { data: won, error: upError } = await sb
    .from('customers')
    .update({ public_token: crypto.randomUUID() })
    .eq('id', customerId)
    .is('public_token', null)
    .select('public_token')
    .maybeSingle();
  if (upError) throw new Error(upError.message);
  if (won?.public_token) return won.public_token as string;

  const { data: again, error: reError } = await sb
    .from('customers')
    .select('public_token')
    .eq('id', customerId)
    .maybeSingle();
  if (reError) throw new Error(reError.message);
  return (again?.public_token as string | undefined) ?? null;
}

/**
 * Returns an order's own public token, minting one when `existing` is
 * null. Used by the customer link for a `sent` order that reached the
 * customer without an email (`/mark-sent` writes no token).
 *
 * @throws when the token can neither be written nor read back.
 */
export async function ensureOrderToken(
  sb: SupabaseClient,
  orderId: string,
  existing: string | null
): Promise<string> {
  if (existing) return existing;
  const { data: won, error } = await sb
    .from('orders')
    .update({ public_token: crypto.randomUUID() })
    .eq('id', orderId)
    .is('public_token', null)
    .select('public_token')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (won?.public_token) return won.public_token as string;
  const { data: again, error: reError } = await sb
    .from('orders')
    .select('public_token')
    .eq('id', orderId)
    .maybeSingle();
  if (reError || !again?.public_token) throw new Error('Could not create the order link.');
  return again.public_token as string;
}

/**
 * Counts a customer's ACTIVE estimates: `sent` and not past expiry (the
 * same rule as the Worker's defensive expiry). `excludeOrderId` lets
 * `/send` count "the others" before the order being sent flips to `sent`.
 */
export async function countActiveEstimates(
  sb: SupabaseClient,
  customerId: string,
  today: string,
  excludeOrderId?: string
): Promise<number> {
  let q = sb
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customerId)
    .eq('status', 'sent')
    .gte('expiry_date', today);
  if (excludeOrderId) q = q.neq('id', excludeOrderId);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}
