// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Blinds Nisa — e-Transfer ingester (Google Apps Script, V8 runtime).
 *
 * Runs on a Gmail time-trigger. For every thread labelled
 * "ToProcess-ETransfer" it checks that each message really is an Interac
 * deposit notification sent to the shop, POSTs it to the Worker webhook,
 * then moves the thread to "Processed-ETransfer".
 *
 * WHAT IT CHECKS. The Worker records a payment — and can start
 * production — on the strength of this script's word, so a label alone
 * is not enough. Every message must pass all of these, read from the
 * message's raw RFC 822 source:
 *   - exactly one From, To and Subject header;
 *   - From is a single mailbox that is one of Interac's notification
 *     addresses;
 *   - Gmail's own (topmost mx.google.com) Authentication-Results reports
 *     dkim=pass for INTERAC_DKIM_DOMAIN and dmarc=pass with header.from
 *     equal to that domain;
 *   - every Interac DKIM-Signature covers From, To and Subject and does
 *     not limit the signed body length (no l= tag);
 *   - To is a single mailbox equal to the SHOP_ADDRESS Script Property;
 *   - the subject announces money received (not a request, reminder,
 *     cancellation, expiry or a transfer the shop sent);
 *   - the amount is a finite number above zero.
 * A message that fails any check is NOT posted, and its thread is moved
 * to "NeedsReview-ETransfer" for a person to look at. Messages in that
 * same thread that passed every check ARE still posted; the execution
 * log names exactly which message ids the Worker recorded and which ones
 * need a person, so nothing is recorded twice by hand.
 *
 * EVERY message in a thread is processed, not just the newest: Gmail can
 * thread two notifications with the same subject together (same sender,
 * same amount, minutes apart — common when a bank's per-transfer limit
 * splits a deposit in two). The Worker stores the Gmail message id
 * UNIQUE and ignores duplicates, so re-posting a message is harmless.
 *
 * RETRIES. A thread keeps its "ToProcess" label only when the Worker
 * could not be reached or answered 401/429/5xx, or when reading the
 * thread threw — conditions a later run can fix. A 400 means the payload
 * itself is unacceptable and will never succeed, so that message is
 * handled like a failed check. Each run holds a script lock (overlapping
 * trigger runs exit at once) and stops starting new threads after
 * RUN_BUDGET_MS, well inside Apps Script's 6-minute limit.
 *
 * INSTALL (owner, in the Apps Script editor):
 *   1. Project Settings -> Script Properties:
 *        SECRET_KEY   = the Worker's ETRANSFER_WEBHOOK_SECRET
 *        SHOP_ADDRESS = the email address Interac deposits are sent to
 *      Neither value is ever written in this file. If either is missing
 *      the script logs why and does nothing.
 *   2. Run selfTest; every line in the log must start with PASS.
 *   3. With a real Interac deposit email under one of the three labels,
 *      run logAuthHeadersForReview. Confirm the DKIM-Signature shows
 *      d=payments.interac.ca and an h= list containing from, to and
 *      subject; that Gmail's Authentication-Results shows dkim=pass for
 *      that domain and dmarc=pass header.from=payments.interac.ca; and
 *      that the last line says "passes every check". If Interac signs
 *      with a different domain, change INTERAC_DKIM_DOMAIN to exactly
 *      that value and re-run steps 2-3.
 *   4. Gmail filter: from:(notify@payments.interac.ca OR
 *      catch@payments.interac.ca) -> apply label "ToProcess-ETransfer".
 *      Do NOT tick "Never send it to Spam".
 *   5. Add a time-driven trigger for processETransfers (e.g. every 5 min).
 */

/**
 * The Worker's e-Transfer webhook (apps/api/src/routes/webhook.ts). It
 * authenticates the bearer SECRET_KEY, answers 2xx for anything it has
 * stored (including duplicates), 400 for a payload it will never accept,
 * and 401/5xx for conditions a retry can fix. Not a secret.
 */
const CLOUDFLARE_ENDPOINT = 'https://blinds-nisa-api.blindsnisa.workers.dev/webhooks/etransfer';

/** Addresses Interac sends deposit notifications from (lower case). */
const INTERAC_SENDERS = ['notify@payments.interac.ca', 'catch@payments.interac.ca'];

/**
 * The one domain Interac's DKIM signature, Gmail's dkim=pass and Gmail's
 * dmarc=pass header.from must all name exactly. The single value to edit
 * if a real email shows a different signing domain (see INSTALL step 3).
 */
const INTERAC_DKIM_DOMAIN = 'payments.interac.ca';

/** authserv-id Gmail writes into the Authentication-Results it adds. */
const GMAIL_AUTHSERV_ID = 'mx.google.com';

/** Headers Interac's signature must cover and that must appear once. */
const REQUIRED_SIGNED_HEADERS = ['from', 'to', 'subject'];

/** Stop starting new threads after this long (Apps Script stops at 6 min). */
const RUN_BUDGET_MS = 5 * 60 * 1000;

/**
 * Input label, applied by the owner's Gmail filter. A thread leaves it
 * only when every message was posted or judged; it stays for a retry.
 */
const LABEL_PENDING = 'ToProcess-ETransfer';
/** Every message in the thread passed every check and the Worker stored it. */
const LABEL_DONE = 'Processed-ETransfer';
/**
 * At least one message failed a check or was refused by the Worker; a
 * person must look. The log lists which messages were already posted.
 */
const LABEL_REVIEW = 'NeedsReview-ETransfer';

/**
 * Removes RFC 5322 comments `( … )` (nested) and quoted strings `" … "`,
 * honouring backslash escapes, leaving a space where each was. Returns
 * null when a quote or parenthesis is unbalanced, so callers fail closed.
 */
function stripCommentsAndQuotes(text) {
  const s = String(text == null ? '' : text);
  let out = '';
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (quoted || depth > 0) {
      if (ch === '\\') i++;
      else if (quoted && ch === '"') quoted = false;
      else if (!quoted && ch === '(') depth++;
      else if (!quoted && ch === ')') depth--;
      if (!quoted && depth === 0) out += ' ';
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === '(') depth = 1;
    else if (ch === ')') return null;
    else out += ch;
  }
  return quoted || depth > 0 ? null : out;
}

/**
 * Splits a raw RFC 822 message into its header fields, top first, with
 * continuation lines unfolded. Names are lower-cased; values keep their
 * text. Only the header block (up to the first blank line) is read.
 */
function headerFields(raw) {
  const text = String(raw || '');
  const end = text.search(/\r?\n\r?\n/);
  const block = end === -1 ? text : text.slice(0, end);
  const fields = [];
  block.split(/\r?\n/).forEach(function (line) {
    if (/^[ \t]/.test(line)) {
      if (fields.length) fields[fields.length - 1].value += line;
      return;
    }
    const colon = line.indexOf(':');
    // A malformed line still starts a (nameless) field, so the lines
    // that follow it are never glued onto the previous real header.
    if (colon <= 0) fields.push({ name: '', value: line });
    else fields.push({ name: line.slice(0, colon).trim().toLowerCase(), value: line.slice(colon + 1).replace(/^[ \t]+/, '') });
  });
  return fields;
}

/** Every value of the named header in the raw message, top first. */
function headerValues(raw, name) {
  const wanted = String(name).toLowerCase();
  return headerFields(raw)
    .filter(function (field) { return field.name === wanted; })
    .map(function (field) { return field.value; });
}

/**
 * The bare, lower-cased address of a header that must hold exactly ONE
 * mailbox (`Name <a@b>`, `"Name" <a@b>` or `a@b`), or null. Rejected:
 * a list of mailboxes or a group (`,` or `;` outside quotes), more than
 * one angle-address, an `@` or `:` in the display name, and anything
 * that is not a plain address. Quoted display names may contain any text.
 */
function mailboxAddress(text) {
  const s = stripCommentsAndQuotes(text);
  if (s === null || /[,;]/.test(s)) return null;
  const opens = s.split('<').length - 1;
  const closes = s.split('>').length - 1;
  let address;
  if (opens === 0 && closes === 0) {
    address = s.trim();
  } else {
    if (opens !== 1 || closes !== 1) return null;
    const match = s.match(/^([^<>]*)<([^<>]*)>\s*$/);
    if (!match || /[@:]/.test(match[1])) return null;
    address = match[2].trim();
  }
  address = address.toLowerCase();
  return /^[^\s@<>()[\]\\",:;]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(address) ? address : null;
}

/** True when the From header is a single mailbox at one of INTERAC_SENDERS. */
function isInteracSender(from) {
  const address = mailboxAddress(from);
  return address !== null && INTERAC_SENDERS.indexOf(address) !== -1;
}

/**
 * True when the To header is a single mailbox equal to the shop's
 * address, compared case-insensitively on the address part only.
 */
function isShopRecipient(to, shopAddress) {
  const address = mailboxAddress(to);
  const shop = mailboxAddress(shopAddress);
  return address !== null && shop !== null && address === shop;
}

/**
 * Parses one Authentication-Results value (RFC 8601) after removing
 * comments and quoted strings: `{ authservId, clauses: [{ method,
 * result, props }] }`, all lower case, or null when it is unbalanced.
 * A clause with a repeated property or a bare word is dropped, so it can
 * never count as a pass.
 */
function parseAuthResults(value) {
  const text = stripCommentsAndQuotes(value);
  if (text === null) return null;
  const parts = text.toLowerCase().split(';');
  const authservId = parts[0].trim().split(/\s+/)[0];
  if (!authservId) return null;
  const clauses = [];
  for (let i = 1; i < parts.length; i++) {
    const tokens = parts[i].replace(/\s*=\s*/g, '=').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const head = tokens[0].split('=');
    if (head.length !== 2 || !head[0] || !head[1]) continue;
    const props = Object.create(null);
    let valid = true;
    for (let t = 1; t < tokens.length && valid; t++) {
      const eq = tokens[t].indexOf('=');
      const key = eq > 0 ? tokens[t].slice(0, eq) : '';
      if (!key || key in props) valid = false;
      else props[key] = tokens[t].slice(eq + 1);
    }
    if (valid) clauses.push({ method: head[0].split('/')[0], result: head[1], props: props });
  }
  return { authservId: authservId, clauses: clauses };
}

/** The signing domain a dkim clause names: header.d, else header.i's domain. */
function dkimClauseDomain(props) {
  if (props['header.d'] !== undefined) return props['header.d'];
  const identity = props['header.i'];
  if (identity === undefined || identity.indexOf('@') === -1) return null;
  return identity.slice(identity.lastIndexOf('@') + 1);
}

/**
 * Gmail's verdict, read strictly. `values` are the message's
 * Authentication-Results headers, top first. Only the TOPMOST one whose
 * authserv-id is mx.google.com counts (Gmail prepends its own; any lower
 * one came with the message). It must hold a dkim=pass clause for
 * exactly INTERAC_DKIM_DOMAIN and a dmarc=pass clause whose header.from
 * is exactly that domain. Anything unreadable on the way fails.
 */
function passesGmailVerdict(values) {
  const list = values || [];
  for (let i = 0; i < list.length; i++) {
    const parsed = parseAuthResults(list[i]);
    if (!parsed) return false;
    if (parsed.authservId !== GMAIL_AUTHSERV_ID) continue;
    let dkim = false;
    let dmarc = false;
    parsed.clauses.forEach(function (clause) {
      if (clause.result !== 'pass') return;
      if (clause.method === 'dkim' && dkimClauseDomain(clause.props) === INTERAC_DKIM_DOMAIN) dkim = true;
      if (clause.method === 'dmarc' && clause.props['header.from'] === INTERAC_DKIM_DOMAIN) dmarc = true;
    });
    return dkim && dmarc;
  }
  return false;
}

/**
 * Parses a DKIM-Signature tag-list (RFC 6376) into `{ tag: value }` with
 * whitespace removed from values, or null when malformed (a part without
 * `=`, or a repeated tag — which RFC 6376 makes a failed signature).
 */
function dkimTags(value) {
  const tags = Object.create(null);
  const parts = String(value || '').split(';');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].replace(/\s+/g, '');
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq <= 0) return null;
    const name = part.slice(0, eq).toLowerCase();
    if (name in tags) return null;
    tags[name] = part.slice(eq + 1);
  }
  return tags;
}

/**
 * True when at least one DKIM-Signature has d= INTERAC_DKIM_DOMAIN and
 * EVERY such signature lists From, To and Subject in h= and has no l=
 * (body length limit). Binds the recipient, sender and amount to what
 * Interac signed. Any unreadable DKIM-Signature fails the check.
 */
function interacSignaturesCover(values) {
  const list = values || [];
  let found = 0;
  for (let i = 0; i < list.length; i++) {
    const tags = dkimTags(list[i]);
    if (!tags) return false;
    if (String(tags.d || '').toLowerCase() !== INTERAC_DKIM_DOMAIN) continue;
    found++;
    if (tags.l !== undefined) return false;
    const signed = String(tags.h || '').toLowerCase().split(':');
    for (let h = 0; h < REQUIRED_SIGNED_HEADERS.length; h++) {
      if (signed.indexOf(REQUIRED_SIGNED_HEADERS[h]) === -1) return false;
    }
  }
  return found > 0;
}

/**
 * Runs every header check on a raw RFC 822 message. Returns '' when the
 * message is an authenticated Interac email addressed to the shop, else
 * a short reason for the log.
 */
function authenticationProblem(raw, shopAddress) {
  for (let i = 0; i < REQUIRED_SIGNED_HEADERS.length; i++) {
    if (headerValues(raw, REQUIRED_SIGNED_HEADERS[i]).length !== 1) {
      return 'expected exactly one ' + REQUIRED_SIGNED_HEADERS[i] + ' header';
    }
  }
  if (!isInteracSender(headerValues(raw, 'from')[0])) return 'not from an Interac notification address';
  if (!passesGmailVerdict(headerValues(raw, 'authentication-results'))) {
    return 'Gmail did not report dkim=pass and dmarc=pass for ' + INTERAC_DKIM_DOMAIN;
  }
  if (!interacSignaturesCover(headerValues(raw, 'dkim-signature'))) {
    return "Interac's signature does not cover From, To and Subject";
  }
  if (!isShopRecipient(headerValues(raw, 'to')[0], shopAddress)) return 'not addressed to SHOP_ADDRESS';
  return '';
}

/**
 * True when the subject announces money RECEIVED. Requests, reminders,
 * cancellations, expiries and transfers the shop itself sent are not
 * deposits and must never become payments. Treating "sent you money" as
 * a deposit relies on the shop's Interac Autodeposit being ON.
 */
function isDepositSubject(subject) {
  const s = String(subject || '');
  if (/request|reminder|cancel|expire|declin|couldn.t be|you sent|your transfer/i.test(s)) return false;
  return /you(?:'|’)ve received|sent you|has been (?:automatically )?deposited/i.test(s);
}

/**
 * Parses one notification into the webhook payload, or returns null when
 * no amount can be read. The amount is validated separately
 * (isPostableAmount) before anything is posted.
 */
function parseNotification(subject, body, isoDate, messageId) {
  // Amount — the subject is the reliable source; fall back to the body.
  //   "Interac e-Transfer: You've received $5.00 from Kemal and it ..."
  const amountMatch =
    subject.match(/\$([0-9,]+(?:\.[0-9]{2})?)/) || body.match(/\$([0-9,]+(?:\.[0-9]{2})?)/);
  if (!amountMatch) return null;

  // Sender name — parse the SUBJECT (never the body, which contains
  // "your account" etc. and mis-captures "you"). Fallbacks: the body's
  // "Sent From:" row, then a "NAME sent you" subject variant.
  let sender = 'Unknown';
  const senderMatch =
    subject.match(/from\s+(.+?)\s+and\b/i) ||
    body.match(/Sent From:\s*([^\n\r]+)/i) ||
    subject.match(/:\s*(.+?)\s+sent you\b/i);
  if (senderMatch && senderMatch[1].trim()) sender = senderMatch[1].trim();

  // Customer message — absent for auto-deposit / most mobile apps.
  const msgMatch = body.match(/Message:\s*(.*)/i);

  return {
    amount: parseFloat(amountMatch[1].replace(/,/g, '')),
    sender: sender.slice(0, 200),
    reference_message: (msgMatch ? msgMatch[1].trim() : '').slice(0, 2000),
    timestamp: isoDate,
    message_id: messageId, // dedupe key
    raw_snippet: body.slice(0, 1000), // context for manual review
  };
}

/** True when an amount may be posted: a finite number above zero. */
function isPostableAmount(amount) {
  return typeof amount === 'number' && isFinite(amount) && amount > 0;
}

/**
 * Reads SECRET_KEY and SHOP_ADDRESS from Script Properties. Returns
 * `{ secret, shopAddress }`, or null (after logging which one is wrong)
 * so callers do nothing — the script fails closed without them.
 */
function readConfig() {
  const props = PropertiesService.getScriptProperties();
  const secret = String(props.getProperty('SECRET_KEY') || '').trim();
  const shopAddress = mailboxAddress(props.getProperty('SHOP_ADDRESS'));
  if (!secret) {
    Logger.log('Script Property SECRET_KEY is not set; nothing was processed.');
    return null;
  }
  if (!shopAddress) {
    Logger.log('Script Property SHOP_ADDRESS is missing or not one email address; nothing was processed.');
    return null;
  }
  return { secret: secret, shopAddress: shopAddress };
}

/**
 * Sends one payload to the Worker.
 * @returns {'ok'|'retry'|'reject'} ok = stored (2xx, includes duplicates);
 *   retry = try again next run; reject = the Worker will never accept it.
 */
function postToWorker(payload, secret) {
  let response;
  try {
    response = UrlFetchApp.fetch(CLOUDFLARE_ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + secret },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
  } catch (error) {
    Logger.log('Webhook unreachable for ' + payload.message_id + ': ' + error);
    return 'retry';
  }
  const code = response.getResponseCode();
  if (code >= 200 && code < 300) return 'ok';
  Logger.log('Webhook answered ' + code + ' for ' + payload.message_id + ': ' + response.getContentText().slice(0, 200));
  return code === 400 || code === 413 || code === 422 ? 'reject' : 'retry';
}

/** Returns the named label, creating it when missing. */
function ensureLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/**
 * Applies every check to one Gmail message. Returns `{ payload }` when it
 * may be posted, else `{ review: reason }`. Never posts.
 */
function examineMessage(message, shopAddress) {
  const problem = authenticationProblem(message.getRawContent(), shopAddress);
  if (problem) return { review: problem };
  const subject = message.getSubject() || '';
  if (!isDepositSubject(subject)) return { review: 'not a deposit notification' };
  const payload = parseNotification(subject, message.getPlainBody() || '', message.getDate().toISOString(), message.getId());
  if (!payload) return { review: 'no amount found' };
  if (!isPostableAmount(payload.amount)) return { review: 'amount is not a positive number' };
  return { payload: payload };
}

/**
 * Processes every message of one thread and moves the thread: kept in
 * ToProcess on a retryable webhook failure, else Processed when every
 * message was posted, else NeedsReview — logging which message ids the
 * Worker already recorded and which need a person.
 */
function processThread(thread, labels, config) {
  const messages = thread.getMessages();
  const posted = [];
  const held = [];
  const retrying = [];

  for (let m = 0; m < messages.length; m++) {
    const message = messages[m];
    const verdict = examineMessage(message, config.shopAddress);
    if (verdict.review) {
      held.push(message.getId() + ' (' + verdict.review + ')');
      continue;
    }
    const outcome = postToWorker(verdict.payload, config.secret);
    if (outcome === 'ok') posted.push(message.getId());
    else if (outcome === 'retry') retrying.push(message.getId());
    else held.push(message.getId() + ' (webhook refused the payload)');
  }

  const summary =
    'already recorded by the Worker, do NOT record by hand: [' + posted.join(', ') + ']; ' +
    'needs a person: [' + held.join(', ') + ']';
  // A retry outranks everything: the thread keeps its label and every
  // message is offered again next run (the Worker ignores the ones it
  // already has).
  if (retrying.length) {
    Logger.log('Thread ' + thread.getId() + ' kept for retry of [' + retrying.join(', ') + ']; ' + summary);
    return;
  }
  if (held.length) {
    thread.addLabel(labels.review);
    Logger.log('Thread ' + thread.getId() + ' -> ' + LABEL_REVIEW + '; ' + summary);
  } else {
    thread.addLabel(labels.done);
  }
  thread.removeLabel(labels.pending);
}

/**
 * Trigger entry point. Reads the Script Properties (does nothing without
 * them), takes the script lock (exits if another run holds it), then
 * processes "ToProcess-ETransfer" threads one by one until the list or
 * RUN_BUDGET_MS runs out. A thread that throws is logged and left in
 * ToProcess for the next run; the others carry on.
 */
function processETransfers() {
  const config = readConfig();
  if (!config) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    Logger.log('Another run is still in progress; this one exits.');
    return;
  }
  try {
    const pendingLabel = GmailApp.getUserLabelByName(LABEL_PENDING);
    if (!pendingLabel) return;
    const labels = { pending: pendingLabel, done: ensureLabel(LABEL_DONE), review: ensureLabel(LABEL_REVIEW) };
    const startedAt = Date.now();
    const threads = pendingLabel.getThreads();
    for (let i = 0; i < threads.length; i++) {
      if (Date.now() - startedAt > RUN_BUDGET_MS) {
        Logger.log('Time budget reached; ' + (threads.length - i) + ' thread(s) left for the next run.');
        break;
      }
      try {
        processThread(threads[i], labels, config);
      } catch (error) {
        Logger.log('Thread ' + threads[i].getId() + ' failed and stays in ' + LABEL_PENDING + ': ' + error);
      }
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * Editor-only install aid: logs the authentication headers of the newest
 * message under ToProcess (else NeedsReview, else Processed) — every
 * Authentication-Results (top first), each DKIM-Signature's d= and h=,
 * From, To and Delivered-To — and the script's verdict. Logs only; never
 * posts or relabels.
 */
function logAuthHeadersForReview() {
  const names = [LABEL_PENDING, LABEL_REVIEW, LABEL_DONE];
  let message = null;
  for (let i = 0; i < names.length && !message; i++) {
    const label = GmailApp.getUserLabelByName(names[i]);
    const threads = label ? label.getThreads(0, 1) : [];
    if (threads.length) {
      const messages = threads[0].getMessages();
      message = messages[messages.length - 1];
      Logger.log('Newest message under ' + names[i] + ': ' + message.getId() + ' — ' + message.getSubject());
    }
  }
  if (!message) {
    Logger.log('No message under ' + names.join(', ') + '. Label a real Interac deposit email first.');
    return;
  }
  const raw = message.getRawContent();
  headerValues(raw, 'authentication-results').forEach(function (value, i) {
    Logger.log('Authentication-Results #' + (i + 1) + ' (top first): ' + value);
  });
  headerValues(raw, 'dkim-signature').forEach(function (value) {
    const tags = dkimTags(value);
    Logger.log(tags ? 'DKIM-Signature d=' + tags.d + ' h=' + tags.h + (tags.l !== undefined ? ' l=' + tags.l : '') : 'DKIM-Signature (unreadable)');
  });
  ['from', 'to', 'delivered-to'].forEach(function (name) {
    headerValues(raw, name).forEach(function (value) { Logger.log(name + ': ' + value); });
  });
  const config = readConfig();
  if (config) Logger.log('Verdict: ' + (authenticationProblem(raw, config.shopAddress) || 'passes every check'));
}

/**
 * Editor-run check of the pure functions above. Run it after pasting the
 * script and after any edit; every line must say PASS. Returns the
 * number of failures. Uses example.com/example.net addresses only.
 */
function selfTest() {
  let failures = 0;
  const check = function (name, actual, expected) {
    if (actual !== expected) failures++;
    Logger.log((actual === expected ? 'PASS  ' : 'FAIL  ') + name + (actual === expected ? '' : '  got ' + actual));
  };
  const D = INTERAC_DKIM_DOMAIN;
  const SHOP = 'shop@example.com';

  // From parsing
  check('from: display name form', isInteracSender('Interac e-Transfer <notify@' + D + '>'), true);
  check('from: quoted display name', isInteracSender('"INTERAC e-Transfer" <notify@' + D + '>'), true);
  check('from: bare address', isInteracSender('notify@' + D), true);
  check('from: Interac address in name, other address', isInteracSender('Interac <notify@' + D + '> <someone@example.net>'), false);
  check('from: quoted Interac address, other address', isInteracSender('"<notify@' + D + '>" <someone@example.net>'), false);
  check('from: unquoted @ in display name', mailboxAddress('notify@' + D + ' <someone@example.net>'), null);
  check('from: several mailboxes', mailboxAddress('notify@' + D + ', someone@example.net'), null);
  check('from: group syntax', mailboxAddress('List: notify@' + D + ';'), null);
  check('from: look-alike domain', isInteracSender('Interac <notify@' + D + '.evil.example>'), false);
  check('from: other sender', isInteracSender('Someone <someone@example.net>'), false);
  check('from: unbalanced quote', mailboxAddress('"Interac <notify@' + D + '>'), null);

  // Recipient match
  check('to: case-insensitive', isShopRecipient('SHOP@Example.COM', SHOP), true);
  check('to: display name and angle brackets', isShopRecipient('Blinds Nisa <Shop@example.com>', SHOP), true);
  check('to: quoted name with comma', isShopRecipient('"Nisa, Blinds" <shop@example.com>', SHOP), true);
  check('to: another address', isShopRecipient('someone@example.net', SHOP), false);
  check('to: shop address only in display name', isShopRecipient('"shop@example.com" <someone@example.net>', SHOP), false);
  check('to: several recipients', isShopRecipient('shop@example.com, someone@example.net', SHOP), false);
  check('to: shop address not configured', isShopRecipient('shop@example.com', null), false);

  // Gmail's Authentication-Results
  const DMARC = 'dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=' + D;
  const good = 'mx.google.com; dkim=pass header.i=@' + D + ' header.s=s1 header.b=AbCd1234; ' +
    'spf=pass (google.com: domain of notify@' + D + ' designates 192.0.2.1 as permitted sender) smtp.mailfrom=notify@' + D + '; ' + DMARC;
  check('auth: Gmail header, header.i form', passesGmailVerdict([good]), true);
  check('auth: Gmail header, header.d form', passesGmailVerdict(['mx.google.com; dkim=pass header.d=' + D + '; ' + DMARC]), true);
  check('auth: pass only inside a comment', passesGmailVerdict(['mx.google.com; dkim=fail (dkim=pass header.i=@' + D + ') header.i=@evil.example; ' + DMARC]), false);
  check('auth: pass only inside a quoted string', passesGmailVerdict(['mx.google.com; dkim=neutral reason="x; dkim=pass header.d=' + D + '"; ' + DMARC]), false);
  check('auth: semicolon inside a comment', passesGmailVerdict(['mx.google.com; spf=pass (x; dkim=pass header.d=' + D + ') smtp.mailfrom=a@b.example; ' + DMARC]), false);
  check('auth: other authserv-id', passesGmailVerdict(['mx.evil.example; dkim=pass header.d=' + D + '; ' + DMARC]), false);
  check('auth: lower Gmail header ignored', passesGmailVerdict(['mx.google.com; dkim=fail header.d=' + D + '; ' + DMARC, good]), false);
  check('auth: DKIM pass, DMARC missing', passesGmailVerdict(['mx.google.com; dkim=pass header.d=' + D]), false);
  check('auth: DMARC fail', passesGmailVerdict(['mx.google.com; dkim=pass header.d=' + D + '; dmarc=fail header.from=' + D]), false);
  check('auth: DMARC for another domain', passesGmailVerdict(['mx.google.com; dkim=pass header.d=' + D + '; dmarc=pass header.from=evil.example']), false);
  check('auth: look-alike domain', passesGmailVerdict(['mx.google.com; dkim=pass header.d=' + D + '.evil.example; dmarc=pass header.from=' + D + '.evil.example']), false);
  check('auth: subdomain is not exact', passesGmailVerdict(['mx.google.com; dkim=pass header.d=x.' + D + '; ' + DMARC]), false);
  check('auth: repeated property', passesGmailVerdict(['mx.google.com; dkim=pass header.d=evil.example header.d=' + D + '; ' + DMARC]), false);
  check('auth: unbalanced comment', passesGmailVerdict(['mx.google.com; dkim=pass header.d=' + D + ' (x; ' + DMARC]), false);
  check('auth: no header', passesGmailVerdict([]), false);

  // DKIM-Signature h=
  const sig = function (domain, h, extra) {
    return 'v=1; a=rsa-sha256; c=relaxed/relaxed; d=' + domain + '; s=s1; h=' + h + '; bh=YWJj=;' + (extra || '') + ' b=ZGVm';
  };
  check('dkim h=: covers to', interacSignaturesCover([sig(D, 'From:To:Subject:Date:Message-ID')]), true);
  check('dkim h=: folded list', interacSignaturesCover([sig(D.toUpperCase(), 'From : To :\r\n\tSubject')]), true);
  check('dkim h=: lacks to', interacSignaturesCover([sig(D, 'From:Subject:Date')]), false);
  check('dkim h=: lacks subject', interacSignaturesCover([sig(D, 'From:To:Date')]), false);
  check('dkim h=: body length limit', interacSignaturesCover([sig(D, 'From:To:Subject', ' l=100;')]), false);
  check('dkim h=: no Interac signature', interacSignaturesCover([sig('evil.example', 'From:To:Subject')]), false);
  check('dkim h=: one Interac signature lacks to', interacSignaturesCover([sig(D, 'From:To:Subject'), sig(D, 'From:Subject')]), false);
  check('dkim h=: other signer ignored', interacSignaturesCover([sig('mailer.example', 'From'), sig(D, 'From:To:Subject')]), true);
  check('dkim h=: repeated tag', interacSignaturesCover([sig(D, 'From:To:Subject', ' d=' + D + ';')]), false);

  // Whole raw message
  const rawMessage = function (lines) { return lines.join('\r\n') + '\r\n\r\nbody'; };
  const base = [
    'Delivered-To: ' + SHOP,
    'Authentication-Results: mx.google.com;',
    '       dkim=pass header.i=@' + D + ' header.s=s1 header.b=AbCd1234;',
    '       ' + DMARC,
    'DKIM-Signature: v=1; a=rsa-sha256; d=' + D + '; s=s1;',
    '\th=From:To:Subject:Date; bh=YWJj=; b=ZGVm',
    'From: "INTERAC e-Transfer" <notify@' + D + '>',
    'To: Blinds Nisa <' + SHOP + '>',
    'Subject: Interac e-Transfer: You\'ve received $5.00 from Ann Lee and it has been automatically deposited.',
  ];
  check('raw: genuine deposit to the shop', authenticationProblem(rawMessage(base), SHOP), '');
  check('raw: addressed to someone else', authenticationProblem(rawMessage(base.slice(0, 7).concat(['To: someone@example.net', base[8]])), SHOP) !== '', true);
  check('raw: second Subject header', authenticationProblem(rawMessage(['Subject: $5000.00'].concat(base)), SHOP) !== '', true);
  check('raw: second To header', authenticationProblem(rawMessage(['To: ' + SHOP].concat(base)), SHOP) !== '', true);
  check('raw: unfolded header value', headerValues(rawMessage(base), 'dkim-signature')[0].indexOf('h=From') !== -1, true);

  // Subject and payload
  check('subject: received', isDepositSubject("Interac e-Transfer: You've received $5.00 from Kemal and it has been automatically deposited."), true);
  check('subject: sent you', isDepositSubject('INTERAC e-Transfer: Ann Lee sent you money.'), true);
  check('subject: money request', isDepositSubject('INTERAC e-Transfer: Ann Lee is requesting $50.00'), false);
  check('subject: expired', isDepositSubject('INTERAC e-Transfer: The money transfer you sent has expired'), false);
  check('subject: cancelled', isDepositSubject('INTERAC e-Transfer: Your transfer to Ann Lee was cancelled'), false);
  const parsed = parseNotification(
    "Interac e-Transfer: You've received $1,250.50 from Ann Lee and it has been automatically deposited.",
    'Hi,\nMessage: T1114-126\n',
    '2026-11-14T15:00:00.000Z',
    'm1'
  );
  check('parse: amount', parsed.amount, 1250.5);
  check('parse: sender', parsed.sender, 'Ann Lee');
  check('parse: message', parsed.reference_message, 'T1114-126');
  check('parse: no amount', parseNotification('Interac e-Transfer', 'nothing here', '2026-11-14T15:00:00.000Z', 'm2'), null);
  check('amount: NaN', isPostableAmount(parseNotification('You\'ve received $, from A and', '', '', 'm3').amount), false);
  check('amount: zero', isPostableAmount(0), false);
  check('amount: negative', isPostableAmount(-5), false);
  check('amount: infinite', isPostableAmount(Infinity), false);
  check('amount: positive', isPostableAmount(12.5), true);

  Logger.log(failures === 0 ? 'ALL PASS' : failures + ' FAIL');
  return failures;
}
