# Production Label Printing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print a 3" × 1.5" production label for every blind on an order — directly from the shop PC's browser, and from any device (including iPad) via a queued job that a local agent sends to the printer.

**Architecture:** Field extraction lives in twin pure modules (`apps/web/src/lib/labels.ts` and `apps/api/src/lib/labels.ts`), following this repo's existing `pricing.ts`/`totals.ts` twin convention. The web path renders those fields as HTML sized with `@page { size: 3in 1.5in }`. The API path renders them as TSPL, stores the command stream in a `print_jobs` row, and a dependency-free Node agent on the shop PC polls for jobs and pipes the bytes to the printer.

**Tech Stack:** React 19 + Vite 8 + Tailwind 4 (web), Hono 4 + Zod 3 on Cloudflare Workers (api), Supabase/Postgres, vitest, plain Node 22 (agent). No new runtime dependencies in any workspace.

Spec: `docs/superpowers/specs/2026-07-28-label-printing-design.md`

## Global Constraints

- Every source file (`.ts`, `.tsx`, `.sql`) MUST begin with:
  ```ts
  // SPDX-License-Identifier: GPL-3.0-only
  // Copyright (c) 2026 Blinds Nisa. All rights reserved.
  ```
  SQL files use `--` comments. (AI_GUIDELINES §10)
- Every exported module, component, hook, function, and type MUST carry a JSDoc comment scoring ≥8/10: purpose, behavior, constraints, integration context — never a restatement of the name. English only. (AI_GUIDELINES §3)
- Zod schemas for request bodies are `.strict()`. Unknown fields → 400, never silently stripped. (AI_GUIDELINES §1)
- Modify ONLY the files each task names. No drive-by refactors. (AI_GUIDELINES §7)
- Files stay under 800 lines; functions under ~100. (AI_GUIDELINES §6)
- Hono literal routes MUST be registered before param routes in the same group. (AI_GUIDELINES §8 — not triggered by this plan, but do not violate it while editing `orders.ts`.)
- `docs/` is in `.gitignore`; spec and plan files are tracked and were added with `git add -f`. Source files are not affected.
- Work happens on branch `feat/label-printing`.
- Label geometry is fixed: 3" × 1.5" stock = **609 × 304 dots** at 203 dpi.
- No new runtime dependencies anywhere. `apps/print-agent` may add only `typescript`, `vitest`, and `@types/node` as devDependencies.

---

### Task 1: API field extraction — `apps/api/src/lib/labels.ts`

The pure function that turns an order into the ordered list of labels. Everything downstream consumes its output.

**Files:**
- Create: `apps/api/src/lib/labels.ts`
- Test: `apps/api/src/lib/labels.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `LabelFields`, `LabelLineItem`, `LabelOrder`, `buildLabels(order: LabelOrder): LabelFields[]`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/labels.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for the API-side label field extraction. This suite is the
 * MIRROR of apps/web/src/lib/labels.test.ts — the two modules are twins
 * (the same convention as pricing.ts/totals.ts) and must be changed
 * together. Any case added here is added there.
 */

import { describe, it, expect } from 'vitest';
import { buildLabels, type LabelLineItem, type LabelOrder } from './labels';

/** An order carrying exactly the fields buildLabels reads. */
function order(overrides: Partial<LabelOrder> = {}): LabelOrder {
  return {
    order_number: 'T0408-126',
    customer: { first_name: 'Ada', last_name: 'Lovelace' },
    line_items: [],
    ...overrides,
  };
}

/** A blind line item with sensible defaults for the fields under test. */
function blind(overrides: Partial<LabelLineItem> = {}): LabelLineItem {
  return {
    item_type: 'blind',
    position: 0,
    room_name: 'Living Room',
    panels: [120, 90],
    height_cm: 210,
    material_name: 'Blackout White',
    color: 'Ivory',
    cassette_name: 'Standard',
    control_name: 'Chain Left',
    quantity: 1,
    ...overrides,
  };
}

describe('buildLabels', () => {
  it('produces one label per unit of quantity, not per panel', () => {
    const labels = buildLabels(order({ line_items: [blind({ quantity: 2 })] }));
    expect(labels).toHaveLength(2);
    expect(labels[0].dimensions).toBe('120 + 90 x 210 cm');
    expect(labels[1].dimensions).toBe('120 + 90 x 210 cm');
  });

  it('numbers labels across the whole order', () => {
    const labels = buildLabels(
      order({ line_items: [blind({ quantity: 2 }), blind({ position: 1, quantity: 1 })] })
    );
    expect(labels.map((l) => [l.index, l.total])).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('orders by line-item position, not array order', () => {
    const labels = buildLabels(
      order({
        line_items: [
          blind({ position: 2, room_name: 'Study' }),
          blind({ position: 1, room_name: 'Kitchen' }),
        ],
      })
    );
    expect(labels.map((l) => l.room)).toEqual(['Kitchen', 'Study']);
  });

  it('skips preset and custom rows', () => {
    const labels = buildLabels(
      order({
        line_items: [
          { ...blind(), item_type: 'preset' },
          { ...blind(), item_type: 'custom', position: 1 },
          blind({ position: 2 }),
        ],
      })
    );
    expect(labels).toHaveLength(1);
    expect(labels[0].index).toBe(1);
  });

  it('returns an empty list for an order with no blinds', () => {
    expect(buildLabels(order())).toEqual([]);
    expect(buildLabels(order({ line_items: null }))).toEqual([]);
  });

  it('joins material and colour with a middle dot, dropping either side when blank', () => {
    const [both] = buildLabels(order({ line_items: [blind()] }));
    expect(both.material).toBe('Blackout White · Ivory');

    const [noColor] = buildLabels(order({ line_items: [blind({ color: '   ' })] }));
    expect(noColor.material).toBe('Blackout White');

    const [noMaterial] = buildLabels(order({ line_items: [blind({ material_name: null })] }));
    expect(noMaterial.material).toBe('Ivory');

    const [neither] = buildLabels(
      order({ line_items: [blind({ material_name: null, color: '' })] })
    );
    expect(neither.material).toBe('');
  });

  it('degrades the dimensions string when panels or drop are missing', () => {
    const [noHeight] = buildLabels(order({ line_items: [blind({ height_cm: null })] }));
    expect(noHeight.dimensions).toBe('120 + 90 cm');

    const [noPanels] = buildLabels(order({ line_items: [blind({ panels: [] })] }));
    expect(noPanels.dimensions).toBe('H 210 cm');

    const [neither] = buildLabels(
      order({ line_items: [blind({ panels: [], height_cm: null })] })
    );
    expect(neither.dimensions).toBe('');
  });

  it('trims text fields and tolerates a missing customer', () => {
    const [label] = buildLabels(
      order({ customer: null, line_items: [blind({ room_name: '  Den  ' })] })
    );
    expect(label.room).toBe('Den');
    expect(label.customer).toBe('');
    expect(label.orderNumber).toBe('T0408-126');
  });

  it('passes cassette and control through, blanking nulls', () => {
    const [full] = buildLabels(order({ line_items: [blind()] }));
    expect(full.cassette).toBe('Standard');
    expect(full.control).toBe('Chain Left');

    const [bare] = buildLabels(
      order({ line_items: [blind({ cassette_name: null, control_name: null })] })
    );
    expect(bare.cassette).toBe('');
    expect(bare.control).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test labels`
Expected: FAIL — `Failed to resolve import "./labels"`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/lib/labels.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Production-label field extraction — the shared source of truth for
 * WHAT goes on a label, independent of how it is drawn.
 *
 * TWIN MODULE: `apps/web/src/lib/labels.ts` is a line-for-line twin of
 * this file, exactly like the pricing.ts/totals.ts pair. The two print
 * paths render differently (browser CSS vs TSPL) but must always carry
 * the same words in the same order, so the extraction is duplicated
 * rather than shared. Change one side and you change BOTH, along with
 * both mirrored test suites.
 *
 * A label is fixed behind a blind's cassette before it ships, so the
 * unit is one physical installed blind: one label per line item per
 * unit of quantity. A multi-panel row is ONE unit and lists all its
 * panel widths. Preset and custom rows carry no dimensions and produce
 * no labels.
 */

/** The subset of a line-item row this module reads. */
export interface LabelLineItem {
  item_type: string;
  position: number;
  room_name: string;
  panels: number[];
  height_cm: number | null;
  material_name: string | null;
  color: string;
  cassette_name: string | null;
  control_name: string | null;
  quantity: number;
}

/** The subset of an order this module reads. */
export interface LabelOrder {
  order_number: string;
  customer?: { first_name: string; last_name: string } | null;
  line_items?: LabelLineItem[] | null;
}

/**
 * One label's worth of already-formatted text. Every field is a plain
 * string — a renderer decides only placement and size, never wording.
 * Fields that do not apply are `''` rather than absent, so a renderer
 * can test one way and never print a dangling label.
 */
export interface LabelFields {
  /** Order number, e.g. "T0408-126". */
  orderNumber: string;
  /** 1-based position across the whole order (the `n` in `n of m`). */
  index: number;
  /** Total labels the order produces (the `m` in `n of m`). */
  total: number;
  /** Customer full name; `''` when the order has no joined customer. */
  customer: string;
  room: string;
  /** Pre-joined, e.g. "120 + 90 x 210 cm"; `''` when nothing is known. */
  dimensions: string;
  /** Material and colour joined with " · "; either side may be absent. */
  material: string;
  cassette: string;
  control: string;
}

/** Trims a possibly-null value to a plain string. */
function text(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/**
 * Builds the printable dimension line. Panels are joined with " + "
 * because that is how the shop reads a multi-panel unit, and the drop
 * follows after "x". Either half degrades independently so a
 * half-measured blind still prints what IS known instead of nothing.
 */
function dimensionsOf(item: LabelLineItem): string {
  const widths = item.panels.length ? item.panels.join(' + ') : '';
  const drop = item.height_cm === null ? '' : String(item.height_cm);
  if (widths && drop) return `${widths} x ${drop} cm`;
  if (widths) return `${widths} cm`;
  if (drop) return `H ${drop} cm`;
  return '';
}

/**
 * Expands an order into its labels, ordered by line-item `position` and
 * then by copy index. Numbering runs across the WHOLE order — label 3
 * of 7 is unambiguous on a bench holding several units — which is why
 * the total is computed before any filtering by the caller.
 *
 * @param order Order with its joined customer and line items.
 * @returns One entry per physical blind; empty when the order has none.
 */
export function buildLabels(order: LabelOrder): LabelFields[] {
  const blinds = (order.line_items ?? [])
    .filter((li) => li.item_type === 'blind')
    .slice()
    .sort((a, b) => a.position - b.position);

  const total = blinds.reduce((sum, li) => sum + Math.max(1, li.quantity), 0);
  const customer = order.customer
    ? `${text(order.customer.first_name)} ${text(order.customer.last_name)}`.trim()
    : '';

  const labels: LabelFields[] = [];
  for (const item of blinds) {
    const material = [text(item.material_name), text(item.color)].filter(Boolean).join(' · ');
    for (let copy = 0; copy < Math.max(1, item.quantity); copy++) {
      labels.push({
        orderNumber: text(order.order_number),
        index: labels.length + 1,
        total,
        customer,
        room: text(item.room_name),
        dimensions: dimensionsOf(item),
        material,
        cassette: text(item.cassette_name),
        control: text(item.control_name),
      });
    }
  }
  return labels;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test labels`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/labels.ts apps/api/src/lib/labels.test.ts
git commit -m "feat(api): label field extraction from an order"
```

---

### Task 2: Web field extraction twin — `apps/web/src/lib/labels.ts`

**Files:**
- Create: `apps/web/src/lib/labels.ts`
- Test: `apps/web/src/lib/labels.test.ts`

**Interfaces:**
- Consumes: nothing at runtime. The file content is the twin of Task 1.
- Produces: the same `LabelFields`, `LabelLineItem`, `LabelOrder`, `buildLabels` — consumed by Task 7.

- [ ] **Step 1: Copy both files across**

Copy `apps/api/src/lib/labels.ts` → `apps/web/src/lib/labels.ts` and `apps/api/src/lib/labels.test.ts` → `apps/web/src/lib/labels.test.ts`, byte-for-byte, then make exactly two edits:

In `apps/web/src/lib/labels.ts`, change the TWIN MODULE paragraph to point the other way:

```ts
 * TWIN MODULE: `apps/api/src/lib/labels.ts` is a line-for-line twin of
 * this file, exactly like the pricing.ts/totals.ts pair. The two print
 * paths render differently (browser CSS vs TSPL) but must always carry
 * the same words in the same order, so the extraction is duplicated
 * rather than shared. Change one side and you change BOTH, along with
 * both mirrored test suites.
```

In `apps/web/src/lib/labels.test.ts`, change the mirror note:

```ts
 * Unit tests for the web-side label field extraction. This suite is the
 * MIRROR of apps/api/src/lib/labels.test.ts — the two modules are twins
 * (the same convention as pricing.ts/totals.ts) and must be changed
 * together. Any case added here is added there.
```

Nothing else differs. The `LabelLineItem` interface is structurally satisfied by the web `LineItem` type, and `LabelOrder` by `Order`, so Task 7 can pass an `Order` straight in without a cast.

- [ ] **Step 2: Run the web suite**

Run: `pnpm --filter web test labels`
Expected: PASS, 9 tests — the same 9 as the API side.

- [ ] **Step 3: Verify the twins have not drifted**

Run: `git diff --no-index apps/api/src/lib/labels.ts apps/web/src/lib/labels.ts`
Expected: only the TWIN MODULE paragraph differs (one path swapped). Any other difference is a mistake — fix it before committing.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/labels.ts apps/web/src/lib/labels.test.ts
git commit -m "feat(web): label field extraction twin"
```

---

### Task 3: TSPL renderer — `apps/api/src/lib/labelTspl.ts`

Turns `LabelFields[]` into the printer's command stream. Named `labelTspl.ts`, not `label.ts`, so it cannot be misread as the `labels.ts` twin.

**Files:**
- Create: `apps/api/src/lib/labelTspl.ts`
- Test: `apps/api/src/lib/labelTspl.test.ts`

**Interfaces:**
- Consumes: `LabelFields` from `./labels` (Task 1).
- Produces: `renderLabelsTspl(labels: LabelFields[]): string`, plus `stripControl(s: string): string` and `foldAscii(s: string): string` exported for tests.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/labelTspl.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Unit tests for TSPL label rendering. Asserts the emitted command
 * stream exactly — the same approach pdf.test.ts takes with itemContent
 * — because the printer is the only other consumer and it cannot be
 * exercised from CI.
 *
 * The stripControl cases are SECURITY tests, not formatting ones: TSPL
 * is newline-delimited, so an unescaped control character in a customer
 * name would let that name inject printer commands.
 */

import { describe, it, expect } from 'vitest';
import { renderLabelsTspl, stripControl, foldAscii } from './labelTspl';
import type { LabelFields } from './labels';

/** A fully-populated label; individual tests blank what they exercise. */
function label(overrides: Partial<LabelFields> = {}): LabelFields {
  return {
    orderNumber: 'T0408-126',
    index: 3,
    total: 7,
    customer: 'Ada Lovelace',
    room: 'Living Room',
    dimensions: '120 + 90 x 210 cm',
    material: 'Blackout White · Ivory',
    cassette: 'Standard',
    control: 'Chain Left',
    ...overrides,
  };
}

describe('stripControl', () => {
  it('removes characters that could close a TEXT statement', () => {
    expect(stripControl('Ada\r\nPRINT 9,9')).toBe('AdaPRINT 9,9');
    expect(stripControl('tab\there')).toBe('tabhere');
    expect(stripControl('null\u0000byte')).toBe('nullbyte');
  });

  it('removes backslashes and downgrades double quotes', () => {
    expect(stripControl('back\\slash')).toBe('backslash');
    expect(stripControl('say "hi"')).toBe("say 'hi'");
  });
});

describe('foldAscii', () => {
  it('folds accented and Turkish characters to their ASCII form', () => {
    expect(foldAscii('Émile Şoğut Çınar')).toBe('Emile Sogut Cinar');
    expect(foldAscii('Müller')).toBe('Muller');
  });

  it('drops characters with no ASCII equivalent', () => {
    expect(foldAscii('Ada 日本 Lovelace')).toBe('Ada  Lovelace');
  });

  it('leaves plain ASCII untouched', () => {
    expect(foldAscii('Blackout White')).toBe('Blackout White');
  });
});

describe('renderLabelsTspl', () => {
  it('renders one full label as an exact command stream', () => {
    expect(renderLabelsTspl([label()])).toBe(
      [
        'SIZE 3,1.50',
        'GAP 0.12,0',
        'DIRECTION 1',
        'DENSITY 8',
        'SPEED 4',
        'CLS',
        'TEXT 10,6,"4",0,1,1,"T0408-126"',
        'TEXT 527,14,"2",0,1,1,"3 of 7"',
        'BAR 10,42,589,2',
        'TEXT 10,50,"3",0,1,1,"Ada Lovelace"',
        'TEXT 10,78,"3",0,1,1,"Living Room"',
        'TEXT 10,106,"4",0,1,1,"120 + 90 x 210 cm"',
        'BAR 10,142,589,2',
        'TEXT 10,150,"3",0,1,1,"Blackout White - Ivory"',
        'TEXT 10,178,"3",0,1,1,"Standard"',
        'TEXT 10,206,"3",0,1,1,"Chain Left"',
        'PRINT 1,1',
        '',
      ].join('\r\n')
    );
  });

  it('emits one CLS/PRINT block per label', () => {
    const stream = renderLabelsTspl([label({ index: 1 }), label({ index: 2 })]);
    expect(stream.match(/^CLS$/gm)).toHaveLength(2);
    expect(stream.match(/^PRINT 1,1$/gm)).toHaveLength(2);
  });

  it('omits the line for an empty field without moving the rows below it', () => {
    const stream = renderLabelsTspl([label({ cassette: '', control: '' })]);
    expect(stream).not.toContain('TEXT 10,178');
    expect(stream).not.toContain('TEXT 10,206');
    // The material row keeps its fixed y.
    expect(stream).toContain('TEXT 10,150,"3",0,1,1,"Blackout White - Ivory"');
  });

  it('truncates per font cell width rather than wrapping', () => {
    // Font "3" is 16 dots wide: 589 / 16 = 36 characters.
    const stream = renderLabelsTspl([label({ room: 'R'.repeat(50) })]);
    expect(stream).toContain(`TEXT 10,78,"3",0,1,1,"${'R'.repeat(36)}"`);

    // Font "4" is 24 dots wide: 589 / 24 = 24 characters.
    const wide = renderLabelsTspl([label({ dimensions: 'D'.repeat(50) })]);
    expect(wide).toContain(`TEXT 10,106,"4",0,1,1,"${'D'.repeat(24)}"`);
  });

  it('right-aligns the counter against the label edge', () => {
    // "10 of 12" is 8 chars at 12 dots = 96; 599 - 96 = 503.
    const stream = renderLabelsTspl([label({ index: 10, total: 12 })]);
    expect(stream).toContain('TEXT 503,14,"2",0,1,1,"10 of 12"');
  });

  it('sanitizes and folds every interpolated field', () => {
    const stream = renderLabelsTspl([label({ customer: 'Şoğut\r\nPRINT 9,9', room: 'a"b' })]);
    expect(stream).toContain('TEXT 10,50,"3",0,1,1,"SogutPRINT 9,9"');
    expect(stream).toContain(`TEXT 10,78,"3",0,1,1,"a'b"`);
    expect(stream.match(/^PRINT 1,1$/gm)).toHaveLength(1);
  });

  it('returns an empty string for no labels', () => {
    expect(renderLabelsTspl([])).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test labelTspl`
Expected: FAIL — `Failed to resolve import "./labelTspl"`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/lib/labelTspl.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * TSPL rendering for production labels — the command stream the print
 * agent pipes straight to a LabelCreate 2410BT.
 *
 * STOCK: 3" x 1.5" direct thermal at 203 dpi = 609 x 304 dots. Every
 * coordinate below is in dots with the origin at the top-left, so the
 * layout is fixed and can be reasoned about without a printer present.
 *
 * FIXED ROWS: each field owns a y coordinate that never moves. A blind
 * with no cassette omits that line entirely rather than shifting the
 * rows beneath it, so an operator's eye finds the same fact in the same
 * place on every label in a batch.
 *
 * NO WRAPPING: an overlong value is truncated to what its font cell
 * fits. A wrapped line would push the layout past the label edge and
 * silently lose the rows below it.
 *
 * ENGINE NOTE: TSPL is a line-oriented command language, so text is
 * emitted with CRLF terminators and every interpolated value passes
 * through `stripControl` first — see its doc comment for why that is a
 * security control rather than formatting.
 */

import type { LabelFields } from './labels';

/* ── Geometry (dots) ────────────────────────────────────────────── */
const LEFT = 10;
const RIGHT_EDGE = 599; // 609 - LEFT
const USABLE = 589; // RIGHT_EDGE - LEFT

/** Bitmap font ids and their cell widths in dots (TSPL font table). */
const FONT_BIG = { id: '4', cell: 24 } as const; // 24x32
const FONT_MED = { id: '3', cell: 16 } as const; // 16x24
const FONT_SMALL = { id: '2', cell: 12 } as const; // 12x20

/**
 * Gap between die-cut labels, in inches. 0.12" (~3 mm) is the standard
 * for this stock and is the one value expected to need adjustment after
 * a physical calibration run with the real roll loaded.
 */
const GAP_INCHES = '0.12';

/**
 * Strips everything that could break out of a TSPL `TEXT` statement.
 *
 * SECURITY CONTROL, not formatting. TSPL commands are delimited by
 * newlines and arguments by double quotes, so a customer name or room
 * containing CR/LF could terminate the statement and have the rest of
 * the value executed as printer commands. Control characters and
 * backslashes are removed outright and double quotes are downgraded to
 * apostrophes — removal is used in preference to escaping because
 * backslash handling varies across TSPL firmware and an escape that the
 * printer does not honour is an injection.
 *
 * Same class of rule as `escapeHtml` for email bodies and the PostgREST
 * `or()` sanitizer (AI_GUIDELINES §2).
 */
export function stripControl(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\\/g, '')
    .replace(/"/g, "'");
}

/**
 * Folds text to printable ASCII.
 *
 * TSPL internal bitmap fonts are codepage-limited: an accented or
 * non-Latin character renders as a blank or as garbage, which on a
 * production label is worse than a plain approximation. "Émile Şoğut"
 * becomes "Emile Sogut". Characters with no ASCII equivalent are
 * dropped. Only the TSPL path folds — the browser path renders the
 * original text as typed.
 *
 * Dotless "ı" and capital "İ" are mapped explicitly because U+0131 has
 * no Unicode decomposition for the NFD pass to strip. The middle dot is
 * mapped because `buildLabels` uses it to join material and colour, and
 * dropping it would run the two values together.
 */
export function foldAscii(value: string): string {
  return value
    .replace(/·/g, '-')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'I')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\u0020-\u007e]/g, '');
}

/** Sanitizes, folds, and truncates one value to a font's cell width. */
function fit(value: string, cell: number): string {
  return foldAscii(stripControl(value)).slice(0, Math.floor(USABLE / cell));
}

/** One left-aligned TEXT command, or null when the value is empty. */
function row(y: number, font: { id: string; cell: number }, value: string): string | null {
  const content = fit(value, font.cell);
  return content ? `TEXT ${LEFT},${y},"${font.id}",0,1,1,"${content}"` : null;
}

/**
 * Renders every label as its own CLS…PRINT block and concatenates them
 * into one stream, so a whole order is a single job the agent writes in
 * one pass.
 *
 * @param labels Ordered labels from `buildLabels`, already filtered to
 *               what the caller wants printed.
 * @returns The complete TSPL stream, CRLF-terminated; `''` for no labels.
 */
export function renderLabelsTspl(labels: LabelFields[]): string {
  const lines: string[] = [];

  for (const label of labels) {
    const counter = fit(`${label.index} of ${label.total}`, FONT_SMALL.cell);
    const counterX = RIGHT_EDGE - counter.length * FONT_SMALL.cell;

    lines.push(
      `SIZE 3,1.50`,
      `GAP ${GAP_INCHES},0`,
      'DIRECTION 1',
      'DENSITY 8',
      'SPEED 4',
      'CLS'
    );

    const orderNumber = fit(label.orderNumber, FONT_BIG.cell);
    if (orderNumber) lines.push(`TEXT ${LEFT},6,"${FONT_BIG.id}",0,1,1,"${orderNumber}"`);
    if (counter) lines.push(`TEXT ${counterX},14,"${FONT_SMALL.id}",0,1,1,"${counter}"`);
    lines.push(`BAR ${LEFT},42,${USABLE},2`);

    for (const line of [
      row(50, FONT_MED, label.customer),
      row(78, FONT_MED, label.room),
      row(106, FONT_BIG, label.dimensions),
    ]) {
      if (line) lines.push(line);
    }

    lines.push(`BAR ${LEFT},142,${USABLE},2`);

    for (const line of [
      row(150, FONT_MED, label.material),
      row(178, FONT_MED, label.cassette),
      row(206, FONT_MED, label.control),
    ]) {
      if (line) lines.push(line);
    }

    lines.push('PRINT 1,1');
  }

  return lines.length ? `${lines.join('\r\n')}\r\n` : '';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test labelTspl`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/labelTspl.ts apps/api/src/lib/labelTspl.test.ts
git commit -m "feat(api): TSPL renderer for 3x1.5in production labels"
```

---

### Task 4: Migration 28 — `print_jobs` + the claim RPC

**Files:**
- Create: `supabase/migrations/20260728000028_print_jobs.sql`

**Interfaces:**
- Consumes: the existing `public.orders` table and `public.set_updated_at()` trigger function.
- Produces: table `public.print_jobs`; RPC `public.claim_print_job()` returning `(id uuid, payload text, label_count int, order_number text)`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260728000028_print_jobs.sql`:

```sql
-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 28: print_jobs.
-- Queue of rendered production-label jobs waiting for the shop-floor
-- print agent. The API is a Cloudflare Worker with no route into the
-- shop LAN, so the agent must initiate every connection: it polls
-- claim_print_job() every 30 seconds and reports the result back.
--
-- payload holds the FULL TSPL command stream for the whole request —
-- one job per print request, not one per label — so the agent writes it
-- to the printer in a single pass and never has to understand TSPL.

create table public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'printing', 'done', 'failed')),
  payload text not null,
  label_count int not null default 1 check (label_count >= 1),
  attempts int not null default 0,
  last_error text not null default '',
  -- Email of the staff member who queued it (order_logs.actor_email convention).
  requested_by text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The agent's only query: oldest pending first.
create index print_jobs_pending_idx on public.print_jobs (status, created_at);

create trigger print_jobs_set_updated_at
  before update on public.print_jobs
  for each row execute function public.set_updated_at();

alter table public.print_jobs enable row level security;

create policy authenticated_full_access on public.print_jobs
  for all to authenticated
  using (true) with check (true);

-- Atomic claim. PostgREST cannot express "update the oldest pending
-- row" without a race, and two agent instances racing would print the
-- same labels twice, so this is an RPC using FOR UPDATE SKIP LOCKED.
create or replace function public.claim_print_job()
returns table (id uuid, payload text, label_count int, order_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Reap jobs whose agent died mid-print. Three failed claims is the
  -- point at which retrying is no longer worth blocking the queue.
  update public.print_jobs
     set status = case when attempts >= 3 then 'failed' else 'pending' end,
         last_error = case when attempts >= 3
                           then 'Abandoned after 3 attempts.'
                           else last_error end
   where status = 'printing'
     and updated_at < now() - interval '5 minutes';

  select j.id into v_id
    from public.print_jobs j
   where j.status = 'pending'
   order by j.created_at
   for update skip locked
   limit 1;

  if v_id is null then
    return;
  end if;

  update public.print_jobs j
     set status = 'printing',
         attempts = j.attempts + 1
   where j.id = v_id;

  return query
    select j.id, j.payload, j.label_count, o.order_number
      from public.print_jobs j
      join public.orders o on o.id = j.order_id
     where j.id = v_id;
end;
$$;

-- Worker-only entry point: nothing but the service role may call it.
revoke execute on function public.claim_print_job() from public, anon, authenticated;
grant execute on function public.claim_print_job() to service_role;
```

- [ ] **Step 2: Verify the file is syntactically plausible**

There is no local Postgres in this repo, so this step is a read-through, not an execution. Confirm by eye:
- the SPDX header uses `--` comments
- `set_updated_at` matches the function name used by the other migrations (check `supabase/migrations/20260703000000_init_helpers.sql`)
- the `revoke`/`grant` pair matches the argument list exactly (`claim_print_job()` takes none)

Run: `grep -n "set_updated_at" supabase/migrations/20260703000000_init_helpers.sql`
Expected: the function is defined there as `public.set_updated_at()`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260728000028_print_jobs.sql
git commit -m "feat(db): print_jobs queue + claim_print_job RPC (migration 28)"
```

⚠️ This migration is NOT applied to the live project by this task. Applying it to `lgbxxlwsdeuhdgzrjjen` is a deploy step recorded in Task 9.

---

### Task 5: `POST /api/orders/:id/print-label`

**Files:**
- Modify: `apps/api/src/routes/orders.ts` (module header endpoint list ~line 15-47; new route beside `/:id/cut-done` at ~line 1377)
- Test: `apps/api/src/routes/orders.routes.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: `buildLabels` from `../lib/labels` (Task 1), `renderLabelsTspl` from `../lib/labelTspl` (Task 3), the `print_jobs` table (Task 4), and the module's existing `readDetail`, `logOrderEvent`, `createSupabaseAdmin`.
- Produces: `POST /:id/print-label` accepting `{ items?: number[] }` and returning `{ data: { job_id: string; label_count: number } }` with status 202.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/routes/orders.routes.test.ts`. The file's existing fake Supabase client and `ENV` const are reused as-is:

```ts
describe('POST /:id/print-label', () => {
  /** An order detail row shaped the way readDetail returns it. */
  function detailRow() {
    return {
      id: '55555555-5555-4555-8555-555555555555',
      order_number: 'T0408-126',
      status: 'in_progress',
      customer: { first_name: 'Ada', last_name: 'Lovelace' },
      payments: [],
      line_items: [
        {
          item_type: 'blind',
          position: 0,
          room_name: 'Living Room',
          panels: [120, 90],
          height_cm: 210,
          material_name: 'Blackout White',
          color: 'Ivory',
          cassette_name: 'Standard',
          control_name: 'Chain Left',
          quantity: 2,
        },
      ],
    };
  }

  beforeEach(() => {
    db.responses = {};
    db.insertPayloads = {};
    db.calls = [];
  });

  it('queues one job holding every label and returns 202', async () => {
    db.responses['orders.select'] = [detailRow()];
    db.responses['print_jobs.insert'] = [{ id: '66666666-6666-4666-8666-666666666666' }];

    const res = await ordersApp.request(
      '/55555555-5555-4555-8555-555555555555/print-label',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      ENV
    );

    expect(res.status).toBe(202);
    const body = (await res.json()) as { data: { job_id: string; label_count: number } };
    expect(body.data.label_count).toBe(2);

    const [job] = db.insertPayloads['print_jobs'] as Array<{
      payload: string;
      label_count: number;
    }>;
    expect(job.label_count).toBe(2);
    expect(job.payload.match(/^PRINT 1,1$/gm)).toHaveLength(2);
  });

  it('prints only the requested labels but keeps their original numbering', async () => {
    db.responses['orders.select'] = [detailRow()];
    db.responses['print_jobs.insert'] = [{ id: '66666666-6666-4666-8666-666666666666' }];

    const res = await ordersApp.request(
      '/55555555-5555-4555-8555-555555555555/print-label',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [2] }),
      },
      ENV
    );

    expect(res.status).toBe(202);
    const [job] = db.insertPayloads['print_jobs'] as Array<{ payload: string }>;
    expect(job.payload).toContain('"2 of 2"');
    expect(job.payload).not.toContain('"1 of 2"');
  });

  it('refuses an order with no blind line items', async () => {
    db.responses['orders.select'] = [{ ...detailRow(), line_items: [] }];

    const res = await ordersApp.request(
      '/55555555-5555-4555-8555-555555555555/print-label',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      ENV
    );

    expect(res.status).toBe(400);
    expect(db.insertPayloads['print_jobs']).toBeUndefined();
  });

  it('refuses a label index the order does not have', async () => {
    db.responses['orders.select'] = [detailRow()];

    const res = await ordersApp.request(
      '/55555555-5555-4555-8555-555555555555/print-label',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [9] }),
      },
      ENV
    );

    expect(res.status).toBe(400);
    expect(db.insertPayloads['print_jobs']).toBeUndefined();
  });

  it('rejects unknown body fields (strict schema)', async () => {
    db.responses['orders.select'] = [detailRow()];

    const res = await ordersApp.request(
      '/55555555-5555-4555-8555-555555555555/print-label',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [1], copies: 3 }),
      },
      ENV
    );

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test orders.routes`
Expected: FAIL — the new cases 404, because the route does not exist.

- [ ] **Step 3: Add the imports and the schema**

In `apps/api/src/routes/orders.ts`, add to the existing import block near the top:

```ts
import { buildLabels } from '../lib/labels';
import { renderLabelsTspl } from '../lib/labelTspl';
```

Add the schema beside the other zod schemas in the file:

```ts
/**
 * Body for POST /:id/print-label. `items` holds 1-based label indexes
 * in the order `buildLabels` produces; omitted or empty means every
 * label. Strict, so a client cannot smuggle in a copy count or a
 * pre-rendered payload.
 */
const printLabelSchema = z
  .object({ items: z.array(z.number().int().positive()).optional() })
  .strict();
```

- [ ] **Step 4: Write the route**

Add immediately after the `/:id/cut-done` handler in `apps/api/src/routes/orders.ts`:

```ts
/**
 * Queues this order's production labels for the shop-floor print agent.
 *
 * Labels are rendered to TSPL HERE, not by the agent — the Worker has
 * the test suite, and the agent stays a dumb pipe that needs no
 * knowledge of the label layout. One request produces exactly one
 * `print_jobs` row holding the whole batch.
 *
 * `items` selects a subset for reprinting a damaged label. Selection
 * happens AFTER numbering, so a reprint of label 3 still prints
 * "3 of 7" and the operator can match it to the unit on the bench.
 *
 * This is the device-independent path: an iPad cannot reach a Bluetooth
 * printer at all, so for anything but the shop PC this endpoint is the
 * only way to print.
 */
app.post('/:id/print-label', async (c) => {
  const parsed = printLabelSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Body must be { items?: number[] }.' }, 400);

  const sb = createSupabaseAdmin(c.env);
  const id = c.req.param('id');
  const { data: order } = await readDetail(sb, id);
  if (!order) return c.json({ error: 'Order not found' }, 404);

  const all = buildLabels(order);
  if (!all.length) return c.json({ error: 'This order has no blinds to label.' }, 400);

  const wanted = parsed.data.items?.length ? parsed.data.items : null;
  if (wanted) {
    const missing = wanted.find((n) => n > all.length);
    if (missing !== undefined) {
      return c.json({ error: `Label ${missing} does not exist on this order.` }, 400);
    }
  }
  const chosen = wanted ? all.filter((l) => wanted.includes(l.index)) : all;

  const { data: job, error } = await sb
    .from('print_jobs')
    .insert({
      order_id: id,
      payload: renderLabelsTspl(chosen),
      label_count: chosen.length,
      // The route group runs behind requireAuth in production; the `?.`
      // keeps route-level tests, which mount this app directly, working.
      requested_by: c.get('user')?.email ?? '',
    })
    .select('id')
    .single();
  if (error) return c.json({ error: error.message }, 500);

  await logOrderEvent(sb, id, `Queued ${chosen.length} label(s) for printing.`);
  return c.json({ data: { job_id: job.id, label_count: chosen.length } }, 202);
});
```

- [ ] **Step 5: Document the endpoint in the module header**

In the `Endpoints:` list in the `apps/api/src/routes/orders.ts` header comment, add after the `/:id/ready` line:

```
 *   POST   /:id/print-label
 *                         queue this order's production labels for the
 *                         shop-floor print agent; `{ items?: number[] }`
 *                         reprints a subset without renumbering them
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter api test orders.routes`
Expected: PASS — the pre-existing cases plus 5 new ones.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/orders.ts apps/api/src/routes/orders.routes.test.ts
git commit -m "feat(api): POST /orders/:id/print-label queues a label job"
```

---

### Task 6: Agent routes — `apps/api/src/routes/printAgent.ts`

**Files:**
- Create: `apps/api/src/routes/printAgent.ts`
- Test: `apps/api/src/routes/printAgent.routes.test.ts`
- Modify: `apps/api/src/index.ts` (Env interface ~line 40; route mounting ~line 92)

**Interfaces:**
- Consumes: the `claim_print_job()` RPC and `print_jobs` table (Task 4), `createSupabaseAdmin`, the `Env` type.
- Produces: `GET /agent/print-jobs/next` → `{ data: { id, payload, label_count, order_number } }` or 204; `POST /agent/print-jobs/:id/result` accepting `{ ok: boolean; error?: string }`. Consumed by Task 8.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/printAgent.routes.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Route-level tests for the print-agent endpoints. These are the only
 * routes outside /api/* other than the e-Transfer webhook, so the
 * shared-secret guard is the first thing pinned here: a Worker with no
 * PRINT_AGENT_SECRET configured must fail CLOSED, never open.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Scripted state for the fake Supabase client. */
const db = {
  rpcResult: [] as unknown[],
  rpcError: null as { message: string } | null,
  updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
};

vi.mock('../lib/supabase', () => ({
  createSupabaseAdmin: () => ({
    rpc: async () => ({ data: db.rpcResult, error: db.rpcError }),
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) builder[m] = () => builder;
      builder.update = (values: Record<string, unknown>) => {
        db.updates.push({ table, values });
        return builder;
      };
      (builder as { then: unknown }).then = (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve(onFulfilled({ data: [], error: null }));
      return builder;
    },
  }),
}));

import agentApp from './printAgent';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  RESEND_API_KEY: 'not-a-real-key',
  APP_URL: 'http://localhost:5173',
  ENVIRONMENT: 'test',
  PRINT_AGENT_SECRET: 'shop-floor-secret',
};

const AUTH = { Authorization: 'Bearer shop-floor-secret' };

beforeEach(() => {
  db.rpcResult = [];
  db.rpcError = null;
  db.updates = [];
});

describe('GET /print-jobs/next', () => {
  it('returns 204 when the queue is empty', async () => {
    const res = await agentApp.request('/print-jobs/next', { headers: AUTH }, ENV);
    expect(res.status).toBe(204);
  });

  it('returns the claimed job', async () => {
    db.rpcResult = [
      {
        id: '66666666-6666-4666-8666-666666666666',
        payload: 'SIZE 3,1.50\r\nPRINT 1,1\r\n',
        label_count: 2,
        order_number: 'T0408-126',
      },
    ];
    const res = await agentApp.request('/print-jobs/next', { headers: AUTH }, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { label_count: number; payload: string } };
    expect(body.data.label_count).toBe(2);
    expect(body.data.payload).toContain('PRINT 1,1');
  });

  it('rejects a wrong secret', async () => {
    const res = await agentApp.request(
      '/print-jobs/next',
      { headers: { Authorization: 'Bearer wrong' } },
      ENV
    );
    expect(res.status).toBe(401);
  });

  it('fails closed when no secret is configured', async () => {
    const res = await agentApp.request('/print-jobs/next', { headers: AUTH }, {
      ...ENV,
      PRINT_AGENT_SECRET: undefined,
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /print-jobs/:id/result', () => {
  it('marks a job done', async () => {
    const res = await agentApp.request(
      '/print-jobs/66666666-6666-4666-8666-666666666666/result',
      {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true }),
      },
      ENV
    );
    expect(res.status).toBe(200);
    expect(db.updates[0].values).toEqual({ status: 'done', last_error: '' });
  });

  it('records a truncated failure reason', async () => {
    const res = await agentApp.request(
      '/print-jobs/66666666-6666-4666-8666-666666666666/result',
      {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'x'.repeat(900) }),
      },
      ENV
    );
    expect(res.status).toBe(200);
    const values = db.updates[0].values as { status: string; last_error: string };
    expect(values.status).toBe('failed');
    expect(values.last_error).toHaveLength(500);
  });

  it('rejects unknown body fields (strict schema)', async () => {
    const res = await agentApp.request(
      '/print-jobs/66666666-6666-4666-8666-666666666666/result',
      {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, retries: 2 }),
      },
      ENV
    );
    expect(res.status).toBe(400);
    expect(db.updates).toHaveLength(0);
  });

  it('rejects an unauthenticated caller before touching the database', async () => {
    const res = await agentApp.request(
      '/print-jobs/66666666-6666-4666-8666-666666666666/result',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"ok":true}' },
      ENV
    );
    expect(res.status).toBe(401);
    expect(db.updates).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test printAgent`
Expected: FAIL — `Failed to resolve import "./printAgent"`.

- [ ] **Step 3: Write the routes**

Create `apps/api/src/routes/printAgent.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Print-agent routes — mounted at /agent, deliberately OUTSIDE the
 * /api/* JWT prefix.
 *
 * The consumer is a headless Node process on a shop PC with no Supabase
 * session and no way to obtain one, so it authenticates with a shared
 * bearer secret (PRINT_AGENT_SECRET) exactly the way routes/webhook.ts
 * does. A Worker with no secret configured rejects everything: this
 * path hands out rendered print jobs, so it must fail closed.
 *
 * DIRECTION: the API is a Cloudflare Worker and cannot open a
 * connection into the shop LAN, so the agent polls. `GET next` claims
 * at most one job and answers 204 the vast majority of the time — at a
 * 30-second interval that is ~2,880 requests a day for a handful of
 * prints. Cheap, and it survives NAT, Wi-Fi drops, and a printer that
 * is switched off.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Context } from 'hono';
import { createSupabaseAdmin } from '../lib/supabase';
import type { Env } from '../index';

const app = new Hono<{ Bindings: Env }>();

/** Body for the agent's completion report. */
const resultSchema = z
  .object({ ok: z.boolean(), error: z.string().max(2000).optional() })
  .strict();

/**
 * Shared-secret check. Returns false when the binding is unset so an
 * unconfigured Worker cannot be polled by anyone.
 */
function authorized(c: Context<{ Bindings: Env }>): boolean {
  const secret = c.env.PRINT_AGENT_SECRET;
  const auth = c.req.header('Authorization') ?? '';
  return Boolean(secret) && auth === `Bearer ${secret}`;
}

/**
 * Claims the oldest waiting job and hands the agent its TSPL payload.
 *
 * Claiming is the `claim_print_job()` RPC rather than a PostgREST
 * update because two agent instances racing on the same row would print
 * the same labels twice; the RPC uses FOR UPDATE SKIP LOCKED and also
 * re-queues jobs whose agent died mid-print.
 *
 * 204 means the queue is empty — the normal answer.
 */
app.get('/print-jobs/next', async (c) => {
  if (!authorized(c)) return c.json({ error: 'Unauthorized' }, 401);

  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb.rpc('claim_print_job');
  if (error) return c.json({ error: error.message }, 500);

  const job = Array.isArray(data) ? data[0] : null;
  if (!job) return c.body(null, 204);
  return c.json({ data: job });
});

/**
 * Records the outcome of a claimed job.
 *
 * The update is filtered on `status = 'printing'`, so a report that
 * arrives twice — the agent retried after a network blip — is a no-op
 * the second time rather than a state corruption. The response is 200
 * either way; the agent has nothing useful to do with the difference.
 */
app.post('/print-jobs/:id/result', async (c) => {
  if (!authorized(c)) return c.json({ error: 'Unauthorized' }, 401);

  const parsed = resultSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Body must be { ok: boolean, error?: string }.' }, 400);
  }

  const sb = createSupabaseAdmin(c.env);
  const status = parsed.data.ok ? 'done' : 'failed';
  const last_error = parsed.data.ok ? '' : (parsed.data.error ?? '').slice(0, 500);

  const { error } = await sb
    .from('print_jobs')
    .update({ status, last_error })
    .eq('id', c.req.param('id'))
    .eq('status', 'printing');
  if (error) return c.json({ error: error.message }, 500);

  return c.json({ data: { status } });
});

export default app;
```

- [ ] **Step 4: Wire it into the Worker**

In `apps/api/src/index.ts`, add to the `Env` interface after `ETRANSFER_WEBHOOK_SECRET`:

```ts
  /** Shared secret the shop-floor print agent sends as a Bearer token. */
  PRINT_AGENT_SECRET?: string;
```

Add the import beside the other route imports:

```ts
import printAgentRoutes from './routes/printAgent';
```

And mount it immediately after the `/webhooks` mount, keeping its comment:

```ts
/**
 * Print agent — like /webhooks, intentionally OUTSIDE /api/* so it
 * skips JWT auth; the agent is a headless process with no Supabase
 * session and authenticates with a shared bearer secret instead.
 */
app.route('/agent', printAgentRoutes);
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter api test printAgent`
Expected: PASS, 8 tests.

- [ ] **Step 6: Type-check the whole API workspace**

Run: `pnpm --filter api check`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/printAgent.ts apps/api/src/routes/printAgent.routes.test.ts apps/api/src/index.ts
git commit -m "feat(api): /agent print-job claim + result endpoints"
```

---

### Task 7: Web label page — `/orders/:id/labels`

**Files:**
- Create: `apps/web/src/pages/orders/OrderLabels.tsx`
- Modify: `apps/web/src/hooks/useOrders.ts` (add the mutation beside `useSetCutDone`, ~line 262)
- Modify: `apps/web/src/App.tsx` (lazy import; route after line 95)
- Modify: `apps/web/src/pages/orders/OrderDetail.tsx` (`ICONS` map ~line 275; `in_progress` branch ~line 1381-1388)

**Interfaces:**
- Consumes: `buildLabels` and `LabelFields` from `../../lib/labels` (Task 2); `POST /api/orders/:id/print-label` (Task 5); the existing `useOrder`, `apiFetch`, `PageHeader`.
- Produces: the `OrderLabels` page component and `useEnqueuePrintLabels(): UseMutationResult<{ job_id: string; label_count: number }, Error, { id: string; items?: number[] }>`.

- [ ] **Step 1: Add the mutation hook**

In `apps/web/src/hooks/useOrders.ts`, add after `useSetCutDone`:

```ts
/**
 * Queues an order's production labels for the shop-floor print agent —
 * the device-independent print path.
 *
 * The shop PC can print straight from the browser, but iOS has no Web
 * Bluetooth, so from an iPad this endpoint is the ONLY way to reach the
 * label printer. `items` holds 1-based label indexes for reprinting a
 * damaged label; omit it to print every label on the order.
 *
 * Queues only — it does not wait for the printer. The agent polls every
 * 30 seconds, so a job can sit briefly before it prints. Nothing about
 * the order changes, so no cache is invalidated.
 */
export function useEnqueuePrintLabels(): UseMutationResult<
  { job_id: string; label_count: number },
  Error,
  { id: string; items?: number[] }
> {
  return useMutation({
    mutationFn: async ({ id, items }) =>
      (
        await apiFetch<Envelope<{ job_id: string; label_count: number }>>(
          `/api/orders/${id}/print-label`,
          { method: 'POST', body: JSON.stringify(items?.length ? { items } : {}) }
        )
      ).data,
  });
}
```

- [ ] **Step 2: Write the page**

Create `apps/web/src/pages/orders/OrderLabels.tsx`:

```tsx
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Production labels for an order — one 3" x 1.5" direct-thermal label
 * per physical blind, fixed behind the cassette before the unit ships.
 *
 * The label is invisible after installation, so this page optimises for
 * legibility on a shop floor and nothing else. Sizing is exact: `@page`
 * declares the stock size and every label box is exactly 3in x 1.5in
 * with zero margin, so one label is one physical label with no scaling.
 *
 * TWO PRINT PATHS, one selection:
 *   - "Print" goes through the browser to a Windows-installed printer.
 *     This is the shop PC. With Chrome started using --kiosk-printing
 *     the dialog is suppressed entirely.
 *   - "Send to printer" queues a job for the shop-floor agent. iOS has
 *     no Web Bluetooth, so from an iPad this is the only path that can
 *     reach the printer at all.
 *
 * Opened in a new tab from the order page, following the Manufacturer
 * Copy / Order Overview pattern.
 */

import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import PageHeader from '../../components/PageHeader';
import { useOrder, useEnqueuePrintLabels } from '../../hooks/useOrders';
import { buildLabels, type LabelFields } from '../../lib/labels';

/**
 * One label at its true printed proportions.
 *
 * Rows sit at fixed positions rather than flowing, mirroring the TSPL
 * renderer: a blind with no cassette leaves that row blank instead of
 * pulling the rows below it up, so the same fact is always in the same
 * place across a batch. `print:break-after-page` makes each label its
 * own sheet.
 */
function Label({ fields }: { fields: LabelFields }) {
  return (
    <div className="h-[1.5in] w-[3in] shrink-0 overflow-hidden border border-border bg-white p-[0.06in] font-sans text-black print:break-after-page print:border-0">
      <div className="flex items-baseline justify-between">
        <span className="text-[15pt] font-bold leading-none">{fields.orderNumber}</span>
        <span className="text-[7pt] leading-none">
          {fields.index} of {fields.total}
        </span>
      </div>
      <div className="my-[0.03in] border-t border-black" />
      <div className="truncate text-[10pt] leading-tight">{fields.customer}</div>
      <div className="truncate text-[10pt] leading-tight">{fields.room}</div>
      <div className="truncate text-[15pt] font-bold leading-tight">{fields.dimensions}</div>
      <div className="my-[0.03in] border-t border-black" />
      <div className="truncate text-[10pt] leading-tight">{fields.material}</div>
      <div className="truncate text-[10pt] leading-tight">{fields.cassette}</div>
      <div className="truncate text-[10pt] leading-tight">{fields.control}</div>
    </div>
  );
}

/**
 * The labels page. Selection state is a set of 1-based label indexes —
 * the same numbering the API uses — so a reprint of one scorched label
 * asks for exactly that label and still prints its original "3 of 7".
 */
export default function OrderLabels() {
  const { id } = useParams<{ id: string }>();
  const { data: order, isLoading } = useOrder(id);
  const enqueue = useEnqueuePrintLabels();

  const labels = useMemo(() => (order ? buildLabels(order) : []), [order]);
  const [deselected, setDeselected] = useState<Set<number>>(new Set());

  const selected = labels.filter((l) => !deselected.has(l.index));
  const allSelected = deselected.size === 0;

  /** Flips one label's checkbox. */
  function toggle(index: number) {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  /** Select-all is a clear; deselect-all marks every index. */
  function toggleAll() {
    setDeselected(allSelected ? new Set(labels.map((l) => l.index)) : new Set());
  }

  /** Queues the current selection for the shop-floor agent. */
  async function handleSend() {
    if (!id || !selected.length) return;
    try {
      const result = await enqueue.mutateAsync({
        id,
        items: allSelected ? undefined : selected.map((l) => l.index),
      });
      toast.success(`Queued ${result.label_count} label(s) for the printer.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not queue the labels.');
    }
  }

  return (
    <div className="min-h-screen bg-surface-muted print:bg-white">
      {/*
        Print rules live in the page rather than the global stylesheet:
        the 3in x 1.5in page size must not leak onto any other printable
        view (the cut sheet and the order overview are both Letter).
      */}
      <style>{`
        @media print {
          @page { size: 3in 1.5in; margin: 0 }
          html, body { margin: 0; padding: 0; background: #fff }
        }
      `}</style>

      <PageHeader
        title="Labels"
        backTo={id ? `/orders/${id}` : '/'}
        right={
          <div className="flex items-center gap-2 print:hidden">
            <button
              onClick={handleSend}
              disabled={!selected.length || enqueue.isPending}
              className="flex h-9 items-center rounded-sm border border-border-input bg-surface px-3 text-sm font-medium text-text-secondary hover:bg-surface-sunken disabled:opacity-50"
            >
              {enqueue.isPending ? 'Queueing…' : 'Send to printer'}
            </button>
            <button
              onClick={() => window.print()}
              disabled={!selected.length}
              className="flex h-9 items-center rounded-sm bg-brand-600 px-3 text-sm font-medium text-white disabled:opacity-50"
            >
              Print
            </button>
          </div>
        }
      />

      <div className="mx-auto w-full max-w-lg p-4">
        {isLoading && <p className="text-sm text-text-muted">Loading…</p>}

        {!isLoading && !labels.length && (
          <p className="text-sm text-text-muted">
            This order has no blinds to label. Preset and custom lines carry no dimensions, so
            they get no label.
          </p>
        )}

        {labels.length > 0 && (
          <>
            <div className="mb-4 flex items-center justify-between print:hidden">
              <span className="text-sm text-text-muted">
                {selected.length} of {labels.length} selected
              </span>
              <button onClick={toggleAll} className="text-sm font-medium text-brand-600">
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            </div>

            <div className="flex flex-col items-center gap-4 print:gap-0">
              {labels.map((fields) => {
                const isOn = !deselected.has(fields.index);
                return (
                  <div key={fields.index} className={isOn ? '' : 'print:hidden'}>
                    <label className="mb-1 flex items-center gap-2 text-sm text-text-secondary print:hidden">
                      <input type="checkbox" checked={isOn} onChange={() => toggle(fields.index)} />
                      Label {fields.index}
                    </label>
                    <Label fields={fields} />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Register the route**

In `apps/web/src/App.tsx`, add the lazy import beside the other order-page imports:

```tsx
const OrderLabels = lazy(() => import('./pages/orders/OrderLabels'));
```

(Match the exact `lazy(...)` style already used for `ManufacturerCopy` in that file.)

Add the route immediately after the `/orders/:id/overview` line:

```tsx
<Route path="/orders/:id/labels" element={guard(<Layout nav={false}><OrderLabels /></Layout>)} />
```

- [ ] **Step 4: Add the entry button**

In `apps/web/src/pages/orders/OrderDetail.tsx`, add to the `ICONS` map after `overview`:

```tsx
  labels: (
    <ActionIcon>
      <path d="M3 7a2 2 0 0 1 2-2h9l6 6-9 9-8-8V7Z" />
      <path d="M7 9h.01" />
    </ActionIcon>
  ),
```

In the `in_progress` branch of `stageActions()`, add the action beside `manufacturer` and return it:

```tsx
      const labels: StageAction = {
        key: 'labels',
        icon: ICONS.labels,
        label: 'Labels',
        short: 'Labels',
        onClick: () => window.open(`/orders/${id}/labels`, '_blank', 'noopener'),
      };
      return { primary: markReady, secondary: [manufacturer, labels, overview] };
```

Three secondaries still fit the mobile bar's one-row-of-three rule, so its worst case does not grow.

- [ ] **Step 5: Verify the web workspace**

Run: `pnpm --filter web check`
Expected: 0 errors.

Run: `pnpm --filter web test`
Expected: PASS — the pre-existing suites plus the 9 twin cases from Task 2.

Run: `pnpm --filter web lint`
Expected: 0 new warnings. Four pre-existing `LineItemEditor` warnings are known and are not yours to fix.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/orders/OrderLabels.tsx apps/web/src/hooks/useOrders.ts apps/web/src/App.tsx apps/web/src/pages/orders/OrderDetail.tsx
git commit -m "feat(web): /orders/:id/labels print view + queue action"
```

---

### Task 8: Print agent — `apps/print-agent/`

**Files:**
- Create: `apps/print-agent/package.json`, `apps/print-agent/tsconfig.json`, `apps/print-agent/README.md`
- Create: `apps/print-agent/src/config.ts`, `apps/print-agent/src/printer.ts`, `apps/print-agent/src/index.ts`
- Test: `apps/print-agent/src/config.test.ts`, `apps/print-agent/src/printer.test.ts`

**Interfaces:**
- Consumes: `GET /agent/print-jobs/next` and `POST /agent/print-jobs/:id/result` (Task 6).
- Produces: a runnable agent. `loadConfig(env: NodeJS.ProcessEnv): AgentConfig`, `strategyFor(target: string): PrintStrategy`, `sendToPrinter(target: string, payload: string): Promise<void>`.

- [ ] **Step 1: Scaffold the workspace**

Create `apps/print-agent/package.json`:

```json
{
  "name": "print-agent",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "check": "tsc --noEmit",
    "test": "vitest run",
    "start": "node dist/index.js"
  },
  "devDependencies": {
    "@types/node": "^24.13.2",
    "typescript": "~6.0.2",
    "vitest": "^3.2.0"
  }
}
```

Create `apps/print-agent/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

Run: `pnpm install`
Expected: the new workspace is linked (`apps/*` is already the workspace glob in `pnpm-workspace.yaml`).

- [ ] **Step 2: Write the failing config test**

Create `apps/print-agent/src/config.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Tests for agent configuration loading. The agent runs unattended on a
 * shop PC, so a misconfiguration must fail loudly at STARTUP rather
 * than silently at the first print an hour later.
 */

import { describe, it, expect } from 'vitest';
import { loadConfig } from './config';

/** A complete, valid environment. */
function env(overrides: Record<string, string | undefined> = {}) {
  return {
    API_BASE_URL: 'https://blinds-nisa-api.workers.dev/',
    PRINT_AGENT_SECRET: 'shop-floor-secret',
    PRINTER_TARGET: 'COM5',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe('loadConfig', () => {
  it('reads a complete environment and strips the trailing slash', () => {
    expect(loadConfig(env())).toEqual({
      apiBaseUrl: 'https://blinds-nisa-api.workers.dev',
      secret: 'shop-floor-secret',
      printerTarget: 'COM5',
      pollMs: 30000,
    });
  });

  it('names every missing variable in one error', () => {
    expect(() =>
      loadConfig(env({ PRINT_AGENT_SECRET: undefined, PRINTER_TARGET: undefined }))
    ).toThrow(/PRINT_AGENT_SECRET, PRINTER_TARGET/);
  });

  it('treats a blank variable as missing', () => {
    expect(() => loadConfig(env({ PRINTER_TARGET: '   ' }))).toThrow(/PRINTER_TARGET/);
  });

  it('accepts a custom poll interval', () => {
    expect(loadConfig(env({ POLL_MS: '60000' })).pollMs).toBe(60000);
  });

  it('rejects a poll interval that would hammer the API', () => {
    expect(() => loadConfig(env({ POLL_MS: '250' }))).toThrow(/POLL_MS/);
    expect(() => loadConfig(env({ POLL_MS: 'soon' }))).toThrow(/POLL_MS/);
  });
});
```

- [ ] **Step 3: Write the failing printer test**

Create `apps/print-agent/src/printer.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Tests for print target strategy selection.
 *
 * Only the DECISION is tested. The byte write itself is I/O against a
 * physical printer; a mock of it would assert nothing real, and the
 * strategy choice is the part that can actually be wrong.
 */

import { describe, it, expect } from 'vitest';
import { strategyFor } from './printer';

describe('strategyFor', () => {
  it('treats a COM port as a direct serial write', () => {
    expect(strategyFor('COM5')).toBe('serial');
    expect(strategyFor('com12')).toBe('serial');
  });

  it('treats anything else as a Windows printer share', () => {
    expect(strategyFor('\\\\localhost\\LabelCreate')).toBe('spooler');
    expect(strategyFor('LabelCreate 2410BT')).toBe('spooler');
  });

  it('does not mistake a share whose name merely starts with COM', () => {
    expect(strategyFor('COMPANY-LABELS')).toBe('spooler');
  });
});
```

- [ ] **Step 4: Run both tests to verify they fail**

Run: `pnpm --filter print-agent test`
Expected: FAIL — `Failed to resolve import "./config"` and `"./printer"`.

- [ ] **Step 5: Write `config.ts`**

Create `apps/print-agent/src/config.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Agent configuration, read from the process environment.
 *
 * The agent runs unattended on a shop PC as a scheduled task, so every
 * value is validated at startup and a bad one throws immediately. A
 * misconfigured agent that starts successfully and then fails silently
 * at print time is the worst outcome available here.
 */

/** Validated settings the agent runs on. */
export interface AgentConfig {
  /** Worker origin with no trailing slash, e.g. https://api.example.dev */
  apiBaseUrl: string;
  /** Shared bearer secret matching the Worker's PRINT_AGENT_SECRET. */
  secret: string;
  /** `COM<n>` for a serial/Bluetooth port, else a Windows printer share. */
  printerTarget: string;
  /** Milliseconds between polls; the Worker expects roughly 30s. */
  pollMs: number;
}

/** Variables with no sensible default — the agent cannot run without them. */
const REQUIRED = ['API_BASE_URL', 'PRINT_AGENT_SECRET', 'PRINTER_TARGET'] as const;

/** Floor on the poll interval, so a typo cannot turn the agent into a flood. */
const MIN_POLL_MS = 1000;

/**
 * Validates the environment and returns the agent's settings.
 *
 * @param env Usually `process.env`; injected so tests need no globals.
 * @throws Error naming every missing variable at once, so a fresh
 *         install is fixed in one pass rather than one restart per typo.
 */
export function loadConfig(env: NodeJS.ProcessEnv): AgentConfig {
  const missing = REQUIRED.filter((key) => !env[key]?.trim());
  if (missing.length) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  const pollMs = Number(env.POLL_MS ?? 30000);
  if (!Number.isFinite(pollMs) || pollMs < MIN_POLL_MS) {
    throw new Error(`POLL_MS must be a number of milliseconds >= ${MIN_POLL_MS}.`);
  }

  return {
    apiBaseUrl: env.API_BASE_URL!.trim().replace(/\/+$/, ''),
    secret: env.PRINT_AGENT_SECRET!.trim(),
    printerTarget: env.PRINTER_TARGET!.trim(),
    pollMs,
  };
}
```

- [ ] **Step 6: Write `printer.ts`**

Create `apps/print-agent/src/printer.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Byte delivery to the label printer.
 *
 * The payload is already a complete TSPL command stream rendered by the
 * Worker, so this module never interprets it — it is a pipe. That is
 * deliberate: no printer driver participates in layout, which is why
 * the output is identical regardless of how the printer was installed.
 *
 * TWO STRATEGIES, chosen from the shape of the target:
 *   - `COM<n>` writes straight to `\\.\COM<n>`. That is the Bluetooth
 *     SPP outgoing port Windows creates when the 2410BT is paired, or a
 *     USB serial port. No driver involved at all.
 *   - anything else is a Windows printer share (e.g.
 *     `\\localhost\LabelCreate`), reached with `copy /b`, which passes
 *     the bytes through the spooler with RAW datatype and so bypasses
 *     driver page layout.
 *
 * Both ship because which one works is settled against the physical
 * printer at install time, not from a development machine.
 */

import { execFile } from 'node:child_process';
import { open, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** How the bytes reach the printer. */
export type PrintStrategy = 'serial' | 'spooler';

/**
 * Picks a strategy from the target string. The pattern is anchored and
 * digits-only so a share named "COMPANY-LABELS" is not mistaken for a
 * serial port.
 */
export function strategyFor(target: string): PrintStrategy {
  return /^COM\d+$/i.test(target) ? 'serial' : 'spooler';
}

/**
 * Writes a rendered TSPL stream to the printer.
 *
 * Encoded as latin1 rather than utf8: TSPL bitmap fonts are byte-
 * oriented, and the Worker has already folded the text to ASCII, so
 * one character must produce exactly one byte.
 *
 * @param target  `PRINTER_TARGET` from the config.
 * @param payload The complete TSPL command stream for one job.
 * @throws Error when the port cannot be opened or `copy` fails, which
 *         the caller reports back to the API as a failed job.
 */
export async function sendToPrinter(target: string, payload: string): Promise<void> {
  const bytes = Buffer.from(payload, 'latin1');

  if (strategyFor(target) === 'serial') {
    const handle = await open(`\\\\.\\${target.toUpperCase()}`, 'w');
    try {
      await handle.write(bytes);
    } finally {
      await handle.close();
    }
    return;
  }

  const file = join(tmpdir(), `label-${randomUUID()}.prn`);
  await writeFile(file, bytes);
  try {
    await run('cmd', ['/c', 'copy', '/b', file, target]);
  } finally {
    // Best-effort cleanup: a leftover temp file must never fail a print.
    await unlink(file).catch(() => {});
  }
}
```

- [ ] **Step 7: Run both tests to verify they pass**

Run: `pnpm --filter print-agent test`
Expected: PASS, 8 tests.

- [ ] **Step 8: Write the poll loop**

Create `apps/print-agent/src/index.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Shop-floor print agent — the process that lets any device print a
 * label.
 *
 * The API is a Cloudflare Worker and cannot open a connection into the
 * shop LAN, so this agent initiates everything: it polls for a claimed
 * job, writes the payload to the printer, and reports the outcome. That
 * inversion is what makes it work behind NAT with no port forwarding,
 * no tunnel, and no static address.
 *
 * FAILURE POLICY: nothing here is fatal except a bad configuration at
 * startup. A dropped Wi-Fi link, a restarted Worker, and a printer that
 * is switched off all resolve to "log it and poll again" — the queue
 * holds the job and the API re-queues anything abandoned mid-print.
 *
 * Run with: pnpm --filter print-agent build && pnpm --filter print-agent start
 */

import { loadConfig, type AgentConfig } from './config.js';
import { sendToPrinter } from './printer.js';

/** One job as handed over by GET /agent/print-jobs/next. */
interface PrintJob {
  id: string;
  payload: string;
  label_count: number;
  order_number: string;
}

/** Timestamped line so a scheduled-task log is readable after the fact. */
function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

/** Claims the next job, or null when the queue is empty. */
async function claimJob(config: AgentConfig): Promise<PrintJob | null> {
  const res = await fetch(`${config.apiBaseUrl}/agent/print-jobs/next`, {
    headers: { Authorization: `Bearer ${config.secret}` },
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Claim failed: HTTP ${res.status}`);
  const body = (await res.json()) as { data: PrintJob };
  return body.data;
}

/** Reports a job's outcome. Never throws — a lost report is re-queued. */
async function reportResult(
  config: AgentConfig,
  jobId: string,
  ok: boolean,
  error?: string
): Promise<void> {
  try {
    await fetch(`${config.apiBaseUrl}/agent/print-jobs/${jobId}/result`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(ok ? { ok } : { ok, error }),
    });
  } catch (err) {
    log(`Could not report job ${jobId}: ${String(err)}`);
  }
}

/** Claims and prints at most one job. Returns true when one was found. */
async function tick(config: AgentConfig): Promise<boolean> {
  const job = await claimJob(config);
  if (!job) return false;

  log(`Printing ${job.label_count} label(s) for ${job.order_number}.`);
  try {
    await sendToPrinter(config.printerTarget, job.payload);
    await reportResult(config, job.id, true);
    log(`Job ${job.id} done.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await reportResult(config, job.id, false, message);
    log(`Job ${job.id} FAILED: ${message}`);
  }
  return true;
}

/** Sleeps without pinning the event loop to a busy wait. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls forever. A found job is followed by an immediate re-poll so a
 * queued batch drains at once instead of one label per interval.
 */
async function main(): Promise<void> {
  const config = loadConfig(process.env);
  log(`Agent started. Target ${config.printerTarget}, polling every ${config.pollMs}ms.`);

  for (;;) {
    try {
      const printed = await tick(config);
      if (printed) continue;
    } catch (err) {
      log(`Poll failed, will retry: ${String(err)}`);
    }
    await sleep(config.pollMs);
  }
}

void main();
```

- [ ] **Step 9: Write the README**

Create `apps/print-agent/README.md`:

```markdown
# Print Agent

Sends production labels to the LabelCreate 2410BT from an always-on shop PC.

The API runs on Cloudflare Workers and cannot reach into the shop LAN, so this
agent polls it. That is also why an iPad can print at all: iOS has no Web
Bluetooth, so the browser there queues a job and this process does the printing.

## Setup

1. Install the printer driver from `pm2410.labelife.cc`. Install over **USB
   first** — it is the more reliable path even when Bluetooth is the goal — then
   switch the port to Bluetooth once the printer appears in the Windows printer
   list.
2. Run a gap calibration with the 3" x 1.5" stock loaded before trusting output.
3. Find the target:
   - **Bluetooth/serial:** Device Manager → Ports (COM & LPT) → the outgoing
     `COM<n>` for the paired printer.
   - **Shared printer:** share it in printer properties and use
     `\\localhost\<share name>`.
4. Set the Worker secret so the two sides agree:
   ```
   wrangler secret put PRINT_AGENT_SECRET
   ```
5. Build and run:
   ```
   pnpm --filter print-agent build
   pnpm --filter print-agent start
   ```

## Environment

| Variable | Required | Meaning |
|---|---|---|
| `API_BASE_URL` | yes | Worker origin, e.g. `https://blinds-nisa-api.workers.dev` |
| `PRINT_AGENT_SECRET` | yes | Must match the Worker secret exactly |
| `PRINTER_TARGET` | yes | `COM5`, or a share like `\\localhost\LabelCreate` |
| `POLL_MS` | no | Poll interval, default `30000`, minimum `1000` |

## Running at logon

Register a Windows scheduled task that runs at logon with the working directory
set to the repo root:

```
schtasks /create /tn "Blinds Nisa Print Agent" /tr "node C:\path\to\repo\apps\print-agent\dist\index.js" /sc onlogon
```

Set the four environment variables as **system** variables so the task inherits
them.

## If nothing prints

- The agent logs every poll failure with a timestamp — check its output first.
- A job stuck in `printing` for over 5 minutes is re-queued automatically, and
  fails for good after 3 attempts. Query `print_jobs` to see `last_error`.
- If the printer is silent but the agent reports success, the firmware may not
  speak TSPL. Confirm the model's command language before debugging further.
```

- [ ] **Step 10: Verify the workspace**

Run: `pnpm --filter print-agent check`
Expected: 0 errors.

Run: `pnpm --filter print-agent build`
Expected: `dist/` is produced with no errors.

- [ ] **Step 11: Commit**

```bash
git add apps/print-agent
git commit -m "feat(agent): polling print agent for the shop-floor label printer"
```

---

### Task 9: Documentation + full verification

AI_GUIDELINES §4 and §5 make this task part of the work, not an afterthought: skipping the history update means the feature is incomplete.

**Files:**
- Modify: `knowledge/history/engine_features.md`
- Modify: `memory-bank/activeContext.md`
- Modify: `memory-bank/progress.md`

**Interfaces:**
- Consumes: everything from Tasks 1-8.
- Produces: nothing consumed by code.

- [ ] **Step 1: Run every affected suite**

Run each and record the actual numbers — do not claim a pass you have not seen:

```bash
pnpm --filter api check && pnpm --filter api test
```

```bash
pnpm --filter web check && pnpm --filter web test && pnpm --filter web lint
```

```bash
pnpm --filter print-agent check && pnpm --filter print-agent test
```

Expected: 0 type errors in all three; all suites green; web lint shows only the 4 pre-existing `LineItemEditor` warnings.

No pricing or totals code was touched, so AI_GUIDELINES §9's both-suites clause is not what puts web and api on this list — they are both here because both were modified.

- [ ] **Step 2: Add the feature entry**

Prepend a dated entry to `knowledge/history/engine_features.md` (newest first, matching the file's existing style) covering: the twin `labels.ts` modules and why they are twins; `labelTspl.ts` with the fixed-row layout, the `stripControl` security rule, and the ASCII fold; migration 28 and the `claim_print_job()` RPC with its skip-locked reasoning; `POST /api/orders/:id/print-label`; the `/agent/*` route group and why it sits outside `/api/*`; `/orders/:id/labels` with its two print buttons; and the `apps/print-agent` workspace with its two target strategies. List every file added or modified.

- [ ] **Step 3: Update the memory bank**

In `memory-bank/activeContext.md`, add a new "## Current Focus — 2026-07-28: Production label printing" section at the top, demoting the aluminium-bar entry to prior focus. State the verified test numbers from Step 1, and record the open items honestly:

- ⚠️ Migration 28 NOT applied to live `lgbxxlwsdeuhdgzrjjen`. Apply it BEFORE deploying `blinds-nisa-api` — `/agent/print-jobs/next` calls an RPC that will not exist yet.
- ⚠️ `PRINT_AGENT_SECRET` not yet set via `wrangler secret put`. Until it is, the agent routes reject every request (fail-closed by design).
- ⚠️ The `GAP 0.12,0` value is unverified against the real stock; expect a calibration pass.
- ⚠️ TSPL support on the 2410BT is assumed, not confirmed. If the firmware speaks an OEM dialect instead, the browser print path is unaffected and still covers the shop PC; only `labelTspl.ts` and the agent would need rework.
- ⚠️ Neither print path has been exercised against physical hardware.

In `memory-bank/progress.md`, add the same open items to the outstanding list.

- [ ] **Step 4: Commit**

```bash
git add knowledge/history/engine_features.md memory-bank/activeContext.md memory-bank/progress.md
git commit -m "docs: record label printing in knowledge base + memory bank"
```

---

## Deploy checklist (not part of any task — user action)

1. Apply migration 28 to `lgbxxlwsdeuhdgzrjjen`.
2. `wrangler secret put PRINT_AGENT_SECRET` for `blinds-nisa-api`.
3. Deploy both Workers (`blinds-nisa-api`, `measure-blinds`).
4. Install the printer on the shop PC, calibrate the gap with real stock, and
   print one label from `/orders/:id/labels` to confirm sizing.
5. Configure and start the agent, then print from an iPad to confirm the queued
   path end to end.
