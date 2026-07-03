// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Login page — email/password authentication via Supabase Auth.
 *
 * Mobile-optimized single-card form with ≥44px tap targets, inline
 * error display, and a pending state that disables double submits.
 * On success the auth store flips to 'authenticated' and the router
 * redirects to the page the user originally requested (or the
 * dashboard). Public self-registration is disabled project-side, so
 * this page intentionally has no sign-up link.
 */

import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks';

export default function Login() {
  const { status, signIn } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /** Where to go after login: the guarded page that redirected here, or home. */
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  if (status === 'authenticated') {
    return <Navigate to={from} replace />;
  }

  /** Validates inputs, attempts sign-in, and surfaces a readable error. */
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface-elevated p-8 shadow-lg">
        <h1 className="mb-1 text-center text-2xl font-semibold text-text-primary">
          Blinds Nisa
        </h1>
        <p className="mb-8 text-center text-sm text-text-muted">
          Sign in to your estimator account
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <label className="mb-1 block text-sm font-medium text-text-secondary" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mb-4 block h-12 w-full rounded-lg border border-border bg-surface px-3 text-base text-text-primary outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />

          <label className="mb-1 block text-sm font-medium text-text-secondary" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mb-6 block h-12 w-full rounded-lg border border-border bg-surface px-3 text-base text-text-primary outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />

          {error && (
            <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending || !email || !password}
            className="h-12 w-full rounded-lg bg-brand-600 text-base font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
