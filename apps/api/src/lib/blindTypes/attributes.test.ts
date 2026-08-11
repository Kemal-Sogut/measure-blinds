// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Attribute-contract tests for the blind-type modules.
 *
 * Every type must accept an empty attribute blob — that is what every
 * historical `line_items` row reads as after migration 29, so a type that
 * rejected `{}` would make old orders unloadable. Every type must also
 * REJECT an undeclared key, because the same schema is the server's only
 * gate against a client smuggling a price into the jsonb column.
 *
 * `describeAttributes` is asserted for the empty case here; a type that
 * declares real fields extends this file with its own cases when it does.
 *
 * Twin of `apps/web/src/lib/blindTypes/attributes.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { BaseBlindType, type BlindPricingInputs } from './base';
import { getBlindType } from './registry';

/** The ten canonical type names, as stored in `line_items.blinds_type`. */
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

describe('attribute contract', () => {
  it('every canonical type resolves to its own module', () => {
    for (const name of CANONICAL) {
      expect(getBlindType(name)).not.toBe(getBlindType('no such type'));
    }
  });

  it('every type accepts an empty attribute blob', () => {
    for (const name of [...CANONICAL, 'no such type', '']) {
      expect(getBlindType(name).attributeSchema.parse({})).toEqual({});
    }
  });

  it('every type rejects an undeclared key', () => {
    for (const name of [...CANONICAL, 'no such type', '']) {
      expect(() => getBlindType(name).attributeSchema.parse({ unit_price: 999 })).toThrow();
    }
  });

  it('defaultAttributes round-trips through the type own schema', () => {
    for (const name of [...CANONICAL, '']) {
      const t = getBlindType(name);
      expect(() => t.attributeSchema.parse(t.defaultAttributes())).not.toThrow();
    }
  });

  it('describes nothing for an empty blob', () => {
    for (const name of [...CANONICAL, '']) {
      expect(getBlindType(name).describeAttributes({})).toEqual([]);
    }
  });
});

describe('extension point', () => {
  /**
   * A throwaway subclass standing in for a type that has diverged. It
   * proves the three new members are genuinely overridable and that
   * `calculateUnitPrice` can read `attributes` — without inventing a
   * business rule for any real blind type.
   */
  class TestBlindType extends BaseBlindType {
    readonly blindType = 'Test';
    readonly attributeSchema = BaseBlindType.attrs({
      surcharge: z.coerce.number().min(0).max(100).optional(),
    });
    defaultAttributes() {
      return { surcharge: 0 };
    }
    describeAttributes(attrs: { surcharge?: number }) {
      return attrs.surcharge ? [{ label: 'Surcharge', value: `$${attrs.surcharge}` }] : [];
    }
    calculateUnitPrice(item: BlindPricingInputs): number {
      const base = super.calculateUnitPrice(item);
      return Math.round((base + Number(item.attributes.surcharge ?? 0)) * 100) / 100;
    }
  }

  const t = new TestBlindType();

  it('accepts its declared key and still rejects others', () => {
    expect(t.attributeSchema.parse({ surcharge: 12 })).toEqual({ surcharge: 12 });
    expect(() => t.attributeSchema.parse({ nope: 1 })).toThrow();
  });

  it('coerces the string a draft would send', () => {
    expect(t.attributeSchema.parse({ surcharge: '12' })).toEqual({ surcharge: 12 });
  });

  it('feeds attributes into the unit price', () => {
    const inputs: BlindPricingInputs = {
      panels: [100],
      height_cm: 200,
      material_price_per_sqm: 10,
      cassette_price_per_m: 0,
      bottom_rail_price_per_m: 0,
      control_price_per_item: 0,
      attributes: { surcharge: 5 },
    };
    // 100cm × 200cm × $10/m² / 10000 = $20, plus the $5 surcharge.
    expect(t.calculateUnitPrice(inputs)).toBe(25);
    expect(t.calculateUnitPrice({ ...inputs, attributes: {} })).toBe(20);
  });
});

describe('generic extension points', () => {
  /**
   * A throwaway type exercising `catalogRefs` without touching a real
   * one, so these stay true no matter which blind types have diverged.
   */
  class RefBlindType extends BaseBlindType {
    readonly blindType = 'RefTest';
    readonly attributeSchema = BaseBlindType.attrs({
      widget_id: z.string().uuid().optional(),
    });
    readonly catalogRefs = [
      {
        attrKey: 'widget_id',
        table: 'widgets',
        valueColumn: 'price_per_item',
        nameKey: 'widget_name',
        valueKey: 'widget_price',
        noun: 'widget',
      },
    ] as const;
  }

  const ID = '99999999-9999-4999-8999-999999999999';
  const resolver = (table: string, id: string) =>
    table === 'widgets' && id === ID ? { name: 'Big Widget', value: 12.5 } : undefined;

  it('defaults to no catalog refs and all three hardware slots', () => {
    const base = new BaseBlindType();
    expect(base.catalogRefs).toEqual([]);
    expect([...base.requiredCatalogs]).toEqual(['cassette', 'bottom_rail', 'control']);
  });

  it('snapshots the referenced row name and value into the attributes', () => {
    const out = new RefBlindType().resolveCatalogRefs({ widget_id: ID }, resolver);
    expect(out).toEqual({ widget_id: ID, widget_name: 'Big Widget', widget_price: 12.5 });
  });

  it('leaves the blob untouched when the id is absent', () => {
    expect(new RefBlindType().resolveCatalogRefs({}, resolver)).toEqual({});
  });

  it('throws a readable error when the referenced row is gone', () => {
    expect(() =>
      new RefBlindType().resolveCatalogRefs(
        { widget_id: '11111111-1111-4111-8111-111111111111' },
        resolver
      )
    ).toThrow(/widget no longer exists/);
  });

  it('reports only the schema-declared keys as inputs', () => {
    expect(new RefBlindType().inputKeys()).toEqual(['widget_id']);
    expect(new BaseBlindType().inputKeys()).toEqual([]);
  });
});
