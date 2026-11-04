-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 53: lead triage matches the Inbox, and a lead can carry an
-- estimate-visit proposal (knowledge/specs/2026-11-04-website-lead-form-design.md,
-- "Follow-up: handled, delete, propose a visit").
--
-- 1. Status vocabulary. Leads now work like Inbox conversations: `new` or
--    `handled`. The old `contacted` and `archived` both meant "dealt with",
--    so they become `handled`. Spam and duplicates are DELETED from the
--    Leads page instead of being archived. `handled_at` records when a lead
--    left the queue (cleared again when it is moved back to New).
--
-- 2. Proposal link. "Propose visit" on the Leads page emails the visitor a
--    thank-you plus a proposed in-home estimate time, books that time as an
--    estimate appointment in `proposed` status (the customer confirms or asks
--    for another time on /appointment/:token), and marks the lead handled.
--    `appointment_id` points at that visit so the card can show its time and
--    the customer's answer, and so a second proposal re-times the SAME visit
--    (same public link) instead of booking a duplicate. SET NULL on delete:
--    removing the visit from the calendar leaves the lead intact.
--
-- Deploy together with the API that speaks `handled`: an older API would
-- try to write `contacted` / `archived`, which this CHECK now rejects.

alter table public.leads drop constraint leads_status_check;

update public.leads
  set status = 'handled'
  where status in ('contacted', 'archived');

alter table public.leads
  add constraint leads_status_check check (status in ('new', 'handled'));

alter table public.leads
  add column handled_at timestamptz,
  add column appointment_id uuid references public.appointments (id) on delete set null;

-- Rows that were already dealt with get a best-known handled time.
update public.leads
  set handled_at = updated_at
  where status = 'handled' and handled_at is null;

-- Supports the ON DELETE SET NULL from appointments without a sequential scan.
create index leads_appointment_idx on public.leads (appointment_id)
  where appointment_id is not null;
