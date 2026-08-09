-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 19: estimate appointments, reminder dedup stamps, and the
-- post-installation review request.
--
-- 1. Estimate appointment scheduling — mirrors the install_* columns.
--    The user proposes a 1-hour visit window for the free in-home
--    estimate; the customer confirms or requests another time on the
--    token'd public page. Independent of the order lifecycle status.
--
-- 2. Reminder dedup stamps — the daily reminder cron sends at most one
--    day-before reminder per appointment/installation; the *_sent_at
--    stamp is what makes reruns of the cron idempotent. Both stamps are
--    cleared when a new time is proposed so a rescheduled visit gets a
--    fresh reminder.
--
-- 3. Review request — `installed_at` records when the order was marked
--    installed; the cron emails a Google-review request 2 days later
--    (at most once, via review_request_sent_at) using the new
--    company_settings.google_review_url.

alter table public.orders
  add column appointment_date date,
  add column appointment_time time,
  add column appointment_status text not null default 'unscheduled'
    check (appointment_status in ('unscheduled', 'proposed', 'confirmed', 'change_requested')),
  add column appointment_confirmed_at timestamptz,
  -- Free-text the customer leaves when requesting a different time.
  add column appointment_response_note text not null default '',
  add column appointment_reminder_sent_at timestamptz,
  add column install_reminder_sent_at timestamptz,
  add column installed_at timestamptz,
  add column review_request_sent_at timestamptz;

alter table public.company_settings
  add column google_review_url text not null default '';
