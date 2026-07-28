// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Byte delivery to the label printer.
 *
 * The payload is already a complete TSPL command stream rendered by the
 * Worker, so this module never interprets it — it is a pipe. That is
 * deliberate: no printer driver participates in layout, which is why
 * the output is identical regardless of how the printer was installed.
 *
 * TWO STRATEGIES, chosen from the shape of the target:
 *   - `COM<n>` writes straight to `\\.\COM<n>`. That is the Bluetooth
 *     SPP outgoing port Windows creates when the 2410BT is paired, or a
 *     USB serial port. No driver involved at all.
 *   - anything else is a Windows printer share (e.g.
 *     `\\localhost\LabelCreate`), reached with `copy /b`, which passes
 *     the bytes through the spooler with RAW datatype and so bypasses
 *     driver page layout.
 *
 * Both ship because which one works is settled against the physical
 * printer at install time, not from a development machine.
 */

import { execFile } from 'node:child_process';
import { open, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** How the bytes reach the printer. */
export type PrintStrategy = 'serial' | 'spooler';

/**
 * Picks a strategy from the target string. The pattern is anchored and
 * digits-only so a share named "COMPANY-LABELS" is not mistaken for a
 * serial port.
 */
export function strategyFor(target: string): PrintStrategy {
  return /^COM\d+$/i.test(target) ? 'serial' : 'spooler';
}

/**
 * Writes a rendered TSPL stream to the printer.
 *
 * Encoded as latin1 rather than utf8: TSPL bitmap fonts are byte-
 * oriented, and the Worker has already folded the text to ASCII, so
 * one character must produce exactly one byte.
 *
 * @param target  `PRINTER_TARGET` from the config.
 * @param payload The complete TSPL command stream for one job.
 * @throws Error when the port cannot be opened or `copy` fails, which
 *         the caller reports back to the API as a failed job.
 */
export async function sendToPrinter(target: string, payload: string): Promise<void> {
  const bytes = Buffer.from(payload, 'latin1');

  if (strategyFor(target) === 'serial') {
    const handle = await open(`\\\\.\\${target.toUpperCase()}`, 'w');
    try {
      await handle.write(bytes);
    } finally {
      await handle.close();
    }
    return;
  }

  const file = join(tmpdir(), `label-${randomUUID()}.prn`);
  await writeFile(file, bytes);
  try {
    await run('cmd', ['/c', 'copy', '/b', file, target]);
  } finally {
    // Best-effort cleanup: a leftover temp file must never fail a print.
    await unlink(file).catch(() => {});
  }
}
