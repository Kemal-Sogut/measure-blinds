/**
 * Blinds Nisa — e-Transfer ingester (Google Apps Script).
 *
 * Runs on a Gmail time-trigger. For every thread labelled
 * "ToProcess-ETransfer" it parses the Interac notification, POSTs it to
 * the Worker webhook, then swaps the label to "Processed-ETransfer".
 *
 * The Worker decides what to do with each payment:
 *   - order number in the message  -> recorded automatically
 *   - confident name + amount match -> recorded automatically
 *   - anything ambiguous            -> parked in the app's Record Payment
 *                                      popup for one-tap manual assignment
 *
 * So this script NO LONGER needs a message/order number to work — banks
 * without a memo field are handled by the app's manual inbox.
 *
 * Idempotency: we send the Gmail message id; the Worker stores it UNIQUE
 * and ignores duplicates, so a retried run never double-records a payment.
 *
 * SETUP:
 *   1. CLOUDFLARE_ENDPOINT  -> your API Worker URL below.
 *   2. SECRET_KEY           -> must equal the Worker's
 *      ETRANSFER_WEBHOOK_SECRET (wrangler secret put ETRANSFER_WEBHOOK_SECRET).
 *   3. Add a time-driven trigger for processETransfers (e.g. every 5 min).
 */

const CLOUDFLARE_ENDPOINT = 'https://blinds-nisa-api.blindsnisa.workers.dev/webhooks/etransfer';
const SECRET_KEY = 'YOUR_SUPER_SECRET_KEY'; // === Worker ETRANSFER_WEBHOOK_SECRET

function processETransfers() {
  const pendingLabelName = 'ToProcess-ETransfer';
  const processedLabelName = 'Processed-ETransfer';

  const pendingLabel = GmailApp.getUserLabelByName(pendingLabelName);
  if (!pendingLabel) return;

  let processedLabel = GmailApp.getUserLabelByName(processedLabelName);
  if (!processedLabel) {
    processedLabel = GmailApp.createLabel(processedLabelName);
  }

  const threads = pendingLabel.getThreads();

  for (let i = 0; i < threads.length; i++) {
    const messages = threads[i].getMessages();
    const message = messages[messages.length - 1]; // most recent in thread
    const subject = message.getSubject() || '';
    const body = message.getPlainBody();

    // Amount — the subject is the reliable source; fall back to the body.
    //   "Interac e-Transfer: You've received $5.00 from Kemal and it ..."
    const amountMatch =
      subject.match(/\$([0-9,]+(?:\.[0-9]{2})?)/) ||
      body.match(/\$([0-9,]+(?:\.[0-9]{2})?)/);

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

    // Only POST when we can read an amount; everything else the app can
    // still reconcile from sender + amount, so no memo is required.
    if (amountMatch) {
      const payload = {
        amount: parseFloat(amountMatch[1].replace(/,/g, '')),
        sender: sender,
        reference_message: msgMatch ? msgMatch[1].trim() : '',
        timestamp: message.getDate().toISOString(),
        message_id: message.getId(),      // dedupe key
        raw_snippet: body.slice(0, 1000), // context for manual review
      };

      const options = {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + SECRET_KEY },
        payload: JSON.stringify(payload),
        muteHttpExceptions: false, // throw on 4xx/5xx so we retry next run
      };

      try {
        UrlFetchApp.fetch(CLOUDFLARE_ENDPOINT, options);
      } catch (error) {
        Logger.log('Webhook failed for ' + message.getId() + ': ' + error);
        continue; // leave the label so it retries next run
      }
    }

    // Success (or a non-payment email): archive it so it isn't reprocessed.
    threads[i].addLabel(processedLabel);
    threads[i].removeLabel(pendingLabel);
  }
}
