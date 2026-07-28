// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Shop-floor print agent — the process that lets any device print a
 * label.
 *
 * The API is a Cloudflare Worker and cannot open a connection into the
 * shop LAN, so this agent initiates everything: it polls for a claimed
 * job, writes the payload to the printer, and reports the outcome. That
 * inversion is what makes it work behind NAT with no port forwarding,
 * no tunnel, and no static address.
 *
 * FAILURE POLICY: nothing here is fatal except a bad configuration at
 * startup. A dropped Wi-Fi link, a restarted Worker, and a printer that
 * is switched off all resolve to "log it and poll again" — the queue
 * holds the job and the API re-queues anything abandoned mid-print.
 *
 * Run with: pnpm --filter print-agent build && pnpm --filter print-agent start
 */

import { loadConfig, type AgentConfig } from './config.js';
import { sendToPrinter } from './printer.js';

/** One job as handed over by GET /agent/print-jobs/next. */
interface PrintJob {
  id: string;
  payload: string;
  label_count: number;
  order_number: string;
}

/**
 * Per-request timeout for both API calls. Node's global `fetch` has its
 * own internal timeouts, but they run to minutes — against a 30s poll
 * cadence, a black-holed connection (packets accepted, never answered;
 * a real flaky-Wi-Fi failure mode, distinct from a fast ECONNREFUSED)
 * would otherwise stall a poll cycle for several minutes with no log
 * output. Must stay well under the poll interval so a stalled request
 * cannot overlap the next cycle.
 */
const FETCH_TIMEOUT_MS = 10_000;

/** Timestamped line so a scheduled-task log is readable after the fact. */
function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

/** Claims the next job, or null when the queue is empty. */
async function claimJob(config: AgentConfig): Promise<PrintJob | null> {
  const res = await fetch(`${config.apiBaseUrl}/agent/print-jobs/next`, {
    headers: { Authorization: `Bearer ${config.secret}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Claim failed: HTTP ${res.status}`);
  const body = (await res.json()) as { data: PrintJob };
  return body.data;
}

/** Reports a job's outcome. Never throws — a lost report is re-queued. */
async function reportResult(
  config: AgentConfig,
  jobId: string,
  ok: boolean,
  error?: string
): Promise<void> {
  try {
    const res = await fetch(`${config.apiBaseUrl}/agent/print-jobs/${jobId}/result`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(ok ? { ok } : { ok, error }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      log(`Reporting job ${jobId} was rejected: HTTP ${res.status}`);
    }
  } catch (err) {
    log(`Could not report job ${jobId}: ${String(err)}`);
  }
}

/** Claims and prints at most one job. Returns true when one was found. */
async function tick(config: AgentConfig): Promise<boolean> {
  const job = await claimJob(config);
  if (!job) return false;

  log(`Printing ${job.label_count} label(s) for ${job.order_number}.`);
  try {
    await sendToPrinter(config.printerTarget, job.payload);
    await reportResult(config, job.id, true);
    log(`Job ${job.id} done.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await reportResult(config, job.id, false, message);
    log(`Job ${job.id} FAILED: ${message}`);
  }
  return true;
}

/** Sleeps without pinning the event loop to a busy wait. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls forever. A found job is followed by an immediate re-poll so a
 * queued batch drains at once instead of one label per interval.
 */
async function main(): Promise<void> {
  const config = loadConfig(process.env);
  log(`Agent started. Target ${config.printerTarget}, polling every ${config.pollMs}ms.`);

  for (;;) {
    try {
      const printed = await tick(config);
      if (printed) continue;
    } catch (err) {
      log(`Poll failed, will retry: ${String(err)}`);
    }
    await sleep(config.pollMs);
  }
}

void main();
