// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Blinds Nisa — e-Transfer ingester (Google Apps Script).
 *
 * Runs on a Gmail time-trigger. For every thread labelled
 * "ToProcess-ETransfer" it checks that each message really is an Interac
 * "money received" notification, POSTs it to the Worker webhook, then
 * moves the thread to "Processed-ETransfer".
 *
 * WHAT IT REFUSES, and why. The Worker records a payment — and can start
 * production — on the strength of this script's word, so a label alone
 * is not enough:
 *   - a message not sent by Interac's notification address;
 *   - a message Gmail did not authenticate as coming from that domain
 *     (DKIM), which is what stops a forged "From";
 *   - an Interac email that is not a deposit (a money request, a
 *     reminder, a cancelled or expired transfer, a transfer YOU sent).
 * A refused thread is moved to "NeedsReview-ETransfer" for a person to
 * look at; nothing is sent to the Worker for it.
 *
 * EVERY message in a thread is processed, not just the newest: Gmail can
 * thread two notifications with the same subject together (same sender,
 * same amount, minutes apart — common when a bank's per-transfer limit
 * splits a deposit in two). The Worker stores the Gmail message id
 * UNIQUE and ignores duplicates, so re-posting a message is harmless.
 *
 * RETRIES. A thread keeps its "ToProcess" label only when the Worker
 * could not be reached or answered 401/429/5xx — conditions a later run
 * can fix. A 400 means the payload itself is unacceptable and will never
 * succeed, so that thread goes to "NeedsReview" instead of being retried
 * every few minutes forever.
 *
 * SETUP:
 *   1. CLOUDFLARE_ENDPOINT  -> your API Worker URL below.
 *   2. SECRET_KEY           -> must equal the Worker's
 *      ETRANSFER_WEBHOOK_SECRET (wrangler secret put ETRANSFER_WEBHOOK_SECRET).
 *   3. Gmail filter: From `notify@payments.interac.ca` -> apply label
 *      "ToProcess-ETransfer". Do NOT tick "Never send it to Spam".
 *   4. Add a time-driven trigger for processETransfers (e.g. every 5 min).
 *   5. Run selfTest() once from the editor; every line must say PASS.
 */

const CLOUDFLARE_ENDPOINT = 'https://blinds-nisa-api.blindsnisa.workers.dev/webhooks/etransfer';
const SECRET_KEY = 'YOUR_SUPER_SECRET_KEY'; // === Worker ETRANSFER_WEBHOOK_SECRET

/** Addresses Interac sends deposit notifications from (lower case). */
const INTERAC_SENDERS = ['notify@payments.interac.ca', 'catch@payments.interac.ca'];

/** The domain Gmail must report a passing DKIM signature for. */
const INTERAC_DKIM_DOMAIN = 'payments.interac.ca';

const LABEL_PENDING = 'ToProcess-ETransfer';
const LABEL_DONE = 'Processed-ETransfer';
const LABEL_REVIEW = 'NeedsReview-ETransfer';

/** Pulls the bare address out of a From header like `Interac <notify@…>`. */
function senderAddress(from) {
  const match = String(from || '').match(/<([^>]+)>/);
  return (match ? match[1] : String(from || '')).trim().toLowerCase();
}

/** True when the From address is one of Interac's notification addresses. */
function isInteracSender(from) {
  return INTERAC_SENDERS.indexOf(senderAddress(from)) !== -1;
}

/**
 * True when Gmail's Authentication-Results header reports a passing DKIM
 * signature for Interac's domain. A forged From fails this.
 */
function hasInteracDkim(authResults) {
  const text = String(authResults || '').toLowerCase();
  const escaped = INTERAC_DKIM_DOMAIN.replace(/\./g, '\\.');
  // The trailing lookahead stops `payments.interac.ca.evil.example` from
  // passing as a prefix match.
  return new RegExp('dkim=pass[^;]*header\\.[id]=@?(?:[a-z0-9-]+\\.)*' + escaped + '(?![a-z0-9.-])').test(text);
}

/**
 * True when the subject announces money RECEIVED. Requests, reminders,
 * cancellations, expiries and transfers the shop itself sent are not
 * deposits and must never become payments.
 */
function isDepositSubject(subject) {
  const s = String(subject || '');
  if (/request|reminder|cancel|expire|declin|couldn.t be|you sent|your transfer/i.test(s)) return false;
  return /you(?:'|’)ve received|sent you|has been (?:automatically )?deposited/i.test(s);
}

/**
 * Parses one notification into the webhook payload, or returns null when
 * no amount can be read.
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

/**
 * Sends one payload to the Worker.
 * @returns {'ok'|'retry'|'reject'} ok = stored (2xx, includes duplicates);
 *   retry = try again next run; reject = the Worker will never accept it.
 */
function postToWorker(payload) {
  let response;
  try {
    response = UrlFetchApp.fetch(CLOUDFLARE_ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + SECRET_KEY },
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

function processETransfers() {
  const pendingLabel = GmailApp.getUserLabelByName(LABEL_PENDING);
  if (!pendingLabel) return;
  const doneLabel = ensureLabel(LABEL_DONE);
  const reviewLabel = ensureLabel(LABEL_REVIEW);

  const threads = pendingLabel.getThreads();
  for (let i = 0; i < threads.length; i++) {
    const thread = threads[i];
    const messages = thread.getMessages();
    let retry = false;
    let review = false;

    for (let m = 0; m < messages.length; m++) {
      const message = messages[m];
      const subject = message.getSubject() || '';

      if (!isInteracSender(message.getFrom()) || !hasInteracDkim(message.getHeader('Authentication-Results'))) {
        Logger.log('Not an authenticated Interac email: ' + message.getId());
        review = true;
        continue;
      }
      if (!isDepositSubject(subject)) {
        Logger.log('Interac email is not a deposit: "' + subject + '"');
        review = true;
        continue;
      }
      const payload = parseNotification(subject, message.getPlainBody(), message.getDate().toISOString(), message.getId());
      if (!payload) {
        Logger.log('No amount found in ' + message.getId());
        review = true;
        continue;
      }
      const outcome = postToWorker(payload);
      if (outcome === 'retry') retry = true;
      if (outcome === 'reject') review = true;
    }

    // A retry outranks everything: the thread keeps its label and every
    // message is offered again next run (the Worker ignores the ones it
    // already has).
    if (retry) continue;
    thread.addLabel(review ? reviewLabel : doneLabel);
    thread.removeLabel(pendingLabel);
  }
}

/**
 * Editor-run check of the pure functions above. Run it once after
 * pasting the script, and again after any edit; every line must say PASS.
 */
function selfTest() {
  const check = function (name, actual, expected) {
    Logger.log((actual === expected ? 'PASS  ' : 'FAIL  ') + name + (actual === expected ? '' : '  got ' + actual));
  };
  check('sender: display name form', isInteracSender('Interac e-Transfer <notify@payments.interac.ca>'), true);
  check('sender: look-alike domain', isInteracSender('Interac <notify@payments.interac.ca.evil.example>'), false);
  check('sender: gmail', isInteracSender('Someone <someone@gmail.com>'), false);
  check('dkim: pass for the domain', hasInteracDkim('mx.google.com; dkim=pass header.i=@payments.interac.ca header.s=k1; spf=pass'), true);
  check('dkim: pass for another domain', hasInteracDkim('mx.google.com; dkim=pass header.i=@evil.example; spf=pass'), false);
  check('dkim: look-alike suffix', hasInteracDkim('mx.google.com; dkim=pass header.i=@payments.interac.ca.evil.example'), false);
  check('dkim: fail', hasInteracDkim('mx.google.com; dkim=fail header.i=@payments.interac.ca'), false);
  check('dkim: missing header', hasInteracDkim(null), false);
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
}
