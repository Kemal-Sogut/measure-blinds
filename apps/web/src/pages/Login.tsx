// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Login page — a centered card on the tinted page: the brand tile with
 * the blinds mark, email/password fields with the design focus ring,
 * and the "provisioned by your admin" note (public self-registration is
 * disabled project-side). On success the auth store flips to
 * 'authenticated' and the router returns to the originally requested
 * page.
 *
 * This is the first screen anyone sees, so it carries the full card
 * language rather than a bare centered form — it is the app's
 * introduction to its own visual system.
 */

import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks';
import { Card, Button, inputClass } from '../components/ui';

/** This page's control treatment: the shared input plus a fixed height. */
const INPUT_CLS = `block h-12 ${inputClass}`;

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
    <div className="flex min-h-screen items-center justify-center bg-surface-muted px-6 py-10">
      <Card className="w-full max-w-[380px] p-6 sm:p-8">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-md bg-brand-600 shadow-sm">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="1" stroke="#fff" strokeWidth="1.75" />
            <path d="M3 9h18M8 4v5M16 4v5" stroke="#fff" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </div>
        <h1 className="mb-1 text-center text-[22px] font-bold text-text-primary">Blinds Nisa</h1>
        <p className="mb-7 text-center text-sm text-text-muted">Sign in to your estimator account</p>

        <form onSubmit={handleSubmit} noValidate>
          <label className="mb-1.5 block text-xs font-semibold text-text-secondary" htmlFor="email">
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

          <label className="mb-1.5 block text-xs font-semibold text-text-secondary" htmlFor="password">
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
            <p
              role="alert"
              className="mb-4 rounded-md border border-danger/20 bg-danger-tint px-3 py-2 text-[13px] text-danger"
            >
              {error}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            block
            loading={pending}
            disabled={!email || !password}
          >
            {pending ? 'Signing in…' : 'Sign In'}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-text-muted">
          Field access is provisioned by your admin — no self sign-up.
        </p>
      </Card>
    </div>
  );
}
