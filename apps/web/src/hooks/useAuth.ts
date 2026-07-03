// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Authentication state store (Zustand).
 *
 * Tracks the current Supabase session and exposes signIn/signOut
 * actions. `initialize()` must be called once at app boot: it loads
 * any persisted session and subscribes to supabase-js auth events
 * (token refresh, sign-out in another tab) so the store never goes
 * stale. Route guards read `status` to decide between rendering,
 * redirecting to /login, or showing a boot spinner.
 */

import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';

/** Auth lifecycle: 'loading' until the persisted session is checked. */
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

/** Shape of the auth store: session state plus auth actions. */
interface AuthState {
  /** Current auth lifecycle phase */
  status: AuthStatus;
  /** Active Supabase session, or null when signed out */
  session: Session | null;
  /** Loads persisted session and subscribes to auth changes (call once at boot) */
  initialize: () => Promise<void>;
  /** Signs in with email/password; throws Error with a user-readable message on failure */
  signIn: (email: string, password: string) => Promise<void>;
  /** Signs out and clears the session */
  signOut: () => Promise<void>;
}

/** Guards against double-subscription if initialize() is called twice. */
let initialized = false;

export const useAuth = create<AuthState>((set) => ({
  status: 'loading',
  session: null,

  initialize: async () => {
    if (initialized) return;
    initialized = true;

    const { data } = await supabase.auth.getSession();
    set({
      session: data.session,
      status: data.session ? 'authenticated' : 'unauthenticated',
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      set({
        session,
        status: session ? 'authenticated' : 'unauthenticated',
      });
    });
  },

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      throw new Error(
        error.message === 'Invalid login credentials'
          ? 'Incorrect email or password.'
          : error.message
      );
    }
    // Session state is updated by the onAuthStateChange subscription.
  },

  signOut: async () => {
    await supabase.auth.signOut();
  },
}));
