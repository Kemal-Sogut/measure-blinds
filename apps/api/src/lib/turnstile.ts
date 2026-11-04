// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Cloudflare Turnstile server-side check for the website lead form.
 *
 * OPTIONAL by design (spec D2): the form has to work the moment it is
 * pasted into WordPress, before anyone has created a Turnstile widget. So
 * `routes/leadIntake.ts` calls this only when the Worker has a
 * `TURNSTILE_SECRET` secret. Once it does, every submission needs a valid
 * token, and the embed must then carry the matching `data-sitekey`, or the
 * form gets 403s.
 */

/** Cloudflare's siteverify endpoint. */
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Asks Cloudflare whether `token` is a valid, unused Turnstile token for
 * this secret. Returns false, and never throws, on an empty token, a
 * network error or a non-JSON reply. If siteverify is unreachable, the
 * visitor sees "Verification failed" and can try again or phone. That is
 * the safer failure while the check is switched on.
 *
 * @param secret - the widget's secret key (Worker secret `TURNSTILE_SECRET`)
 * @param token - the `turnstile_token` the form posted
 * @param ip - the visitor's IP (`CF-Connecting-IP`), sent as `remoteip` when known
 */
export async function verifyTurnstile(secret: string, token: string, ip?: string): Promise<boolean> {
  if (!token) return false;
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  try {
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body });
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch (e) {
    console.error('Turnstile siteverify failed:', e);
    return false;
  }
}
