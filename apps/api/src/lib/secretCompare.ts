// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Constant-time comparison for shared secrets (`routes/webhook.ts`).
 *
 * A plain `a === b` returns as soon as two characters differ, which in
 * principle lets a caller learn a secret one character at a time from
 * response timing. Both inputs are hashed first, so the loop always
 * compares 32 bytes whatever the inputs' lengths, and every byte is
 * visited regardless of where the first difference is. Uses Web Crypto
 * only, so it runs unchanged in workerd and in the Node test runner.
 */

/**
 * Compares two shared-secret strings in time that does not depend on
 * where they first differ; use it wherever a caller-supplied credential
 * is checked against a configured secret (the e-Transfer webhook's
 * bearer token). Callers must still refuse an unset or empty secret
 * before comparing.
 *
 * @param a One secret (for example the received `Authorization` header).
 * @param b The other (the expected value).
 * @returns True only when the two strings are identical.
 */
export async function secretsMatch(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);
  let difference = 0;
  for (let i = 0; i < bytesA.length; i++) difference |= bytesA[i] ^ bytesB[i];
  return difference === 0;
}
