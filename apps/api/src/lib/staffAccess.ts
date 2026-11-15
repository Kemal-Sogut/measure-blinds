// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The staff allow-list behind `/api/*`.
 *
 * A verified Supabase JWT proves only that someone logged in to the
 * project. Whether that someone is STAFF is decided here: their user id
 * must have a row in `public.profiles` (migration 54). `middleware/auth.ts`
 * calls the gate after signature verification, so a login that is not on
 * the list gets 403 before any route runs.
 *
 * The lookup result is cached per Worker isolate, and only a "yes" is
 * cached: a removed profile stops working within `STAFF_CACHE_TTL_MS`,
 * while a newly added one works on its very next request. A failed
 * lookup is thrown, never turned into an answer — the middleware maps it
 * to 503, so a database blip can neither lock staff out silently nor let
 * a stranger in.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** How long a positive staff lookup is trusted before `profiles` is read again. */
export const STAFF_CACHE_TTL_MS = 60_000;

/** Answers whether the auth user with this id is a staff member. */
export type StaffLookup = (userId: string) => Promise<boolean>;

/**
 * Wraps a lookup with a positive-only cache.
 *
 * @param lookup The authoritative check (normally {@link profilesLookup}).
 * @param ttlMs  How long a "yes" is reused; defaults to {@link STAFF_CACHE_TTL_MS}.
 * @param now    Clock in epoch ms; injectable so tests can move time.
 * @returns A gate with the same signature as `lookup`.
 */
export function createStaffGate(
  lookup: StaffLookup,
  ttlMs: number = STAFF_CACHE_TTL_MS,
  now: () => number = Date.now
): StaffLookup {
  const allowedUntil = new Map<string, number>();
  return async (userId) => {
    const until = allowedUntil.get(userId);
    if (until !== undefined && now() < until) return true;
    allowedUntil.delete(userId);
    const isStaff = await lookup(userId);
    if (isStaff) allowedUntil.set(userId, now() + ttlMs);
    return isStaff;
  };
}

/**
 * The production lookup: one indexed primary-key read of `profiles`.
 *
 * @param sb Service-role client (the table has no client-role access).
 * @throws when the read fails, so the caller can answer 503.
 */
export function profilesLookup(sb: SupabaseClient): StaffLookup {
  return async (userId) => {
    const { data, error } = await sb.from('profiles').select('id').eq('id', userId).maybeSingle();
    if (error) throw new Error(`Staff lookup failed: ${error.message}`);
    return data !== null;
  };
}
