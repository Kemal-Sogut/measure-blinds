// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Supabase client factory for the Cloudflare Worker.
 *
 * Creates a Supabase client using the service role key, granting full
 * access to all tables (bypassing RLS). This client must ONLY be used
 * server-side in the Worker — the service role key must never be exposed
 * to the frontend.
 *
 * @param env - Cloudflare Worker environment bindings containing
 *              SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 * @returns A configured Supabase client instance with admin privileges
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function createSupabaseAdmin(env: {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
