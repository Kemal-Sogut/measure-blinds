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
const EstimatesPage = lazy(() => import('./pages/estimates/EstimatesPage'));
const OrderList = lazy(() => import('./pages/orders/OrderList'));
const OrderDetail = lazy(() => import('./pages/orders/OrderDetail'));
// Staff order URLs resolve by order number; the sub-pages render inside it.
const OrderByNumberRoute = lazy(() => import('./pages/orders/orderRoute'));
const LegacyOrderRedirect = lazy(() =>
  import('./pages/orders/orderRoute').then((m) => ({ default: m.LegacyOrderRedirect }))
);
const CalendarPage = lazy(() => import('./pages/calendar/CalendarPage'));
const AppointmentsList = lazy(() => import('./pages/calendar/AppointmentsList'));
const AppointmentDetail = lazy(() => import('./pages/calendar/AppointmentDetail'));
const NotificationsPage = lazy(() => import('./pages/notifications/NotificationsPage'));
const InboxPage = lazy(() => import('./pages/inbox/InboxPage'));
const InboxThreadPage = lazy(() => import('./pages/inbox/InboxThreadPage'));
const SettingsIndex = lazy(() => import('./pages/settings/SettingsIndex'));
const CompanyInfo = lazy(() => import('./pages/settings/CompanyInfo'));
const Materials = lazy(() => import('./pages/settings/Materials'));
const MaterialsForType = lazy(() => import('./pages/settings/MaterialsForType'));
const BlindTypeDefaults = lazy(() => import('./pages/settings/BlindTypeDefaults'));
const CassetteOptions = lazy(() => import('./pages/settings/CassetteOptions'));
const BottomRailOptions = lazy(() => import('./pages/settings/BottomRailOptions'));
const ControlOptions = lazy(() => import('./pages/settings/ControlOptions'));
const PleatTypes = lazy(() => import('./pages/settings/PleatTypes'));
const InstallationOptions = lazy(() => import('./pages/settings/InstallationOptions'));
const PresetLineItems = lazy(() => import('./pages/settings/PresetLineItems'));
const TermsAndConditions = lazy(() => import('./pages/settings/TermsAndConditions'));
const EmailRules = lazy(() => import('./pages/settings/EmailRules'));
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
            <Route path="/" element={guard(<Layout><EstimatesPage /></Layout>)} />

            {/* Customers */}
            <Route path="/customers" element={guard(<Layout><CustomerList /></Layout>)} />
            <Route path="/customers/new" element={guard(<Layout><CustomerForm /></Layout>)} />
            <Route path="/customers/:id" element={guard(<Layout><CustomerForm /></Layout>)} />

            {/* Orders — the list itself lives at "/", so /orders folds into it */}
            <Route path="/orders" element={guard(<Layout><OrderList /></Layout>)} />
            <Route path="/orders/new" element={guard(<Layout><OrderDetail /></Layout>)} />
            {/* Ids (notifications, calendar, inbox, old links) redirect to the canonical URL */}
            <Route path="/orders/:id" element={guard(<Layout><LegacyOrderRedirect /></Layout>)} />
            <Route path="/orders/:id/manufacturer" element={guard(<Layout><LegacyOrderRedirect sub="manufacturer" /></Layout>)} />
            <Route path="/orders/:id/present" element={guard(<Layout><LegacyOrderRedirect sub="present" /></Layout>)} />
            <Route path="/orders/:id/labels" element={guard(<Layout><LegacyOrderRedirect sub="labels" /></Layout>)} />

            {/* Calendar */}
            <Route path="/calendar" element={guard(<Layout><CalendarPage /></Layout>)} />
            <Route path="/appointments" element={guard(<Layout><AppointmentsList /></Layout>)} />
            <Route path="/appointments/:id" element={guard(<Layout><AppointmentDetail /></Layout>)} />

            {/* Inbox — Titan conversations (INBOX + Sent), synced every minute 8 AM–10 PM, every 10 min overnight */}
            <Route path="/inbox" element={guard(<Layout><InboxPage /></Layout>)} />
            <Route path="/inbox/:id" element={guard(<Layout><InboxThreadPage /></Layout>)} />

            {/* Notifications — customer confirms, edit requests, e-Transfers */}
            <Route path="/notifications" element={guard(<Layout><NotificationsPage /></Layout>)} />

            {/* Legacy /estimates paths map onto the order screens */}
            <Route path="/estimates" element={<Navigate to="/" replace />} />
            <Route path="/estimates/new" element={guard(<Layout><OrderDetail /></Layout>)} />
            <Route path="/estimates/:id" element={guard(<Layout><LegacyOrderRedirect /></Layout>)} />

            {/* Settings */}
            <Route path="/settings" element={guard(<Layout><SettingsIndex /></Layout>)} />
            <Route path="/settings/company" element={guard(<Layout><CompanyInfo /></Layout>)} />
            <Route path="/settings/materials" element={guard(<Layout><Materials /></Layout>)} />
            <Route path="/settings/materials/:blindTypeId" element={guard(<Layout><MaterialsForType /></Layout>)} />
            <Route path="/settings/cassette" element={guard(<Layout><CassetteOptions /></Layout>)} />
            <Route path="/settings/bottom-rail" element={guard(<Layout><BottomRailOptions /></Layout>)} />
            <Route path="/settings/controls" element={guard(<Layout><ControlOptions /></Layout>)} />
            <Route path="/settings/pleat-types" element={guard(<Layout><PleatTypes /></Layout>)} />
            <Route path="/settings/installation" element={guard(<Layout><InstallationOptions /></Layout>)} />
            <Route path="/settings/presets" element={guard(<Layout><PresetLineItems /></Layout>)} />
            <Route path="/settings/defaults" element={guard(<Layout><BlindTypeDefaults /></Layout>)} />
            <Route path="/settings/terms" element={guard(<Layout><TermsAndConditions /></Layout>)} />
            <Route path="/settings/email-rules" element={guard(<Layout><EmailRules /></Layout>)} />

            {/* Public — no auth */}
            <Route path="/customer/:token" element={<CustomerView />} />
            <Route path="/appointment/:token" element={<AppointmentView />} />
            {/* Staff order URL: /<customer-slug>/<order-number>[/<sub>] — React Router
                ranks static segments first, so every route above still wins. */}
            <Route path="/:customerSlug/:orderNumber" element={guard(<Layout><OrderByNumberRoute /></Layout>)} />
            <Route path="/:customerSlug/:orderNumber/:sub" element={guard(<Layout><OrderByNumberRoute /></Layout>)} />
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
