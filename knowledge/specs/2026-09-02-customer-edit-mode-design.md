# Customer edit mode

**Date:** 2026-09-02
**Status:** Approved — ready for implementation

## Problem

`/customers/:id` opens straight into a live, fully editable form. Every visit to
look something up — a phone number before calling, an address before driving —
is a visit to a screen where a stray tap changes the record. There is no
"reading" state for a customer, only an "editing" state that has not been saved
yet.

Separately, the order editor shows the customer as read-only text
(`CustomerCard` in `pages/orders/OrderHeaderCards.tsx`) with no way to correct
it. A wrong phone number or a mistyped street noticed while writing up an
order means abandoning the order editor, navigating to the customers module,
fixing the record, and navigating back.

## Goal

1. `/customers/:id` opens read-only. A pen-icon button enters edit mode.
2. The order editor's customer card gets the same pen, opening a modal that
   edits the customer record without leaving the order.

## Non-goals

- **No API, schema, or hook changes.** `PUT /api/customers/:id`
  (`apps/api/src/routes/customers.ts`) and `useUpdateCustomer`
  (`hooks/useCustomers.ts`) already do everything needed.
- **No change to `/customers/new`.** Creating a customer is always an editing
  activity; it has no view mode, no pen, and no Cancel, and it still navigates
  to the list on success.
- **No change to `CustomerCreateModal`.** Its compact, billing-less layout is a
  deliberate difference for a quick add inside a picker. Rewiring it onto the
  shared field set would be a refactor this task does not authorize
  (AI_GUIDELINES rule 7).
- **No write to the order.** Editing a customer from the order page writes the
  `customers` row only. Order pricing, totals and line items are untouched —
  AI_GUIDELINES rule 1 is not in play.
- No permission model. Any authenticated user who can reach these screens today
  can already edit customers.

## Architecture

The order-side modal needs the same fields the customers page has. Without
extraction that markup would exist in three places (`CustomerForm`,
`CustomerCreateModal`, and the new modal), and the client-side "name, email or
phone" validation rule — which already exists in two places — would exist in
three. So the editable form is extracted once and shared by the two surfaces
this task builds.

```
lib/customerForm.ts          pure state/validation      (new, tested)
        |
        +-- components/CustomerFields.tsx                (new)
        |         |
        |         +-- pages/customers/CustomerForm.tsx   (edit mode)
        |         +-- components/CustomerEditModal.tsx   (new)
        |                       |
        |                       +-- pages/orders/OrderDetail.tsx
        |
        +-- pages/customers/CustomerDetailView.tsx       (new, read-only)
```

### New: `lib/customerForm.ts`

Pure, no React, no network — sits beside `lib/customerName.ts`, which the same
two modules already share.

| Export | Responsibility |
| --- | --- |
| `CustomerFormState` | The editable subset of `Customer`, all strings except `billing_same_as_shipping` |
| `EMPTY_CUSTOMER_FORM` | Blank state; `shipping_province` defaults to `'ON'`, `billing_same_as_shipping` to `true` |
| `toCustomerFormState(row)` | Copies only editable fields off a server row, `?? ''` for nullable text. Never spreads the row — `id` and timestamps would make the strict update schema 400 |
| `toCustomerInput(form)` | Trims the four identity fields, returns a `CustomerInput` |
| `validateCustomerForm(form)` | Returns an error string or `null`. Mirrors the server's create refinement: at least one of first/last/email/phone, plus the email shape check |
| `isCustomerFormDirty(form, row)` | Compares against `toCustomerFormState(row)`; drives the discard confirmation |

### New: `components/CustomerFields.tsx`

The Contact / Shipping Address / Billing Address card sections as they exist in
`CustomerForm` today, driven by `value: CustomerFormState` and
`onChange: (next: CustomerFormState) => void`. Keeps the address-autocomplete
wiring (`applyAddress`) and the billing-same-as-shipping disclosure, whose
hidden fields retain their values so unchecking restores what was entered.

A `variant` prop selects the chrome: `'page'` renders the three bordered card
sections the customers page uses; `'modal'` renders them flush inside the
`Modal` body. The fields themselves are identical in both.

### New: `pages/customers/CustomerDetailView.tsx`

Presentational, props `{ customer: Customer }`. The same three sections as the
form, values as label/value rows, `—` where a field is empty. Email renders as
`mailto:`, phone as `tel:` — this is a phone-first field app and those are the
two things a consultant opens this screen to do. Billing collapses to a single
"Same as shipping" line when that flag is set.

### Changed: `pages/customers/CustomerForm.tsx`

- New `editing` state, initialised to `!id` — a new customer starts in the
  form, an existing one starts in the view. The existing `isEdit` flag (which
  means "this route has an id", not "the user is editing") keeps its meaning
  and is renamed `isExisting` so the two cannot be confused at a glance.
- View mode: `PageHeader` title becomes the customer's `displayName`, eyebrow
  `CUSTOMER`, right slot a 44×44 pen button (`aria-label="Edit customer"`,
  inline SVG — this codebase has no icon library). Body is
  `CustomerDetailView`. No sticky bar, so `pb-28` drops.
- Entering edit seeds form state from the loaded record. This replaces the
  `loaded` flag and its `useEffect`: the form can no longer show a stale copy
  after a save, and view mode reads the record directly.
- Edit mode: `PageHeader` title `Edit Customer`, no pen. Sticky bar carries
  `Cancel` (secondary) and `Save Changes` (primary).
- `Cancel` returns to view; if `isCustomerFormDirty`, `window.confirm('Discard
  changes?')` first — matching the delete-confirm idiom already in the file.
- **Save on an existing customer returns to view mode** with the fresh record
  instead of navigating to `/customers`. Create still navigates to the list.
- `Delete Customer` moves into edit mode only, keeping the default view purely
  read-only.

### New: `components/CustomerEditModal.tsx`

Props `{ customer, onSaved, onClose }`. Sibling of `CustomerCreateModal` and
follows its contract exactly: mounted conditionally by the caller, passes
`open` as a constant `true`, and adds no Escape/backdrop/scroll-lock handling
of its own — all of that comes from `Modal`, and duplicating it would fire the
close handler twice.

Seeds from `toCustomerFormState(customer)`, validates with
`validateCustomerForm`, saves through `useUpdateCustomer`, hands the saved row
to `onSaved`. Save failures toast and leave the modal open with the typed data
intact.

### Changed: `pages/orders/OrderHeaderCards.tsx`

`CustomerCard` gains an `onEdit: () => void` prop and a pen button between the
picker and the existing chevron. It renders only when a customer is selected
and `!readOnly` — the same conditions the chevron and the picker click already
use. The module's header doc, which currently states that editing a customer
stays in the Customers module, is updated: the card still writes nothing
itself, but it now *opens* the editor.

### Changed: `pages/orders/OrderDetail.tsx`

Adds a `customerEdit` boolean and mounts `CustomerEditModal` at the page tail
beside `CustomerCreateModal` — deliberately outside the
`fieldset disabled={readOnly}` wrapper, so the modal's inputs can never inherit
a disabled fieldset. On save it calls `setCustomer(updated)`, which refreshes
the card immediately; `useUpdateCustomer`'s existing `onSuccess` already
refreshes the customer detail and list caches, so `/customers` reflects the
change without extra plumbing.

## Data flow

```
pen (customers page)   -> editing = true, form <- toCustomerFormState(record)
pen (order card)       -> CustomerEditModal, form <- toCustomerFormState(customer)
Save                   -> validateCustomerForm -> toCustomerInput
                       -> useUpdateCustomer -> PUT /api/customers/:id
                       -> server row back
                          customers page: editing = false, view renders row
                          order page:     setCustomer(row), modal closes
                          both:           detail cache set, list cache invalidated
```

## Error handling

| Case | Behaviour |
| --- | --- |
| Record still loading | Existing loading state, title `Customer` |
| Fetch failed | Existing error state, title `Customer` |
| Validation failed | `toast.error`, stay in edit mode / modal open |
| Save failed | `toast.error`, stay in edit mode / modal open, typed data kept |
| Cancel with changes | `window.confirm('Discard changes?')` |
| Cancel with no changes | Returns to view immediately, no prompt |

## Testing

`lib/customerForm.test.ts` — `apps/web` has no DOM test harness (every test is
pure `.ts`), which is the reason the state and validation logic is extracted
into a pure module rather than left inside the components:

- `toCustomerFormState` — `null` text columns become `''`; `shipping_province`
  falls back to `'ON'`; `billing_same_as_shipping` falls back to `true`;
  `id` and timestamp columns never appear in the result
- `toCustomerInput` — trims first/last/email/phone, leaves address fields alone
- `validateCustomerForm` — rejects the wholly anonymous record, accepts a
  record identified by any single one of the four fields, rejects a malformed
  email, accepts an empty one
- `isCustomerFormDirty` — false for a freshly seeded form; true for a changed
  text field, a changed province, and a toggled `billing_same_as_shipping`

Then, in `apps/web`: `pnpm check`, `pnpm test`, `pnpm lint` — 0 errors,
0 warnings (AI_GUIDELINES rule 9).

## Documentation obligations

- SPDX + copyright header on all four new files (rule 10).
- JSDoc on every new module, component, function and type; module headers
  explain responsibility and integration context (rule 3).
- `knowledge/history/engine_features.md` entry (rule 4).
- `memory-bank/activeContext.md` and `progress.md` updated as current-state
  snapshots, not appended changelog entries (rule 5).
