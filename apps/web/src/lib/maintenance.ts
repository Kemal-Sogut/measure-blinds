// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Recognises the Worker's maintenance-mode refusal on the public,
 * token'd customer pages.
 *
 * While staff have maintenance mode on (migration 40), every
 * `/public/*` route answers `503 { error, maintenance: true, message }`.
 * Without this check the customer pages would show that message inside
 * their "Order not found" card — telling someone their order is gone
 * when the shop is merely closed for an hour. Both public pages call
 * this on every response, load and action alike, so a switch flipped
 * mid-session lands as a maintenance card rather than an error.
 *
 * Both conditions are required: the status AND the explicit flag. A 503
 * from a proxy or a cold Worker is an outage, not a maintenance window,
 * and must keep falling through to the ordinary error path.
 *
 * @param res - The fetch Response for a `/public/*` request
 * @param body - Its parsed JSON body, or null when it had none
 * @returns The message to show the customer, or null when this is not a
 *          maintenance refusal. Never returns an empty string: a Worker
 *          that somehow sent one still yields readable wording.
 */
export function maintenanceMessage(res: Response, body: unknown): string | null {
  if (res.status !== 503) return null;
  const payload = body as { maintenance?: boolean; message?: string } | null;
  if (!payload?.maintenance) return null;
  return (
    payload.message?.trim() ||
    'We are briefly offline for maintenance. Please check back shortly.'
  );
}
