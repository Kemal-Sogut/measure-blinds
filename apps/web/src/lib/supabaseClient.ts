// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Frontend Supabase client — used EXCLUSIVELY for authentication
 * (sign-in, sign-out, session refresh). All data reads and writes go
 * through the Cloudflare Worker API; this client is created with the
 * public anon key, which grants no data access under the project's
 * RLS policies.
 *
 * Session persistence and auto-refresh are handled by supabase-js;
 * `apiFetch` (lib/api.ts) asks this client for the current access
 * token on every request, so tokens are never manually stored.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail loudly at boot rather than with confusing auth errors later.
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — check apps/web/.env'
  );
}

/** Singleton Supabase client for auth operations only. */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
