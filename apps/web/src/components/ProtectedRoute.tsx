// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Route guard for authenticated pages.
 *
 * Renders its children only when a Supabase session exists. While the
 * persisted session is still being checked at boot ('loading') it shows
 * a neutral splash instead of flashing the login page. When the user is
 * signed out it redirects to /login, preserving the attempted path in
 * router state so Login can navigate back after success.
 */

import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks';

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-muted">
        <p className="text-text-muted">Loading…</p>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
