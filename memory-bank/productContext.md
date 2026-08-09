# Product Context

## Why This Project Exists
Custom blinds consultants visit customer homes to measure windows and create estimates. Currently this process involves manual calculations and paperwork. This app digitizes the entire workflow from measurement to estimate delivery.

## Problems It Solves
1. **Manual calculation errors** — Complex pricing with fabric costs, cassette costs, panel splitting, and minimum dimension rules
2. **Slow estimate delivery** — Paper estimates or email templates that need manual formatting
3. **No confirmation tracking** — No way for customers to formally accept estimates
4. **Settings scattered** — Fabric pricing, options, and company info not centrally managed

## How It Should Work
1. Consultant logs in on tablet at customer's home
2. Selects or creates a customer
3. Creates an ORDER with blind line items (room name, dimensions, fabric, cassette, control)
4. App calculates pricing live as they enter measurements
5. Consultant reviews totals, applies any discount, and sends the ESTIMATE via email
6. Customer receives a branded Estimate PDF and a link to view/confirm online
7. Customer confirms → order moves to "awaiting payment" → consultant notified (deposit
   instructions shown to the customer). The consultant can REVERSE the confirmation (back
   to sent) while no payment has been recorded — customers cannot.
8. As money arrives, the consultant records payments against the order; the app shows the
   running balance and moves the order to "in progress". The document now downloads as an
   INVOICE. When the goods are ready the consultant marks the order "ready".
9. From a Ready order the consultant proposes an installation time. The customer gets an
   email ("We will be there between {start} and {end} on {date} if that works for you.")
   with a link to confirm the time or request another. After the job is physically done the
   consultant marks the order "installed" (the final state).

## User Experience Goals
- **Fast** — Optimized for field use with poor connectivity
- **Touch-friendly** — 44px minimum tap targets, bottom nav, bottom-sheet modals
- **Professional** — Branded PDFs and email templates
- **Simple** — Minimal training needed, intuitive flows
