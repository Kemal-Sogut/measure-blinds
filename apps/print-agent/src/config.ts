// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Agent configuration, read from the process environment.
 *
 * The agent runs unattended on a shop PC as a scheduled task, so every
 * value is validated at startup and a bad one throws immediately. A
 * misconfigured agent that starts successfully and then fails silently
 * at print time is the worst outcome available here.
 */

/** Validated settings the agent runs on. */
export interface AgentConfig {
  /** Worker origin with no trailing slash, e.g. https://api.example.dev */
  apiBaseUrl: string;
  /** Shared bearer secret matching the Worker's PRINT_AGENT_SECRET. */
  secret: string;
  /** `COM<n>` for a serial/Bluetooth port, else a Windows printer share. */
  printerTarget: string;
  /** Milliseconds between polls; the Worker expects roughly 30s. */
  pollMs: number;
}

/** Variables with no sensible default — the agent cannot run without them. */
const REQUIRED = ['API_BASE_URL', 'PRINT_AGENT_SECRET', 'PRINTER_TARGET'] as const;

/** Floor on the poll interval, so a typo cannot turn the agent into a flood. */
const MIN_POLL_MS = 1000;

/**
 * Validates the environment and returns the agent's settings.
 *
 * @param env Usually `process.env`; injected so tests need no globals.
 * @throws Error naming every missing variable at once, so a fresh
 *         install is fixed in one pass rather than one restart per typo.
 */
export function loadConfig(env: NodeJS.ProcessEnv): AgentConfig {
  const missing = REQUIRED.filter((key) => !env[key]?.trim());
  if (missing.length) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  const pollMs = Number(env.POLL_MS ?? 30000);
  if (!Number.isFinite(pollMs) || pollMs < MIN_POLL_MS) {
    throw new Error(`POLL_MS must be a number of milliseconds >= ${MIN_POLL_MS}.`);
  }

  return {
    apiBaseUrl: env.API_BASE_URL!.trim().replace(/\/+$/, ''),
    secret: env.PRINT_AGENT_SECRET!.trim(),
    printerTarget: env.PRINTER_TARGET!.trim(),
    pollMs,
  };
}
