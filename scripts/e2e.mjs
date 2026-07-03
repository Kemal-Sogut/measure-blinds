// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Live end-to-end test — exercises the REAL Worker + REAL Supabase
 * with zero browser involvement. Run it locally while `pnpm dev` (or
 * at least `pnpm dev:api`) is up:
 *
 *   node scripts/e2e.mjs
 *
 * It reads credentials from apps/api/.dev.vars and apps/web/.env,
 * creates a throwaway auth user + customer + estimates, walks the
 * whole flow (auth → server pricing → PDF → failed-send safety →
 * public view → confirm-once → expiry → rate limit), then deletes
 * everything it created — including the temp auth user.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Parses simple KEY=VALUE env files (comments/blank lines ignored). */
function parseEnvFile(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const devVars = parseEnvFile(resolve(root, 'apps/api/.dev.vars'));
const webEnv = parseEnvFile(resolve(root, 'apps/web/.env'));
const SB = devVars.SUPABASE_URL;
const SVC = devVars.SUPABASE_SERVICE_ROLE_KEY;
const ANON = webEnv.VITE_SUPABASE_ANON_KEY;
const API = webEnv.VITE_API_URL || 'http://localhost:8787';

const EMAIL = `e2e-${Date.now()}@example.test`;
const PASS = 'E2e-Temp-Passw0rd!';
let failures = 0;
const created = { userId: null, customerId: null, estimateIds: [] };

function check(cond, name, extra = '') {
  console.log(`${cond ? '  PASS' : '✗ FAIL'}  ${name}${cond ? '' : ` — ${extra}`}`);
  if (!cond) failures++;
}

/** Supabase admin request (service role). */
const admin = (path, opts = {}) =>
  fetch(`${SB}${path}`, {
    ...opts,
    headers: {
      apikey: SVC,
      Authorization: `Bearer ${SVC}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...opts.headers,
    },
  });

async function main() {
  // ── Auth ──────────────────────────────────────────────────────
  const createUser = await admin('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASS, email_confirm: true }),
  });
  const user = await createUser.json();
  created.userId = user.id;
  check(Boolean(user.id), 'create temp auth user');

  const login = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  const { access_token } = await login.json();
  check(Boolean(access_token), 'password login');

  const api = async (path, opts = {}) => {
    const r = await fetch(`${API}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
        ...opts.headers,
      },
    });
    const isJson = r.headers.get('content-type')?.includes('json');
    return { status: r.status, body: isJson ? await r.json() : await r.arrayBuffer() };
  };

  check((await fetch(`${API}/api/me`)).status === 401, 'unauthenticated /api/me → 401');
  const me = await api('/api/me');
  check(me.status === 200 && me.body.user.email === EMAIL, 'JWT verified via JWKS');

  // ── Catalog + customer ───────────────────────────────────────
  const fabrics = (await api('/api/settings/fabrics')).body.data;
  const cassettes = (await api('/api/settings/cassette-options')).body.data;
  const controls = (await api('/api/settings/control-options')).body.data;
  const fabric = fabrics.find((f) => Number(f.price_per_sqm) === 55) ?? fabrics[0];
  const cassette = cassettes.find((x) => Number(x.price_per_m) === 20) ?? cassettes[0];
  const control = controls.find((x) => Number(x.price_per_item) === 0) ?? controls[0];
  check(Boolean(fabric && cassette && control), 'catalogs available');

  const cust = await api('/api/customers', {
    method: 'POST',
    body: JSON.stringify({
      first_name: 'E2E',
      last_name: 'Tester',
      email: 'e2e-customer@example.test',
      shipping_city: 'Toronto',
    }),
  });
  check(cust.status === 201, 'create customer');
  created.customerId = cust.body.data.id;

  // ── Estimate with known math ─────────────────────────────────
  // blind: W=140 H=200 fabric×$f + cassette 1.4×$c + control 2×$k
  const f = Number(fabric.price_per_sqm), cm = Number(cassette.price_per_m), k = Number(control.price_per_item);
  const unit = Math.round(((140 * 200 * f) / 10000 + 1.4 * cm + 2 * k) * 100) / 100;
  const sub = Math.round((unit * 2 + 25) * 100) / 100;
  const disc = Math.round(sub * 10) / 100;
  const taxable = Math.round((sub - disc) * 100) / 100;
  const tax = Math.round(taxable * 13) / 100;
  const total = Math.round((taxable + tax) * 100) / 100;

  const est = await api('/api/estimates', {
    method: 'POST',
    body: JSON.stringify({
      customer_id: created.customerId,
      discount_type: 'percent',
      discount_value: 10,
      line_items: [
        {
          item_type: 'blind', room_name: 'Living Room', blinds_type: 'Roller',
          panels: [70, 70], height_cm: 200,
          fabric_id: fabric.id, cassette_id: cassette.id, control_id: control.id, quantity: 2,
        },
        { item_type: 'preset', description: 'Installation', quantity: 1, unit_price: 25 },
      ],
    }),
  });
  check(est.status === 201, 'create estimate', JSON.stringify(est.body));
  const e = est.body.data;
  created.estimateIds.push(e.id);
  check(Number(e.subtotal) === sub, `server subtotal ${sub}`, e.subtotal);
  check(Number(e.total) === total, `server total ${total} (discount before 13% HST)`, e.total);
  check(/^[SMTWF]\d{4}-\d+\d{2}$/.test(e.order_number), 'order number format', e.order_number);
  check(e.line_items?.[0]?.fabric_name === fabric.name, 'option snapshots stored');

  // ── Tamper rejection ─────────────────────────────────────────
  const tamper = await api('/api/estimates', {
    method: 'POST',
    body: JSON.stringify({
      customer_id: created.customerId,
      line_items: [{
        item_type: 'blind', room_name: 'x', blinds_type: '', panels: [100], height_cm: 200,
        fabric_id: fabric.id, cassette_id: cassette.id, control_id: control.id,
        quantity: 1, unit_price: 0.01,
      }],
    }),
  });
  check(tamper.status === 400, 'client-supplied price rejected with 400', tamper.status);

  // ── PDF ──────────────────────────────────────────────────────
  const pdf = await api(`/api/estimates/${e.id}/pdf`);
  const magic = new TextDecoder().decode(new Uint8Array(pdf.body).slice(0, 5));
  check(pdf.status === 200 && magic === '%PDF-', 'PDF endpoint returns a real PDF');

  // ── Send failure leaves the estimate untouched ───────────────
  const send = await api(`/api/estimates/${e.id}/send`, { method: 'POST' });
  const resendConfigured = send.status === 200;
  if (!resendConfigured) {
    check(send.status === 502, 'send fails cleanly without a Resend key', send.status);
    const after = await api(`/api/estimates/${e.id}`);
    check(
      after.body.data.status === 'draft' && after.body.data.public_token === null,
      'failed send leaves status/token untouched'
    );
  } else {
    console.log('  INFO  Resend key configured — send succeeded, skipping failure-path check');
  }

  // ── Public flow (simulate sent state directly in the DB) ─────
  const token = crypto.randomUUID();
  await admin(`/rest/v1/estimates?id=eq.${e.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'sent', public_token: token, terms_snapshot: 'E2E terms' }),
  });

  const pub = await fetch(`${API}/public/estimate/${token}`);
  const pubBody = await pub.json();
  check(pub.status === 200 && pubBody.data.status === 'sent', 'public view via token');
  check(pubBody.data.terms === 'E2E terms', 'terms snapshot served');
  check(!('public_token' in pubBody.data) && !('id' in pubBody.data), 'payload sanitized');

  const confirm1 = await fetch(`${API}/public/estimate/${token}/confirm`, { method: 'POST' });
  check(confirm1.status === 200, 'customer confirm succeeds', confirm1.status);
  const confirm2 = await fetch(`${API}/public/estimate/${token}/confirm`, { method: 'POST' });
  check(confirm2.status === 409, 'double confirm rejected with 409', confirm2.status);

  // ── Defensive expiry ─────────────────────────────────────────
  const est2 = await api('/api/estimates', {
    method: 'POST',
    body: JSON.stringify({
      customer_id: created.customerId,
      estimate_date: '2026-01-01',
      expiry_date: '2026-01-02',
      line_items: [{ item_type: 'custom', description: 'old', quantity: 1, unit_price: 10 }],
    }),
  });
  created.estimateIds.push(est2.body.data.id);
  const token2 = crypto.randomUUID();
  await admin(`/rest/v1/estimates?id=eq.${est2.body.data.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'sent', public_token: token2 }),
  });
  const expired = await (await fetch(`${API}/public/estimate/${token2}`)).json();
  check(expired.data.status === 'expired', 'stale sent estimate reads as expired', expired.data?.status);

  // ── Rate limit (6th public hit within a minute → 429) ────────
  let got429 = false;
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`${API}/public/estimate/${token}`);
    if (r.status === 429) got429 = true;
  }
  check(got429, 'public rate limiter returns 429');

  console.log(failures === 0 ? '\nAll E2E checks passed.' : `\n${failures} check(s) FAILED.`);
}

/** Deletes everything the test created, even after failures. */
async function cleanup() {
  for (const id of created.estimateIds) {
    await admin(`/rest/v1/estimates?id=eq.${id}`, { method: 'DELETE' });
  }
  if (created.customerId) {
    await admin(`/rest/v1/customers?id=eq.${created.customerId}`, { method: 'DELETE' });
  }
  if (created.userId) {
    await admin(`/auth/v1/admin/users/${created.userId}`, { method: 'DELETE' });
  }
  console.log('Cleanup complete (test estimates, customer, and auth user removed).');
}

try {
  await main();
} catch (err) {
  console.error('E2E crashed:', err);
  failures++;
} finally {
  await cleanup();
  process.exit(failures ? 1 : 0);
}
