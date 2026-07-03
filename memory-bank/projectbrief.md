# Blinds Nisa Field Estimator — Project Brief

## Project Overview
A field-facing web application for custom blinds consultants. Consultants log in at a customer's premises, create estimates with detailed line items (blinds with fabric/cassette/control options), and send branded PDF estimates directly to customers via email. Customers confirm estimates through a public-facing link.

## Core Requirements
1. **Mobile-first design** — Primary usage is on tablets/phones in the field
2. **Custom pricing engine** — Formula-based pricing with width/height minimums, panel splitting
3. **PDF generation** — Branded estimates generated server-side
4. **Email delivery** — Estimates sent to customers with PDF attachments via Resend
5. **Customer confirmation flow** — Public token-gated view with confirm button
6. **Settings management** — Fabrics, cassette options, control options, preset items, company info, T&C
7. **Estimate lifecycle** — Draft → Sent → Confirmed/Expired with auto-expiry

## Technical Stack
- Frontend: React + Vite + TypeScript + Tailwind CSS
- Backend: Cloudflare Workers (Hono.js)
- Database: Supabase (PostgreSQL with RLS)
- Auth: Supabase Auth (JWT)
- Email: Resend.com API
- PDF: @react-pdf/renderer
- Hosting: Cloudflare Pages

## Business Rules
- Pricing divisor: /10000 (cm² → m² conversion)
- Tax: Ontario HST 13%, fixed
- Single-org model: all authenticated users share data
- Discount applied before tax
- Default estimate expiry: 14 days from estimate date
- Calculation order: subtotal → discount → taxable → HST → total
