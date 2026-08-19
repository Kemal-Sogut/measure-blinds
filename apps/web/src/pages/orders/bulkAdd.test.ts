// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * `expandBulkSections` / `validateBulkSections` tests.
 *
 * `expandBulkSections` is the pure fan-out at the heart of bulk add: one
 * section (a shared blind configuration) times many measurement rows
 * becomes one `BlindDraft` per row. The cases below pin down the exact
 * field provenance (which fields come from the section vs. the row), the
 * ORDER items come out in (section 1 before section 2, row order preserved
 * within a section — the consultant reads the list back and expects it to
 * match what they typed), and that each draft owns its own `panels` array
 * AND its own `attributes` object rather than sharing the row's/config's
 * references (a later per-item edit — e.g. "+ Panel" or a Curtains pleat
 * pick in the single-item form — must not silently rewrite the original
 * bulk row/config it came from, or a SIBLING item expanded from the same
 * section, which a shared reference would allow).
 *
 * `validateBulkSections` mirrors `buildPayload`'s rules, message style AND
 * CHECK ORDER in `OrderDetail.tsx` (same wording: "choose a material.",
 * "choose a cassette.", "enter every panel width.", "check the Curtains
 * options."; same order: measurement checks before configuration checks)
 * — the Worker enforces the exact same constraints on save, so a bulk-add
 * section that passes this check must always be acceptable to
 * `buildPayload` once expanded. Section/row numbers in messages are
 * ONE-based, matching how `buildPayload` numbers items and how a
 * consultant counts rows on screen.
 */

import { describe, it, expect } from 'vitest';
import type { BlindDraft, Catalogs } from './lineItemDrafts';
import {
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
  return { key: 'r1', room_name: 'Living Room', panels: ['100'], height_cm: '200', ...overrides };
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
        row({ key: 'r1', room_name: 'Living Room', panels: ['100'], height_cm: '200' }),
        row({ key: 'r2', room_name: 'Kitchen', panels: ['80', '90'], height_cm: '150' }),
      ],
    });
    const s2 = section({
      key: 's2',
      config: rollerConfig({ color: 'Grey', note: 'n2' }),
      rows: [row({ key: 'r3', room_name: 'Bedroom', panels: ['60'], height_cm: '120' })],
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

  it('copies panels arrays (no shared references)', () => {
    const sharedRow = row({ panels: ['100', '120'] });
    const [draftItem] = expandBulkSections([section({ rows: [sharedRow] })]);

    // Mutating the draft's panels must never reach back into the row that
    // produced it — a later per-item "+ Panel" edit would otherwise
    // silently corrupt data the bulk sheet still displays.
    draftItem.panels.push('999');
    expect(sharedRow.panels).toEqual(['100', '120']);
    expect(draftItem.panels).toEqual(['100', '120', '999']);
    expect(draftItem.panels).not.toBe(sharedRow.panels);
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
});

describe('validateBulkSections', () => {
  it('null for valid input', () => {
    expect(validateBulkSections([section()], catalogs())).toBeNull();
  });

  it('section without type / material → message naming the section number', () => {
    expect(
      validateBulkSections([section({ config: rollerConfig({ blinds_type: '' }) })], catalogs())
    ).toBe('Section 1: choose a blind type.');
    expect(
      validateBulkSections([section({ config: rollerConfig({ material_id: '' }) })], catalogs())
    ).toBe('Section 1: choose a material.');
  });

  it('missing slot pick for a used slot → message (same rule as buildPayload)', () => {
    expect(
      validateBulkSections([section({ config: rollerConfig({ cassette_id: '' }) })], catalogs())
    ).toBe('Section 1: choose a cassette.');
    expect(
      validateBulkSections([section({ config: rollerConfig({ bottom_rail_id: '' }) })], catalogs())
    ).toBe('Section 1: choose a bottom rail.');
    expect(
      validateBulkSections([section({ config: rollerConfig({ control_id: '' }) })], catalogs())
    ).toBe('Section 1: choose a control option.');
    expect(
      validateBulkSections([section({ config: rollerConfig({ installation_id: '' }) })], catalogs())
    ).toBe('Section 1: choose an installation option.');
  });

  it('does not require a slot the type does not use', () => {
    // No installation option is scoped to Roller in this catalog, so the
    // slot is unused and an empty id must not block validation — exactly
    // as `slotsForType`-gated `buildPayload` behaves for e.g. Curtains and
    // its unused cassette/bottom-rail slots.
    const noInstall = catalogs({ installationOptions: [] });
    expect(
      validateBulkSections(
        [section({ config: rollerConfig({ installation_id: '' }) })],
        noInstall
      )
    ).toBeNull();
  });

  it('invalid attributes for the section blind type → message matching buildPayload wording', () => {
    // `attributes` lives on the shared config; a bad value there would
    // otherwise fail identically on every row expanded from it, and only
    // surface once `buildPayload` rejects the first already-expanded item.
    // Curtains' `pleat_type_id` is optional but, when present, must be a
    // real uuid — this fixture supplies neither a cassette nor a bottom
    // rail scoped to Curtains, so those slots are unused and stay out of
    // the way of the attributes check being exercised.
    const CURTAINS = { id: 't-curtains', name: 'Curtains', active: true, sort_order: 1 };
    const curtainCatalogs = catalogs({
      blindTypes: [ROLLER, CURTAINS],
      materials: [
        ...catalogs().materials,
        {
          id: 'm-curtains',
          name: 'Curtain Fabric',
          price_per_sqm: 40,
          active: true,
          sort_order: 1,
          width_cm: null,
          blind_type_ids: [CURTAINS.id],
        },
      ],
    });
    const badAttributes = section({
      config: rollerConfig({
        blinds_type: 'Curtains',
        material_id: 'm-curtains',
        attributes: { pleat_type_id: 'not-a-uuid' },
      }),
    });
    expect(validateBulkSections([badAttributes], curtainCatalogs)).toBe(
      'Section 1: check the Curtains options.'
    );
  });

  it('row with empty room allowed, but missing panel width or height → message naming section+row', () => {
    const withEmptyRoom = section({ rows: [row({ room_name: '' })] });
    expect(validateBulkSections([withEmptyRoom], catalogs())).toBeNull();

    const missingPanel = section({ rows: [row({ key: 'r1' }), row({ key: 'r2', panels: [''] })] });
    expect(validateBulkSections([missingPanel], catalogs())).toBe(
      'Section 1, row 2: enter every panel width.'
    );

    const missingHeight = section({ rows: [row({ key: 'r1' }), row({ key: 'r2', height_cm: '' })] });
    expect(validateBulkSections([missingHeight], catalogs())).toBe(
      'Section 1, row 2: enter a height.'
    );
  });

  it('catches an invalid panel in the middle of a multi-panel row, not just the first', () => {
    // A row with several panels where only a MIDDLE entry is bad — proves
    // the check inspects every panel rather than just `panels[0]`.
    const middleInvalid = section({
      rows: [row({ key: 'r1' }), row({ key: 'r2', panels: ['100', 'abc', '50'] })],
    });
    expect(validateBulkSections([middleInvalid], catalogs())).toBe(
      'Section 1, row 2: enter every panel width.'
    );
  });

  it('section with zero rows → message', () => {
    expect(validateBulkSections([section({ rows: [] })], catalogs())).toBe(
      'Section 1: add at least one row.'
    );
  });

  it('names the second section when only it is invalid', () => {
    expect(
      validateBulkSections(
        [section({ key: 's1' }), section({ key: 's2', config: rollerConfig({ material_id: '' }) })],
        catalogs()
      )
    ).toBe('Section 2: choose a material.');
  });

  it('names the second row of the second section when only it is invalid', () => {
    expect(
      validateBulkSections(
        [
          section({ key: 's1' }),
          section({
            key: 's2',
            rows: [row({ key: 'r1' }), row({ key: 'r2', height_cm: '' })],
          }),
        ],
        catalogs()
      )
    ).toBe('Section 2, row 2: enter a height.');
  });
});

describe('newBulkRow', () => {
  it('returns a blank row with one empty panel', () => {
    const r = newBulkRow();
    expect(r.room_name).toBe('');
    expect(r.panels).toEqual(['']);
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
    expect(s.rows[0].panels).toEqual(['']);
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
