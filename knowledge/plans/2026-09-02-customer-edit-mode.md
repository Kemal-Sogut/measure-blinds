# Customer Edit Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/customers/:id` open read-only with a pen-icon button that enters edit mode, and add the same pen to the order editor's customer card so a customer can be corrected without leaving the order.

**Architecture:** The editable customer form is extracted once into a pure state module (`lib/customerForm.ts`) plus a presentational field set (`components/CustomerFields.tsx`). Two surfaces consume it: the customers page (`CustomerForm.tsx`, which gains a view/edit toggle and a new read-only `CustomerDetailView`) and a new `CustomerEditModal` opened from the order editor's customer card. No API, schema, hook, route, or type changes — `PUT /api/customers/:id` and `useUpdateCustomer` already exist.

**Tech Stack:** React 19, TypeScript, Vite 8, Tailwind 4 (`@theme` tokens — no PostCSS), TanStack Query 5, react-router-dom 6, react-hot-toast, Vitest 3, oxlint.

## Global Constraints

Full detail in `AI_GUIDELINES.md`. Every task's requirements implicitly include this section.

- **Branch:** all work lands on `feat/customer-edit-mode` (already created, spec already committed).
- **Working directory:** `/Users/kemal/Desktop/measure-blinds`. Every `pnpm` command runs from `apps/web` unless stated otherwise.
- **SPDX header (rule 10):** every new `.ts`/`.tsx` file begins with exactly these two lines, before anything else:
  ```ts
  // SPDX-License-Identifier: GPL-3.0-only
  // Copyright (c) 2026 Blinds Nisa. All rights reserved.
  ```
  Preserve the header on every file you modify.
- **JSDoc (rule 3):** every exported module, component, hook, function and type carries a `/** ... */` comment. File headers describe the module's responsibility, behaviour, constraints and integration context — never just restate the name. English only. Self-score each doc 0–10; anything below 8 must be improved before the task is done.
- **File size (rule 6):** files stay under 800 lines; functions ideally under 100. `OrderDetail.tsx` is a known standing violation (~3,170 lines) — do not attempt to reduce it here; add only what this plan specifies.
- **Scope isolation (rule 7):** modify only the files each task names. No drive-by refactors. **`components/CustomerCreateModal.tsx` is explicitly out of scope** — do not rewire it onto the shared field set.
- **Verification (rule 9):** `pnpm check`, `pnpm test`, `pnpm lint` in `apps/web` — target 0 errors, 0 warnings.
- **No icon library.** This codebase draws icons as inline `<svg>` with `stroke="currentColor"`. Do not add `lucide-react` or any icon dependency.
- **No new dependencies at all.**
- **Server-authoritative money (rule 1)** is not in play: nothing here touches orders, pricing, or totals.
- **Tap targets:** every interactive control clears 44px (`h-11` / `min-h-11`).

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `apps/web/src/lib/customerForm.ts` | **new.** Pure customer-form state, conversion, validation, dirty-check. No React, no network. | 1 |
| `apps/web/src/lib/customerForm.test.ts` | **new.** Unit tests for the above. | 1 |
| `apps/web/src/components/CustomerFields.tsx` | **new.** The Contact / Shipping / Billing inputs, controlled by a `CustomerFormState`. Two chrome variants: `page` and `modal`. | 2 |
| `apps/web/src/pages/customers/CustomerDetailView.tsx` | **new.** Read-only label/value rendering of a `Customer`. | 3 |
| `apps/web/src/pages/customers/CustomerForm.tsx` | **modify.** View/edit toggle; delegates its markup to the two new modules. | 4 |
| `apps/web/src/components/CustomerEditModal.tsx` | **new.** `Modal` + `CustomerFields` + `useUpdateCustomer`. | 5 |
| `apps/web/src/pages/orders/OrderHeaderCards.tsx` | **modify.** `CustomerCard` gains `onEdit` and a pen button. | 6 |
| `apps/web/src/pages/orders/OrderDetail.tsx` | **modify.** Mounts `CustomerEditModal`, wires `onEdit`. | 6 |
| `knowledge/history/engine_features.md` | **modify.** Feature history entry (rule 4). | 7 |
| `memory-bank/activeContext.md`, `memory-bank/progress.md` | **modify.** Current-state snapshots (rule 5). | 7 |

## Reference: existing types and helpers

You will need these. They already exist — do not redefine them.

`apps/web/src/types/index.ts`:

```ts
export interface Customer {
  id: string;
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
  billing_address_line1: string;
  billing_address_line2: string;
  billing_city: string;
  billing_province: string;
  billing_postal_code: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
```

> Note: the columns are typed non-nullable here, but the database allows NULL in the text columns and older rows contain them. `toCustomerFormState` must still coalesce — that is why its tests cast fixtures.

`apps/web/src/hooks/useCustomers.ts`:

```ts
export type CustomerInput = Partial<Omit<Customer, 'id' | 'deleted_at' | 'created_at' | 'updated_at'>>;
export function useCustomer(id: string | undefined): UseQueryResult<Customer>;
export function useUpdateCustomer(): UseMutationResult<Customer, Error, { id: string; patch: CustomerInput }>;
export function useCreateCustomer(): UseMutationResult<Customer, Error, CustomerInput>;
export function useDeleteCustomer(): UseMutationResult<{ id: string }, Error, string>;
```

`apps/web/src/lib/customerName.ts`: `displayName(c)` → full name, else email, else phone, else `'Unnamed customer'`.

`apps/web/src/components/ui/index.ts`: `Pill`, `Card`, `CardHeader`, `CardBody`, `CardFooter`, `Button`, `Field`, `inputClass`, `Modal`, `StatTile`.

`apps/web/src/components/ui/Modal.tsx` props: `{ open, onClose, title, subtitle?, footer?, size?: 'sm'|'md'|'lg', children }`. It owns Escape, backdrop dismissal, scroll lock and focus — callers must not add their own.

`apps/web/src/components/AddressAutocomplete.tsx` props: `{ label, value, onChange, onSelect, required?, autoFocus? }` where `onSelect` receives an `AddressSuggestion` (`{ line1, city, province, postal_code }`, from `lib/addressSearch`).

---

### Task 1: Pure customer-form module

**Files:**
- Create: `apps/web/src/lib/customerForm.ts`
- Test: `apps/web/src/lib/customerForm.test.ts`

**Interfaces:**
- Consumes: `Customer` from `../types`, `CustomerInput` from `../hooks/useCustomers`.
- Produces:
  ```ts
  export interface CustomerFormState { first_name: string; last_name: string; email: string; phone: string; shipping_address_line1: string; shipping_address_line2: string; shipping_city: string; shipping_province: string; shipping_postal_code: string; billing_same_as_shipping: boolean; billing_address_line1: string; billing_address_line2: string; billing_city: string; billing_province: string; billing_postal_code: string; }
  export const EMPTY_CUSTOMER_FORM: CustomerFormState;
  export function toCustomerFormState(row: Customer): CustomerFormState;
  export function toCustomerInput(form: CustomerFormState): CustomerInput;
  export function validateCustomerForm(form: CustomerFormState): string | null;
  export function isCustomerFormDirty(form: CustomerFormState, row: Customer): boolean;
  ```

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/customerForm.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for `lib/customerForm` — the pure half of the customer
 * edit surface. These cover the three rules that silently corrupt a
 * save when they regress: nullable columns must not reach a controlled
 * input as `null`, the strict server schema must never see `id` or a
 * timestamp column, and the client validation must match the server's
 * create refinement in `apps/api/src/routes/customers.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_CUSTOMER_FORM,
  isCustomerFormDirty,
  toCustomerFormState,
  toCustomerInput,
  validateCustomerForm,
} from './customerForm';
import type { Customer } from '../types';

/**
 * A fully populated row. Tests derive their fixtures from this so each
 * one states only the field it is about.
 */
const ROW: Customer = {
  id: 'c-1',
  first_name: 'Kemal',
  last_name: 'Sogut',
  email: 'kemal@example.com',
  phone: '4165550142',
  shipping_address_line1: '12 Bay St',
  shipping_address_line2: 'Unit 4',
  shipping_city: 'Toronto',
  shipping_province: 'ON',
  shipping_postal_code: 'M5J 2R8',
  billing_same_as_shipping: true,
  billing_address_line1: '',
  billing_address_line2: '',
  billing_city: '',
  billing_province: '',
  billing_postal_code: '',
  deleted_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

/** Builds a row with some fields overridden. */
function row(patch: Partial<Customer>): Customer {
  return { ...ROW, ...patch };
}

describe('toCustomerFormState', () => {
  it('copies the editable fields off a row', () => {
    expect(toCustomerFormState(ROW)).toEqual({
      first_name: 'Kemal',
      last_name: 'Sogut',
      email: 'kemal@example.com',
      phone: '4165550142',
      shipping_address_line1: '12 Bay St',
      shipping_address_line2: 'Unit 4',
      shipping_city: 'Toronto',
      shipping_province: 'ON',
      shipping_postal_code: 'M5J 2R8',
      billing_same_as_shipping: true,
      billing_address_line1: '',
      billing_address_line2: '',
      billing_city: '',
      billing_province: '',
      billing_postal_code: '',
    });
  });

  it('omits id and the timestamp columns, which the strict update schema rejects', () => {
    const form = toCustomerFormState(ROW) as Record<string, unknown>;
    expect(form).not.toHaveProperty('id');
    expect(form).not.toHaveProperty('created_at');
    expect(form).not.toHaveProperty('updated_at');
    expect(form).not.toHaveProperty('deleted_at');
  });

  it('coalesces null text columns to empty strings so inputs stay controlled', () => {
    // Older rows predate the NOT NULL defaults; the TS type lies about this.
    const legacy = row({
      first_name: null as unknown as string,
      shipping_city: null as unknown as string,
    });
    const form = toCustomerFormState(legacy);
    expect(form.first_name).toBe('');
    expect(form.shipping_city).toBe('');
  });

  it('falls back to the ON province default when the column is null', () => {
    const form = toCustomerFormState(row({ shipping_province: null as unknown as string }));
    expect(form.shipping_province).toBe('ON');
  });

  it('falls back to billing_same_as_shipping = true when the column is null', () => {
    const form = toCustomerFormState(row({ billing_same_as_shipping: null as unknown as boolean }));
    expect(form.billing_same_as_shipping).toBe(true);
  });
});

describe('toCustomerInput', () => {
  it('trims the four identity fields', () => {
    const input = toCustomerInput({
      ...EMPTY_CUSTOMER_FORM,
      first_name: '  Kemal  ',
      last_name: ' Sogut ',
      email: ' kemal@example.com ',
      phone: ' 4165550142 ',
    });
    expect(input.first_name).toBe('Kemal');
    expect(input.last_name).toBe('Sogut');
    expect(input.email).toBe('kemal@example.com');
    expect(input.phone).toBe('4165550142');
  });

  it('leaves address fields exactly as typed', () => {
    const input = toCustomerInput({ ...EMPTY_CUSTOMER_FORM, shipping_address_line2: ' Unit 4 ' });
    expect(input.shipping_address_line2).toBe(' Unit 4 ');
  });
});

describe('validateCustomerForm', () => {
  it('rejects a wholly anonymous record', () => {
    expect(validateCustomerForm(EMPTY_CUSTOMER_FORM)).toBe('Enter a name, email or phone number.');
  });

  it.each(['first_name', 'last_name', 'phone'] as const)(
    'accepts a record identified by %s alone',
    (field) => {
      expect(validateCustomerForm({ ...EMPTY_CUSTOMER_FORM, [field]: 'x' })).toBeNull();
    }
  );

  it('accepts a record identified by email alone', () => {
    expect(validateCustomerForm({ ...EMPTY_CUSTOMER_FORM, email: 'a@b.co' })).toBeNull();
  });

  it('treats whitespace as absent', () => {
    expect(validateCustomerForm({ ...EMPTY_CUSTOMER_FORM, first_name: '   ' })).toBe(
      'Enter a name, email or phone number.'
    );
  });

  it('rejects a malformed email', () => {
    expect(validateCustomerForm({ ...EMPTY_CUSTOMER_FORM, phone: '416', email: 'nope' })).toBe(
      'Enter a valid email or leave it empty.'
    );
  });

  it('accepts an empty email when another identifier is present', () => {
    expect(validateCustomerForm({ ...EMPTY_CUSTOMER_FORM, phone: '416', email: '' })).toBeNull();
  });
});

describe('isCustomerFormDirty', () => {
  it('is false for a freshly seeded form', () => {
    expect(isCustomerFormDirty(toCustomerFormState(ROW), ROW)).toBe(false);
  });

  it('is true when a text field changed', () => {
    const form = { ...toCustomerFormState(ROW), phone: '4165550143' };
    expect(isCustomerFormDirty(form, ROW)).toBe(true);
  });

  it('is true when the province changed', () => {
    const form = { ...toCustomerFormState(ROW), shipping_province: 'QC' };
    expect(isCustomerFormDirty(form, ROW)).toBe(true);
  });

  it('is true when billing_same_as_shipping was toggled', () => {
    const form = { ...toCustomerFormState(ROW), billing_same_as_shipping: false };
    expect(isCustomerFormDirty(form, ROW)).toBe(true);
  });

  it('ignores hidden billing values while billing mirrors shipping', () => {
    // Unchecking, typing, and re-checking must not leave the form dirty:
    // those values are not sent and not shown.
    const form = { ...toCustomerFormState(ROW), billing_city: 'Ottawa' };
    expect(isCustomerFormDirty(form, ROW)).toBe(false);
  });

  it('does compare billing values once billing differs from shipping', () => {
    const differing = row({ billing_same_as_shipping: false, billing_city: 'Toronto' });
    const form = { ...toCustomerFormState(differing), billing_city: 'Ottawa' };
    expect(isCustomerFormDirty(form, differing)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `apps/web`:

```bash
pnpm vitest run src/lib/customerForm.test.ts
```

Expected: FAIL — `Failed to resolve import "./customerForm"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/customerForm.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pure state, conversion and validation for the customer edit form.
 *
 * Extracted so the two surfaces that edit a customer — the customers
 * page (`pages/customers/CustomerForm`) and the order editor's inline
 * dialog (`components/CustomerEditModal`) — share one definition of
 * what the form holds, what gets sent, and what counts as valid. The
 * validation rule in particular must not fork: it mirrors the server's
 * create refinement in `apps/api/src/routes/customers.ts`, and a copy
 * that drifts turns a clear client-side message into an opaque 400.
 *
 * Deliberately free of React and of the network layer, so it is
 * testable without a DOM — `apps/web` has no DOM test harness.
 */

import type { CustomerInput } from '../hooks/useCustomers';
import type { Customer } from '../types';

/**
 * The editable subset of a customer row, all held as strings for direct
 * binding to controlled inputs. `billing_same_as_shipping` is the one
 * boolean because it drives a checkbox, not a text field.
 *
 * Excludes `id` and the timestamp columns on purpose: the server's
 * update schema is `.strict()`, so a payload carrying them is rejected
 * with a 400 rather than silently cleaned.
 */
export interface CustomerFormState {
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
  billing_address_line1: string;
  billing_address_line2: string;
  billing_city: string;
  billing_province: string;
  billing_postal_code: string;
}

/**
 * Blank form for a brand-new customer.
 *
 * Two fields are not blank: the province defaults to Ontario (this shop
 * is Ontario-only, and pre-filling it removes a keystroke from every
 * new record), and billing defaults to mirroring shipping, which is
 * true for nearly every residential customer.
 */
export const EMPTY_CUSTOMER_FORM: CustomerFormState = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  shipping_address_line1: '',
  shipping_address_line2: '',
  shipping_city: '',
  shipping_province: 'ON',
  shipping_postal_code: '',
  billing_same_as_shipping: true,
  billing_address_line1: '',
  billing_address_line2: '',
  billing_city: '',
  billing_province: '',
  billing_postal_code: '',
};

/**
 * Copies just the editable fields off a server row.
 *
 * Field-by-field rather than a spread, for two reasons. The row also
 * carries `id` and the timestamp columns, and the update schema is
 * strict — spreading it wholesale would make every save 400. And the
 * text columns are nullable in the database despite the TypeScript
 * type: a `null` reaching an input turns it uncontrolled and React
 * warns, so every text field coalesces to `''`.
 */
export function toCustomerFormState(row: Customer): CustomerFormState {
  return {
    first_name: row.first_name ?? '',
    last_name: row.last_name ?? '',
    email: row.email ?? '',
    phone: row.phone ?? '',
    shipping_address_line1: row.shipping_address_line1 ?? '',
    shipping_address_line2: row.shipping_address_line2 ?? '',
    shipping_city: row.shipping_city ?? '',
    shipping_province: row.shipping_province ?? EMPTY_CUSTOMER_FORM.shipping_province,
    shipping_postal_code: row.shipping_postal_code ?? '',
    billing_same_as_shipping: row.billing_same_as_shipping ?? true,
    billing_address_line1: row.billing_address_line1 ?? '',
    billing_address_line2: row.billing_address_line2 ?? '',
    billing_city: row.billing_city ?? '',
    billing_province: row.billing_province ?? '',
    billing_postal_code: row.billing_postal_code ?? '',
  };
}

/**
 * Converts form state into the create/update payload.
 *
 * Only the four identity fields are trimmed. They are what the server's
 * "not wholly anonymous" refinement inspects and what search matches
 * against, so stray whitespace there is a data defect. Address fields
 * are left verbatim — a trailing space in a street line is harmless,
 * and silently rewriting what someone typed is worse than keeping it.
 */
export function toCustomerInput(form: CustomerFormState): CustomerInput {
  return {
    ...form,
    first_name: form.first_name.trim(),
    last_name: form.last_name.trim(),
    email: form.email.trim(),
    phone: form.phone.trim(),
  };
}

/**
 * Validates the form, returning a user-facing message or `null` when it
 * is safe to save.
 *
 * Mirrors `createSchema` in `apps/api/src/routes/customers.ts`. Names
 * are optional — a customer met on site is often nothing but a phone
 * number — but a record with no name, email or phone is unsearchable,
 * un-emailable, and indistinguishable from every other blank row, so at
 * least one identifier is required. The email check is shape-only and
 * skipped when the field is empty, because an empty email is valid.
 *
 * Returned rather than thrown or toasted here: this module stays free
 * of UI concerns, and each caller decides how to present the message.
 */
export function validateCustomerForm(form: CustomerFormState): string | null {
  const identified =
    form.first_name.trim() || form.last_name.trim() || form.email.trim() || form.phone.trim();
  if (!identified) return 'Enter a name, email or phone number.';
  if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) {
    return 'Enter a valid email or leave it empty.';
  }
  return null;
}

/**
 * Reports whether the form differs from the row it was seeded from.
 *
 * Drives the discard confirmation, so a false positive costs the user a
 * pointless prompt and a false negative costs them their typing.
 *
 * Billing fields are compared ONLY when billing differs from shipping.
 * While the "same as shipping" box is checked those inputs are hidden
 * and their values are irrelevant — the form deliberately retains them
 * so unchecking restores what was entered — and treating a value the
 * user cannot see as an unsaved change would prompt them to discard
 * nothing.
 */
export function isCustomerFormDirty(form: CustomerFormState, row: Customer): boolean {
  const seeded = toCustomerFormState(row);
  if (form.billing_same_as_shipping !== seeded.billing_same_as_shipping) return true;

  const billingKeys = [
    'billing_address_line1',
    'billing_address_line2',
    'billing_city',
    'billing_province',
    'billing_postal_code',
  ] as const;
  const skip: ReadonlySet<string> = form.billing_same_as_shipping
    ? new Set<string>(billingKeys)
    : new Set<string>();

  return (Object.keys(seeded) as (keyof CustomerFormState)[]).some(
    (key) => !skip.has(key) && form[key] !== seeded[key]
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm vitest run src/lib/customerForm.test.ts
```

Expected: PASS — 21 tests (5 + 2 + 8 + 6 across the four `describe` blocks; the `it.each` counts as 3).

- [ ] **Step 5: Typecheck and lint**

```bash
pnpm check && pnpm lint
```

Expected: no output from `check`; `Found 0 warnings and 0 errors` from `lint`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/customerForm.ts apps/web/src/lib/customerForm.test.ts
git commit -m "feat(customers): pure customer-form state, validation and dirty-check"
```

---

### Task 2: Shared editable field set

**Files:**
- Create: `apps/web/src/components/CustomerFields.tsx`

**Interfaces:**
- Consumes: `CustomerFormState` from `../lib/customerForm` (Task 1); `AddressAutocomplete`, `inputClass` from `./ui`; `AddressSuggestion` from `../lib/addressSearch`.
- Produces:
  ```ts
  export default function CustomerFields(props: {
    value: CustomerFormState;
    onChange: (next: CustomerFormState) => void;
    variant?: 'page' | 'modal';
    autoFocus?: boolean;
  }): JSX.Element;
  ```

This task has no test — `apps/web` has no DOM test harness, and every behaviour worth asserting was pulled into `lib/customerForm.ts` in Task 1. Verification is `pnpm check` + `pnpm lint`, and the visual check in Task 4 where it first renders.

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/CustomerFields.tsx`:

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The editable customer field set: contact details, shipping address,
 * and a billing address behind a "same as shipping" disclosure.
 *
 * Single owner of this markup. It is rendered by the customers page in
 * edit mode (`pages/customers/CustomerForm`) and by the order editor's
 * inline dialog (`components/CustomerEditModal`); before it existed the
 * same three sections were about to be written a third time, with the
 * usual result that a field added to one copy is missing from the rest.
 *
 * Fully controlled and stateless — the whole `CustomerFormState` comes
 * in as `value` and every edit goes back out through `onChange`, so the
 * owning surface keeps the single copy of the form and can compare it
 * against the server row for its dirty-check.
 *
 * NOT shared with `CustomerCreateModal`, whose compact, billing-less
 * layout is a deliberate difference for a quick add inside a picker.
 *
 * @see lib/customerForm for the state shape, validation and dirty-check.
 */

import AddressAutocomplete from './AddressAutocomplete';
import { inputClass } from './ui';
import type { AddressSuggestion } from '../lib/addressSearch';
import type { CustomerFormState } from '../lib/customerForm';

/**
 * This form's control treatment. Composed from the shared `inputClass`
 * so it cannot drift from every other input in the app, plus the fixed
 * height the two-column grids rely on to stay aligned.
 */
const INPUT_CLS = `h-11 ${inputClass}`;

/**
 * Section chrome per variant. `page` gives each section the app's
 * standard bordered card; `modal` drops the border and padding, because
 * the `Modal` primitive already supplies both and nesting cards inside
 * a dialog reads as a panel inside a panel.
 */
const SECTION_CLS = {
  page: 'flex flex-col gap-3.5 rounded-xl border border-border-light bg-surface p-4 shadow-md',
  modal: 'flex flex-col gap-3.5',
} as const;

/** Labelled text input bound to one `CustomerFormState` key. */
function Field({
  label,
  value,
  onChange,
  type = 'text',
  inputMode,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  inputMode?: 'email' | 'tel' | 'text';
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-text-secondary">{label}</span>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT_CLS}
      />
    </label>
  );
}

export default function CustomerFields({
  value,
  onChange,
  variant = 'page',
  autoFocus = false,
}: {
  /** The complete form state. This component holds none of its own. */
  value: CustomerFormState;
  /** Receives the whole next state, not a patch. */
  onChange: (next: CustomerFormState) => void;
  /** Section chrome: bordered cards on a page, flush inside a dialog. */
  variant?: 'page' | 'modal';
  /** Focuses the first name field on mount — for dialogs, not pages. */
  autoFocus?: boolean;
}) {
  const sectionCls = SECTION_CLS[variant];

  /** Single-field updater preserving the rest of the form. */
  function set<K extends keyof CustomerFormState>(key: K, next: CustomerFormState[K]) {
    onChange({ ...value, [key]: next });
  }

  /**
   * Fills a whole address block from a chosen autocomplete suggestion in
   * one update. Line 2 is intentionally left untouched — unit and buzzer
   * numbers rarely come back from the geocoder and the consultant may
   * have already typed one. Literal keys (not a computed `${prefix}_…`)
   * keep the update strictly typed against `CustomerFormState`, whose
   * `billing_same_as_shipping` boolean would otherwise clash with an
   * inferred string index signature.
   */
  function applyAddress(prefix: 'shipping' | 'billing', s: AddressSuggestion) {
    onChange(
      prefix === 'shipping'
        ? {
            ...value,
            shipping_address_line1: s.line1,
            shipping_city: s.city || value.shipping_city,
            shipping_province: s.province || value.shipping_province,
            shipping_postal_code: s.postal_code || value.shipping_postal_code,
          }
        : {
            ...value,
            billing_address_line1: s.line1,
            billing_city: s.city || value.billing_city,
            billing_province: s.province || value.billing_province,
            billing_postal_code: s.postal_code || value.billing_postal_code,
          }
    );
  }

  return (
    <>
      {/* Contact */}
      <section className={sectionCls}>
        <h2 className="text-[15px] font-bold text-text-primary">Contact</h2>
        <div className="grid grid-cols-2 gap-3.5">
          {/* Neither name is required — see `validateCustomerForm`. */}
          <Field
            label="First Name"
            value={value.first_name}
            onChange={(v) => set('first_name', v)}
            autoFocus={autoFocus}
          />
          <Field label="Last Name" value={value.last_name} onChange={(v) => set('last_name', v)} />
        </div>
        <Field
          label="Email"
          type="email"
          inputMode="email"
          value={value.email}
          onChange={(v) => set('email', v)}
        />
        <Field
          label="Phone"
          type="tel"
          inputMode="tel"
          value={value.phone}
          onChange={(v) => set('phone', v)}
        />
      </section>

      {/* Shipping address */}
      <section className={sectionCls}>
        <h2 className="text-[15px] font-bold text-text-primary">Shipping Address</h2>
        <AddressAutocomplete
          label="Address Line 1"
          value={value.shipping_address_line1}
          onChange={(v) => set('shipping_address_line1', v)}
          onSelect={(s) => applyAddress('shipping', s)}
        />
        <Field
          label="Address Line 2"
          value={value.shipping_address_line2}
          onChange={(v) => set('shipping_address_line2', v)}
        />
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="City" value={value.shipping_city} onChange={(v) => set('shipping_city', v)} />
          <Field
            label="Province"
            value={value.shipping_province}
            onChange={(v) => set('shipping_province', v)}
          />
        </div>
        <Field
          label="Postal Code"
          value={value.shipping_postal_code}
          onChange={(v) => set('shipping_postal_code', v)}
        />
      </section>

      {/* Billing address */}
      <section className={sectionCls}>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={value.billing_same_as_shipping}
            onChange={(e) => set('billing_same_as_shipping', e.target.checked)}
            className="h-5 w-5 rounded-sm accent-brand-600"
          />
          <span className="text-sm font-medium text-text-primary">Billing same as shipping</span>
        </label>
        {/* Hidden fields keep their values, so unchecking restores what
            was previously entered. `isCustomerFormDirty` knows to ignore
            them while they are hidden. */}
        {!value.billing_same_as_shipping && (
          <>
            <AddressAutocomplete
              label="Address Line 1"
              value={value.billing_address_line1}
              onChange={(v) => set('billing_address_line1', v)}
              onSelect={(s) => applyAddress('billing', s)}
            />
            <Field
              label="Address Line 2"
              value={value.billing_address_line2}
              onChange={(v) => set('billing_address_line2', v)}
            />
            <div className="grid grid-cols-2 gap-3.5">
              <Field label="City" value={value.billing_city} onChange={(v) => set('billing_city', v)} />
              <Field
                label="Province"
                value={value.billing_province}
                onChange={(v) => set('billing_province', v)}
              />
            </div>
            <Field
              label="Postal Code"
              value={value.billing_postal_code}
              onChange={(v) => set('billing_postal_code', v)}
            />
          </>
        )}
      </section>
    </>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

```bash
pnpm check && pnpm lint
```

Expected: no output from `check`; `Found 0 warnings and 0 errors` from `lint`.

If `lint` flags the `autoFocus` prop (`jsx-a11y/no-autofocus`), leave the code as written and confirm against `CustomerCreateModal.tsx`, which already passes `autoFocus` — if the rule is not enabled there it is not enabled here.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/CustomerFields.tsx
git commit -m "feat(customers): extract shared editable customer field set"
```

---

### Task 3: Read-only customer view

**Files:**
- Create: `apps/web/src/pages/customers/CustomerDetailView.tsx`

**Interfaces:**
- Consumes: `Customer` from `../../types`.
- Produces:
  ```ts
  export default function CustomerDetailView(props: { customer: Customer }): JSX.Element;
  ```

- [ ] **Step 1: Write the component**

Create `apps/web/src/pages/customers/CustomerDetailView.tsx`:

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Read-only presentation of a customer record — the default state of
 * `/customers/:id`, which the pen button in the page header flips into
 * the editable field set.
 *
 * Mirrors `components/CustomerFields` section for section (Contact,
 * Shipping Address, Billing Address) so the two states of the screen
 * read as the same document rather than two different pages. Values are
 * label/value rows, not disabled inputs: a greyed-out box reads as
 * broken rather than read-only, and an empty one says nothing, where a
 * dash says "we do not have this".
 *
 * Email and phone are the two things a consultant opens this screen to
 * act on, so they render as `mailto:` and `tel:` links — this app is
 * used on a phone, in the field.
 *
 * Purely presentational: no state, no queries, no mutations. The owning
 * page fetches the record and owns the view/edit toggle.
 */

import type { Customer } from '../../types';

/** Section chrome, matching the `page` variant of `CustomerFields`. */
const SECTION_CLS =
  'flex flex-col gap-3.5 rounded-xl border border-border-light bg-surface p-4 shadow-md';

/**
 * One label/value row.
 *
 * A blank or whitespace-only value renders an em dash in muted type, so
 * every field the record could hold keeps its line and the layout does
 * not shift between a complete record and a sparse one.
 *
 * `href` turns the value into a link (`mailto:`/`tel:`); it is ignored
 * when there is no value to link to.
 */
function DetailRow({ label, value, href }: { label: string; value: string; href?: string }) {
  const text = (value ?? '').trim();
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="text-xs font-semibold text-text-secondary sm:w-36 sm:shrink-0">{label}</span>
      {text ? (
        href ? (
          <a
            href={href}
            className="break-words text-[15px] text-brand-600 underline-offset-2 hover:underline"
          >
            {text}
          </a>
        ) : (
          <span className="break-words text-[15px] text-text-primary">{text}</span>
        )
      ) : (
        <span className="text-[15px] text-text-muted">—</span>
      )}
    </div>
  );
}

export default function CustomerDetailView({ customer }: { customer: Customer }) {
  const email = (customer.email ?? '').trim();
  const phone = (customer.phone ?? '').trim();

  return (
    <>
      {/* Contact */}
      <section className={SECTION_CLS}>
        <h2 className="text-[15px] font-bold text-text-primary">Contact</h2>
        <DetailRow label="First Name" value={customer.first_name ?? ''} />
        <DetailRow label="Last Name" value={customer.last_name ?? ''} />
        <DetailRow label="Email" value={email} href={email ? `mailto:${email}` : undefined} />
        {/* Spaces and dashes are legal in a tel: URI but confuse some
            dialers, so the href is stripped to dialable characters
            while the label keeps whatever was entered. */}
        <DetailRow
          label="Phone"
          value={phone}
          href={phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : undefined}
        />
      </section>

      {/* Shipping address */}
      <section className={SECTION_CLS}>
        <h2 className="text-[15px] font-bold text-text-primary">Shipping Address</h2>
        <DetailRow label="Address Line 1" value={customer.shipping_address_line1 ?? ''} />
        <DetailRow label="Address Line 2" value={customer.shipping_address_line2 ?? ''} />
        <DetailRow label="City" value={customer.shipping_city ?? ''} />
        <DetailRow label="Province" value={customer.shipping_province ?? ''} />
        <DetailRow label="Postal Code" value={customer.shipping_postal_code ?? ''} />
      </section>

      {/* Billing address — collapses to one line when it mirrors
          shipping, because repeating the same five rows under a second
          heading tells the reader nothing. */}
      <section className={SECTION_CLS}>
        <h2 className="text-[15px] font-bold text-text-primary">Billing Address</h2>
        {customer.billing_same_as_shipping ? (
          <p className="text-[15px] text-text-secondary">Same as shipping address</p>
        ) : (
          <>
            <DetailRow label="Address Line 1" value={customer.billing_address_line1 ?? ''} />
            <DetailRow label="Address Line 2" value={customer.billing_address_line2 ?? ''} />
            <DetailRow label="City" value={customer.billing_city ?? ''} />
            <DetailRow label="Province" value={customer.billing_province ?? ''} />
            <DetailRow label="Postal Code" value={customer.billing_postal_code ?? ''} />
          </>
        )}
      </section>
    </>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

```bash
pnpm check && pnpm lint
```

Expected: no output from `check`; `Found 0 warnings and 0 errors` from `lint`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/customers/CustomerDetailView.tsx
git commit -m "feat(customers): read-only customer detail view"
```

---

### Task 4: Customers page view/edit toggle

**Files:**
- Modify: `apps/web/src/pages/customers/CustomerForm.tsx` (rewrite — the current 336-line file loses its inline `FormState`, `EMPTY`, `toFormState`, `Field`, `applyAddress` and all three form sections to Tasks 1–3)

**Interfaces:**
- Consumes: `CustomerFormState`, `EMPTY_CUSTOMER_FORM`, `toCustomerFormState`, `toCustomerInput`, `validateCustomerForm`, `isCustomerFormDirty` from `../../lib/customerForm` (Task 1); `CustomerFields` (Task 2); `CustomerDetailView` (Task 3); `displayName` from `../../lib/customerName`.
- Produces: nothing consumed by later tasks — it is a route component.

- [ ] **Step 1: Replace the file**

Overwrite `apps/web/src/pages/customers/CustomerForm.tsx` with:

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Customer create / view / edit page.
 *
 * One component serves both routes. At `/customers/new` there is no
 * record yet, so the page opens straight into the editable field set.
 * At `/customers/:id` it opens READ-ONLY: looking a customer up (a
 * phone number before calling, an address before driving) is the common
 * visit, and a live form makes every one of those visits a chance to
 * change the record by accident. The pen button in the header enters
 * edit mode; Cancel and Save return to the view.
 *
 * Entering edit seeds the form from the freshly loaded record rather
 * than from a value cached on first render, so the form can never show
 * a stale copy of a customer that was saved a moment ago.
 *
 * Delete lives inside edit mode. The default state of this screen is
 * something to read, and a destructive control does not belong there.
 *
 * The field set itself and the form's state rules are not here — see
 * `components/CustomerFields` and `lib/customerForm`, which the order
 * editor's `CustomerEditModal` shares.
 */

import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import PageHeader from '../../components/PageHeader';
import CustomerFields from '../../components/CustomerFields';
import CustomerDetailView from './CustomerDetailView';
import { displayName } from '../../lib/customerName';
import {
  EMPTY_CUSTOMER_FORM,
  isCustomerFormDirty,
  toCustomerFormState,
  toCustomerInput,
  validateCustomerForm,
  type CustomerFormState,
} from '../../lib/customerForm';
import {
  useCustomer,
  useCreateCustomer,
  useUpdateCustomer,
  useDeleteCustomer,
} from '../../hooks/useCustomers';

/**
 * Pen glyph for the "edit this record" control. Inline because this
 * codebase carries no icon dependency; `currentColor` lets the button
 * own the colour.
 */
function PencilIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4Z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="m13.5 6.5 4 4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

export default function CustomerForm() {
  const { id } = useParams<{ id: string }>();
  /** True on `/customers/:id` — the route addresses a saved record. */
  const isExisting = Boolean(id);
  const navigate = useNavigate();

  const { data: existing, isLoading, error } = useCustomer(id);
  const create = useCreateCustomer();
  const update = useUpdateCustomer();
  const remove = useDeleteCustomer();

  /**
   * Whether the field set is showing. A new customer has nothing to
   * read, so it starts open; a saved one starts closed.
   */
  const [editing, setEditing] = useState(!isExisting);
  const [form, setForm] = useState<CustomerFormState>(EMPTY_CUSTOMER_FORM);

  /** Seeds the form from the loaded record and opens the field set. */
  function startEditing() {
    if (!existing) return;
    setForm(toCustomerFormState(existing));
    setEditing(true);
  }

  /**
   * Leaves edit mode, confirming first when there is typed work to
   * lose. A new customer has no view to fall back to, so Cancel there
   * returns to the list instead.
   */
  function cancelEditing() {
    if (!isExisting) return navigate('/customers');
    if (existing && isCustomerFormDirty(form, existing)) {
      if (!window.confirm('Discard changes?')) return;
    }
    setEditing(false);
  }

  /**
   * Validates and saves.
   *
   * On an existing customer this returns to the read-only view with the
   * refreshed record — the screen the user came from — rather than
   * bouncing to the list. Creating still goes to the list, because a
   * brand-new record's next step is usually the next record.
   *
   * A failure keeps the field set open with the typed values intact.
   */
  function handleSave() {
    const message = validateCustomerForm(form);
    if (message) return toast.error(message);

    const payload = toCustomerInput(form);
    if (isExisting && id) {
      update.mutate(
        { id, patch: payload },
        {
          onSuccess: () => {
            toast.success('Customer updated.');
            setEditing(false);
          },
          onError: (e) => toast.error(e.message),
        }
      );
    } else {
      create.mutate(payload, {
        onSuccess: () => {
          toast.success('Customer created.');
          navigate('/customers');
        },
        onError: (e) => toast.error(e.message),
      });
    }
  }

  /** Confirms then soft-deletes the customer. */
  function handleDelete() {
    if (!id) return;
    if (!window.confirm('Delete this customer? Their existing orders are kept.')) return;
    remove.mutate(id, {
      onSuccess: () => {
        toast.success('Customer deleted.');
        navigate('/customers');
      },
      onError: (e) => toast.error(e.message),
    });
  }

  if (isExisting && (isLoading || (!existing && !error))) {
    return (
      <div className="min-h-screen bg-surface-muted">
        <PageHeader title="Customer" backTo="/customers" />
        <p className="p-4 text-text-muted">Loading…</p>
      </div>
    );
  }
  if (isExisting && error) {
    return (
      <div className="min-h-screen bg-surface-muted">
        <PageHeader title="Customer" backTo="/customers" />
        <p className="p-4 text-danger">{error.message}</p>
      </div>
    );
  }

  const pending = create.isPending || update.isPending;

  // Read-only view. Reachable only with a loaded record, since the
  // guards above cover every other state of an existing customer.
  if (!editing && existing) {
    return (
      <div className="min-h-screen bg-surface-muted pb-8">
        <PageHeader
          title={displayName(existing)}
          eyebrow="Customer"
          backTo="/customers"
          right={
            <button
              type="button"
              onClick={startEditing}
              aria-label="Edit customer"
              className="flex h-11 w-11 items-center justify-center rounded-md border border-border-input bg-surface text-text-secondary hover:bg-surface-sunken"
            >
              <PencilIcon />
            </button>
          }
        />
        <div className="page-container flex flex-col gap-4 py-4 md:py-6 lg:py-8 [--page-max:48rem]">
          <CustomerDetailView customer={existing} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-muted pb-28">
      <PageHeader title={isExisting ? 'Edit Customer' : 'New Customer'} backTo="/customers" />
      <div className="page-container flex flex-col gap-4 py-4 md:py-6 lg:py-8 [--page-max:48rem]">
        <CustomerFields value={form} onChange={setForm} variant="page" />

        {isExisting && (
          <button
            onClick={handleDelete}
            disabled={remove.isPending}
            className="h-11 rounded-md border border-border-input bg-surface text-[13px] font-medium text-danger hover:bg-surface-muted disabled:opacity-40"
          >
            {remove.isPending ? 'Deleting…' : 'Delete Customer'}
          </button>
        )}
      </div>

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex w-full max-w-lg gap-2.5">
          <button
            onClick={cancelEditing}
            disabled={pending}
            className="flex h-12 flex-1 items-center justify-center rounded-md border border-border-input bg-surface text-sm font-semibold text-text-primary hover:bg-surface-sunken disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={pending}
            className="flex h-12 flex-[2] items-center justify-center rounded-md bg-brand-600 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-40"
          >
            {pending ? 'Saving…' : isExisting ? 'Save Changes' : 'Create Customer'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck, lint, and run the full suite**

```bash
pnpm check && pnpm lint && pnpm test
```

Expected: `check` silent, `lint` reports 0 warnings and 0 errors, `test` all files pass.

- [ ] **Step 3: Verify in the browser**

Start the preview and walk the flow. `apps/web` needs Supabase env to render — if `apps/web/.env` is missing the app renders blank; in that case skip to Step 4 and note the visual check as deferred rather than inventing a result.

Check, at `/customers/:id` for a real customer:
1. Page opens read-only — no inputs, title is the customer's name, `CUSTOMER` eyebrow above it.
2. Pen button top-right; clicking it shows the field set with the record's values loaded.
3. Change the phone, press Cancel → `Discard changes?` prompt; dismissing it stays in edit.
4. Press Cancel with nothing changed → returns to the view with no prompt.
5. Change the phone, Save → toast, returns to the **view**, and the new number is shown.
6. `/customers/new` still opens straight into the form and Create still returns to the list.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/customers/CustomerForm.tsx
git commit -m "feat(customers): open /customers/:id read-only with a pen to edit"
```

---

### Task 5: Customer edit modal

**Files:**
- Create: `apps/web/src/components/CustomerEditModal.tsx`

**Interfaces:**
- Consumes: `CustomerFields` (Task 2); `toCustomerFormState`, `toCustomerInput`, `validateCustomerForm`, `type CustomerFormState` from `../lib/customerForm` (Task 1); `useUpdateCustomer` from `../hooks/useCustomers`; `Modal`, `Button` from `./ui`.
- Produces:
  ```ts
  export default function CustomerEditModal(props: {
    customer: Customer;
    onSaved: (customer: Customer) => void;
    onClose: () => void;
  }): JSX.Element;
  ```

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/CustomerEditModal.tsx`:

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * CustomerEditModal — edits an existing customer record from inside
 * another flow, currently the order editor's customer card.
 *
 * The case it exists for: a wrong phone number or a mistyped street
 * noticed while writing up an order. Before it, fixing that meant
 * abandoning the order editor for the customers module and navigating
 * back.
 *
 * Writes the `customers` row and nothing else — the order is neither
 * saved nor dirtied by this dialog, so order pricing and totals are
 * untouched (AI_GUIDELINES rule 1 is not in play). The saved row is
 * handed back through `onSaved` so the opener can refresh whatever it
 * renders from it; `useUpdateCustomer` separately refreshes the
 * customer detail and list caches, so the customers module reflects
 * the change with no extra plumbing here.
 *
 * Sibling of `CustomerCreateModal` and follows the same contract:
 * callers mount it conditionally rather than toggling a prop, so it
 * passes `open` as a constant `true`. Escape handling, backdrop
 * dismissal, body scroll lock and focus all come from `Modal` — this
 * file must not add its own, or the close handler would fire twice.
 *
 * Rendered at z-50 (by `Modal`) so it stacks above the z-40 sheets that
 * open it.
 */

import { useState } from 'react';
import toast from 'react-hot-toast';
import CustomerFields from './CustomerFields';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { useUpdateCustomer } from '../hooks/useCustomers';
import { displayName } from '../lib/customerName';
import {
  toCustomerFormState,
  toCustomerInput,
  validateCustomerForm,
  type CustomerFormState,
} from '../lib/customerForm';
import type { Customer } from '../types';

export default function CustomerEditModal({
  customer,
  onSaved,
  onClose,
}: {
  /** The record to edit; seeds the form once, on mount. */
  customer: Customer;
  /** Called with the saved row so the opener can refresh its copy. */
  onSaved: (customer: Customer) => void;
  onClose: () => void;
}) {
  const updateMut = useUpdateCustomer();
  // Seeded once by the initializer, not synced from the prop: while the
  // dialog is open the user's typing is the truth, and re-seeding from
  // a re-rendered prop would discard it mid-edit.
  const [form, setForm] = useState<CustomerFormState>(() => toCustomerFormState(customer));

  /**
   * Validates and saves. A failure toasts and leaves the dialog open
   * with the typed values intact — closing it would throw away work the
   * user can no longer recover.
   */
  async function submit() {
    const message = validateCustomerForm(form);
    if (message) return toast.error(message);
    try {
      const saved = await updateMut.mutateAsync({
        id: customer.id,
        patch: toCustomerInput(form),
      });
      toast.success(`Customer ${displayName(saved)} updated.`);
      onSaved(saved);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the customer.');
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit customer"
      subtitle="Changes apply to the customer record everywhere"
      size="lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={submit} loading={updateMut.isPending}>
            {updateMut.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <CustomerFields value={form} onChange={setForm} variant="modal" autoFocus />
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

```bash
pnpm check && pnpm lint
```

Expected: no output from `check`; `Found 0 warnings and 0 errors` from `lint`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/CustomerEditModal.tsx
git commit -m "feat(customers): customer edit modal for use inside other flows"
```

---

### Task 6: Pen button on the order editor's customer card

**Files:**
- Modify: `apps/web/src/pages/orders/OrderHeaderCards.tsx` (module doc at lines 4–27; `CustomerCard` signature ~lines 88–99; action row ~lines 133–170)
- Modify: `apps/web/src/pages/orders/OrderDetail.tsx` (import block near line 76; state near line 591; `CustomerCard` usage at lines 2413–2417; modal mount near line 2831)

**Interfaces:**
- Consumes: `CustomerEditModal` (Task 5).
- Produces: `CustomerCard` gains one required prop — `onEdit: () => void`.

- [ ] **Step 1: Correct the OrderHeaderCards module doc**

In `apps/web/src/pages/orders/OrderHeaderCards.tsx`, replace this sentence in the file header (currently lines 13–15):

```
 * form fields — this is something to read, and boxes around unchangeable
 * values invite edits that cannot happen. Editing a customer stays in
 * the Customers module; nothing here writes back to the customer row.
```

with:

```
 * form fields — this is something to read, and boxes around editable
 * values inside an order card would blur which record is being changed.
 * The pen beside the picker opens `CustomerEditModal` for that: the
 * card itself still writes nothing, and editing a customer still never
 * touches the order.
```

- [ ] **Step 2: Add the `onEdit` prop to CustomerCard**

Replace the `CustomerCard` JSDoc and signature (currently lines ~80–99):

```tsx
/**
 * Customer card: searchable picker as the title row plus an expandable
 * read-only detail panel.
 *
 * @param customer  Currently selected customer, or `null` while unset.
 * @param onPick    Opens the customer search sheet owned by `OrderDetail`.
 * @param onEdit    Opens the customer edit dialog owned by `OrderDetail`.
 * @param readOnly  Suppresses the picker click and hides the pen (the
 *                  card still expands, because reading is always safe).
 */
export function CustomerCard({
  customer,
  onPick,
  onEdit,
  readOnly,
}: {
  customer: Customer | null;
  onPick: () => void;
  onEdit: () => void;
  readOnly: boolean;
}) {
```

- [ ] **Step 3: Add the pen button to the action row**

In the same file, insert this block immediately **before** the `{canExpand && (` chevron button (currently line ~146), inside the `flex items-stretch gap-2` div:

```tsx
          {/* Correct the customer record without leaving the order. Hidden
              when nothing is selected (nothing to edit) and when the order
              is read-only, matching the picker beside it. */}
          {canExpand && !readOnly && (
            <button
              type="button"
              onClick={onEdit}
              aria-label="Edit customer"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border-input bg-surface text-text-muted hover:bg-surface-muted"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4Z"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path d="m13.5 6.5 4 4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
              </svg>
            </button>
          )}
```

- [ ] **Step 4: Import the modal in OrderDetail**

In `apps/web/src/pages/orders/OrderDetail.tsx`, directly below the existing line 76:

```tsx
import CustomerCreateModal from '../../components/CustomerCreateModal';
```

add:

```tsx
import CustomerEditModal from '../../components/CustomerEditModal';
```

- [ ] **Step 5: Add the open/closed state**

Directly below the existing line 591:

```tsx
  const [addingCustomer, setAddingCustomer] = useState(false);
```

add:

```tsx
  // Inline customer-record editor, opened by the pen on the customer card.
  // Separate from `addingCustomer` because the two dialogs edit different
  // things and may not both be open.
  const [editingCustomer, setEditingCustomer] = useState(false);
```

- [ ] **Step 6: Wire the card**

Replace the `CustomerCard` usage (currently lines 2413–2417):

```tsx
            <CustomerCard
              customer={customer}
              onPick={() => setSheet('customer')}
              onEdit={() => setEditingCustomer(true)}
              readOnly={readOnly}
            />
```

- [ ] **Step 7: Mount the modal**

Directly below the closing `)}` of the `{addingCustomer && (...)}` block (currently line ~2841), add:

```tsx
      {/*
        Inline customer-record editor. Mounted here, at the page tail,
        rather than beside the card — the card sits inside the
        `fieldset disabled={readOnly}` wrapper, and a dialog rendered in
        that subtree would inherit the disabled state and present a form
        nobody can type into. Writes the customer row only; the order is
        neither saved nor dirtied.
      */}
      {editingCustomer && customer && (
        <CustomerEditModal
          customer={customer}
          onClose={() => setEditingCustomer(false)}
          onSaved={(saved) => {
            setCustomer(saved);
            setEditingCustomer(false);
          }}
        />
      )}
```

- [ ] **Step 8: Typecheck, lint, and run the full suite**

```bash
pnpm check && pnpm lint && pnpm test
```

Expected: `check` silent, `lint` reports 0 warnings and 0 errors, `test` all files pass.

- [ ] **Step 9: Verify in the browser**

On an existing order with a customer selected:
1. The customer card's action row reads picker · pen · chevron.
2. The pen opens the dialog with the customer's values, first name focused.
3. Change the phone and Save → toast, dialog closes, and expanding the card's chevron shows the new number.
4. Navigate to `/customers/:id` for that customer → the read-only view shows the new number too (the shared cache).
5. Reopen the pen, change something, press Cancel → the card still shows the previous value.
6. On an order with no customer selected, no pen is shown.

If the app cannot render for lack of Supabase env, note the visual check as deferred rather than reporting an unverified pass.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/orders/OrderHeaderCards.tsx apps/web/src/pages/orders/OrderDetail.tsx
git commit -m "feat(orders): edit the customer record from the order's customer card"
```

---

### Task 7: Knowledge base and memory bank

**Files:**
- Modify: `knowledge/history/engine_features.md`
- Modify: `memory-bank/activeContext.md`
- Modify: `memory-bank/progress.md`

Rules 4 and 5 make this mandatory — the task is not complete without it.

- [ ] **Step 1: Append the feature history entry**

The file's entries are `## YYYY-MM-DD — Title` followed by prose paragraphs with bolded lead-ins and a closing `### Verified`. Append this at the end of `knowledge/history/engine_features.md`, filling in the real test counts from Step 3:

```markdown
## 2026-09-02 — Customer edit mode (read-only by default, pen to edit)

**Why.** `/customers/:id` opened straight into a live form. Looking a customer up — a phone
number before calling, an address before driving — is the common visit, and every one of them
was a chance to change the record by accident. There was also no way to correct a customer
from the order editor: a wrong number noticed while writing up an order meant abandoning the
editor for the customers module and navigating back.

**Web — customers page** (`pages/customers/CustomerForm.tsx`). The route now opens READ-ONLY,
rendering the new `pages/customers/CustomerDetailView.tsx`: the same three sections as the
form, as label/value rows with an em dash for blanks, email as `mailto:` and phone as `tel:`
(this app is used on a phone, in the field). Label/value rather than disabled inputs — a
greyed-out box reads as broken, not as read-only. A pen button in the `PageHeader` right slot
enters edit mode, and the header shows the customer's `displayName` under a `CUSTOMER` eyebrow
instead of "Edit Customer". Entering edit SEEDS the form from the freshly loaded record, which
replaced the old `loaded` flag and its effect — the form can no longer show a stale copy of a
customer saved a moment ago. Saving an existing customer returns to the VIEW with the refreshed
record rather than bouncing to the list (creating still goes to the list). Cancel prompts only
when `isCustomerFormDirty`. Delete moved inside edit mode: the default state of the screen is
something to read, and a destructive control does not belong there. `/customers/new` is
unchanged.

**Web — order editor.** `CustomerCard` (`pages/orders/OrderHeaderCards.tsx`) gained a pen
between the picker and the disclosure chevron, shown only with a customer selected and
`!readOnly`. It opens the new `components/CustomerEditModal.tsx` — `Modal` + the shared field
set + `useUpdateCustomer` — which writes the `customers` row and NOTHING else: the order is
neither saved nor dirtied, so pricing and totals are untouched (rule 1 is not in play). The
saved row comes back through `onSaved` into `setCustomer`, and `useUpdateCustomer`'s existing
`onSuccess` refreshes the detail and list caches, so the customers module reflects the change
with no extra plumbing.

**LOCKED — where the dialog is mounted.** `CustomerEditModal` is mounted at `OrderDetail`'s
page tail beside `CustomerCreateModal`, deliberately OUTSIDE the `fieldset disabled={readOnly}`
wrapper. A dialog rendered inside that subtree inherits the disabled fieldset and presents a
form nobody can type into. `readOnly` is currently a vestigial `const readOnly = false`, so the
bug would not bite today and would be baffling the day that constant becomes real.

**Sharing, not duplicating.** The order-side dialog needs the same fields the page has, so the
form was extracted rather than copied a third time: `lib/customerForm.ts` (the pure
`CustomerFormState`, `EMPTY_CUSTOMER_FORM`, `toCustomerFormState`, `toCustomerInput`,
`validateCustomerForm`, `isCustomerFormDirty`) and `components/CustomerFields.tsx` (the Contact
/ Shipping / Billing inputs, `variant` selecting bordered cards on a page or flush sections in
a dialog). `validateCustomerForm` mirrors the server's create refinement in
`apps/api/src/routes/customers.ts`, and now lives in ONE place instead of the two it had drifted
into. `isCustomerFormDirty` skips the billing fields while "same as shipping" is ticked — those
inputs are hidden and their values deliberately retained, so treating them as unsaved changes
would prompt the user to discard nothing.

**Deliberately untouched.** `components/CustomerCreateModal.tsx` keeps its own compact,
billing-less layout — a deliberate difference for a quick add inside a picker, not drift.
And there are NO api, schema, hook or route changes: `PUT /api/customers/:id` and
`useUpdateCustomer` already did everything needed.

### Verified
`tsc` clean, `oxlint` clean, web <N>/<N> (previous count + 21 new in `lib/customerForm.test.ts`).
No api changes, so the api suite is untouched.
```

- [ ] **Step 2: Update the memory bank**

These two files are **current-state snapshots, not changelogs** (rule 5). Overwrite the relevant sections; do not stack a new dated block on top of the old one.

- `memory-bank/activeContext.md` — set the current focus to the customer edit mode work; under recent changes/learnings record the shared-field-set extraction and the disabled-fieldset constraint, linking to the dated `engine_features.md` entry rather than re-narrating it.
- `memory-bank/progress.md` — record that customer records are now editable from both the customers page and the order editor, and that the customers page is read-only by default.

- [ ] **Step 3: Final full verification**

```bash
pnpm check && pnpm test && pnpm lint
```

Expected: 0 errors, 0 warnings across all three. Paste the real output when reporting — do not summarise a run you did not make.

- [ ] **Step 4: Commit**

```bash
git add knowledge/history/engine_features.md memory-bank/activeContext.md memory-bank/progress.md
git commit -m "docs: record customer edit mode in knowledge base and memory bank"
```
