// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Opens an authenticated, read-only IMAP session to the Titan mailbox.
 *
 * The ONLY inbox module that imports `cloudflare:sockets`, which exists
 * only inside workerd; every other inbox module stays importable by
 * vitest in Node. Connects with implicit TLS (port 993), checks the
 * greeting, logs in with SASL PLAIN, and hands back a `MailSource`.
 * Verified by a spike against imap.titan.email on 2026-10-21.
 */

import { connect } from 'cloudflare:sockets';
import { ImapClient } from './imapClient';
import { createMailSource } from './mailSource';
import type { MailSource } from './types';

/** Connection settings; `password` comes from a Worker secret only. */
export interface TitanConfig {
  host: string;
  port: number;
  user: string;
  password: string;
}

/**
 * Connects and logs in. On any failure the socket is closed before the
 * error propagates, so a bad password never leaks a connection.
 */
export async function openTitanSource(cfg: TitanConfig): Promise<MailSource> {
  const socket = connect({ hostname: cfg.host, port: cfg.port }, { secureTransport: 'on', allowHalfOpen: false });
  try {
    const client = await ImapClient.open(socket.readable, socket.writable);
    await client.authenticatePlain(cfg.user, cfg.password);
    return createMailSource(client, () => socket.close());
  } catch (error) {
    await socket.close().catch(() => undefined);
    throw error;
  }
}
