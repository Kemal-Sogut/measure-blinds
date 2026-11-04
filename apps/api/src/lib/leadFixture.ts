// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Shared TEST fixture for the website lead modules: one valid payload shaped
 * exactly like what `apps/web/public/embed/lead-form.js` posts. Used by
 * `leadSchema.test.ts`, `leadCustomer.test.ts`, `leadAlerts.test.ts` and
 * `leadIntake.routes.test.ts`. Not imported by any runtime module.
 */

/** A payload shaped exactly like the embed's `payload()` output. */
export const FORM_PAYLOAD = {
  first_name: ' Jane ',
  last_name: 'Doe',
  phone: '(613) 555-0123',
  email: 'Jane.Doe@Example.com',
  street: '12 Elm St',
  unit: '',
  city: 'Ottawa',
  province: 'ON',
  postal_code: 'k1a 0b1',
  coverings: ['zebra', 'roller'],
  window_count: '5-15',
  message: 'Bay window in the living room.',
  consent: true,
  source_url: 'https://blindsnisa.com/free-estimate/',
  turnstile_token: '',
  website: '',
  fill_ms: 42_000,
};
