# Incomplete Draft Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a draft order save blind items whose options or measurements are not decided yet, while no order can leave draft (send, PDF, confirm, stage move) until every item is complete — and never show a partial total as if it were the order total.

**Architecture:** One pure completeness rule, `lineItemCompleteness.ts`, written as identical twins in `apps/api` and `apps/web`. The Worker's save path stops requiring the fields while the order is a draft and prices an incomplete blind at $0. Every route that takes an order OUT of draft refuses while the rule reports anything missing. Read routes annotate drafts with `incomplete_items` (per order) and `missing_fields` (per line) so the lists and the Present view can hide totals. The editor runs the web twin over its live drafts.

**Tech Stack:** TypeScript, Zod 3, Hono 4 (Cloudflare Worker), supabase-js 2, React 19 + Tailwind 4, React Router (`BrowserRouter`), Vitest, oxlint.

Spec: `knowledge/specs/2026-11-02-incomplete-draft-items-design.md`.

## Global Constraints

- Every new source file starts with `// SPDX-License-Identifier: GPL-3.0-only` / `// Copyright (c) 2026 Blinds Nisa. All rights reserved.`
- Every exported symbol has a JSDoc scoring ≥ 8/10 (purpose, behaviour, constraints, integration context). English only.
- `apps/api/src/lib/lineItemCompleteness.ts` and `apps/web/src/lib/lineItemCompleteness.ts` are TWINS: byte-identical code and byte-identical test files. Change both or neither.
- `apps/{api,web}/src/lib/blindTypes/*` are TWINS too (AI_GUIDELINES §1).
- Server-authoritative money is untouched: the client still sends ids and measurements only; blind schemas stay `.strict()`.
- Locked pattern: every row of a `line_items` bulk insert carries the SAME column set.
- Locked pattern: Hono literal routes stay registered before `/:id`.
- **The invariant: an incomplete item can only exist on a `draft` order.** Gates apply only while the order's CURRENT status is `draft` — a sent/confirmed order is never re-judged against today's Settings scoping (it keeps today's behaviour exactly).
- Message wording (shared by both sides): `Item N (Room): <action>.` with `(Room)` omitted when the room is blank. Actions: `choose a blind type`, `enter every panel width`, `enter a height`, `choose a material`, `choose a cassette`, `choose a bottom rail`, `choose a control option`, `choose an installation option`, and `choose a/an <noun>` for a type's required attribute.
- Present view replacement line, verbatim: `Total available once every item is complete.`
- Editor pricing-panel note, verbatim: `Total excludes N incomplete item(s)` — `1 incomplete item` / `2 incomplete items`.
- Leave-guard prompt, verbatim: `You have unsaved changes. Leave without saving?`
- Verification (AI_GUIDELINES §9), in BOTH workspaces: `pnpm check`, `pnpm test`, `pnpm lint` → 0 errors / 0 warnings.
- Commands run from the repo root: `pnpm --filter ./apps/api <script>`, `pnpm --filter ./apps/web <script>`.

## Coordination with the Dual Shades plan

`knowledge/plans/2026-11-02-dual-shades.md` (not yet executed when this plan was written) adds
`requiredAttributes` / `missingRequiredAttribute` to `BaseBlindType` (its Task 2) and a HARD 400
for a missing back fabric (its Tasks 4 and 5). This plan consumes `requiredAttributes` and makes the
hard gates unnecessary. Task 1 Step 1 below adds the base members if they are absent and annotates
the Dual plan so its Tasks 4–5 become "declare `requiredAttributes`; completeness enforces it".

## File Structure

| File | Responsibility |
|---|---|
| `apps/{api,web}/src/lib/lineItemCompleteness.ts` (create, twins) | The rule: `missingFields`, `firstIncompleteMessage`, `countIncomplete`, `measuredWidths`, `SLOT_NOUNS` |
| `apps/{api,web}/src/lib/lineItemCompleteness.test.ts` (create, twins) | Identical rule tests |
| `apps/{api,web}/src/lib/blindTypes/base.ts` | `RequiredAttribute`, `requiredAttributes`, `missingRequiredAttribute` (only if Dual Task 2 has not landed) |
| `apps/api/src/lib/orderCompleteness.ts` (create) | DB-facing helpers: `incompleteMessageFor`, `loadIncompleteMessage`, `annotateOrderCompleteness`, `attachIncompleteCounts` |
| `apps/api/src/lib/orderCompleteness.test.ts` (create) | Helper tests with a fake client |
| `apps/api/src/routes/orders.ts` | Relaxed blind schema; `resolveLineItems(…, allowIncomplete)`; gates on send/mark-sent/confirm/status/pdf; annotations on reads |
| `apps/api/src/lib/orderDuplicate.ts` | Null-safe `height_cm` and panel entries |
| `apps/api/src/routes/orders.routes.test.ts` | Save, gate and read tests |
| `apps/api/src/lib/orderDuplicate.test.ts` | Null round-trip test |
| `apps/web/src/types/index.ts` | `LineItem.panels: (number \| null)[]`, `LineItem.missing_fields?`, `Order.incomplete_items?` |
| `apps/web/src/hooks/useOrders.ts` | `BlindItemInput` nullable `panels` entries / `height_cm` / `material_id` |
| `apps/web/src/pages/orders/lineItemDrafts.ts` | `scopeFromCatalogs`, `draftCompletenessInput`, `draftMissingFields`, `firstIncompleteDraftMessage`; `blindDraftInputs` uses the rule |
| `apps/web/src/pages/orders/orderPayload.ts` (create) | `buildOrderPayload` + `toIso`, moved out of `OrderDetail.tsx` |
| `apps/web/src/pages/orders/orderPayload.test.ts` (create) | Payload tests |
| `apps/web/src/pages/orders/OrderDetail.tsx` | Uses `buildOrderPayload`; `toDrafts` null panels; pre-checks; pricing note; leave guard |
| `apps/web/src/pages/orders/LineItemRow.tsx` | Amber "Incomplete · …" chip |
| `apps/web/src/pages/orders/PresentationTable.tsx`, `OrderPresentation.tsx` | "To be decided" cells; totals hidden |
| `apps/web/src/pages/estimates/EstimateGroup.tsx`, `pages/orders/OrderList.tsx`, `pages/calendar/AppointmentWizard.tsx` | "Incomplete" badge instead of a draft's total |
| `apps/web/src/components/IncompleteBadge.tsx` (create) | The shared badge |
| `apps/web/src/hooks/useLeaveGuard.ts` (create) | `beforeunload` + same-origin link-click guard |
| `apps/web/src/lib/{labels,manufacturing}.ts`, `pages/customer-view/CustomerView.tsx`, `lib/optionBreakdown.ts` | Read panels through `measuredWidths` (type change ripple) |
| `apps/web/src/pages/orders/bulkAdd.ts` | Doc comment: the save is no longer the gate |
| `knowledge/history/engine_features.md`, `memory-bank/{activeContext,progress,systemPatterns}.md` | Knowledge updates |

---

### Task 1: The completeness rule (twins)

**Files:**
- Modify (only if absent): `apps/api/src/lib/blindTypes/base.ts`, `apps/web/src/lib/blindTypes/base.ts`, both `blindTypes/index.ts`, both `blindTypes/attributes.test.ts`
- Modify: `knowledge/plans/2026-11-02-dual-shades.md` (coordination note)
- Create: `apps/api/src/lib/lineItemCompleteness.ts`, `apps/web/src/lib/lineItemCompleteness.ts`
- Test: `apps/api/src/lib/lineItemCompleteness.test.ts`, `apps/web/src/lib/lineItemCompleteness.test.ts`

**Interfaces:**
- Consumes: `getBlindType(name)` from `./blindTypes`; `CatalogSlot` from `./blindTypes/base`; `BaseBlindType.requiredAttributes: readonly RequiredAttribute[]`.
- Produces (both twins, identical):
  - `interface CompletenessInput { item_type: 'blind' | 'preset' | 'custom'; room_name?: string | null; blinds_type?: string | null; panels?: readonly (number | null)[] | null; height_cm?: number | null; material_id?: string | null; cassette_id?: string | null; bottom_rail_id?: string | null; control_id?: string | null; installation_id?: string | null; attributes?: Record<string, unknown> | null }`
  - `interface CompletenessScope { isKnownType(name: string): boolean; usesSlot(name: string, slot: CatalogSlot): boolean; requiredAttributes?(name: string): readonly { key: string; noun: string }[] }`
  - `const SLOT_NOUNS: Record<CatalogSlot, string>`
  - `missingFields(item: CompletenessInput, scope: CompletenessScope): string[]`
  - `incompleteMessage(index: number, item: CompletenessInput, missing: readonly string[]): string`
  - `firstIncompleteMessage(items: readonly CompletenessInput[], scope: CompletenessScope): string | null`
  - `countIncomplete(items: readonly CompletenessInput[], scope: CompletenessScope): number`
  - `measuredWidths(panels: readonly (number | null)[] | null | undefined): number[]`

- [ ] **Step 1: Make sure the base hook exists, and annotate the Dual plan**

Run: `grep -n "requiredAttributes" apps/api/src/lib/blindTypes/base.ts apps/web/src/lib/blindTypes/base.ts`

If BOTH files already declare it (Dual Shades Task 2 landed), skip to the Dual-plan note below. Otherwise add to BOTH `base.ts` files, beside `CatalogRef`:

```ts
/**
 * An attribute a blind type cannot be SENT without. `noun` completes the
 * shared message "Item N: choose a <noun>." — the same wording the editor
 * and the Worker use, produced by `lib/lineItemCompleteness.ts`.
 *
 * Declared here rather than by making the schema field non-optional,
 * because `attributeSchema` must still accept `{}` (every historical row
 * and `defaultAttributes()` parse through it) and because a draft may be
 * SAVED without it (spec 2026-11-02, incomplete draft items).
 */
export interface RequiredAttribute {
  /** Attribute key, declared in the type's `attributeSchema`. */
  readonly key: string;
  /** Human noun for the message, e.g. "back fabric". */
  readonly noun: string;
}
```

and in `class BaseBlindType`, after `catalogRefs`:

```ts
  /**
   * Attributes this type cannot be sent without. Empty for every type
   * except those that declare one (Dual Shades' back fabric). Read by
   * `lib/lineItemCompleteness.ts`, which makes a blind missing one
   * INCOMPLETE: savable on a draft, refused by every route that takes
   * the order out of draft.
   */
  readonly requiredAttributes: readonly RequiredAttribute[] = [];

  /**
   * The first {@link requiredAttributes} entry whose value in `attrs` is
   * absent or a blank string, or null when all are present. Accepts the
   * raw draft map (strings) as well as a parsed blob.
   */
  missingRequiredAttribute(attrs: Record<string, unknown>): RequiredAttribute | null {
    return (
      this.requiredAttributes.find((r) => {
        const v = attrs[r.key];
        return typeof v !== 'string' || v.trim() === '';
      }) ?? null
    );
  }
```

Export `type RequiredAttribute` from both `blindTypes/index.ts` next to the other type exports. Append to the `generic extension points` describe in BOTH `attributes.test.ts` files (if that describe does not exist, add `describe('generic extension points', () => { … })` at the end of the file):

```ts
  it('defaults to no required attributes', () => {
    const t = new BaseBlindType();
    expect(t.requiredAttributes).toEqual([]);
    expect(t.missingRequiredAttribute({})).toBeNull();
  });

  it('reports the first required attribute that is absent or blank', () => {
    class ReqBlindType extends BaseBlindType {
      readonly blindType = 'ReqTest';
      readonly requiredAttributes = [{ key: 'widget_id', noun: 'widget' }];
    }
    const t = new ReqBlindType();
    expect(t.missingRequiredAttribute({})).toEqual({ key: 'widget_id', noun: 'widget' });
    expect(t.missingRequiredAttribute({ widget_id: '  ' })).toEqual({ key: 'widget_id', noun: 'widget' });
    expect(t.missingRequiredAttribute({ widget_id: 'x' })).toBeNull();
  });
```

Then, in `knowledge/plans/2026-11-02-dual-shades.md`, insert directly under its `## Global Constraints` heading:

```markdown
> **Superseded in part by `knowledge/plans/2026-11-02-incomplete-draft-items.md`.** If that plan
> has landed: Task 2's `requiredAttributes` / `missingRequiredAttribute` already exist (skip their
> steps); Task 4's hard 400 in `resolveLineItems` and Task 5's `buildPayload` guard are NOT added —
> declaring `requiredAttributes = [{ key: 'back_material_id', noun: 'back fabric' }]` on
> `DualShadesBlindType` is enough, because `lib/lineItemCompleteness.ts` makes a Dual line without a
> back fabric incomplete (savable on a draft, refused at send). Task 5's preview gate in
> `blindDraftInputs` is also already covered (it calls `draftMissingFields`).
```

- [ ] **Step 2: Write the failing rule tests** — create `apps/api/src/lib/lineItemCompleteness.test.ts` and an IDENTICAL `apps/web/src/lib/lineItemCompleteness.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the incomplete-item rule (spec 2026-11-02). TWIN of the other
 * workspace's file — the editor's chips/pre-checks and the Worker's
 * gates must agree on every case here, so the two files stay identical.
 */

import { describe, it, expect } from 'vitest';
import {
  countIncomplete,
  firstIncompleteMessage,
  measuredWidths,
  missingFields,
  type CompletenessInput,
  type CompletenessScope,
} from './lineItemCompleteness';

const ID = '11111111-1111-4111-8111-111111111111';

/** Roller uses cassette + bottom rail + control; Curtains control + installation. */
const scope: CompletenessScope = {
  isKnownType: (t) => t === 'Roller' || t === 'Curtains' || t === 'ReqTest',
  usesSlot: (t, s) =>
    (t === 'Roller' ? ['cassette', 'bottom_rail', 'control'] : t === 'Curtains' ? ['control', 'installation'] : []).includes(s),
  requiredAttributes: (t) => (t === 'ReqTest' ? [{ key: 'widget_id', noun: 'widget' }] : []),
};

function roller(over: Partial<CompletenessInput> = {}): CompletenessInput {
  return {
    item_type: 'blind',
    room_name: 'Kitchen',
    blinds_type: 'Roller',
    panels: [70, 70],
    height_cm: 200,
    material_id: ID,
    cassette_id: ID,
    bottom_rail_id: ID,
    control_id: ID,
    installation_id: null,
    attributes: {},
    ...over,
  };
}

describe('missingFields', () => {
  it('reports nothing for a complete blind', () => {
    expect(missingFields(roller(), scope)).toEqual([]);
  });

  it('lists every open field of a bulk-added blank row, in message order', () => {
    const blank = roller({ blinds_type: '', panels: [], height_cm: null, material_id: null, cassette_id: null, bottom_rail_id: null, control_id: null });
    // A blank type uses no slot, so only the four type-independent fields show.
    expect(missingFields(blank, scope)).toEqual(['blind type', 'width', 'height', 'material']);
  });

  it('treats a blank panel among measured ones as a missing width', () => {
    expect(missingFields(roller({ panels: [70, null] }), scope)).toEqual(['width']);
    expect(missingFields(roller({ panels: [70, 0] }), scope)).toEqual(['width']);
  });

  it('lists only the slots the type uses', () => {
    expect(missingFields(roller({ material_id: null, control_id: null }), scope)).toEqual(['material', 'control option']);
    const curtain = roller({ blinds_type: 'Curtains', cassette_id: null, bottom_rail_id: null, installation_id: null });
    expect(missingFields(curtain, scope)).toEqual(['installation option']);
  });

  it('leaves an unknown legacy type unconstrained on hardware', () => {
    const legacy = roller({ blinds_type: 'Venetian (legacy)', cassette_id: null, bottom_rail_id: null, control_id: null });
    expect(missingFields(legacy, scope)).toEqual([]);
  });

  it("reports a type's required attribute when blank", () => {
    expect(missingFields(roller({ blinds_type: 'ReqTest', attributes: {} }), scope)).toEqual(['widget']);
    expect(missingFields(roller({ blinds_type: 'ReqTest', attributes: { widget_id: ID } }), scope)).toEqual([]);
  });

  it('never reports a preset or custom item', () => {
    expect(missingFields({ item_type: 'preset' }, scope)).toEqual([]);
    expect(missingFields({ item_type: 'custom' }, scope)).toEqual([]);
  });
});

describe('firstIncompleteMessage', () => {
  it('names the first incomplete item by its position and room', () => {
    const items: CompletenessInput[] = [{ item_type: 'custom' }, roller({ control_id: null })];
    expect(firstIncompleteMessage(items, scope)).toBe('Item 2 (Kitchen): choose a control option.');
  });

  it('omits the room when blank and uses the measurement wording', () => {
    expect(firstIncompleteMessage([roller({ room_name: '', height_cm: null })], scope)).toBe('Item 1: enter a height.');
    expect(firstIncompleteMessage([roller({ panels: [null] })], scope)).toBe('Item 1 (Kitchen): enter every panel width.');
  });

  it('uses "an" before a vowel', () => {
    const curtain = roller({ blinds_type: 'Curtains', cassette_id: null, bottom_rail_id: null, installation_id: null });
    expect(firstIncompleteMessage([curtain], scope)).toBe('Item 1 (Kitchen): choose an installation option.');
  });

  it('returns null when every item is complete', () => {
    expect(firstIncompleteMessage([roller(), { item_type: 'preset' }], scope)).toBeNull();
  });
});

describe('countIncomplete / measuredWidths', () => {
  it('counts incomplete items, hidden or not', () => {
    expect(countIncomplete([roller(), roller({ material_id: null }), roller({ height_cm: null })], scope)).toBe(2);
  });

  it('keeps only measured widths', () => {
    expect(measuredWidths([70, null, 0, 55])).toEqual([70, 55]);
    expect(measuredWidths(null)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter ./apps/api test -- lineItemCompleteness` and `pnpm --filter ./apps/web test -- lineItemCompleteness`
Expected: FAIL — cannot resolve `./lineItemCompleteness`.

- [ ] **Step 4: Implement** — create `apps/api/src/lib/lineItemCompleteness.ts` and an IDENTICAL `apps/web/src/lib/lineItemCompleteness.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Which product decisions and measurements are still OPEN on a line item.
 *
 * Spec 2026-11-02 (incomplete draft items): a draft may be saved with a
 * blind whose type, widths, height, material, scoped hardware or a
 * type's required attribute are not decided yet. Such an item is
 * INCOMPLETE — stored at $0, and the invariant is that it can exist only
 * on a `draft`: every route that takes an order out of draft refuses
 * while this rule reports anything.
 *
 * TWIN of the other workspace's `lib/lineItemCompleteness.ts`, which
 * must stay byte-identical: the editor's chips and pre-checks run this
 * against live drafts, and the Worker's save and send gates run it
 * against payloads and stored rows. If the two disagreed, the editor
 * would offer a Send the Worker refuses, or the reverse.
 *
 * Pure: the caller supplies the blind-type scoping (`SlotScoping` from
 * `optionScoping.ts` on the Worker, `scopeFromCatalogs` in the editor),
 * so the rule is judged against TODAY's Settings — a type that gains a
 * slot makes its open drafts incomplete, which is intended.
 */

import { getBlindType } from './blindTypes';
import type { CatalogSlot } from './blindTypes/base';

/**
 * The fields the rule reads. Loose on purpose (every field optional and
 * nullable) so a stored row, a parsed payload item and an editor draft
 * converted by `draftCompletenessInput` all satisfy it without mapping.
 */
export interface CompletenessInput {
  item_type: 'blind' | 'preset' | 'custom';
  room_name?: string | null;
  blinds_type?: string | null;
  /** A blank panel width is `null`; `0` reads as blank too. */
  panels?: readonly (number | null)[] | null;
  height_cm?: number | null;
  material_id?: string | null;
  cassette_id?: string | null;
  bottom_rail_id?: string | null;
  control_id?: string | null;
  installation_id?: string | null;
  attributes?: Record<string, unknown> | null;
}

/**
 * Blind-type scoping as the rule needs it. `requiredAttributes` is
 * optional and defaults to the registry's `getBlindType(name)
 * .requiredAttributes`; tests inject it.
 */
export interface CompletenessScope {
  /** True when the name resolves to a configured blind type. */
  isKnownType(name: string): boolean;
  /** True when the type uses that hardware slot (an active option is scoped to it). */
  usesSlot(name: string, slot: CatalogSlot): boolean;
  requiredAttributes?(name: string): readonly { key: string; noun: string }[];
}

/** The noun each hardware slot is reported as — also the message noun. */
export const SLOT_NOUNS: Record<CatalogSlot, string> = {
  cassette: 'cassette',
  bottom_rail: 'bottom rail',
  control: 'control option',
  installation: 'installation option',
};

/** Slot, its id column, in the order the form and the messages list them. */
const SLOT_FIELDS = [
  ['cassette', 'cassette_id'],
  ['bottom_rail', 'bottom_rail_id'],
  ['control', 'control_id'],
  ['installation', 'installation_id'],
] as const;

/** Nouns whose message is "enter …" rather than "choose a …". */
const MEASUREMENT_ACTIONS: Record<string, string> = {
  width: 'enter every panel width',
  height: 'enter a height',
};

const isPositive = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isBlank = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/**
 * Every open field of one item, in message order: blind type, width,
 * height, material, each scoped slot, each required attribute. `[]` for
 * a complete blind and ALWAYS `[]` for a preset/custom item (their own
 * title/price rules run at parse time, unchanged).
 *
 * A blank type uses no slot, and an UNKNOWN non-blank type (legacy free
 * text, a deleted type) is unconstrained on hardware — the same rule the
 * Worker's slot gate has always applied.
 */
export function missingFields(item: CompletenessInput, scope: CompletenessScope): string[] {
  if (item.item_type !== 'blind') return [];
  const out: string[] = [];
  const type = (item.blinds_type ?? '').trim();
  if (type === '') out.push('blind type');
  const panels = item.panels ?? [];
  if (panels.length === 0 || panels.some((p) => !isPositive(p))) out.push('width');
  if (!isPositive(item.height_cm)) out.push('height');
  if (isBlank(item.material_id)) out.push('material');
  if (type !== '' && scope.isKnownType(type)) {
    for (const [slot, key] of SLOT_FIELDS) {
      if (scope.usesSlot(type, slot) && isBlank(item[key])) out.push(SLOT_NOUNS[slot]);
    }
  }
  if (type !== '') {
    const required = scope.requiredAttributes?.(type) ?? getBlindType(type).requiredAttributes;
    const attrs = item.attributes ?? {};
    for (const r of required) if (isBlank(attrs[r.key])) out.push(r.noun);
  }
  return out;
}

/**
 * The user-facing message for one incomplete item, naming its FIRST open
 * field: `Item 3 (Kitchen): choose a control option.` — the wording the
 * editor's save guard has always used, so nothing reads new.
 *
 * @param index Zero-based position in the order's full item list.
 */
export function incompleteMessage(
  index: number,
  item: CompletenessInput,
  missing: readonly string[]
): string {
  const room = (item.room_name ?? '').trim();
  const noun = missing[0] ?? 'blind type';
  const action = MEASUREMENT_ACTIONS[noun] ?? `choose ${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;
  return `Item ${index + 1}${room ? ` (${room})` : ''}: ${action}.`;
}

/**
 * The message for the first incomplete item, or null when the whole list
 * is complete. Hidden items count: the invariant is about the ORDER, and
 * a hidden item can be un-hidden on a sent order.
 */
export function firstIncompleteMessage(
  items: readonly CompletenessInput[],
  scope: CompletenessScope
): string | null {
  for (const [index, item] of items.entries()) {
    const missing = missingFields(item, scope);
    if (missing.length > 0) return incompleteMessage(index, item, missing);
  }
  return null;
}

/** How many items are incomplete — the lists' "Incomplete" badge count. */
export function countIncomplete(
  items: readonly CompletenessInput[],
  scope: CompletenessScope
): number {
  return items.filter((item) => missingFields(item, scope).length > 0).length;
}

/**
 * The measured panel widths of a stored blind, dropping blank (`null`)
 * and non-positive entries. Every display that joins or sums widths
 * reads through this, because a draft may hold a blank panel.
 */
export function measuredWidths(panels: readonly (number | null)[] | null | undefined): number[] {
  return (panels ?? []).filter((w): w is number => typeof w === 'number' && w > 0);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter ./apps/api test -- lineItemCompleteness attributes` and `pnpm --filter ./apps/web test -- lineItemCompleteness attributes`
Expected: PASS. Then `diff apps/api/src/lib/lineItemCompleteness.ts apps/web/src/lib/lineItemCompleteness.ts && diff apps/api/src/lib/lineItemCompleteness.test.ts apps/web/src/lib/lineItemCompleteness.test.ts` — Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/lineItemCompleteness.ts apps/api/src/lib/lineItemCompleteness.test.ts apps/web/src/lib/lineItemCompleteness.ts apps/web/src/lib/lineItemCompleteness.test.ts apps/api/src/lib/blindTypes apps/web/src/lib/blindTypes knowledge/plans/2026-11-02-dual-shades.md
git commit -m "feat(lib): incomplete-item rule (twins) and requiredAttributes hook"
```

---

### Task 2: Worker save path — drafts accept incomplete blinds

**Files:**
- Modify: `apps/api/src/routes/orders.ts` (`blindItemSchema` ~L183–223, `lockInputFromPayload` ~L434, `resolveLineItems` ~L475–880, `createOrderFromInput` ~L1150, `PUT /:id` ~L1320)
- Modify: `apps/api/src/lib/orderDuplicate.ts` (~L109–113)
- Test: `apps/api/src/routes/orders.routes.test.ts`, `apps/api/src/lib/orderDuplicate.test.ts`

**Interfaces:**
- Consumes: `missingFields`, `incompleteMessage` (Task 1).
- Produces: `resolveLineItems(sb, items, locks?, allowIncomplete = false)`; stored incomplete rows have null snapshots for what is missing, `line_total: 0`, `unit_price` = override or 0, `base_unit_price` = 0 when overridden else null, `addons` as sent.

- [ ] **Step 1: Rewrite the two tests that pinned the old rule, and add the new save tests.** In `describe('Curtains line items')`, replace the test `'requires a control while one is still scoped to the type'` with:

```ts
  it('saves a draft blind with a scoped control left open — at $0, snapshot null', async () => {
    const p = payload() as unknown as { line_items: Record<string, unknown>[] };
    p.line_items[0].control_id = null;
    const res = await create(p);
    expect(res.status).toBe(201);
    const rows = db.insertPayloads['line_items']?.[0] as Record<string, unknown>[];
    expect(rows[0].control_id).toBeNull();
    expect(rows[0].control_name).toBeNull();
    expect(rows[0].line_total).toBe(0);
    // Only the 25.00 preset reaches the subtotal.
    expect((db.insertPayloads['orders']?.[0] as Record<string, number>).subtotal).toBe(25);
  });
```

and replace `'still requires a cassette on a type that uses one'` with:

```ts
  it('saves a draft blind missing its cassette at $0', async () => {
    const p = payload() as unknown as { line_items: Record<string, unknown>[] };
    p.line_items[0].cassette_id = null;
    const res = await create(p);
    expect(res.status).toBe(201);
    const rows = db.insertPayloads['line_items']?.[0] as Record<string, unknown>[];
    expect(rows[0].cassette_name).toBeNull();
    expect(rows[0].line_total).toBe(0);
  });
```

Then append a new describe at the end of the file:

```ts
describe('incomplete draft items — saving (spec 2026-11-02)', () => {
  const json = { 'Content-Type': 'application/json' };
  const create = (body: unknown) =>
    ordersApp.request('/', { method: 'POST', body: JSON.stringify(body), headers: json }, ENV);
  const put = (id: string, body: unknown) =>
    ordersApp.request(`/${id}`, { method: 'PUT', body: JSON.stringify(body), headers: json }, ENV);
  const future = () => new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const today = () => new Date().toISOString().slice(0, 10);
  /** payload() with its blind replaced by a bulk-added blank row. */
  function blankPayload(over: Record<string, unknown> = {}) {
    const p = payload() as unknown as { line_items: Record<string, unknown>[]; order_date: string; expiry_date: string };
    p.order_date = today();
    p.expiry_date = future();
    p.line_items[0] = {
      item_type: 'blind', room_name: 'Kitchen', blinds_type: '', panels: [null], height_cm: null,
      material_id: null, cassette_id: null, bottom_rail_id: null, control_id: null, quantity: 1, ...over,
    };
    return p;
  }

  it('creates a draft whose blind has no type, width, height or material', async () => {
    db.orderInsertResults = [{ data: { id: 'n1' } }];
    const res = await create(blankPayload());
    expect(res.status).toBe(201);
    const [row] = db.insertPayloads['line_items']?.[0] as Record<string, unknown>[];
    expect(row).toMatchObject({ blinds_type: '', panels: [null], height_cm: null, material_id: null, material_name: null, material_price_per_sqm: null, line_total: 0, unit_price: 0, base_unit_price: null });
  });

  it('keeps the same column set on an incomplete row as on a priced one', async () => {
    db.orderInsertResults = [{ data: { id: 'n2' } }];
    const p = blankPayload();
    p.line_items.push(payload().line_items[0] as unknown as Record<string, unknown>);
    await create(p);
    const rows = db.insertPayloads['line_items']?.[0] as Record<string, unknown>[];
    const keys = rows.map((r) => Object.keys(r).sort().join(','));
    expect(new Set(keys).size).toBe(1);
  });

  it('keeps an override and add-ons typed on an incomplete item, charging nothing', async () => {
    db.orderInsertResults = [{ data: { id: 'n3' } }];
    const res = await create(blankPayload({ unit_price_override: 150, addons: [{ label: 'Motor', price: 50 }] }));
    expect(res.status).toBe(201);
    const [row] = db.insertPayloads['line_items']?.[0] as Record<string, unknown>[];
    expect(row).toMatchObject({ unit_price: 150, base_unit_price: 0, addons: [{ label: 'Motor', price: 50 }], line_total: 0 });
  });

  it('still rejects a typed garbage measurement', async () => {
    const res = await create(blankPayload({ panels: [-5] }));
    expect(res.status).toBe(400);
    expect(db.calls).not.toContain('orders.insert');
  });

  it('PUT on a draft accepts an incomplete item', async () => {
    db.responses['orders.select'] = [{ id: 'd1', status: 'draft', expiry_date: future(), line_items: [] }];
    const res = await put('d1', blankPayload());
    expect(res.status).toBe(200);
    expect(db.calls).toContain('line_items.insert');
  });

  it('PUT on a sent order refuses an incomplete item and writes nothing', async () => {
    db.responses['orders.select'] = [{ id: 's1', status: 'sent', expiry_date: future(), line_items: [] }];
    const p = payload() as unknown as { line_items: Record<string, unknown>[]; order_date: string; expiry_date: string };
    p.order_date = today();
    p.expiry_date = future();
    p.line_items[0].control_id = null;
    const res = await put('s1', p);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Item 1 (Living Room): choose a control option.' });
    expect(db.calls).not.toContain('line_items.delete');
    expect(db.calls).not.toContain('orders.update');
  });

  it('completing an overridden incomplete item logs no price-change line', async () => {
    db.responses['orders.select'] = [{
      id: 'd2', status: 'draft', expiry_date: future(),
      line_items: [{ position: 0, unit_price: 150, base_unit_price: 0, addons: [] }],
    }];
    const p = payload() as unknown as { line_items: Record<string, unknown>[]; order_date: string; expiry_date: string };
    p.order_date = today();
    p.expiry_date = future();
    p.line_items = [{ ...p.line_items[0], unit_price_override: 150 }];
    const res = await put('d2', p);
    expect(res.status).toBe(200);
    const messages = ((db.insertPayloads['order_logs'] ?? []) as Array<{ message: string }>).map((l) => l.message);
    expect(messages.filter((m) => m.includes('price override'))).toEqual([]);
  });
});
```

And in `apps/api/src/lib/orderDuplicate.test.ts`, add (inside the file's top-level describe, using its existing order-fixture helper if there is one; otherwise this standalone form):

```ts
  it('carries a blank height and blank panels through as null', () => {
    const out = toDuplicateInput({
      customer_id: 'c1', discount_type: 'fixed', discount_value: 0,
      line_items: [{ item_type: 'blind', position: 0, room_name: '', blinds_type: '', panels: [null, 70], height_cm: null, material_id: null, quantity: 1, addons: [], attributes: {} }],
    }) as { line_items: Array<Record<string, unknown>> };
    expect(out.line_items[0].height_cm).toBeNull();
    expect(out.line_items[0].panels).toEqual([null, 70]);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter ./apps/api test -- orders.routes orderDuplicate`
Expected: FAIL — the new tests get 400s from the schema (`material_id` required, `panels` positive) and the duplicate test gets `height_cm: 0`.

- [ ] **Step 3: Relax the blind schema** — in `blindItemSchema` replace the three lines

```ts
    panels: z.array(z.number().positive().max(1000)).min(1, 'At least one panel').max(10),
    height_cm: z.number().positive().max(1000),
    material_id: z.string().uuid(),
```

with

```ts
    /**
     * A BLANK measurement or material is allowed (spec 2026-11-02): a
     * draft may hold a blind that is not decided yet. A blank panel is
     * `null` so the panel COUNT survives; a typed value must still be
     * positive. Whether blanks are acceptable for THIS order is decided
     * in `resolveLineItems` (`allowIncomplete`), never here.
     */
    panels: z.array(z.number().positive().max(1000).nullable()).max(10).default([]),
    height_cm: z.number().positive().max(1000).nullable().default(null),
    material_id: z.string().uuid().nullable().default(null),
```

Add the import beside the other lib imports at the top of `orders.ts`:

```ts
import { incompleteMessage, missingFields } from '../lib/lineItemCompleteness';
```

- [ ] **Step 4: Keep the lock fingerprint type-correct** — in `lockInputFromPayload`, replace `panels: it.panels,` and `height_cm: it.height_cm,` with:

```ts
      // An incomplete item never reaches a lock (it exists only on a
      // draft), so these maps are identity for every item that does.
      panels: it.panels.map((p) => p ?? 0),
      height_cm: it.height_cm ?? 0,
```

- [ ] **Step 5: `resolveLineItems` takes `allowIncomplete`** — change the signature and doc:

```ts
 * `allowIncomplete` is true only when the order is (or, in this save,
 * becomes) a `draft`. Then a blind the completeness rule reports open is
 * stored with null snapshots for what is missing and `line_total: 0`;
 * otherwise the first such item throws the shared message.
 ...
async function resolveLineItems(
  sb: SupabaseClient,
  items: z.infer<typeof lineItemSchema>[],
  locks?: Map<string, StoredLock>,
  allowIncomplete = false
): Promise<LineItemRow[]> {
```

In the id-collection loop, replace `ids.materials.add(it.material_id);` with:

```ts
    if (it.material_id) ids.materials.add(it.material_id);
```

In the blind (unlocked) branch, replace

```ts
    const material = materials.get(it.material_id);
    if (!material) throw new Error('Selected material no longer exists.');
```

with

```ts
    // Open fields are judged FIRST: on a non-draft order an incomplete
    // item is refused with the shared message before anything is looked
    // up; on a draft it is priced at $0 below.
    const missing = missingFields(it, scoping);
    if (missing.length > 0 && !allowIncomplete) {
      throw new Error(incompleteMessage(position, it, missing));
    }
    const complete = missing.length === 0;
    const material = it.material_id ? materials.get(it.material_id) : undefined;
    if (it.material_id && !material) throw new Error('Selected material no longer exists.');
```

Replace the four slot gates (the `if (enforced && uses('cassette') !== Boolean(it.cassette_id))` block through the installation one) with the "does not take" half only:

```ts
    // An id for a slot the type does not use would name an option on
    // every document while pricing nothing. The OTHER half — a used slot
    // left empty — is the completeness rule's now (above).
    if (enforced && it.cassette_id && !uses('cassette')) {
      throw new Error(`Item ${position + 1}: ${label} does not take a cassette.`);
    }
    if (enforced && it.bottom_rail_id && !uses('bottom_rail')) {
      throw new Error(`Item ${position + 1}: ${label} does not take a bottom rail.`);
    }
    if (enforced && it.control_id && !uses('control')) {
      throw new Error(`Item ${position + 1}: ${label} does not take a control option.`);
    }
    if (enforced && it.installation_id && !uses('installation')) {
      throw new Error(`Item ${position + 1}: ${label} does not take an installation option.`);
    }
```

Replace the pricing call and adjustment

```ts
    const base = calculateBlindUnitPriceForType(it.blinds_type, {
      panels: it.panels,
      height_cm: it.height_cm,
      material_price_per_sqm: material.price,
      hardware,
      attributes,
    });
```

with

```ts
    // An incomplete blind has no formula price: it is stored at $0 base
    // with its hand-entered override and add-ons KEPT (so nothing typed
    // is lost) and `line_total` forced to 0 below, so it adds nothing to
    // the subtotal — matching the editor, which previews it as "—".
    const base = complete
      ? calculateBlindUnitPriceForType(it.blinds_type, {
          panels: it.panels as number[],
          height_cm: it.height_cm as number,
          material_price_per_sqm: material!.price,
          hardware,
          attributes,
        })
      : 0;
```

In that branch's return object, replace `material_name: material.name,` / `material_price_per_sqm: material.price,` with `material_name: material?.name ?? null,` / `material_price_per_sqm: material?.price ?? null,`, and replace `line_total: adjusted.line_total,` with `line_total: complete ? adjusted.line_total : 0,`. (`panels: it.panels` and `height_cm: it.height_cm` stay — they now carry nulls.)

- [ ] **Step 6: Pass `allowIncomplete` from the two callers.** In `createOrderFromInput`: `rows = await resolveLineItems(sb, input.line_items, undefined, true);` with a comment `// Every create — POST / and /duplicate — makes a draft.` In `PUT /:id`, replace `rows = await resolveLineItems(sb, input.line_items, locks);` with:

```ts
    // Incomplete items may live only on a draft (spec 2026-11-02): a
    // draft stays one, and so does an expired estimate revived here.
    const allowIncomplete = existing.status === 'draft' || reviveToDraft;
    rows = await resolveLineItems(sb, input.line_items, locks, allowIncomplete);
```

- [ ] **Step 7: Null-safe duplicate** — in `apps/api/src/lib/orderDuplicate.ts` replace

```ts
          panels: ((li.panels ?? []) as unknown[]).map(Number),
          height_cm: Number(li.height_cm),
```

with

```ts
          // A draft may hold blank measurements (spec 2026-11-02); they
          // copy as blanks rather than becoming 0, which the schema refuses.
          panels: ((li.panels ?? []) as unknown[]).map((p) => (p === null ? null : Number(p))),
          height_cm: li.height_cm === null || li.height_cm === undefined ? null : Number(li.height_cm),
```

- [ ] **Step 8: Run the API suite and typecheck**

Run: `pnpm --filter ./apps/api test` then `pnpm --filter ./apps/api check`
Expected: all PASS; tsc clean. If tsc flags `PdfDocumentData`/`pdf.ts` or `optionBreakdown.ts` reading `panels` as `number[]`, wrap the read in `measuredWidths(...)` from `../lib/lineItemCompleteness` (stored rows only reach those modules for complete orders, so output is unchanged).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes/orders.ts apps/api/src/routes/orders.routes.test.ts apps/api/src/lib/orderDuplicate.ts apps/api/src/lib/orderDuplicate.test.ts apps/api/src/lib/pdf.ts apps/api/src/lib/optionBreakdown.ts
git commit -m "feat(api): drafts save incomplete blind items at \$0"
```

---

### Task 3: Worker gates — nothing leaves draft incomplete

**Files:**
- Create: `apps/api/src/lib/orderCompleteness.ts`
- Test: `apps/api/src/lib/orderCompleteness.test.ts`
- Modify: `apps/api/src/routes/orders.ts` (`/:id/pdf`, `/:id/send`, `/:id/mark-sent`, `/:id/confirm`, `/:id/status`)
- Test: `apps/api/src/routes/orders.routes.test.ts`

**Interfaces:**
- Consumes: `loadSlotScoping` (`lib/optionScoping.ts`), Task 1 functions.
- Produces:
  - `incompleteMessageFor(sb: SupabaseClient, items: readonly CompletenessInput[]): Promise<string | null>`
  - `loadIncompleteMessage(sb: SupabaseClient, orderId: string): Promise<string | null>`
  - `annotateOrderCompleteness(sb, order: Record<string, unknown>): Promise<void>` (Task 4 uses)
  - `attachIncompleteCounts(sb, orders: Record<string, unknown>[]): Promise<void>` (Task 4 uses)

- [ ] **Step 1: Write the failing helper tests** — create `apps/api/src/lib/orderCompleteness.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The DB-facing completeness helpers, against a scripted fake client:
 * scoping rows for one Roller type that uses a control, and whatever
 * line items a test seeds.
 */

import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  annotateOrderCompleteness,
  attachIncompleteCounts,
  incompleteMessageFor,
  loadIncompleteMessage,
} from './orderCompleteness';

const ID = '11111111-1111-4111-8111-111111111111';
const ROLLER = { id: 'bt1', name: 'Roller' };

/** Fake supabase-js: every chain resolves to `rows[table]`. */
function fakeClient(rows: Record<string, unknown[]>): SupabaseClient {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order']) b[m] = () => b;
    (b as { then: unknown }).then = (ok: (v: unknown) => unknown) =>
      Promise.resolve(ok({ data: rows[table] ?? [], error: null }));
    return b;
  };
  return { from: builder } as unknown as SupabaseClient;
}

const scoping = {
  blind_types: [ROLLER],
  control_options: [{ id: ID, active: true }],
  control_option_blind_types: [{ control_option_id: ID, blind_type_id: ROLLER.id }],
};
const complete = { item_type: 'blind', room_name: 'Hall', blinds_type: 'Roller', panels: [70], height_cm: 200, material_id: ID, control_id: ID, attributes: {} };
const open = { ...complete, room_name: 'Kitchen', control_id: null };

describe('incompleteMessageFor / loadIncompleteMessage', () => {
  it('names the first incomplete item', async () => {
    const sb = fakeClient(scoping);
    expect(await incompleteMessageFor(sb, [complete, open] as never)).toBe('Item 2 (Kitchen): choose a control option.');
  });

  it('is null for an order of complete or flat items, without a scoping query', async () => {
    const sb = fakeClient({});
    expect(await incompleteMessageFor(sb, [{ item_type: 'custom' }])).toBeNull();
  });

  it('loads the rows by order id', async () => {
    const sb = fakeClient({ ...scoping, line_items: [open] });
    expect(await loadIncompleteMessage(sb, 'o1')).toBe('Item 1 (Kitchen): choose a control option.');
  });
});

describe('annotateOrderCompleteness', () => {
  it('adds missing_fields per line and incomplete_items on a draft', async () => {
    const order = { status: 'draft', line_items: [{ ...complete }, { ...open }] } as Record<string, unknown>;
    await annotateOrderCompleteness(fakeClient(scoping), order);
    expect(order.incomplete_items).toBe(1);
    expect((order.line_items as Array<{ missing_fields: string[] }>).map((l) => l.missing_fields)).toEqual([[], ['control option']]);
  });

  it('reports nothing on a non-draft order, whatever the rows say', async () => {
    const order = { status: 'sent', line_items: [{ ...open }] } as Record<string, unknown>;
    await annotateOrderCompleteness(fakeClient(scoping), order);
    expect(order.incomplete_items).toBe(0);
    expect((order.line_items as Array<{ missing_fields: string[] }>)[0].missing_fields).toEqual([]);
  });
});

describe('attachIncompleteCounts', () => {
  it('counts per draft order and leaves others at 0', async () => {
    const sb = fakeClient({ ...scoping, line_items: [{ ...open, order_id: 'd1' }, { ...open, order_id: 'd1' }, { ...complete, order_id: 'd2' }] });
    const orders: Record<string, unknown>[] = [{ id: 'd1', status: 'draft' }, { id: 'd2', status: 'draft' }, { id: 's1', status: 'sent' }];
    await attachIncompleteCounts(sb, orders);
    expect(orders.map((o) => o.incomplete_items)).toEqual([2, 0, 0]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter ./apps/api test -- orderCompleteness`
Expected: FAIL — cannot resolve `./orderCompleteness`.

- [ ] **Step 3: Implement** — create `apps/api/src/lib/orderCompleteness.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The Worker's DB-facing side of the incomplete-item rule (spec
 * 2026-11-02). `lib/lineItemCompleteness.ts` decides; this module feeds
 * it stored rows and today's slot scoping, for three callers:
 *   - the gates on every route that takes an order OUT of draft (send,
 *     mark-sent, confirm, a status move to sent+, the PDF) — each runs
 *     ONLY while the order is currently a draft, so a sent or confirmed
 *     order is never re-judged against a later Settings change;
 *   - the detail reads, which annotate a draft's lines with
 *     `missing_fields` and the order with `incomplete_items` for the
 *     Present view;
 *   - the list reads, which attach `incomplete_items` to every draft so
 *     a list shows "Incomplete" instead of a partial total.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadSlotScoping } from './optionScoping';
import {
  countIncomplete,
  firstIncompleteMessage,
  missingFields,
  type CompletenessInput,
} from './lineItemCompleteness';

/**
 * The columns the rule reads. Literal strings (not built), because
 * supabase-js parses the select string at the type level.
 */
const COLUMNS =
  'item_type, position, room_name, blinds_type, panels, height_cm, material_id, cassette_id, bottom_rail_id, control_id, installation_id, attributes';
const LIST_COLUMNS =
  'order_id, item_type, position, room_name, blinds_type, panels, height_cm, material_id, cassette_id, bottom_rail_id, control_id, installation_id, attributes';

/** The blind-type names a scoping load needs; flat items contribute none. */
function blindTypesOf(items: readonly CompletenessInput[]): string[] {
  return items.flatMap((it) => (it.item_type === 'blind' ? [String(it.blinds_type ?? '')] : []));
}

/**
 * The first incomplete item's message for rows already in hand (the
 * order bundle the PDF and send routes load), or null. Costs no query
 * when no row is a blind.
 */
export async function incompleteMessageFor(
  sb: SupabaseClient,
  items: readonly CompletenessInput[]
): Promise<string | null> {
  if (!items.some((it) => it.item_type === 'blind')) return null;
  const scope = await loadSlotScoping(sb, blindTypesOf(items));
  return firstIncompleteMessage(items, scope);
}

/**
 * As {@link incompleteMessageFor}, reading the order's rows itself —
 * for routes that load only the order's status (mark-sent, confirm,
 * status). Rows come back in `position` order, matching "Item N".
 *
 * @throws Error when the read fails, so the caller fails the transition
 *         rather than letting an unchecked order through.
 */
export async function loadIncompleteMessage(
  sb: SupabaseClient,
  orderId: string
): Promise<string | null> {
  const { data, error } = await sb
    .from('line_items')
    .select(COLUMNS)
    .eq('order_id', orderId)
    .order('position');
  if (error) throw new Error(error.message);
  return incompleteMessageFor(sb, (data ?? []) as CompletenessInput[]);
}

/**
 * Mutates a detail-read order: every line gets `missing_fields` and the
 * order gets `incomplete_items`. Only a draft can hold an incomplete
 * item, so any other status gets `[]` / `0` with no query.
 */
export async function annotateOrderCompleteness(
  sb: SupabaseClient,
  order: Record<string, unknown>
): Promise<void> {
  const lines = (order.line_items ?? []) as Record<string, unknown>[];
  if (order.status !== 'draft' || !lines.some((l) => l.item_type === 'blind')) {
    for (const line of lines) line.missing_fields = [];
    order.incomplete_items = 0;
    return;
  }
  const items = lines as unknown as CompletenessInput[];
  const scope = await loadSlotScoping(sb, blindTypesOf(items));
  for (const line of lines) {
    line.missing_fields = missingFields(line as unknown as CompletenessInput, scope);
  }
  order.incomplete_items = countIncomplete(items, scope);
}

/**
 * Mutates list rows: each gets `incomplete_items` — counted for drafts in
 * one `line_items` read plus one scoping load, `0` for every other
 * status. Hidden items count (the badge means "cannot be sent yet").
 */
export async function attachIncompleteCounts(
  sb: SupabaseClient,
  orders: Record<string, unknown>[]
): Promise<void> {
  for (const o of orders) o.incomplete_items = 0;
  const draftIds = orders.filter((o) => o.status === 'draft').map((o) => String(o.id));
  if (draftIds.length === 0) return;
  const { data, error } = await sb.from('line_items').select(LIST_COLUMNS).in('order_id', draftIds);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as (CompletenessInput & { order_id: string })[];
  if (!rows.some((r) => r.item_type === 'blind')) return;
  const scope = await loadSlotScoping(sb, blindTypesOf(rows));
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (missingFields(row, scope).length > 0) counts.set(row.order_id, (counts.get(row.order_id) ?? 0) + 1);
  }
  for (const o of orders) o.incomplete_items = counts.get(String(o.id)) ?? 0;
}
```

- [ ] **Step 4: Run helper tests** — `pnpm --filter ./apps/api test -- orderCompleteness` — Expected: PASS.

- [ ] **Step 5: Write the failing route-gate tests** — append to `orders.routes.test.ts`:

```ts
describe('incomplete draft items — leaving draft is gated (spec 2026-11-02)', () => {
  const future = () => new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  /** A Roller row with its scoped control still open. */
  const OPEN_ROW = {
    item_type: 'blind', position: 0, room_name: 'Kitchen', blinds_type: 'Roller', panels: [70], height_cm: 200,
    material_id: MATERIAL.id, cassette_id: CASSETTE.id, bottom_rail_id: BOTTOM_RAIL.id, control_id: null,
    installation_id: null, attributes: {}, quantity: 1, unit_price: 0, line_total: 0, base_unit_price: null,
    material_name: 'Blackout White', cassette_name: 'Standard', bottom_rail_name: 'Regular', control_name: null,
    addons: [], hidden: false, title: '', description: '', note: '', color: '', show_original_price: true,
  };
  const MESSAGE = 'Item 1 (Kitchen): choose a control option.';
  const json = { 'Content-Type': 'application/json' };
  const company = () => [{ company_name: 'Blinds Nisa', logo_url: null, email: 'x@y.z', phone: '', address: '', hst_number: '', terms_and_conditions: 'T&C', default_expiry_days: 14 }];
  /** A full order bundle, as `readDetail` returns it, for /send and /pdf. */
  function bundle(status: string) {
    return {
      id: 'g1', status, order_number: 'F0307-126', order_date: new Date().toISOString().slice(0, 10), expiry_date: future(),
      subtotal: 0, discount_amount: 0, taxable_amount: 0, tax_amount: 0, total: 0, tax_rate: 0.13,
      public_token: 'tok', terms_snapshot: null, line_items: [OPEN_ROW], payments: [], customer_id: 'c1',
      customer: { first_name: 'A', last_name: 'B', email: 'a@example.com', phone: '', shipping_address_line1: '', shipping_address_line2: '', shipping_city: '', shipping_province: '', shipping_postal_code: '', billing_same_as_shipping: true, billing_address_line1: '', billing_address_line2: '', billing_city: '', billing_province: '', billing_postal_code: '' },
    };
  }
  /** Asserts the transition had no side effect at all. */
  function expectUntouched() {
    expect(db.calls).not.toContain('orders.update');
    expect(db.calls).not.toContain('line_items.update');
  }

  it('/send refuses a draft with an incomplete item before emailing', async () => {
    db.responses['orders.select'] = [bundle('draft')];
    db.responses['company_settings.select'] = company();
    const realFetch = globalThis.fetch;
    let resendHits = 0;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('api.resend.com')) resendHits += 1;
      return realFetch(url as never, init as never);
    }) as typeof fetch;
    try {
      const res = await ordersApp.request('/g1/send', { method: 'POST' }, ENV);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: MESSAGE });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(resendHits).toBe(0);
    expectUntouched();
  });

  it('/pdf refuses a draft with an incomplete item', async () => {
    db.responses['orders.select'] = [bundle('draft')];
    db.responses['company_settings.select'] = company();
    const res = await ordersApp.request('/g1/pdf', { method: 'GET' }, ENV);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: MESSAGE });
  });

  it('/pdf is NOT re-judged once the order has left draft', async () => {
    // A sent order is complete by the invariant; a later Settings change
    // must never block its documents.
    db.responses['orders.select'] = [bundle('sent')];
    db.responses['company_settings.select'] = company();
    const res = await ordersApp.request('/g1/pdf', { method: 'GET' }, ENV);
    expect(res.status).toBe(200);
  });

  it('/mark-sent refuses', async () => {
    db.responses['orders.select'] = [{ id: 'g1', status: 'draft', expiry_date: future() }];
    db.responses['line_items.select'] = [OPEN_ROW];
    const res = await ordersApp.request('/g1/mark-sent', { method: 'POST' }, ENV);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: MESSAGE });
    expectUntouched();
  });

  it('/confirm refuses a draft', async () => {
    db.responses['orders.select'] = [{ id: 'g1', status: 'draft' }];
    db.responses['line_items.select'] = [OPEN_ROW];
    const res = await ordersApp.request('/g1/confirm', { method: 'POST' }, ENV);
    expect(res.status).toBe(400);
    expectUntouched();
  });

  it.each(['sent', 'installed'])('/status draft → %s refuses', async (to) => {
    db.responses['orders.select'] = [{ id: 'g1', status: 'draft', sent_at: null, confirmed_at: null, installed_at: null }];
    db.responses['line_items.select'] = [OPEN_ROW];
    const res = await ordersApp.request('/g1/status', { method: 'POST', body: JSON.stringify({ to }), headers: json }, ENV);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: MESSAGE });
    expectUntouched();
  });

  it('/status from a non-draft stage is never re-judged', async () => {
    db.responses['orders.select'] = [{ id: 'g1', status: 'in_progress', sent_at: 'x', confirmed_at: 'x', installed_at: null }];
    db.responses['line_items.select'] = [OPEN_ROW];
    const res = await ordersApp.request('/g1/status', { method: 'POST', body: JSON.stringify({ to: 'ready' }), headers: json }, ENV);
    expect(res.status).toBe(200);
  });

  it('/status sent → draft stays allowed', async () => {
    db.responses['orders.select'] = [{ id: 'g1', status: 'sent', sent_at: 'x', confirmed_at: null, installed_at: null }];
    db.responses['line_items.select'] = [OPEN_ROW];
    const res = await ordersApp.request('/g1/status', { method: 'POST', body: JSON.stringify({ to: 'draft' }), headers: json }, ENV);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 6: Run to verify failure** — `pnpm --filter ./apps/api test -- orders.routes` — Expected: the new refusals FAIL (routes return 200/502).

- [ ] **Step 7: Wire the gates.** Import at the top of `orders.ts`:

```ts
import { incompleteMessageFor, loadIncompleteMessage } from '../lib/orderCompleteness';
import type { CompletenessInput } from '../lib/lineItemCompleteness';
```

Add one helper above `GET /:id/pdf`:

```ts
/**
 * The leave-draft gate (spec 2026-11-02): a 400 body naming the first
 * incomplete item while the order is a DRAFT, or null to proceed. Never
 * consulted for any other status — a sent or confirmed order is complete
 * by the invariant, and must not be re-judged against a later Settings
 * change. `rows` is passed when the caller already holds them.
 */
async function leaveDraftRefusal(
  sb: SupabaseClient,
  order: { id: string; status: string },
  rows?: readonly CompletenessInput[]
): Promise<{ error: string } | null> {
  if (order.status !== 'draft') return null;
  const message = rows ? await incompleteMessageFor(sb, rows) : await loadIncompleteMessage(sb, order.id);
  return message ? { error: message } : null;
}
```

Then insert, each BEFORE any side effect:
- `GET /:id/pdf`, right after `if (!bundle) return …404`:
  ```ts
  const refusal = await leaveDraftRefusal(sb, bundle.order, bundle.order.line_items as CompletenessInput[]);
  if (refusal) return c.json(refusal, 400);
  ```
- `POST /:id/send`, right after the expiry-date check:
  ```ts
  const refusal = await leaveDraftRefusal(sb, order, order.line_items as CompletenessInput[]);
  if (refusal) return c.json(refusal, 400);
  ```
- `POST /:id/mark-sent`, right after the expiry-date check, and `POST /:id/confirm`, right after the `EDITABLE` check:
  ```ts
  const refusal = await leaveDraftRefusal(sb, existing);
  if (refusal) return c.json(refusal, 400);
  ```
- `POST /:id/status`, right after the `existing.status === to` 409:
  ```ts
  // Moving forward OUT of draft is gated; moving back to draft never is.
  if (STAGE_ORDER.indexOf(to) >= STAGE_ORDER.indexOf('sent')) {
    const refusal = await leaveDraftRefusal(sb, existing);
    if (refusal) return c.json(refusal, 400);
  }
  ```

- [ ] **Step 8: Run the API suite + typecheck** — `pnpm --filter ./apps/api test && pnpm --filter ./apps/api check` — Expected: PASS, tsc clean. Existing send/mark-sent/status tests still pass (their draft fixtures carry no line items or complete Roller rows).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/lib/orderCompleteness.ts apps/api/src/lib/orderCompleteness.test.ts apps/api/src/routes/orders.ts apps/api/src/routes/orders.routes.test.ts
git commit -m "feat(api): no order leaves draft with an incomplete item"
```

---

### Task 4: Worker reads — annotate drafts for lists and the Present view

**Files:**
- Modify: `apps/api/src/routes/orders.ts` (`readDetail` ~L956, `GET /` ~L1019, `GET /grouped` ~L1059, `GET /by-number/:orderNumber` ~L1091)
- Test: `apps/api/src/routes/orders.routes.test.ts`

**Interfaces:**
- Consumes: `annotateOrderCompleteness`, `attachIncompleteCounts` (Task 3).
- Produces (API contract the web relies on): every list row carries `incomplete_items: number`; every detail read carries `incomplete_items: number` and each line item `missing_fields: string[]`.

- [ ] **Step 1: Write failing tests** — append:

```ts
describe('incomplete draft items — reads (spec 2026-11-02)', () => {
  const OPEN_ROW = { order_id: 'd1', item_type: 'blind', position: 0, room_name: 'Kitchen', blinds_type: 'Roller', panels: [70], height_cm: 200, material_id: MATERIAL.id, cassette_id: CASSETTE.id, bottom_rail_id: BOTTOM_RAIL.id, control_id: null, installation_id: null, attributes: {} };

  it('GET / attaches incomplete_items to drafts only', async () => {
    db.responses['orders.select'] = [{ id: 'd1', status: 'draft', payments: [] }, { id: 's1', status: 'sent', payments: [] }];
    db.responses['line_items.select'] = [OPEN_ROW];
    const res = await ordersApp.request('/', { method: 'GET' }, ENV);
    const { data } = (await res.json()) as { data: Array<{ id: string; incomplete_items: number }> };
    expect(data.map((o) => [o.id, o.incomplete_items])).toEqual([['d1', 1], ['s1', 0]]);
  });

  it('GET /grouped attaches incomplete_items', async () => {
    db.responses['orders.select'] = [{ id: 'd1', status: 'draft', customer_id: 'c1', created_at: '2026-11-02T00:00:00Z', customer: { id: 'c1', first_name: 'A', last_name: 'B', email: '', phone: '' }, payments: [] }];
    db.responses['line_items.select'] = [OPEN_ROW];
    const res = await ordersApp.request('/grouped?status=all', { method: 'GET' }, ENV);
    const { data } = (await res.json()) as { data: Array<{ orders: Array<{ incomplete_items: number }> }> };
    expect(data[0].orders[0].incomplete_items).toBe(1);
  });

  it('GET /:id annotates each line with missing_fields', async () => {
    db.responses['orders.select'] = [{ id: 'd1', status: 'draft', expiry_date: '2099-01-01', line_items: [OPEN_ROW], payments: [] }];
    const res = await ordersApp.request('/d1', { method: 'GET' }, ENV);
    const { data } = (await res.json()) as { data: { incomplete_items: number; line_items: Array<{ missing_fields: string[] }> } };
    expect(data.incomplete_items).toBe(1);
    expect(data.line_items[0].missing_fields).toEqual(['control option']);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter ./apps/api test -- orders.routes` — Expected: FAIL (`incomplete_items` undefined).

- [ ] **Step 3: Implement.** Import `annotateOrderCompleteness, attachIncompleteCounts` alongside Task 3's import. Replace `readDetail` with:

```ts
/**
 * Reads one full order (items ordered, payments oldest-first), annotated
 * for the incomplete-item rule: `incomplete_items` on the order and
 * `missing_fields` on each line (both empty/0 unless it is a draft).
 * Every route that returns an order goes through here, so the editor
 * cache and the Present view always see the annotation.
 */
async function readDetail(sb: SupabaseClient, id: string) {
  const result = await sb
    .from('orders')
    .select(DETAIL_SELECT)
    .eq('id', id)
    .order('position', { referencedTable: 'line_items' })
    .order('paid_on', { referencedTable: 'payments' })
    .maybeSingle();
  if (result.data) await annotateOrderCompleteness(sb, result.data as Record<string, unknown>);
  return result;
}
```

In `GET /by-number/:orderNumber`, after its `if (!data) …404`, add `await annotateOrderCompleteness(sb, data as Record<string, unknown>);`.

In `GET /`, after building `rows`, add:

```ts
  // Drafts carry `incomplete_items` so the list shows "Incomplete"
  // instead of a total that silently leaves those items out.
  try {
    await attachIncompleteCounts(sb, rows);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Could not read items' }, 500);
  }
```

In `GET /grouped`, the same block between building `rows` and `groupOrdersByCustomer(rows)`.

- [ ] **Step 4: Run the API suite + typecheck** — `pnpm --filter ./apps/api test && pnpm --filter ./apps/api check` — Expected: PASS. If a pre-existing test pins an EXACT `db.calls` array for a draft read with blind rows, append the scoping reads it now makes (`blind_types.select`, the four `*_options.select` / `*_blind_types.select`) to that expectation — do not loosen any other assertion.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/orders.ts apps/api/src/routes/orders.routes.test.ts
git commit -m "feat(api): drafts report incomplete_items on lists and missing_fields on detail"
```

---

### Task 5: Web types, draft rule and the payload module

**Files:**
- Modify: `apps/web/src/types/index.ts` (`LineItem`, `Order`), `apps/web/src/hooks/useOrders.ts` (`BlindItemInput`)
- Modify: `apps/web/src/pages/orders/lineItemDrafts.ts`
- Create: `apps/web/src/pages/orders/orderPayload.ts`, `apps/web/src/pages/orders/orderPayload.test.ts`
- Modify: `apps/web/src/pages/orders/OrderDetail.tsx` (`toIso` L267, `toDrafts` L289, `buildPayload` L1078–1219, `save` L1222)
- Modify (type ripple): `apps/web/src/lib/labels.ts` L133, `lib/manufacturing.ts` L424 + `describeDimensions`, `lib/optionBreakdown.ts` L206, `pages/orders/PresentationTable.tsx` L62, `pages/customer-view/CustomerView.tsx` L272
- Test: `apps/web/src/pages/orders/lineItemDrafts.test.ts`

**Interfaces:**
- Consumes: Task 1 web twin; Task 4's API fields.
- Produces:
  - `scopeFromCatalogs(catalogs: Catalogs): CompletenessScope`
  - `draftCompletenessInput(draft: ItemDraft): CompletenessInput`
  - `draftMissingFields(draft: ItemDraft, catalogs: Catalogs): string[]`
  - `firstIncompleteDraftMessage(drafts: ItemDraft[], catalogs: Catalogs): string | null`
  - `interface OrderPayloadState { customer: Customer | null; orderDate: Date; expiryDate: Date | null; title: string; discountType: DiscountType; discountValue: string; items: ItemDraft[]; catalogs: Catalogs; status: OrderStatus }`
  - `buildOrderPayload(state: OrderPayloadState): OrderInput | string`
  - `toIso(d: Date): string`
  - Types: `LineItem.panels: (number | null)[]`, `LineItem.missing_fields?: string[]`, `Order.incomplete_items?: number`

- [ ] **Step 1: Types.** In `types/index.ts` `LineItem`: change `panels: number[];` to

```ts
  /** Panel widths in cm; a draft may hold a blank (`null`) panel — read through `measuredWidths`. */
  panels: (number | null)[];
  /**
   * Open fields on a DRAFT's incomplete blind (spec 2026-11-02), set by
   * the Worker's detail reads; `[]` on every complete item and on every
   * non-draft order. The Present view renders these as "To be decided".
   */
  missing_fields?: string[];
```

In `Order`, after `total: number;`:

```ts
  /**
   * How many items are still incomplete — set on drafts by every list and
   * detail read, `0` otherwise. Non-zero means the order cannot be sent
   * yet and its stored total leaves those items out, so lists show an
   * "Incomplete" badge instead of the total.
   */
  incomplete_items?: number;
```

In `hooks/useOrders.ts` `BlindItemInput`: `panels: (number | null)[];`, `height_cm: number | null;`, `material_id: string | null;`, and update its slot doc's last sentence to: "Sending an id for an unused slot is a 400; leaving a used one empty makes the item incomplete — allowed only on a draft (spec 2026-11-02)."

- [ ] **Step 2: Failing draft-rule tests** — in `lineItemDrafts.test.ts`, inside `describe('blindDraftPrice')`, add:

```ts
    it('previews nothing for a blind with no type — it is incomplete', () => {
      expect(blindDraftPrice({ ...roller, blinds_type: '' }, catalogs())).toBeNull();
    });
```

and a new top-level describe at the end (reuse the file's `draft()` builder and the `catalogs()` of the `optionsForType / slotsForType` describe by placing this inside that describe):

```ts
  describe('draft completeness', () => {
    it('reports open fields of a draft in message order', () => {
      const d = draft({ blinds_type: 'Roller', panels: ['100', ''], height_cm: '', material_id: '', control_id: '' });
      expect(draftMissingFields(d, catalogs())).toEqual(['width', 'height', 'material', 'control option']);
    });

    it('names the first incomplete draft', () => {
      const done = draft({ blinds_type: 'Roller', panels: ['100'], height_cm: '200', room_name: 'Hall' });
      const open = draft({ blinds_type: 'Roller', panels: ['100'], height_cm: '200', room_name: 'Kitchen', cassette_id: '' });
      expect(firstIncompleteDraftMessage([done, open], catalogs())).toBe('Item 2 (Kitchen): choose a cassette.');
      expect(firstIncompleteDraftMessage([done], catalogs())).toBeNull();
    });
  });
```

Add `draftMissingFields, firstIncompleteDraftMessage` to the file's import from `./lineItemDrafts`.

- [ ] **Step 3: Run to verify failure** — `pnpm --filter ./apps/web test -- lineItemDrafts` — Expected: FAIL (no exports; blank type still prices).

- [ ] **Step 4: Implement in `lineItemDrafts.ts`.** Add to the imports:

```ts
import {
  firstIncompleteMessage,
  missingFields,
  type CompletenessInput,
  type CompletenessScope,
} from '../../lib/lineItemCompleteness';
```

Add after `slotsForType`:

```ts
/**
 * The completeness scope over the editor's cached catalogs — the SAME
 * `slotsForType` rule the form renders from, so a chip, a pre-check and
 * the Worker's gate (which uses `loadSlotScoping`) agree.
 */
export function scopeFromCatalogs(catalogs: Catalogs): CompletenessScope {
  return {
    isKnownType: (name) => catalogs.blindTypes.some((t) => t.name === name),
    usesSlot: (name, slot) => slotsForType(catalogs, name).has(slot),
  };
}

/**
 * A draft as the completeness rule reads it: typed text parsed with
 * `parsePositive` (blank → null), blank ids → null. A TYPED garbage
 * measurement also parses to null and so reads as missing here; it never
 * gets that far on save, because `buildOrderPayload` rejects it first.
 */
export function draftCompletenessInput(draft: ItemDraft): CompletenessInput {
  if (draft.item_type !== 'blind') return { item_type: draft.item_type };
  return {
    item_type: 'blind',
    room_name: draft.room_name,
    blinds_type: draft.blinds_type.trim(),
    panels: draft.panels.map(parsePositive),
    height_cm: parsePositive(draft.height_cm),
    material_id: draft.material_id || null,
    cassette_id: draft.cassette_id || null,
    bottom_rail_id: draft.bottom_rail_id || null,
    control_id: draft.control_id || null,
    installation_id: draft.installation_id || null,
    attributes: draft.attributes,
  };
}

/** Open fields of one draft, in message order; `[]` when complete or flat. */
export function draftMissingFields(draft: ItemDraft, catalogs: Catalogs): string[] {
  return missingFields(draftCompletenessInput(draft), scopeFromCatalogs(catalogs));
}

/**
 * The first incomplete draft's message ("Item 3 (Kitchen): choose a
 * control option."), or null. The editor's pre-check before Send, a
 * stage move or a PDF; the Worker refuses the same cases regardless.
 */
export function firstIncompleteDraftMessage(drafts: ItemDraft[], catalogs: Catalogs): string | null {
  return firstIncompleteMessage(drafts.map(draftCompletenessInput), scopeFromCatalogs(catalogs));
}
```

In `blindDraftInputs`, insert as the first line of the body (before `const blindType = …`):

```ts
  // Incomplete (spec 2026-11-02) → no price, exactly as the Worker
  // stores it at $0. This also covers a blank type and a required
  // attribute, which the checks below never looked at.
  if (draftMissingFields(draft, catalogs).length > 0) return null;
```

Update its doc's "Which hardware slots are REQUIRED…" paragraph to start: "Completeness — which fields must be filled — is `draftMissingFields`, the twin rule the Worker gates on; the checks below remain for ids that no longer resolve in the cache."

- [ ] **Step 5: Run** — `pnpm --filter ./apps/web test -- lineItemDrafts materialUsage` — Expected: PASS (Material usage reuses `blindDraftInputs`; its fixtures carry typed blinds).

- [ ] **Step 6: Failing payload tests** — create `apps/web/src/pages/orders/orderPayload.test.ts`. Build `catalogs` exactly like the `optionsForType / slotsForType` describe in `lineItemDrafts.test.ts` (Roller type using cassette c1, bottom rail, control; material m1) — copy that `catalogs()` function and the `draft()` builder into this file, then:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * `buildOrderPayload`: blanks are allowed on a draft, typed garbage never,
 * and a non-draft order is held to completeness client-side with the
 * same message the Worker would return.
 */

import { describe, it, expect } from 'vitest';
import { buildOrderPayload, type OrderPayloadState } from './orderPayload';
import type { BlindItemInput } from '../../hooks/useOrders';
// …copied `catalogs()` and `draft()` helpers here…

const CUSTOMER = { id: '44444444-4444-4444-8444-444444444444' } as OrderPayloadState['customer'];

function state(over: Partial<OrderPayloadState> = {}): OrderPayloadState {
  return {
    customer: CUSTOMER,
    orderDate: new Date(2026, 10, 2),
    expiryDate: new Date(2026, 10, 16),
    title: '',
    discountType: 'fixed',
    discountValue: '',
    items: [],
    catalogs: catalogs(),
    status: 'draft',
    ...over,
  };
}

describe('buildOrderPayload', () => {
  it('sends blanks as null on a draft', () => {
    const d = draft({ blinds_type: '', panels: ['', '80'], height_cm: '', material_id: '', cassette_id: '', bottom_rail_id: '', control_id: '' });
    const out = buildOrderPayload(state({ items: [d] }));
    expect(typeof out).toBe('object');
    const blind = (out as { line_items: BlindItemInput[] }).line_items[0];
    expect(blind).toMatchObject({ panels: [null, 80], height_cm: null, material_id: null, cassette_id: null });
  });

  it('rejects a typed garbage width or height', () => {
    expect(buildOrderPayload(state({ items: [draft({ panels: ['12a'] })] }))).toBe('Item 1: enter every panel width.');
    expect(buildOrderPayload(state({ items: [draft({ height_cm: '-5' })] }))).toBe('Item 1: enter a height.');
  });

  it('holds a sent order to completeness with the Worker message', () => {
    const d = draft({ blinds_type: 'Roller', panels: ['100'], height_cm: '200', room_name: 'Kitchen', control_id: '' });
    expect(buildOrderPayload(state({ items: [d], status: 'sent' }))).toBe('Item 1 (Kitchen): choose a control option.');
    expect(typeof buildOrderPayload(state({ items: [d], status: 'draft' }))).toBe('object');
  });

  it('still requires a customer and an expiry date', () => {
    expect(buildOrderPayload(state({ customer: null }))).toBe('Select a customer first.');
    expect(buildOrderPayload(state({ expiryDate: null }))).toBe('Pick an expiry date.');
  });
});
```

(`draft()` defaults must give room `''` so "Item 1:" has no room; if the copied builder sets a room, pass `room_name: ''` in the two garbage cases.)

- [ ] **Step 7: Run to verify failure** — `pnpm --filter ./apps/web test -- orderPayload` — Expected: FAIL (module missing).

- [ ] **Step 8: Create `orderPayload.ts`** — MOVE `buildPayload` (OrderDetail L1078–1219) and `toIso` (L266–269) here, converting closure reads to `state.*`. The blind branch changes; the flat branch, `adjustmentsFor` and `identityFor` move verbatim. Full file:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Turns the order editor's state into the `POST /api/orders` / `PUT
 * /api/orders/:id` payload, or a user-facing message when it cannot be
 * sent as is. Moved out of `OrderDetail.tsx` so it can be tested.
 *
 * Spec 2026-11-02 (incomplete draft items): a BLANK blind type, width,
 * height, material or hardware slot no longer blocks a draft's save — it
 * travels as null/'' and the Worker stores the item at $0. TYPED garbage
 * ("12a", "-5", an unparseable override) is still refused here, because
 * it would otherwise become a measurement nobody entered. On a non-draft
 * order the completeness rule runs too, returning the same message the
 * Worker would.
 */

import {
  canOverridePrice,
  firstIncompleteDraftMessage,
  parseAddons,
  parseDraftAttributes,
  parseOverride,
  parsePositive,
  type Catalogs,
  type ItemDraft,
} from './lineItemDrafts';
import type {
  AdjustmentInputFields,
  ItemIdentityFields,
  LineItemInput,
  OrderInput,
} from '../../hooks/useOrders';
import type { Customer, DiscountType, OrderStatus } from '../../types';

/** Formats a Date as the API's YYYY-MM-DD (local date, no UTC shift). */
export function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Everything the payload is built from — the editor's state at save time. */
export interface OrderPayloadState {
  customer: Customer | null;
  orderDate: Date;
  expiryDate: Date | null;
  title: string;
  discountType: DiscountType;
  discountValue: string;
  items: ItemDraft[];
  catalogs: Catalogs;
  /** The stored status; `'draft'` for an order never saved. */
  status: OrderStatus;
}

/** A typed value that does not parse — distinct from a blank one. */
const typedButInvalid = (raw: string): boolean => raw.trim() !== '' && parsePositive(raw) === null;

/**
 * Validates the editor state and builds the API payload, or returns the
 * first problem as a message. See the module doc for what is allowed.
 */
export function buildOrderPayload(state: OrderPayloadState): OrderInput | string {
  const { customer, expiryDate, items } = state;
  if (!customer) return 'Select a customer first.';
  if (!expiryDate) return 'Pick an expiry date.';
  if (state.status !== 'draft') {
    const incomplete = firstIncompleteDraftMessage(items, state.catalogs);
    if (incomplete) return incomplete;
  }
  const line_items: LineItemInput[] = [];

  // `adjustmentsFor` and `identityFor` come across unchanged from
  // OrderDetail's buildPayload — bring their JSDoc blocks with them.
  function adjustmentsFor(it: ItemDraft, index: number): AdjustmentInputFields | string {
    const override = parseOverride(it.unit_price_override);
    if (!override.valid) return `Item ${index + 1}: enter a valid override price.`;
    return {
      ...(canOverridePrice(it) ? { unit_price_override: override.value } : {}),
      show_original_price: it.show_original_price,
      addons: parseAddons(it.addons),
    };
  }
  function identityFor(it: ItemDraft): ItemIdentityFields {
    return { ...(it.uid ? { uid: it.uid } : {}), hidden: it.hidden };
  }

  for (const [i, it] of items.entries()) {
    if (it.item_type === 'blind') {
      if (it.panels.some(typedButInvalid)) return `Item ${i + 1}: enter every panel width.`;
      if (typedButInvalid(it.height_cm)) return `Item ${i + 1}: enter a height.`;
      const qty = parsePositive(it.quantity);
      if (!qty) return `Item ${i + 1}: enter a quantity.`;
      const attributes = parseDraftAttributes(it);
      if (attributes === null) return `Item ${i + 1}: check the ${it.blinds_type || 'blind'} options.`;
      const adj = adjustmentsFor(it, i);
      if (typeof adj === 'string') return adj;
      line_items.push({
        item_type: 'blind',
        room_name: it.room_name.trim(),
        blinds_type: it.blinds_type.trim(),
        // Blank → null: a draft may hold a blind not measured yet.
        panels: it.panels.map(parsePositive),
        height_cm: parsePositive(it.height_cm),
        material_id: it.material_id || null,
        // Null, not '' — the API accepts a uuid or null for a slot.
        cassette_id: it.cassette_id || null,
        bottom_rail_id: it.bottom_rail_id || null,
        control_id: it.control_id || null,
        installation_id: it.installation_id || null,
        color: it.color.trim(),
        note: it.note.trim(),
        attributes,
        quantity: Math.round(qty),
        ...adj,
        ...identityFor(it),
      });
    } else {
      // Preset/custom: unchanged from OrderDetail's buildPayload.
      const qty = parsePositive(it.quantity);
      const unit = Number(it.unit_price);
      if (!it.title.trim() && !it.description.trim())
        return `Item ${i + 1}: enter a title or a description.`;
      if (!qty) return `Item ${i + 1}: enter a quantity.`;
      const adj = adjustmentsFor(it, i);
      if (typeof adj === 'string') return adj;
      if (it.item_type === 'preset' && it.preset_id) {
        // Priced by the Worker from the catalog. Sending a figure would
        // be ignored, and sending one that disagreed would be a lie the
        // consultant could read on screen.
        line_items.push({
          item_type: 'preset',
          preset_id: it.preset_id,
          title: it.title.trim(),
          description: it.description.trim(),
          quantity: Math.round(qty),
          ...adj,
          ...identityFor(it),
        });
      } else if (it.item_type === 'preset') {
        // Legacy preset: no provenance, so its stored price still
        // travels and the Worker keeps honouring it.
        if (!Number.isFinite(unit) || unit < 0) return `Item ${i + 1}: enter a unit price.`;
        line_items.push({
          item_type: 'preset',
          preset_id: null,
          title: it.title.trim(),
          description: it.description.trim(),
          quantity: Math.round(qty),
          unit_price: unit,
          ...adj,
          ...identityFor(it),
        });
      } else {
        if (!Number.isFinite(unit) || unit < 0) return `Item ${i + 1}: enter a unit price.`;
        line_items.push({
          item_type: 'custom',
          title: it.title.trim(),
          description: it.description.trim(),
          quantity: Math.round(qty),
          unit_price: unit,
          ...adj,
          ...identityFor(it),
        });
      }
    }
  }
  return {
    customer_id: customer.id,
    order_date: toIso(state.orderDate),
    expiry_date: toIso(expiryDate),
    title: state.title.trim() === '' ? null : state.title.trim(),
    discount_type: state.discountType,
    discount_value: Number(state.discountValue) || 0,
    line_items,
  };
}
```

Copy `adjustmentsFor`'s and `identityFor`'s original JSDoc blocks across with them. `parseDraftAttributes` needs no blank-type special case: it keeps only the type's declared keys, so a blank type (the Default module, no keys) always parses to `{}`.

- [ ] **Step 9: Wire `OrderDetail.tsx`.** Delete its local `toIso` and `buildPayload`; import `buildOrderPayload, toIso` from `./orderPayload` (`toIso` is still used for `paid_on`). Replace `const payload = buildPayload();` in `save()` with:

```ts
    const payload = buildOrderPayload({
      customer, orderDate, expiryDate, title, discountType, discountValue, items, catalogs, status,
    });
```

In `toDrafts`, replace `panels: li.panels.map(String),` with `panels: li.panels.map((p) => (p === null ? '' : String(p))),` (a blank panel reopens blank, never as "null").

- [ ] **Step 10: Fix the `panels` type ripple** — run `pnpm --filter ./apps/web check` and fix each error by reading widths through `measuredWidths` from `../lib/lineItemCompleteness` (or `../../lib/…` by depth):
  - `lib/labels.ts:133` → `const widths = measuredWidths(item.panels).join(' + ');`
  - `lib/manufacturing.ts:424` → `const panels = measuredWidths(item.panels);` and `describeDimensions(panels: readonly (number | null)[] | null, …)` → `const widths = measuredWidths(panels);`
  - `lib/optionBreakdown.ts:206` → `panels: measuredWidths(item.panels),`
  - `pages/orders/PresentationTable.tsx:62` → `const widths = measuredWidths(item.panels);`
  - `pages/customer-view/CustomerView.tsx:272–273` → `const widths = measuredWidths(li.panels)` and use `widths.length` / `widths.join(' + ')`.
  These readers only ever see complete orders except the Present table, so output is unchanged.

- [ ] **Step 11: Run the web suite** — `pnpm --filter ./apps/web test && pnpm --filter ./apps/web check && pnpm --filter ./apps/web lint` — Expected: PASS / 0 errors.

- [ ] **Step 12: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): drafts save incomplete blinds; payload builder extracted and tested"
```

---

### Task 6: Editor — chips, pricing note, pre-checks

**Files:**
- Modify: `apps/web/src/pages/orders/LineItemRow.tsx`, `apps/web/src/pages/orders/OrderDetail.tsx`

**Interfaces:**
- Consumes: `draftMissingFields`, `firstIncompleteDraftMessage` (Task 5).

- [ ] **Step 1: Chip in `LineItemRow`.** Import `draftMissingFields` from `./lineItemDrafts`. After `const locked = isPriceLocked(item);` add:

```ts
  // Open product decisions on this blind (spec 2026-11-02). Savable on a
  // draft; Send and stage moves stay refused until this is empty.
  const missing = draftMissingFields(item, catalogs);
```

Directly after the `{item.hidden && (…Hidden…)}` badge, add:

```tsx
        {/* Amber, like the edit-request card: something to finish, not an error. */}
        {missing.length > 0 && (
          <span
            title={`Still to decide: ${missing.join(', ')}`}
            className="mt-0.5 max-w-[14rem] shrink-0 truncate rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 sm:mt-0"
          >
            Incomplete · {missing.join(', ')}
          </span>
        )}
```

- [ ] **Step 2: Pricing note in `OrderDetail`.** After `const status = existing?.status ?? 'draft';` add:

```ts
  /**
   * Visible items still incomplete — they price at $0, so the running
   * total leaves them out and says so. Hidden ones are already outside
   * the total; they still block Send (see `leaveDraftMessage`).
   */
  const incompleteVisible = useMemo(
    () => items.filter((it) => !it.hidden && draftMissingFields(it, catalogs).length > 0).length,
    [items, catalogs]
  );
  /** Why this draft cannot leave draft yet, or null. Only drafts are judged. */
  const leaveDraftMessage = useMemo(
    () => (status === 'draft' ? firstIncompleteDraftMessage(items, catalogs) : null),
    [status, items, catalogs]
  );
```

(import both helpers from `./lineItemDrafts`). In `totalsRows`, after the closing `</div>` of the Total row, add:

```tsx
      {incompleteVisible > 0 && (
        <p className="text-[12px] font-medium text-amber-700">
          Total excludes {incompleteVisible} incomplete item{incompleteVisible === 1 ? '' : 's'}
        </p>
      )}
```

- [ ] **Step 3: Pre-checks.** At the top of `openSend` (before the email check): `if (leaveDraftMessage) return toast.error(leaveDraftMessage);`. At the top of `handlePdf`: the same line. In `handleSetStatus`, right after `const backward = toIdx < curIdx;`:

```ts
    // Leaving draft forward is refused while anything is incomplete — say
    // so before the confirm prompt and the save, not after.
    if (!backward && toIdx >= STAGES.findIndex((s) => s.key === 'sent') && leaveDraftMessage) {
      toast.error(leaveDraftMessage);
      return;
    }
```

Present to Customer (`handlePresent`) is deliberately NOT gated.

- [ ] **Step 4: Verify** — `pnpm --filter ./apps/web check && pnpm --filter ./apps/web lint && pnpm --filter ./apps/web test` — Expected: clean. Then render check per the memory note "Browser preview needs Supabase env": if `apps/web/.env` exists, `preview_start` the web app, open a draft, clear one item's control, Save (succeeds, chip shows "Incomplete · control option", pricing note shows), click Send (toast names the item). Otherwise mount `LineItemRow` in a throwaway Vite harness with a blank-control draft and screenshot the chip. Record which was done.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/orders/LineItemRow.tsx apps/web/src/pages/orders/OrderDetail.tsx
git commit -m "feat(web): incomplete chip, total note, and leave-draft pre-checks in the editor"
```

---

### Task 7: Present to Customer — "To be decided", no partial total

**Files:**
- Modify: `apps/web/src/pages/orders/PresentationTable.tsx`, `apps/web/src/pages/orders/OrderPresentation.tsx`

**Interfaces:**
- Consumes: `LineItem.missing_fields`, `Order.incomplete_items` (Task 4/5); `SLOT_NOUNS` (Task 1); `OptionColumn` (`lib/optionBreakdown.ts`).

- [ ] **Step 1: Table cells.** In `PresentationTable.tsx` import `SLOT_NOUNS` from `../../lib/lineItemCompleteness` and add above the component:

```tsx
/** Amber placeholder for a choice still open on a draft (spec 2026-11-02). */
const TBD = <span className="font-medium text-amber-700">To be decided</span>;

/** True when the line's open fields include this option column. */
function columnOpen(missing: ReadonlySet<string>, column: OptionColumn): boolean {
  if (column === 'material') return missing.has('material');
  if (column === 'color') return false;
  return missing.has(SLOT_NOUNS[column]);
}
```

In the row map, add `const missing = new Set(item.missing_fields ?? []); const open = missing.size > 0;` (convert the arrow to a block body). Then:
- Blind type cell: `{missing.has('blind type') ? TBD : item.blinds_type || '—'}`
- Size cell: `{missing.has('width') || missing.has('height') ? TBD : size(item)}`
- Option cells: `{columnOpen(missing, column) ? TBD : <OptionValue … />}`
- Unit cell: `{open ? '' : <UnitPrice item={item} />}`; Add-ons cell: `{open || breakdown.addons === 0 ? '' : money(breakdown.addons)}`; Line total cell: `{open ? '' : money(breakdown.lineTotal)}`

In the `useMemo`, add `anyOpen: rows.some((row) => (row.item.missing_fields ?? []).length > 0)` to the returned object and destructure it. In `<tfoot>`, render money only when `!anyOpen`: column totals `{!anyOpen && showBreakdown && totals.get(column) ? money(totals.get(column)) : ''}`, add-ons `{!anyOpen && addonsTotal ? money(addonsTotal) : ''}`, overall `{anyOpen ? '' : money(overall)}`.

- [ ] **Step 2: Order strip.** In `OrderPresentation.tsx`, replace the contents of the totals `<section>` with a branch:

```tsx
              {Number(order.incomplete_items ?? 0) > 0 ? (
                // A $0 line among twenty is easy to miss, so a partial
                // total is never shown to a customer (spec 2026-11-02).
                <p className="text-sm font-medium text-amber-700">
                  Total available once every item is complete.
                </p>
              ) : (
                <>
                  {/* …the existing TotalRow block, unchanged… */}
                </>
              )}
```

Move the existing `TotalRow`s, the Paid/Balance block and the `filtered` note inside the fragment unchanged.

- [ ] **Step 3: Verify** — `pnpm --filter ./apps/web check && pnpm --filter ./apps/web lint && pnpm --filter ./apps/web test`. Render the Present view (real app if `.env` exists; else a throwaway harness feeding `PresentationTable` one complete and one `missing_fields: ['control option']` item, and the strip with `incomplete_items: 1`). Screenshot: "To be decided" in the Control cell, blank price cells on that row, empty footer money, the replacement line in the strip.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/orders/PresentationTable.tsx apps/web/src/pages/orders/OrderPresentation.tsx
git commit -m "feat(web): Present view shows To be decided and hides totals while items are open"
```

---

### Task 8: Lists — "Incomplete" badge instead of a draft's total

**Files:**
- Create: `apps/web/src/components/IncompleteBadge.tsx`
- Modify: `apps/web/src/pages/estimates/EstimateGroup.tsx` (~L119), `apps/web/src/pages/orders/OrderList.tsx` (~L264, ~L314), `apps/web/src/pages/calendar/AppointmentWizard.tsx` (~L348)

**Interfaces:**
- Consumes: `Order.incomplete_items` (Task 4/5).
- Produces: `IncompleteBadge({ count }: { count: number }): ReactNode`

- [ ] **Step 1: Create the badge:**

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Stands in for a draft's total in every order list while the draft
 * still has incomplete items (spec 2026-11-02). The stored total leaves
 * those items out at $0, so showing it would read as the order's price.
 * `count` comes from the Worker's `incomplete_items` and includes hidden
 * items — the badge means "cannot be sent yet".
 */

import type { ReactNode } from 'react';

/** Amber pill with the count in its tooltip; sized to sit where a total sits. */
export default function IncompleteBadge({ count }: { count: number }): ReactNode {
  return (
    <span
      title={`${count} item${count === 1 ? '' : 's'} incomplete`}
      className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800"
    >
      Incomplete
    </span>
  );
}
```

- [ ] **Step 2: Use it in the three lists.** Each total expression becomes a branch on the row's `incomplete_items`. `EstimateGroup.tsx` L119:

```tsx
                      {Number(o.incomplete_items ?? 0) > 0 ? (
                        <IncompleteBadge count={Number(o.incomplete_items)} />
                      ) : (
                        money.format(Number(o.total))
                      )}
```

`OrderList.tsx` (both breakpoints) and `AppointmentWizard.tsx`: replace `${Number(order.total).toFixed(2)}` (resp. `o.total`) with `{Number(order.incomplete_items ?? 0) > 0 ? <IncompleteBadge count={Number(order.incomplete_items)} /> : `$${Number(order.total).toFixed(2)}`}` — keeping the enclosing `<span>` and its classes. Import `IncompleteBadge` from `../../components/IncompleteBadge`.

- [ ] **Step 3: Verify** — `pnpm --filter ./apps/web check && pnpm --filter ./apps/web lint && pnpm --filter ./apps/web test` — Expected: clean. Render one list with a draft carrying `incomplete_items: 2` (real app or harness) and screenshot the badge where the total was.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/IncompleteBadge.tsx apps/web/src/pages/estimates/EstimateGroup.tsx apps/web/src/pages/orders/OrderList.tsx apps/web/src/pages/calendar/AppointmentWizard.tsx
git commit -m "feat(web): lists show Incomplete instead of a draft's partial total"
```

---

### Task 9: Unsaved-changes guard on the order page

**Files:**
- Create: `apps/web/src/hooks/useLeaveGuard.ts`, `apps/web/src/hooks/useLeaveGuard.test.ts`
- Modify: `apps/web/src/pages/orders/OrderDetail.tsx`

**Interfaces:**
- Produces: `useLeaveGuard(active: boolean, message?: string): void`; `shouldGuardClick(event: Pick<MouseEvent, 'defaultPrevented' | 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>, anchor: Pick<HTMLAnchorElement, 'href' | 'target' | 'origin' | 'hasAttribute'> | null, currentHref: string): boolean`; `LEAVE_GUARD_MESSAGE`.

- [ ] **Step 1: Failing test for the click predicate** — create `useLeaveGuard.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/** Which link clicks the order page's leave guard intercepts. */

import { describe, it, expect } from 'vitest';
import { shouldGuardClick } from './useLeaveGuard';

const ORIGIN = 'https://app.example';
const click = (over = {}) => ({ defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over });
const anchor = (href: string, over: { target?: string; download?: boolean } = {}) => ({
  href, target: over.target ?? '', origin: new URL(href).origin, hasAttribute: (n: string) => n === 'download' && Boolean(over.download),
});

describe('shouldGuardClick', () => {
  it('guards a plain same-origin navigation', () => {
    expect(shouldGuardClick(click(), anchor(`${ORIGIN}/orders`), `${ORIGIN}/c/F1`)).toBe(true);
  });
  it('ignores new-tab, modified, external, download and same-page clicks', () => {
    expect(shouldGuardClick(click({ metaKey: true }), anchor(`${ORIGIN}/orders`), `${ORIGIN}/x`)).toBe(false);
    expect(shouldGuardClick(click(), anchor(`${ORIGIN}/orders`, { target: '_blank' }), `${ORIGIN}/x`)).toBe(false);
    expect(shouldGuardClick(click(), anchor('https://other.example/'), `${ORIGIN}/x`)).toBe(false);
    expect(shouldGuardClick(click(), anchor(`${ORIGIN}/f.pdf`, { download: true }), `${ORIGIN}/x`)).toBe(false);
    expect(shouldGuardClick(click(), anchor(`${ORIGIN}/x`), `${ORIGIN}/x`)).toBe(false);
    expect(shouldGuardClick(click(), null, `${ORIGIN}/x`)).toBe(false);
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter ./apps/web test -- useLeaveGuard` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement `useLeaveGuard.ts`:**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Asks before the user leaves a page with unsaved edits (spec
 * 2026-11-02 — leaving the order editor used to lose everything typed).
 *
 * The app runs on `<BrowserRouter>`, not a data router, so React
 * Router's `useBlocker` is unavailable and moving routers is out of
 * scope. Instead, while `active`:
 *   - `beforeunload` → the browser's own prompt on tab close/refresh;
 *   - a capture-phase `click` listener on `document` intercepts plain
 *     same-origin `<a href>` navigations (sidebar, breadcrumbs, rows)
 *     and asks with `window.confirm`; cancel → `preventDefault`.
 * Known, accepted limit: the browser Back button is not intercepted.
 * Programmatic `navigate()` calls are never intercepted, so the app's
 * own save-then-navigate flows (Present, a new order's first save) do
 * not prompt.
 */

import { useEffect } from 'react';

/** The prompt shown on an in-app link click. */
export const LEAVE_GUARD_MESSAGE = 'You have unsaved changes. Leave without saving?';

/**
 * Whether a click on `anchor` is an in-app navigation the guard should
 * ask about: primary button, no modifier, same origin, same tab, not a
 * download, and actually going somewhere else. Pure, for tests.
 */
export function shouldGuardClick(
  event: Pick<MouseEvent, 'defaultPrevented' | 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  anchor: Pick<HTMLAnchorElement, 'href' | 'target' | 'origin' | 'hasAttribute'> | null,
  currentHref: string
): boolean {
  if (!anchor || !anchor.href) return false;
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target && anchor.target !== '_self') return false;
  if (anchor.hasAttribute('download')) return false;
  if (anchor.origin !== new URL(currentHref).origin) return false;
  return anchor.href !== currentHref;
}

/**
 * Installs the guard while `active` is true and removes it otherwise.
 * `message` overrides {@link LEAVE_GUARD_MESSAGE} for the link prompt;
 * browsers show their own fixed text on unload.
 */
export function useLeaveGuard(active: boolean, message: string = LEAVE_GUARD_MESSAGE): void {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy browsers need a returnValue to show the prompt.
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as Element | null)?.closest?.('a') ?? null;
      if (!shouldGuardClick(e, anchor, window.location.href)) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [active, message]);
}
```

- [ ] **Step 4: Dirty tracking in `OrderDetail`.** Add near the other state:

```ts
  /**
   * A comparable snapshot of what Save would send — the editor's own
   * render keys stripped — so "dirty" means an actual edit, not a
   * re-render. Compared against `savedSnapshot`, set on hydrate and after
   * every successful save.
   */
  const editorSnapshot = useMemo(
    () =>
      JSON.stringify({
        customer: customer?.id ?? null,
        orderDate: toIso(orderDate),
        expiryDate: expiryDate ? toIso(expiryDate) : null,
        title,
        discountType,
        discountValue,
        items: items.map(({ key: _key, ...rest }) => ({
          ...rest,
          addons: rest.addons.map(({ key: _addonKey, ...a }) => a),
        })),
      }),
    [customer, orderDate, expiryDate, title, discountType, discountValue, items]
  );
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  // Baseline once the loaded order has hydrated (existing order) — a new
  // order is dirty as soon as it has an item.
  useEffect(() => {
    if (id && hydrated && savedSnapshot === null) setSavedSnapshot(editorSnapshot);
  }, [id, hydrated, savedSnapshot, editorSnapshot]);
  const dirty = id ? savedSnapshot !== null && editorSnapshot !== savedSnapshot : items.length > 0;
  useLeaveGuard(dirty);
```

(If the oxlint config flags the `_key` destructure as unused, use the same unused-var convention the file already uses elsewhere.) In `save()`, capture `const snapshotAtSave = editorSnapshot;` before the `try`, and right after the mutation succeeds call `setSavedSnapshot(snapshotAtSave);`. In `handleDuplicateOrder`, also `setSavedSnapshot(null)` alongside `setHydrated(false)` so the copy re-baselines. Import `useLeaveGuard` from `../../hooks/useLeaveGuard`.

- [ ] **Step 5: Verify** — `pnpm --filter ./apps/web test && pnpm --filter ./apps/web check && pnpm --filter ./apps/web lint`. In the browser (real app if available): edit a field, click a sidebar link → prompt; Cancel stays; Save then click → no prompt; Present after editing → no prompt (it saves first). Record what was verified and what could not be.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/hooks/useLeaveGuard.ts apps/web/src/hooks/useLeaveGuard.test.ts apps/web/src/pages/orders/OrderDetail.tsx
git commit -m "feat(web): ask before leaving the order page with unsaved edits"
```

---

### Task 10: Full verification and knowledge updates

**Files:**
- Modify: `apps/web/src/pages/orders/bulkAdd.ts` (doc comment ~L310–345)
- Modify: `knowledge/history/engine_features.md`, `memory-bank/activeContext.md`, `memory-bank/progress.md`, `memory-bank/systemPatterns.md`

- [ ] **Step 1: Correct the `bulkAdd.ts` doc** — replace the "COMPLETENESS IS ENFORCED LATER, AT SAVE" paragraph with:

```ts
 * COMPLETENESS IS ENFORCED LATER, WHEN THE ORDER LEAVES DRAFT — not here,
 * and no longer at save either (spec 2026-11-02). A draft saves with
 * incomplete items; `lib/lineItemCompleteness.ts` (twinned in the
 * Worker) decides what is still open, the editor marks such items
 * "Incomplete", and Send / a stage move to Sent+ / the PDF are refused
 * — by the editor first and by the Worker regardless — until nothing
 * is. A future reader who adds a blind-type / material / hardware check
 * HERE would reintroduce the exact on-site dead end this relaxation
 * exists to remove.
```

- [ ] **Step 2: Full verification, both workspaces**

```bash
pnpm --filter ./apps/api check
pnpm --filter ./apps/api test
pnpm --filter ./apps/web check
pnpm --filter ./apps/web test
pnpm --filter ./apps/web lint
```

Expected: 0 errors / 0 warnings, every test passing. Confirm the twins: `diff apps/api/src/lib/lineItemCompleteness.ts apps/web/src/lib/lineItemCompleteness.ts` → no output.

- [ ] **Step 3: Knowledge** — append a dated `2026-11-02` entry to `knowledge/history/engine_features.md`: "Incomplete draft items" — what changed (drafts save blank options/measurements at $0; leave-draft gates on send/mark-sent/confirm/status/pdf, draft-only; `incomplete_items` / `missing_fields` on reads; Incomplete chip, total note, Present "To be decided" + hidden totals, list badge; leave guard; blank blind type now incomplete; non-draft save message reworded from "a X option is required" to "choose a X option"), files, no migration, verification run. Overwrite the current-state sections of `memory-bank/activeContext.md` and `progress.md` (do not append dated narration — AI_GUIDELINES §5). Add to `memory-bank/systemPatterns.md` as a locked pattern: "Incomplete items only on drafts — gates run only while status is `draft`; `lineItemCompleteness.ts` twins are the single rule."

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/orders/bulkAdd.ts knowledge/history/engine_features.md memory-bank
git commit -m "docs: incomplete draft items — history and memory bank"
```
