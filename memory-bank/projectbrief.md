# Blinds Nisa Field Estimator — Project Brief

## Project Overview
A field-facing web application for custom blinds consultants. Consultants log in at a customer's premises, create ORDERS with detailed line items (blinds with fabric/cassette/control options), and send branded PDF ESTIMATES about those orders directly to customers via email. Customers confirm through a public-facing link, which moves the order to "awaiting payment". The consultant records payments against the order (deriving a balance), and once paid the generated PDF becomes an INVOICE. An estimate/invoice is only the document — the order is the record of truth (total, items, status, payments).

## Core Requirements
1. **Mobile-first design** — Primary usage is on tablets/phones in the field
2. **Custom pricing engine** — Formula-based pricing with width/height minimums, panel splitting
3. **PDF generation** — Branded estimates generated server-side
4. **Email delivery** — Estimates sent to customers with PDF attachments via Resend
5. **Customer confirmation flow** — Public token-gated view with confirm button (reversible by the user, never the customer)
6. **Settings management** — Fabrics, cassette options, control options, preset items, company info, T&C
7. **Order lifecycle** — Draft → Sent → Awaiting Payment → In Progress → Ready → Installed (+ Expired for lapsed estimates), auto-expiry on sent
8. **Payments & invoicing** — Payment ledger per order; balance = total − Σpayments; PDF is an Estimate until the first payment, then an Invoice
9. **Installation scheduling** — Once Ready, propose an install time; customer confirms or requests another via the public link; email states the one-hour arrival window ("between {start} and {end} on {date}")

## Technical Stack
- Frontend: React + Vite + TypeScript + Tailwind CSS
- Backend: Cloudflare Workers (Hono.js)
- Database: Supabase (PostgreSQL with RLS)
- Auth: Supabase Auth (JWT)
- Email: Resend.com API
- PDF: pdf-lib (pure JS — @react-pdf/renderer cannot run on Workers: runtime WASM is forbidden)
- Hosting: Cloudflare Pages

## Business Rules
- Pricing divisor: /10000 (cm² → m² conversion)
- Tax: Ontario HST 13%, fixed
- Single-org model: all authenticated users share data
- Discount applied before tax
- Default estimate validity: 14 days from order date
- Calculation order: subtotal → discount → taxable → HST → total
- Balance is derived (total − Σ payments), never stored
- A confirmation may be reversed by the user only while the order is `awaiting_payment` (before any payment)
