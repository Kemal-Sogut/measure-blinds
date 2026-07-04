// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Login page (redesign screen 01) — centered form on the page
 * background: brand square with the blinds mark, email/password
 * fields with the design focus ring, and the "provisioned by your
 * admin" note (public self-registration is disabled project-side).
 * On success the auth store flips to 'authenticated' and the router
 * returns to the originally requested page.
 */

import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks';

const INPUT_CLS =
  'block h-[46px] w-full rounded-sm border border-border-input bg-surface px-3 text-[15px] text-text-primary';

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
    <div className="flex min-h-screen items-center justify-center bg-surface-muted px-6">
      <div className="w-full max-w-[320px]">
        <div className="mx-auto mb-5 flex h-11 w-11 items-center justify-center rounded-sm bg-brand-600">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="1" stroke="#fff" strokeWidth="1.75" />
            <path d="M3 9h18M8 4v5M16 4v5" stroke="#fff" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </div>
        <h1 className="mb-1 text-center text-[22px] font-semibold text-text-primary">Blinds Nisa</h1>
        <p className="mb-7 text-center text-sm text-text-muted">Sign in to your estimator account</p>

        <form onSubmit={handleSubmit} noValidate>
          <label className="mb-1.5 block text-[13px] font-medium text-text-secondary" htmlFor="email">
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
            className={`${INPUT_CLS} mb-3.5`}
          />

          <label className="mb-1.5 block text-[13px] font-medium text-text-secondary" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${INPUT_CLS} mb-[22px]`}
          />

          {error && (
            <p role="alert" className="mb-4 rounded-sm bg-danger-tint px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending || !email || !password}
            className="h-[46px] w-full rounded-sm bg-brand-600 text-[15px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-text-muted">
          Field access is provisioned by your admin — no self sign-up.
        </p>
      </div>
    </div>
  );
}
