// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Resolves an incoming e-Transfer to a specific order when possible.
 *
 * Two signals, tried in order:
 *   1. An explicit order number in the payment message (fast path).
 *   2. A confident customer-name + amount match: the sender's name maps
 *      to exactly one customer whose single open order's outstanding
 *      balance OR standard 50% deposit equals the amount.
 *
 * Anything ambiguous (unknown sender, several candidate orders, amount
 * mismatch) returns null so the payment is parked for manual assignment.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Confirmed statuses that still accept payments. */
const OPEN_STATUSES = ['awaiting_payment', 'in_progress', 'ready', 'installed'];

export interface OrderMatch {
  id: string;
  status: string;
  order_number: string;
}

/** Pulls an order number ("T0408-126") out of free text, or null. */
export function extractOrderNumber(text: string | undefined | null): string | null {
  if (!text) return null;
  const m = text.match(/[A-Za-z]\d{4}-\d{2,4}/);
  return m ? m[0].toUpperCase() : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}
function sumAmounts(rows: Array<{ amount: number | string }> | null | undefined): number {
  return (rows ?? []).reduce((acc, r) => acc + Number(r.amount), 0);
}

/** Sanitises a token for safe use inside a PostgREST or() filter value. */
function sanitizeToken(t: string): string {
  return t.replace(/[,.()%_*]/g, ' ').trim();
}

export async function resolveOrder(
  sb: SupabaseClient,
  amount: number,
  sender: string,
  reference: string
): Promise<OrderMatch | null> {
  // 1) Explicit order number in the message (or, rarely, the sender).
  const num = extractOrderNumber(reference) ?? extractOrderNumber(sender);
  if (num) {
    const { data } = await sb
      .from('orders')
      .select('id, status, order_number')
      .eq('order_number', num)
      .maybeSingle();
    if (data && OPEN_STATUSES.includes(data.status)) {
      return { id: data.id, status: data.status, order_number: data.order_number };
    }
  }

  // 2) Confident customer-name + amount match.
  const tokens = Array.from(
    new Set(sanitizeToken(sender).split(/\s+/).filter((t) => t.length >= 2))
  );
  if (tokens.length === 0) return null;

  const orFilter = tokens
    .map((t) => `first_name.ilike.%${t}%,last_name.ilike.%${t}%`)
    .join(',');
  const { data: customers } = await sb
    .from('customers')
    .select('id, first_name, last_name')
    .or(orFilter)
    .is('deleted_at', null)
    .limit(50);

  const senderLower = sender.toLowerCase();
  const senderTokens = new Set(tokens.map((t) => t.toLowerCase()));
  const matchedIds = (customers ?? [])
    .filter((cu) => {
      const first = String(cu.first_name ?? '').toLowerCase();
      const last = String(cu.last_name ?? '').toLowerCase();
      const full = `${first} ${last}`.trim();
      // Full name present in the sender, OR a sender token equals the
      // customer's first or last name. The latter enables first-name-only
      // transfers (e.g. "Kemal") to match — the amount + single-candidate
      // checks below keep that safe.
      return (
        (!!first && !!last && senderLower.includes(full)) ||
        (!!first && senderTokens.has(first)) ||
        (!!last && senderTokens.has(last))
      );
    })
    .map((cu) => cu.id);
  if (matchedIds.length === 0) return null;

  const { data: orders } = await sb
    .from('orders')
    .select('id, status, total, order_number, payments(amount)')
    .in('customer_id', matchedIds)
    .in('status', OPEN_STATUSES);

  const candidates = (orders ?? []).filter((o) => {
    const total = Number(o.total);
    const paid = sumAmounts(o.payments as Array<{ amount: number | string }>);
    const balance = round2(total - paid);
    const deposit = round2(total / 2);
    // A full-balance payment or the standard 50% deposit both count.
    return balance > 0 && (approxEqual(amount, balance) || approxEqual(amount, deposit));
  });

  if (candidates.length === 1) {
    const o = candidates[0];
    return { id: o.id, status: o.status, order_number: o.order_number };
  }
  return null; // 0 or >1 candidates → manual assignment
}
