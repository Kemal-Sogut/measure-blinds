// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Cloudflare Worker entry point for the Blinds Nisa API.
 *
 * Configures the Hono application with global middleware (CORS, security headers),
 * mounts all route groups, and exports the Worker fetch handler along with
 * a scheduled handler for cron-triggered estimate expiry.
 *
 * This file is intentionally kept thin — all business logic lives in
 * dedicated route and lib modules.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requireAuth, type AuthVariables } from './middleware/auth';
import settingsRoutes from './routes/settings';
import customersRoutes from './routes/customers';
import ordersRoutes from './routes/orders';
import appointmentsRoutes from './routes/appointments';
import paymentsRoutes from './routes/payments';
import publicRoutes from './routes/public';
import webhookRoutes from './routes/webhook';
import { createSupabaseAdmin } from './lib/supabase';
import { runDailyEmailJobs } from './lib/reminders';

/** Environment bindings provided by Cloudflare Workers runtime. */
export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY: string;
  /** Optional verified sender, e.g. "Blinds Nisa <estimates@domain.com>" */
  RESEND_FROM?: string;
  /** Optional reply-to address for customer-facing emails, e.g. "info@domain.com" */
  RESEND_REPLY_TO?: string;
  APP_URL: string;
  ENVIRONMENT: string;
  /** Shared secret the e-Transfer Apps Script sends as a Bearer token. */
  ETRANSFER_WEBHOOK_SECRET?: string;
}

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

/**
 * Global CORS middleware.
 * In production, origin should be locked to the Pages deployment domain.
 * During development, localhost is permitted.
 */
app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return '';
      if (
        origin.includes('localhost') ||
        origin.includes('127.0.0.1') ||
        origin === 'https://measure-blinds.blindsnisa.workers.dev'
      ) {
        return origin;
      }
      return '';
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  })
);

/**
 * Global security headers middleware.
 * Sets Content-Security-Policy, X-Content-Type-Options, and X-Frame-Options
 * on every response to harden against common web attacks.
 */
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Content-Security-Policy', "default-src 'self'");
});

/** Health check endpoint — verifies the Worker is running. */
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * e-Transfer webhook — intentionally OUTSIDE /api/* so it skips JWT
 * auth; it authenticates with a shared bearer secret instead. Posted to
 * by the Gmail Apps Script.
 */
app.route('/webhooks', webhookRoutes);

/**
 * JWT verification on every /api/* route registered below this point.
 * /api/health stays public (registered above); /public/* routes are
 * intentionally outside this prefix and use rate limiting instead.
 */
app.use('/api/*', requireAuth);

/**
 * Temporary authenticated echo endpoint — lets Phase 3 verification
 * confirm the full login → Bearer token → Worker flow before real
 * data routes exist. Replaced by real route groups in Phases 4-9.
 */
app.get('/api/me', (c) => {
  return c.json({ user: c.get('user') });
});

/** Settings module — company info, catalogs, logo upload (Phase 4). */
app.route('/api/settings', settingsRoutes);

/** Customers module — CRUD with search and soft delete (Phase 5). */
app.route('/api/customers', customersRoutes);

/** Orders module — server-priced CRUD, estimates/invoices, payments. */
app.route('/api/orders', ordersRoutes);

/** Appointments — estimate visits + installations, calendar events. */
app.route('/api/appointments', appointmentsRoutes);

/** Payment reconciliation — the unmatched e-Transfer inbox. */
app.route('/api/payments', paymentsRoutes);

/** Public customer view + confirm — token-gated, rate-limited (Phase 9). */
app.route('/public', publicRoutes);

export default {
  /**
   * Main HTTP fetch handler for all incoming requests.
   * Delegates to the Hono router for route matching and middleware execution.
   */
  fetch: app.fetch,

  /**
   * Scheduled handler for Cloudflare Cron Triggers. Two daily runs:
   *
   *   0 6 * * *  — expires every 'sent' order whose estimate validity
   *                date has passed (the defensive per-read check in the
   *                order routes covers the window between runs).
   *   0 14 * * * — customer emails at 10 AM Toronto (EDT; 9 AM in
   *                winter): day-before appointment + installation
   *                reminders and review requests 2 days after install.
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        if (event.cron === '0 14 * * *') {
          const sent = await runDailyEmailJobs(env);
          console.log(
            `Daily emails: ${sent.appointmentReminders} appointment reminder(s), ` +
              `${sent.installReminders} install reminder(s), ` +
              `${sent.reviewRequests} review request(s) (${event.cron})`
          );
          return;
        }
        const sb = createSupabaseAdmin(env);
        const today = new Date().toISOString().slice(0, 10);
        const { data, error } = await sb
          .from('orders')
          .update({ status: 'expired' })
          .eq('status', 'sent')
          .lt('expiry_date', today)
          .select('id');
        if (error) console.error('Auto-expiry failed:', error.message);
        else console.log(`Auto-expiry: ${data?.length ?? 0} order(s) expired (${event.cron})`);
      })()
    );
  },
};
