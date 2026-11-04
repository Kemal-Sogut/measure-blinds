// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * ProposeVisitModal: the Leads page's quick "Propose visit" dialog. Staff
 * pick a day and a 30-minute start time, optionally add a note, and press
 * Send. The Worker (`POST /api/leads/:id/propose`, `apps/api/src/lib/leadProposal.ts`)
 * emails the visitor a thank-you with the proposed in-home estimate window,
 * books it on the calendar as a `proposed` estimate visit (the customer
 * confirms or asks for another time from the email), and marks the lead
 * handled.
 *
 * Built for speed: the calendar is inline (no nested date overlay), opens
 * on tomorrow (Monday after a Saturday), past days are disabled, and the
 * slots are one tap. When the lead already has a proposed visit, the dialog
 * opens on that day and time, and Send re-times the SAME visit: the
 * customer's earlier link keeps working.
 *
 * Layout: one column on phones (calendar, then a 4-up slot grid); calendar
 * and slots side by side from `sm`. The day grid is react-day-picker's
 * fixed ~308px, which fits a 375px phone's sheet (343px content). The
 * recipient email is visitor input, so it wraps anywhere.
 */

import { useState } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Button, Field, Modal, inputClass } from '../../components/ui';
import { useProposeLeadVisit } from '../../hooks/useLeads';
import type { Lead } from '../../types';
import { leadName } from './leadText';
import { VISIT_SLOTS, defaultVisitDay, fromIsoDate, to12Hour, toIsoDate, visitWindow } from './visitTime';

/** Same cap as the Worker's schema and the Calendar's booking note. */
const NOTE_MAX = 1000;

/** The dialog for one lead. Mounted only while open, so its state resets each time. */
export default function ProposeVisitModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const existing = lead.appointment;
  const [day, setDay] = useState<Date>(() => (existing ? fromIsoDate(existing.appointment_date) : defaultVisitDay()));
  const [time, setTime] = useState<string | null>(existing ? existing.appointment_time.slice(0, 5) : null);
  const [note, setNote] = useState('');
  const propose = useProposeLeadVisit();
  const name = leadName(lead);
  const today = new Date(new Date().setHours(0, 0, 0, 0));

  function send() {
    if (!time) return;
    propose.mutate(
      {
        id: lead.id,
        input: { appointment_date: toIsoDate(day), appointment_time: time, ...(note.trim() ? { message: note.trim() } : {}) },
      },
      {
        onSuccess: ({ emailedTo }) => {
          toast.success(`Proposal sent to ${emailedTo}. Lead marked handled.`);
          onClose();
        },
        onError: (e) => toast.error(e.message),
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={existing ? 'Propose a new time' : 'Propose an estimate visit'}
      subtitle={name}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={propose.isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={send} disabled={!time} loading={propose.isPending}>
            {propose.isPending ? 'Sending…' : 'Send proposal'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-13px text-text-secondary wrap-anywhere">
          Emails a thank-you and this time to <span className="font-semibold text-text-primary">{lead.email}</span>.
          They confirm it or ask for another time from the email, and the lead is marked handled.
        </p>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="self-center sm:self-start">
            <DayPicker
              mode="single"
              required
              selected={day}
              defaultMonth={day}
              onSelect={(d) => d && setDay(d)}
              disabled={{ before: today }}
              classNames={{
                day: 'rounded-md',
                today: 'font-bold text-brand-600',
                selected: 'bg-brand-600 text-white rounded-md',
                chevron: 'fill-text-secondary',
              }}
            />
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="text-xs font-semibold text-text-secondary">Start time · {format(day, 'EEE, MMM d')}</span>
            <div role="radiogroup" aria-label="Start time" className="grid grid-cols-4 gap-1.5 sm:grid-cols-3">
              {VISIT_SLOTS.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={time === t}
                  onClick={() => setTime(t)}
                  className={`h-10 rounded-md border text-13px font-medium tabular-nums ${
                    time === t
                      ? 'border-brand-600 bg-brand-100 text-brand-600'
                      : 'border-border-input bg-surface text-text-secondary hover:bg-surface-muted'
                  }`}
                >
                  {to12Hour(t)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <Field label="Note (optional)" htmlFor={`propose-note-${lead.id}`} hint={`${note.length}/${NOTE_MAX} · shown above the buttons in the email`}>
          <textarea
            id={`propose-note-${lead.id}`}
            rows={2}
            maxLength={NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. We'll bring zebra and roller samples."
            className={`${inputClass} py-2`}
          />
        </Field>

        <p className="rounded-lg bg-surface-sunken p-2.5 text-13px text-text-secondary" aria-live="polite">
          {time ? (
            <>
              They will see: <span className="font-semibold text-text-primary">{format(day, 'EEEE, MMMM d')} · {visitWindow(time)}</span>
            </>
          ) : (
            'Pick a start time.'
          )}
        </p>
      </div>
    </Modal>
  );
}
