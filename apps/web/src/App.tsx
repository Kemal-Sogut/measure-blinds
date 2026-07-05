// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Root application component for the Blinds Nisa Field Estimator.
 *
 * Sets up the React Router with all page routes, TanStack Query
 * provider, and the global toast system. Pages are lazy-loaded
 * (React.lazy + route-level Suspense) so the public customer view
 * doesn't pull in the whole consultant app and vice versa — this
 * keeps first paint fast on field connections and resolves the
 * >500 kB single-chunk build warning.
 */

import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import { useAuth } from './hooks';
import './App.css';

const Login = lazy(() => import('./pages/Login'));
const Main = lazy(() => import('./pages/Main'));
const CustomerList = lazy(() => import('./pages/customers/CustomerList'));
const CustomerForm = lazy(() => import('./pages/customers/CustomerForm'));
const OrderList = lazy(() => import('./pages/orders/OrderList'));
const OrderDetail = lazy(() => import('./pages/orders/OrderDetail'));
const SettingsIndex = lazy(() => import('./pages/settings/SettingsIndex'));
const CompanyInfo = lazy(() => import('./pages/settings/CompanyInfo'));
const Fabrics = lazy(() => import('./pages/settings/Fabrics'));
const BlindTypes = lazy(() => import('./pages/settings/BlindTypes'));
const CassetteOptions = lazy(() => import('./pages/settings/CassetteOptions'));
const ControlOptions = lazy(() => import('./pages/settings/ControlOptions'));
const PresetLineItems = lazy(() => import('./pages/settings/PresetLineItems'));
const TermsAndConditions = lazy(() => import('./pages/settings/TermsAndConditions'));
const CustomerView = lazy(() => import('./pages/customer-view/CustomerView'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2, // field-use resilience: transient network errors retry twice
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});

/** Neutral splash shown while a lazy page chunk loads. */
function PageFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted">
      <p className="text-text-muted">Loading…</p>
    </div>
  );
}

export default function App() {
  const initialize = useAuth((s) => s.initialize);

  // Load the persisted session and subscribe to auth changes at boot.
  useEffect(() => {
    void initialize();
  }, [initialize]);

  /** Wraps a page element in the auth guard. */
  const guard = (element: React.ReactNode) => <ProtectedRoute>{element}</ProtectedRoute>;

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            {/* Auth */}
            <Route path="/login" element={<Login />} />

            {/* Authenticated routes */}
            <Route path="/" element={guard(<Layout><Main /></Layout>)} />

            {/* Customers */}
            <Route path="/customers" element={guard(<Layout><CustomerList /></Layout>)} />
            <Route path="/customers/new" element={guard(<Layout nav={false}><CustomerForm /></Layout>)} />
            <Route path="/customers/:id" element={guard(<Layout nav={false}><CustomerForm /></Layout>)} />

            {/* Orders */}
            <Route path="/orders" element={guard(<Layout><OrderList /></Layout>)} />
            <Route path="/orders/new" element={guard(<Layout nav={false}><OrderDetail /></Layout>)} />
            <Route path="/orders/:id" element={guard(<Layout nav={false}><OrderDetail /></Layout>)} />

            {/* Legacy /estimates paths redirect to /orders */}
            <Route path="/estimates" element={guard(<Layout><OrderList /></Layout>)} />
            <Route path="/estimates/new" element={guard(<Layout nav={false}><OrderDetail /></Layout>)} />
            <Route path="/estimates/:id" element={guard(<Layout nav={false}><OrderDetail /></Layout>)} />

            {/* Settings */}
            <Route path="/settings" element={guard(<Layout><SettingsIndex /></Layout>)} />
            <Route path="/settings/company" element={guard(<Layout nav={false}><CompanyInfo /></Layout>)} />
            <Route path="/settings/fabrics" element={guard(<Layout nav={false}><Fabrics /></Layout>)} />
            <Route path="/settings/blind-types" element={guard(<Layout nav={false}><BlindTypes /></Layout>)} />
            <Route path="/settings/cassette" element={guard(<Layout nav={false}><CassetteOptions /></Layout>)} />
            <Route path="/settings/controls" element={guard(<Layout nav={false}><ControlOptions /></Layout>)} />
            <Route path="/settings/presets" element={guard(<Layout nav={false}><PresetLineItems /></Layout>)} />
            <Route path="/settings/terms" element={guard(<Layout nav={false}><TermsAndConditions /></Layout>)} />

            {/* Public — no auth */}
            <Route path="/customer/:token" element={<CustomerView />} />
          </Routes>
        </Suspense>
        <Toaster
          position="top-center"
          toastOptions={{
            duration: 4000,
            style: {
              borderRadius: '0.5rem',
              padding: '0.75rem 1rem',
              fontSize: '0.875rem',
            },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
