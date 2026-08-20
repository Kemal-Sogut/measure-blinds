// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * `expandBulkSections` / `validateBulkSections` tests.
 *
 * `expandBulkSections` is the pure fan-out at the heart of bulk add: one
 * section (a shared blind configuration) times many measurement rows
 * becomes one `BlindDraft` per row it has content in — an entirely blank
 * row (no room, no width, no height) is skipped rather than turned into
 * an empty item, matching a freshly opened sheet's own blank starting
 * row. The cases below pin down the exact field provenance (which fields
 * come from the section vs. the row), the ORDER items come out in
 * (section 1 before section 2, row order preserved within a section —
 * the consultant reads the list back and expects it to match what they
 * typed), that a row's `width_cm` shorthand (`'118.5+118'`) expands into
 * the draft's `panels` array via `parsePanelInput`, and that each draft
 * owns its own `panels` array AND its own `attributes` object rather
 * than sharing the config's references (a later per-item edit — e.g. "+
 * Panel" or a Curtains pleat pick in the single-item form — must not
 * silently rewrite the section's `config` it came from, or a SIBLING
 * item expanded from the same section, which a shared reference would
 * allow).
 *
 * `validateBulkSections` is DELIBERATELY more permissive than
 * `buildPayload`: it no longer requires a blind type, a material, or any
 * hardware slot, because bulk add exists for on-site measuring before
 * those product decisions are made. A section with none of those picked
 * validates as `null` and expands into items carrying those fields
 * blank — `buildPayload` in `OrderDetail.tsx` is what blocks the actual
 * SAVE and names the offending item once the order is otherwise ready
 * ("choose a blind type.", "choose a material.", "choose a cassette.",
 * etc.). What this function keeps rejecting: a section with zero rows, a
 * row whose width or height was actually TYPED but is not a positive
 * number (a blank one is fine — that is the whole point), and a chosen
 * type's attributes — but only once a type has actually been chosen,
 * since `parseDraftAttributes` cannot judge a type that was never
 * picked. Section/row numbers in messages are ONE-based, matching how
 * `buildPayload` numbers items and how a consultant counts rows on
 * screen.
 */

import { describe, it, expect } from 'vitest';
import type { BlindDraft, Catalogs } from './lineItemDrafts';
import {
  bulkAddHasContent,
  bulkRowHasContent,
  expandBulkSections,
  newBulkRow,
  newBulkSection,
  validateBulkSections,
  type BulkMeasureRow,
  type BulkSection,
} from './bulkAdd';

/**
 * One blind type (Roller) scoped to all four hardware slots, so a single
 * fixture can exercise every slot-missing message `validateBulkSections`
 * mirrors from `buildPayload`. Not realistic (a real Roller has no
 * installation option), but scoping is purely data-driven
 * (`slotsForType`), so the fixture is free to declare it for coverage —
 * the same simplification `lineItemBulk.test.ts` uses.
 */
const ROLLER = { id: 't-roller', name: 'Roller', active: true, sort_order: 0 };

function catalogs(overrides: Partial<Catalogs> = {}): Catalogs {
  return {
    blindTypes: [ROLLER],
    materials: [
      {
        id: 'm-roller',
        name: 'Roller Fabric',
        price_per_sqm: 50,
        active: true,
        sort_order: 0,
        width_cm: null,
        blind_type_ids: [ROLLER.id],
      },
    ],
    cassettes: [
      { id: 'c1', name: 'Standard', price: 20, price_basis: 'per_m', active: true, sort_order: 0, blind_type_ids: [ROLLER.id] },
    ],
    bottomRails: [
      { id: 'b1', name: 'Regular', price: 0, price_basis: 'per_m', active: true, sort_order: 0, blind_type_ids: [ROLLER.id] },
    ],
    controls: [
      { id: 'ct1', name: 'Chain', price: 0, price_basis: 'per_panel', active: true, sort_order: 0, blind_type_ids: [ROLLER.id] },
    ],
    installationOptions: [
      { id: 'ins1', name: 'Rod', price: 10, price_basis: 'per_unit', active: true, sort_order: 0, blind_type_ids: [ROLLER.id] },
    ],
    pleatTypes: [],
    defaults: [],
    ...overrides,
  };
}

/** A fully-configured Roller section config — every slot Roller uses filled. */
function rollerConfig(overrides: Partial<BlindDraft> = {}): BlindDraft {
  return {
    key: 'cfg1',
    uid: null,
    hidden: false,
    item_type: 'blind',
    room_name: '',
    blinds_type: 'Roller',
    panels: [''],
    height_cm: '',
    material_id: 'm-roller',
    cassette_id: 'c1',
    bottom_rail_id: 'b1',
    control_id: 'ct1',
    installation_id: 'ins1',
    color: 'White',
    note: 'Handle with care',
    attributes: {},
    quantity: '1',
    unit_price_override: '',
    show_original_price: true,
    addons: [],
    ...overrides,
  };
}

function row(overrides: Partial<BulkMeasureRow> = {}): BulkMeasureRow {
  return { key: 'r1', room_name: 'Living Room', width_cm: '100', height_cm: '200', ...overrides };
}

function section(overrides: Partial<BulkSection> = {}): BulkSection {
  return { key: 's1', config: rollerConfig(), rows: [row()], ...overrides };
}

describe('expandBulkSections', () => {
  it('one BlindDraft per row, section config + row measurements, qty 1', () => {
    const s1 = section({
      key: 's1',
      config: rollerConfig({ color: 'White', note: 'n1' }),
      rows: [
        row({ key: 'r1', room_name: 'Living Room', width_cm: '100', height_cm: '200' }),
        row({ key: 'r2', room_name: 'Kitchen', width_cm: '80+90', height_cm: '150' }),
      ],
    });
    const s2 = section({
      key: 's2',
      config: rollerConfig({ color: 'Grey', note: 'n2' }),
      rows: [row({ key: 'r3', room_name: 'Bedroom', width_cm: '60', height_cm: '120' })],
    });

    const drafts = expandBulkSections([s1, s2]);

    expect(drafts).toHaveLength(3);
    // Order: section 1's rows before section 2's, row order preserved.
    expect(drafts.map((d) => d.room_name)).toEqual(['Living Room', 'Kitchen', 'Bedroom']);

    const [d1, d2, d3] = drafts;
    // Row-owned fields.
    expect(d1.panels).toEqual(['100']);
    expect(d1.height_cm).toBe('200');
    expect(d2.panels).toEqual(['80', '90']);
    expect(d2.room_name).toBe('Kitchen');
    expect(d3.room_name).toBe('Bedroom');

    // Config-owned fields, carried from the section onto every one of its rows.
    for (const d of [d1, d2]) {
      expect(d.blinds_type).toBe('Roller');
      expect(d.material_id).toBe('m-roller');
      expect(d.cassette_id).toBe('c1');
      expect(d.bottom_rail_id).toBe('b1');
      expect(d.control_id).toBe('ct1');
      expect(d.installation_id).toBe('ins1');
      expect(d.color).toBe('White');
      expect(d.note).toBe('n1');
      expect(d.attributes).toEqual({});
    }
    expect(d3.color).toBe('Grey');
    expect(d3.note).toBe('n2');

    // Fixed quantity of 1 per row, regardless of the section config's own quantity.
    for (const d of drafts) expect(d.quantity).toBe('1');

    // Neutral price adjustments (NO_ADJUSTMENTS), even if the config carried something else.
    for (const d of drafts) {
      expect(d.unit_price_override).toBe('');
      expect(d.show_original_price).toBe(true);
      expect(d.addons).toEqual([]);
    }

    // Fresh, unique keys distinct from every section/row/config key.
    const keys = drafts.map((d) => d.key);
    expect(new Set(keys).size).toBe(3);
    for (const k of keys) {
      expect(['s1', 's2', 'r1', 'r2', 'r3', 'cfg1']).not.toContain(k);
    }
  });

  it('a config with an unfixed quantity still yields quantity 1 items (fixed at expansion, not read from config)', () => {
    const s = section({ config: rollerConfig({ quantity: '5' }) });
    const [d] = expandBulkSections([s]);
    expect(d.quantity).toBe('1');
  });

  it('expands a shorthand width_cm ("118.5+118") into multiple panels', () => {
    const s = section({ rows: [row({ width_cm: '118.5+118' })] });
    const [d] = expandBulkSections([s]);
    expect(d.panels).toEqual(['118.5', '118']);
  });

  it('a plain width_cm with no "+" gives a single-element panels array', () => {
    const s = section({ rows: [row({ width_cm: '120' })] });
    const [d] = expandBulkSections([s]);
    expect(d.panels).toEqual(['120']);
  });

  it('gives each expanded draft its own panels array (no shared references)', () => {
    // Two rows typed with the identical shorthand must still each produce
    // their OWN array instance — a later per-item "+ Panel" edit on one
    // expanded line item must never reach back into a SIBLING item's
    // panels, which a shared reference would allow.
    const s = section({
      rows: [row({ key: 'r1', width_cm: '100+120' }), row({ key: 'r2', width_cm: '100+120' })],
    });
    const [d1, d2] = expandBulkSections([s]);

    expect(d1.panels).toEqual(['100', '120']);
    expect(d2.panels).toEqual(['100', '120']);
    expect(d1.panels).not.toBe(d2.panels);

    d1.panels.push('999');
    expect(d2.panels).toEqual(['100', '120']);
  });

  it('copies the section config attributes object (no shared reference)', () => {
    const cfg = rollerConfig({ attributes: { foo: 'bar' } });
    const s = section({ config: cfg, rows: [row({ key: 'r1' }), row({ key: 'r2' })] });
    const [d1, d2] = expandBulkSections([s]);

    // Every row expanded from one section shares that section's `config`,
    // which stays live in the sheet's own state — mutating one expanded
    // item's attributes (e.g. a Curtains pleat pick on the single-item
    // form) must never reach back into the config or into a SIBLING item
    // expanded from the same section.
    d1.attributes.baz = 'qux';
    expect(cfg.attributes).toEqual({ foo: 'bar' });
    expect(d2.attributes).toEqual({ foo: 'bar' });
    expect(d1.attributes).not.toBe(cfg.attributes);
    expect(d2.attributes).not.toBe(cfg.attributes);
    expect(d1.attributes).not.toBe(d2.attributes);
  });

  it('skips an entirely blank row instead of expanding it into an empty item', () => {
    const s = section({
      rows: [row({ key: 'r1' }), row({ key: 'r2', room_name: '', width_cm: '', height_cm: '' })],
    });
    const drafts = expandBulkSections([s]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].room_name).toBe('Living Room');
  });

  it('keeps a row with only a room name typed — not entirely blank', () => {
    const s = section({
      rows: [row({ key: 'r1', room_name: 'Hallway', width_cm: '', height_cm: '' })],
    });
    const drafts = expandBulkSections([s]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].room_name).toBe('Hallway');
    expect(drafts[0].panels).toEqual(['']);
    expect(drafts[0].height_cm).toBe('');
  });

  it('a section with no type, material, or hardware expands with those fields blank', () => {
    const bareConfig = rollerConfig({
      blinds_type: '',
      material_id: '',
      cassette_id: '',
      bottom_rail_id: '',
      control_id: '',
      installation_id: '',
    });
    const [d] = expandBulkSections([section({ config: bareConfig })]);
    expect(d.blinds_type).toBe('');
    expect(d.material_id).toBe('');
    expect(d.cassette_id).toBe('');
    expect(d.bottom_rail_id).toBe('');
    expect(d.control_id).toBe('');
    expect(d.installation_id).toBe('');
  });

  it('an untouched sheet (default section, blank row) counts zero items and expands to nothing', () => {
    // Regression test for the bug this fix-round addresses: before it,
    // `BulkAddSheet.tsx`'s `itemCount` counted raw rows instead of rows
    // with content, so an untouched sheet showed "Add 1 item", the
    // confirm button was enabled, `validateBulkSections` returned `null`
    // (an all-blank row trips no width/height/attribute check), and
    // confirming silently expanded to an empty array and closed with
    // nothing added. This mirrors the sheet's `itemCount` expression
    // exactly, using the same exported `bulkRowHasContent` the sheet now
    // uses, so a regression to that shared predicate is caught here too
    // (there is no jsdom/testing-library in this repo to render the sheet
    // itself and assert on the rendered button).
    const sections = [newBulkSection()];
    const itemCount = sections.reduce((n, s) => n + s.rows.filter(bulkRowHasContent).length, 0);
    expect(itemCount).toBe(0);
    expect(expandBulkSections(sections)).toEqual([]);
  });
});

describe('bulkRowHasContent', () => {
  it('is false for an entirely blank row', () => {
    expect(bulkRowHasContent(newBulkRow())).toBe(false);
  });

  it('is true once a room name, width, or height has been typed', () => {
    expect(bulkRowHasContent({ ...newBulkRow(), room_name: 'Bedroom' })).toBe(true);
    expect(bulkRowHasContent({ ...newBulkRow(), width_cm: '120' })).toBe(true);
    expect(bulkRowHasContent({ ...newBulkRow(), height_cm: '200' })).toBe(true);
  });

  it('is false for whitespace-only fields (not real content)', () => {
    expect(bulkRowHasContent({ ...newBulkRow(), room_name: '   ' })).toBe(false);
  });
});

describe('validateBulkSections', () => {
  it('null for valid input', () => {
    expect(validateBulkSections([section()], catalogs())).toBeNull();
  });

  it('a section with no blind type, material, or hardware validates as null', () => {
    const bareConfig = rollerConfig({
      blinds_type: '',
      material_id: '',
      cassette_id: '',
      bottom_rail_id: '',
      control_id: '',
      installation_id: '',
    });
    expect(validateBulkSections([section({ config: bareConfig })], catalogs())).toBeNull();
  });

  it('skips the attribute check entirely when no type is chosen, even with garbage attributes', () => {
    // `parseDraftAttributes` looks a schema up BY the chosen type; a blank
    // type has no schema to check against, so running the check anyway
    // would effectively force a type pick before validation could pass —
    // exactly the requirement this task removes.
    const bareConfig = rollerConfig({
      blinds_type: '',
      material_id: '',
      cassette_id: '',
      bottom_rail_id: '',
      control_id: '',
      installation_id: '',
      attributes: { anything: 'garbage', pleat_type_id: 'not-a-uuid' },
    });
    expect(validateBulkSections([section({ config: bareConfig })], catalogs())).toBeNull();
  });

  it('invalid attributes for a CHOSEN blind type still errors, even with no material or hardware picked', () => {
    // `attributes` lives on the shared config; a bad value there would
    // otherwise fail identically on every row expanded from it, and only
    // surface once `buildPayload` rejects the first already-expanded item.
    // Curtains' `pleat_type_id` is optional but, when present, must be a
    // real uuid — and this task's whole point is that a bulk-add section
    // no longer needs a material or any hardware picked for this check to
    // still catch a bad value.
    const CURTAINS = { id: 't-curtains', name: 'Curtains', active: true, sort_order: 1 };
    const curtainCatalogs = catalogs({ blindTypes: [ROLLER, CURTAINS] });
    const badAttributes = section({
      config: rollerConfig({
        blinds_type: 'Curtains',
        material_id: '',
        cassette_id: '',
        bottom_rail_id: '',
        control_id: '',
        installation_id: '',
        attributes: { pleat_type_id: 'not-a-uuid' },
      }),
    });
    expect(validateBulkSections([badAttributes], curtainCatalogs)).toBe(
      'Section 1: check the Curtains options.'
    );
  });

  it('row with empty room, width, or height is allowed — nothing is required until typed', () => {
    const withEmptyRoom = section({ rows: [row({ room_name: '' })] });
    expect(validateBulkSections([withEmptyRoom], catalogs())).toBeNull();

    const withEmptyWidth = section({ rows: [row({ key: 'r1' }), row({ key: 'r2', width_cm: '' })] });
    expect(validateBulkSections([withEmptyWidth], catalogs())).toBeNull();

    const withEmptyHeight = section({
      rows: [row({ key: 'r1' }), row({ key: 'r2', height_cm: '' })],
    });
    expect(validateBulkSections([withEmptyHeight], catalogs())).toBeNull();
  });

  it('a typed but malformed width or height still errors — a typo must not silently become an item', () => {
    const badWidth = section({ rows: [row({ key: 'r1' }), row({ key: 'r2', width_cm: 'abc' })] });
    expect(validateBulkSections([badWidth], catalogs())).toBe(
      'Section 1, row 2: enter a valid width.'
    );

    const negativeWidth = section({
      rows: [row({ key: 'r1' }), row({ key: 'r2', width_cm: '-5' })],
    });
    expect(validateBulkSections([negativeWidth], catalogs())).toBe(
      'Section 1, row 2: enter a valid width.'
    );

    const badHeight = section({ rows: [row({ key: 'r1' }), row({ key: 'r2', height_cm: 'abc' })] });
    expect(validateBulkSections([badHeight], catalogs())).toBe(
      'Section 1, row 2: enter a valid height.'
    );
  });

  it('catches an invalid panel in the middle of a multi-panel row, not just the first', () => {
    // A row with several panels where only a MIDDLE entry is bad — proves
    // the check inspects every panel rather than just `panels[0]`.
    const middleInvalid = section({
      rows: [row({ key: 'r1' }), row({ key: 'r2', width_cm: '100+abc+50' })],
    });
    expect(validateBulkSections([middleInvalid], catalogs())).toBe(
      'Section 1, row 2: enter a valid width.'
    );
  });

  it('section with zero rows → message', () => {
    expect(validateBulkSections([section({ rows: [] })], catalogs())).toBe(
      'Section 1: add at least one row.'
    );
  });

  it('names the second section when only it is invalid', () => {
    expect(
      validateBulkSections([section({ key: 's1' }), section({ key: 's2', rows: [] })], catalogs())
    ).toBe('Section 2: add at least one row.');
  });

  it('names the second row of the second section when only it is invalid', () => {
    expect(
      validateBulkSections(
        [
          section({ key: 's1' }),
          section({
            key: 's2',
            rows: [row({ key: 'r1' }), row({ key: 'r2', height_cm: 'nope' })],
          }),
        ],
        catalogs()
      )
    ).toBe('Section 2, row 2: enter a valid height.');
  });
});

describe('newBulkRow', () => {
  it('returns a blank row with an empty width', () => {
    const r = newBulkRow();
    expect(r.room_name).toBe('');
    expect(r.width_cm).toBe('');
    expect(r.height_cm).toBe('');
    expect(r.key).toBeTruthy();
  });

  it('mints a distinct key on every call', () => {
    const a = newBulkRow();
    const b = newBulkRow();
    expect(a.key).not.toBe(b.key);
  });
});

describe('newBulkSection', () => {
  it('returns one empty row and a blank config with quantity 1', () => {
    const s = newBulkSection();
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].room_name).toBe('');
    expect(s.rows[0].width_cm).toBe('');
    expect(s.rows[0].height_cm).toBe('');

    expect(s.config.item_type).toBe('blind');
    expect(s.config.blinds_type).toBe('');
    expect(s.config.material_id).toBe('');
    expect(s.config.cassette_id).toBe('');
    expect(s.config.bottom_rail_id).toBe('');
    expect(s.config.control_id).toBe('');
    expect(s.config.installation_id).toBe('');
    expect(s.config.quantity).toBe('1');
    expect(s.config.panels).toEqual(['']);
    expect(s.config.uid).toBeNull();
    expect(s.key).toBeTruthy();
  });

  it('mints distinct keys across sections, including the config key', () => {
    const a = newBulkSection();
    const b = newBulkSection();
    expect(a.key).not.toBe(b.key);
    expect(a.config.key).not.toBe(b.config.key);
  });
});

/*
 * FINDING 4 — a fresh bulk-add sheet's default single section + single
 * blank row must read as "nothing entered", so a stray backdrop tap on an
 * untouched sheet stays silent; the moment anything is typed or picked,
 * it must read as "has content", so the same tap gets a confirm guard
 * instead of silently discarding a measuring pass (`BulkAddSheet.tsx`'s
 * close handler).
 */
describe('bulkAddHasContent', () => {
  it('is false for a freshly opened sheet (default section, blank row)', () => {
    expect(bulkAddHasContent([newBulkSection()])).toBe(false);
  });

  it('is true once a row has a room name, a panel width, or a height', () => {
    const withRoom: BulkSection = { ...newBulkSection() };
    withRoom.rows[0].room_name = 'Bedroom';
    expect(bulkAddHasContent([withRoom])).toBe(true);

    const withWidth: BulkSection = { ...newBulkSection() };
    withWidth.rows[0].width_cm = '120';
    expect(bulkAddHasContent([withWidth])).toBe(true);

    const withHeight: BulkSection = { ...newBulkSection() };
    withHeight.rows[0].height_cm = '200';
    expect(bulkAddHasContent([withHeight])).toBe(true);
  });

  it('is true once the section config has a blind type, material, or hardware picked', () => {
    const withType: BulkSection = { ...newBulkSection() };
    withType.config = { ...withType.config, blinds_type: 'Roller' };
    expect(bulkAddHasContent([withType])).toBe(true);

    const withMaterial: BulkSection = { ...newBulkSection() };
    withMaterial.config = { ...withMaterial.config, material_id: 'm-roller' };
    expect(bulkAddHasContent([withMaterial])).toBe(true);
  });

  it('is true once the section config has a colour, note, or attribute typed', () => {
    const withColor: BulkSection = { ...newBulkSection() };
    withColor.config = { ...withColor.config, color: 'White' };
    expect(bulkAddHasContent([withColor])).toBe(true);

    const withAttr: BulkSection = { ...newBulkSection() };
    withAttr.config = { ...withAttr.config, attributes: { pleat_type_id: 'p1' } };
    expect(bulkAddHasContent([withAttr])).toBe(true);
  });

  it('is false across multiple untouched sections', () => {
    expect(bulkAddHasContent([newBulkSection(), newBulkSection()])).toBe(false);
  });
});
