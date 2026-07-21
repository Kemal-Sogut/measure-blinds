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
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import { useAuth } from './hooks';
import './App.css';

const Login = lazy(() => import('./pages/Login'));
const CustomerList = lazy(() => import('./pages/customers/CustomerList'));
const CustomerForm = lazy(() => import('./pages/customers/CustomerForm'));
const OrderList = lazy(() => import('./pages/orders/OrderList'));
const OrderDetail = lazy(() => import('./pages/orders/OrderDetail'));
const ManufacturerCopy = lazy(() => import('./pages/orders/ManufacturerCopy'));
const OrderOverview = lazy(() => import('./pages/orders/OrderOverview'));
const CalendarPage = lazy(() => import('./pages/calendar/CalendarPage'));
const AppointmentsList = lazy(() => import('./pages/calendar/AppointmentsList'));
const AppointmentDetail = lazy(() => import('./pages/calendar/AppointmentDetail'));
const SettingsIndex = lazy(() => import('./pages/settings/SettingsIndex'));
const CompanyInfo = lazy(() => import('./pages/settings/CompanyInfo'));
const Materials = lazy(() => import('./pages/settings/Materials'));
const MaterialsForType = lazy(() => import('./pages/settings/MaterialsForType'));
const CassetteOptions = lazy(() => import('./pages/settings/CassetteOptions'));
const ControlOptions = lazy(() => import('./pages/settings/ControlOptions'));
const PresetLineItems = lazy(() => import('./pages/settings/PresetLineItems'));
const TermsAndConditions = lazy(() => import('./pages/settings/TermsAndConditions'));
const CustomerView = lazy(() => import('./pages/customer-view/CustomerView'));
const AppointmentView = lazy(() => import('./pages/customer-view/AppointmentView'));

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

            {/* Orders are the app's home screen */}
            <Route path="/" element={guard(<Layout><OrderList /></Layout>)} />

            {/* Customers */}
            <Route path="/customers" element={guard(<Layout><CustomerList /></Layout>)} />
            <Route path="/customers/new" element={guard(<Layout nav={false}><CustomerForm /></Layout>)} />
            <Route path="/customers/:id" element={guard(<Layout nav={false}><CustomerForm /></Layout>)} />

            {/* Orders — the list itself lives at "/", so /orders folds into it */}
            <Route path="/orders" element={<Navigate to="/" replace />} />
            <Route path="/orders/new" element={guard(<Layout nav={false}><OrderDetail /></Layout>)} />
            <Route path="/orders/:id" element={guard(<Layout nav={false}><OrderDetail /></Layout>)} />
            <Route path="/orders/:id/manufacturer" element={guard(<Layout nav={false}><ManufacturerCopy /></Layout>)} />
            <Route path="/orders/:id/overview" element={guard(<Layout nav={false}><OrderOverview /></Layout>)} />

            {/* Calendar */}
            <Route path="/calendar" element={guard(<Layout><CalendarPage /></Layout>)} />
            <Route path="/appointments" element={guard(<Layout nav={false}><AppointmentsList /></Layout>)} />
            <Route path="/appointments/:id" element={guard(<Layout nav={false}><AppointmentDetail /></Layout>)} />

            {/* Legacy /estimates paths map onto the order screens */}
            <Route path="/estimates" element={<Navigate to="/" replace />} />
            <Route path="/estimates/new" element={guard(<Layout nav={false}><OrderDetail /></Layout>)} />
            <Route path="/estimates/:id" element={guard(<Layout nav={false}><OrderDetail /></Layout>)} />

            {/* Settings */}
            <Route path="/settings" element={guard(<Layout><SettingsIndex /></Layout>)} />
            <Route path="/settings/company" element={guard(<Layout nav={false}><CompanyInfo /></Layout>)} />
            <Route path="/settings/materials" element={guard(<Layout nav={false}><Materials /></Layout>)} />
            <Route path="/settings/materials/:blindTypeId" element={guard(<Layout nav={false}><MaterialsForType /></Layout>)} />
            <Route path="/settings/cassette" element={guard(<Layout nav={false}><CassetteOptions /></Layout>)} />
            <Route path="/settings/controls" element={guard(<Layout nav={false}><ControlOptions /></Layout>)} />
            <Route path="/settings/presets" element={guard(<Layout nav={false}><PresetLineItems /></Layout>)} />
            <Route path="/settings/terms" element={guard(<Layout nav={false}><TermsAndConditions /></Layout>)} />

            {/* Public — no auth */}
            <Route path="/customer/:token" element={<CustomerView />} />
            <Route path="/appointment/:token" element={<AppointmentView />} />
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
