// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Tests for agent configuration loading. The agent runs unattended on a
 * shop PC, so a misconfiguration must fail loudly at STARTUP rather
 * than silently at the first print an hour later.
 */

import { describe, it, expect } from 'vitest';
import { loadConfig } from './config';

/** A complete, valid environment. */
function env(overrides: Record<string, string | undefined> = {}) {
  return {
    API_BASE_URL: 'https://blinds-nisa-api.workers.dev/',
    PRINT_AGENT_SECRET: 'shop-floor-secret',
    PRINTER_TARGET: 'COM5',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe('loadConfig', () => {
  it('reads a complete environment and strips the trailing slash', () => {
    expect(loadConfig(env())).toEqual({
      apiBaseUrl: 'https://blinds-nisa-api.workers.dev',
      secret: 'shop-floor-secret',
      printerTarget: 'COM5',
      pollMs: 30000,
    });
  });

  it('names every missing variable in one error', () => {
    expect(() =>
      loadConfig(env({ PRINT_AGENT_SECRET: undefined, PRINTER_TARGET: undefined }))
    ).toThrow(/PRINT_AGENT_SECRET, PRINTER_TARGET/);
  });

  it('treats a blank variable as missing', () => {
    expect(() => loadConfig(env({ PRINTER_TARGET: '   ' }))).toThrow(/PRINTER_TARGET/);
  });

  it('accepts a custom poll interval', () => {
    expect(loadConfig(env({ POLL_MS: '60000' })).pollMs).toBe(60000);
  });

  it('rejects a poll interval that would hammer the API', () => {
    expect(() => loadConfig(env({ POLL_MS: '250' }))).toThrow(/POLL_MS/);
    expect(() => loadConfig(env({ POLL_MS: 'soon' }))).toThrow(/POLL_MS/);
  });
});
