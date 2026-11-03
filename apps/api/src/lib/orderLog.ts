// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The order activity trail (`order_logs`) — one shared writer.
 *
 * Lifted out of `routes/orders.ts` on 2026-10-24 so the multi-estimate
 * send (`lib/estimateSend.ts`) records its lines through the SAME writer
 * the per-order transitions use. Two copies would have drifted on the
 * `source` default alone, and the trail is what a consultant reads to
 * find out whether a customer was ever emailed.
 *
 * Deliberately tiny and Supabase-only: it owns nothing but the insert,
 * so every route group can depend on it without pulling order logic in.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Appends one row to the order's activity trail. Best-effort: a logging
 * failure must never fail the request it is describing, so errors are
 * swallowed (mirrors the "best-effort cleanup" pattern used elsewhere).
 *
 * `source` marks who caused the entry: 'staff' (the default, so all
 * existing call sites are unchanged) or 'customer' for anything driven
 * from the token'd public page. The web trail renders customer rows on
 * a light-blue background.
 */
export async function logOrderEvent(
  sb: SupabaseClient,
  orderId: string,
  message: string,
  source: 'staff' | 'customer' = 'staff'
): Promise<void> {
  try {
    await sb.from('order_logs').insert({ order_id: orderId, message, source });
  } catch {
    // Logging is diagnostic only — never block the caller's mutation.
  }
}
