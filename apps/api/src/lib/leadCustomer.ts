// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Turns a website lead into a customer: links it to the existing customer
 * whose email matches, or creates a new one. Used only by
 * `routes/leadIntake.ts`, BEFORE the lead row is inserted, so every lead
 * row is born with its `customer_id`.
 *
 * Matching rule (owner decision 2026-11-04, spec D3):
 *   - case-insensitive equality on `customers.email`, among customers that
 *     are not soft-deleted (`deleted_at is null`). A soft-deleted customer
 *     is out of every list and lookup, so a lead must not quietly revive one.
 *   - several matches → the most recently updated one, which is the record
 *     staff are actually working with.
 *   - on a match, existing data is NEVER overwritten. `blankFieldPatch`
 *     fills only empty fields, and treats the shipping address as one
 *     block so two different addresses can never be mixed into one.
 *
 * The response to the visitor never reveals which branch ran: the route
 * answers the same `201` either way, so the form cannot be used to test
 * whether an email address belongs to a customer.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { phoneDigits, type LeadInput } from './leadSchema';

/** Whether the lead created its customer or was linked to an existing one (`leads.customer_match`). */
export type CustomerMatch = 'created' | 'matched';

/** The customer columns the matcher reads in order to decide which blanks to fill. */
export interface MatchableCustomer {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  shipping_address_line1: string;
}

/** Customer columns a lead can write (create) or fill (match). */
export type CustomerFields = Partial<{
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  shipping_address_line1: string;
  shipping_address_line2: string;
  shipping_city: string;
  shipping_province: string;
  shipping_postal_code: string;
  billing_same_as_shipping: boolean;
}>;

/** `(613) 555-0123` from any 10-digit input; other shapes are returned trimmed, unchanged. */
export function formatLeadPhone(raw: string): string {
  const d = phoneDigits(raw);
  if (d.length !== 10) return raw.trim();
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/**
 * Postal code in `K1A 0B1` form. The schema has already upper-cased and
 * validated it, but accepts it with or without the space, so this
 * normalises the form for storage on both the customer and the lead row.
 */
export function formatPostal(raw: string): string {
  const p = raw.replace(/\s+/g, '');
  return p.length === 6 ? `${p.slice(0, 3)} ${p.slice(3)}` : raw;
}

/** The shipping-address block of a lead, in customer-column form. */
function addressFields(lead: LeadInput): CustomerFields {
  return {
    shipping_address_line1: lead.street,
    shipping_address_line2: lead.unit,
    shipping_city: lead.city,
    shipping_province: lead.province,
    shipping_postal_code: formatPostal(lead.postal_code),
  };
}

/** The full row for a customer created from a lead. Billing follows shipping. */
export function newCustomerFromLead(lead: LeadInput): CustomerFields {
  return {
    first_name: lead.first_name,
    last_name: lead.last_name,
    email: lead.email,
    phone: formatLeadPhone(lead.phone),
    ...addressFields(lead),
    billing_same_as_shipping: true,
  };
}

/**
 * The fields to copy from a lead onto an EXISTING customer: only the ones
 * that are blank on the customer. The rules:
 *   - phone: copied when the customer has none.
 *   - name: copied only when BOTH names are blank. Half a name is a
 *     deliberate staff entry (e.g. "Mrs. Chen" with no first name), so it is
 *     not completed with what the visitor typed.
 *   - address: the whole shipping block is copied only when
 *     `shipping_address_line1` is blank. City, province and postal code are
 *     never filled on their own, because they would then describe a
 *     different address than the street already on file. (`shipping_province`
 *     defaults to 'ON', so it is never truly blank anyway.)
 * Returns `{}` when nothing needs filling, and the caller then skips the update.
 */
export function blankFieldPatch(customer: MatchableCustomer, lead: LeadInput): CustomerFields {
  const patch: CustomerFields = {};
  if (!customer.phone.trim()) patch.phone = formatLeadPhone(lead.phone);
  if (!customer.first_name.trim() && !customer.last_name.trim()) {
    patch.first_name = lead.first_name;
    patch.last_name = lead.last_name;
  }
  if (!customer.shipping_address_line1.trim()) Object.assign(patch, addressFields(lead));
  return patch;
}

/** Escapes ILIKE wildcards so an email is matched literally (`_` is legal in addresses). */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Finds the customer for a lead, or creates one. Returns the customer id
 * and which branch ran. Throws on a database error: the route turns that
 * into a 500 and the form shows the visitor its "please call us" message.
 * Losing the customer link silently would be worse than asking the visitor
 * to try again.
 *
 * A failure to FILL BLANKS on a matched customer is logged and ignored. The
 * link is what matters, and the lead row keeps the submitted details anyway.
 */
export async function findOrCreateLeadCustomer(
  sb: SupabaseClient,
  lead: LeadInput
): Promise<{ customerId: string; match: CustomerMatch }> {
  const { data: matches, error: findError } = await sb
    .from('customers')
    .select('id, first_name, last_name, phone, shipping_address_line1')
    .ilike('email', likeLiteral(lead.email))
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(1);
  if (findError) throw new Error(`Customer lookup failed: ${findError.message}`);

  const existing = (matches?.[0] ?? null) as MatchableCustomer | null;
  if (existing) {
    const patch = blankFieldPatch(existing, lead);
    if (Object.keys(patch).length > 0) {
      const { error } = await sb.from('customers').update(patch).eq('id', existing.id);
      if (error) console.error('Lead: filling blank customer fields failed:', error.message);
    }
    return { customerId: existing.id, match: 'matched' };
  }

  const { data: created, error: createError } = await sb
    .from('customers')
    .insert(newCustomerFromLead(lead))
    .select('id')
    .single();
  if (createError || !created) {
    throw new Error(`Customer create failed: ${createError?.message ?? 'no row returned'}`);
  }
  return { customerId: (created as { id: string }).id, match: 'created' };
}
