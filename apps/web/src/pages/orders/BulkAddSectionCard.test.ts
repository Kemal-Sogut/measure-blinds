// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Guards the `SectionAttributes` extension point in `BulkAddSectionCard.tsx`
 * against silently going stale.
 *
 * `SectionAttributes`'s own doc comment says a blind type that grows a
 * type-specific attribute needs a case added there, "exactly as it needs
 * one added to its own `<Type>Form.tsx`" — nothing in the type system
 * enforces that pairing. If a type's `attributeSchema` ever gains a
 * REQUIRED key with no matching case here, a bulk-add section for that
 * type has no field to fill the key in, so `validateBulkSections`
 * (via `parseDraftAttributes`, which mirrors `buildPayload`'s own check)
 * can never pass for it — a section that is broken with no way to fix it
 * from this sheet. `blindForms.test.ts` guards the sibling single-item
 * failure (no form at all, for any type); this guards the narrower
 * bulk-add one, which only matters once a schema actually REQUIRES
 * something — an OPTIONAL attribute (Curtains' `pleat_type_id` today) has
 * no such failure mode, so it does not need a case to keep sections
 * savable.
 *
 * Reads each type's live `attributeSchema` from the registry
 * (`getBlindType`) rather than hand-maintaining a "these types need a
 * case" list — the same reach-into-`.shape` pattern `BaseBlindType.
 * inputKeys()` uses, since `attributeSchema` is typed as the widened
 * `z.ZodTypeAny` on purpose (see `base.ts`). That is what lets this test
 * start failing the day a schema actually changes, rather than only when
 * someone remembers to update a second, parallel list.
 *
 * Today only Curtains declares an attribute and it is OPTIONAL, so no
 * canonical type currently has a required key and this test's main
 * assertion passes vacuously — the second assertion below exists so that
 * vacuous pass is never silent.
 */

import { describe, it, expect } from 'vitest';
import { getBlindType } from '../../lib/blindTypes';
import sectionCardSource from './BulkAddSectionCard.tsx?raw';

/**
 * The ten canonical type names, as stored in `line_items.blinds_type` —
 * the same list `blindForms.test.ts` and `lib/blindTypes/attributes.
 * test.ts` use.
 */
const CANONICAL = [
  'Roller',
  'Zebra',
  'Roman',
  'Sunscreen',
  'Honeycomb',
  'Shutter',
  'Vertical Sheer',
  'Vertical Panel',
  'Vertical Roller',
  'Curtains',
] as const;

/**
 * The keys of a canonical type's `attributeSchema` that are NOT optional —
 * the ones a bulk-add section cannot silently leave unfilled. Reaches into
 * `.shape` the same way `BaseBlindType.inputKeys()` does (the schema is
 * typed `z.ZodTypeAny`, so a subclass's narrower `ZodObject` shape is not
 * otherwise visible) and asks each field its own `isOptional()`, rather
 * than assuming every declared key is required — an OPTIONAL field, like
 * Curtains' `pleat_type_id`, must never trip this.
 */
function requiredAttributeKeys(typeName: string): string[] {
  const schema = getBlindType(typeName).attributeSchema as unknown as {
    shape?: Record<string, { isOptional(): boolean }>;
  };
  const shape = schema.shape ?? {};
  return Object.keys(shape).filter((key) => !shape[key].isOptional());
}

/**
 * Isolates the `SectionAttributes` function BODY (not its destructured
 * parameter list or inline param-type annotation, both of which contain
 * their own balanced `{}` pairs) from the rest of `BulkAddSectionCard.tsx`,
 * so a match against a required type's name elsewhere in the file (an
 * import, a comment, another component) can never produce a false pass.
 *
 * Two passes are needed because the signature itself has braces before the
 * body starts: `function SectionAttributes({ config, catalogs, onChange }:
 * { config: BlindDraft; catalogs: Catalogs; onChange: (next: BlindDraft) =>
 * void }) {`. Brace-counting from the header's first `{` alone would return
 * once depth hits 0 at the destructured parameter list's OWN closing
 * brace — never reaching the body. So this first paren-counts from the
 * `(` right after the function name to find that parameter list's matching
 * `)` (paren-depth is unaffected by the braces inside), THEN brace-counts
 * from the next `{` after that — the actual body's opening brace.
 */
function sectionAttributesBody(): string {
  const header = 'function SectionAttributes(';
  const start = sectionCardSource.indexOf(header);
  if (start === -1) {
    throw new Error('SectionAttributes not found in BulkAddSectionCard.tsx');
  }
  const parenStart = start + header.length - 1; // index of the header's own '('
  let parenDepth = 0;
  let parenEnd = -1;
  for (let i = parenStart; i < sectionCardSource.length; i++) {
    const char = sectionCardSource[i];
    if (char === '(') parenDepth++;
    else if (char === ')') {
      parenDepth--;
      if (parenDepth === 0) {
        parenEnd = i;
        break;
      }
    }
  }
  if (parenEnd === -1) {
    throw new Error('Unbalanced parens reading SectionAttributes params from BulkAddSectionCard.tsx');
  }
  const braceStart = sectionCardSource.indexOf('{', parenEnd);
  let depth = 0;
  for (let i = braceStart; i < sectionCardSource.length; i++) {
    const char = sectionCardSource[i];
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return sectionCardSource.slice(braceStart, i + 1);
    }
  }
  throw new Error('Unbalanced braces reading SectionAttributes from BulkAddSectionCard.tsx');
}

describe('SectionAttributes covers every type with a required attribute', () => {
  it('has a matching case for each canonical type whose schema requires a key', () => {
    const body = sectionAttributesBody();
    for (const name of CANONICAL) {
      const required = requiredAttributeKeys(name);
      if (required.length === 0) continue; // nothing a section could leave unfilled
      expect(
        body.includes(`'${name}'`) || body.includes(`"${name}"`),
        `${name} requires [${required.join(', ')}] but SectionAttributes has no case naming it — ` +
          `a bulk-add section for ${name} would validate as unsavable with no field to fix it`
      ).toBe(true);
    }
  });

  it('is not vacuous by accident: today no canonical type requires an attribute', () => {
    // If this list is ever non-empty, the assertion above just started
    // doing real work for the first time — worth a deliberate look, not a
    // silent green run.
    const typesWithRequiredAttrs = CANONICAL.filter((name) => requiredAttributeKeys(name).length > 0);
    expect(typesWithRequiredAttrs).toEqual([]);
  });
});
