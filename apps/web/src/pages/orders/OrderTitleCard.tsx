// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Optional estimate title in the order editor's Order Details section
 * (migration 47). Tells two estimates for one customer apart
 * ("Option A – Roller blinds") on the Estimates page, the customer's
 * link, the email subject and the PDF. Left blank it is sent as null and
 * shown nowhere — there is deliberately no auto-generated fallback.
 *
 * Controlled and presentational; `OrderDetail` owns the value and puts
 * it in the save payload. Capped at 120 characters to match the DB.
 */

import { Field, inputClass } from '../../components/ui';

export default function OrderTitleCard({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <section className="flex flex-col gap-3.5 rounded-xl border border-border-light bg-surface p-4 shadow-md">
      <Field
        label="Title (optional)"
        htmlFor="order-title"
        hint="Shown to the customer only when filled in."
      >
        <input
          id="order-title"
          type="text"
          maxLength={120}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. Option A – Roller blinds"
          className={`${inputClass} h-11`}
        />
      </Field>
    </section>
  );
}
