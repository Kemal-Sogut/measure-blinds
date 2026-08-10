// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Client-side blind pricing entry points (live keystroke previews).
 *
 * The math lives in the blind-type module hierarchy (`./blindTypes/*`): a
 * `BaseBlindType` holds the shared default formula and each blind
 * type has a subclass that (for now) inherits it unchanged. This module
 * is a thin façade that keeps the historical function API stable and
 * adds a type-aware dispatch:
 *   - `calculateBlindUnitPrice` — the type-agnostic default (base).
 *   - `calculateBlindUnitPriceForType` — dispatches to the blind type's
 *     own module via the registry.
 *   - `calculateBlindLineTotal` — unit price × quantity.
 *
 * Mirrors `apps/api/src/lib/pricing.ts` (the AUTHORITATIVE recalc that
 * runs on save); the two, and their `pricing.test.ts` suites, MUST stay
 * in sync — the Worker recalculates authoritatively to prevent tampering.
 */

import { BaseBlindType, type BlindPricingInputs } from './blindTypes/base';
import { getBlindType } from './blindTypes/registry';

export type { BlindPricingInputs };

/** Input parameters for a single blind's live preview (adds quantity). */
export interface BlindInputs extends BlindPricingInputs {
  /** Number of identical blinds (used only for the line total). */
  quantity: number;
}

/** Shared default blind-type instance for the type-agnostic helpers. */
const defaultBlindType = new BaseBlindType();

/** Raises widths below 100cm to 100cm. */
export function applyWidthMinimum(totalCm: number): number {
  return defaultBlindType.applyWidthMinimum(totalCm);
}

/** Tiered height minimum: <100→100cm, 100–199→200cm, ≥200→actual. */
export function applyHeightMinimum(heightCm: number): number {
  return defaultBlindType.applyHeightMinimum(heightCm);
}

/**
 * Unit price using the shared DEFAULT formula. Prefer
 * `calculateBlindUnitPriceForType` when the blind type is known.
 */
export function calculateBlindUnitPrice(item: BlindInputs): number {
  return defaultBlindType.calculateUnitPrice(item);
}

/**
 * Type-aware unit price: resolves the blind type's module from the
 * registry (default fallback when unknown) and prices with it.
 */
export function calculateBlindUnitPriceForType(
  blindsType: string | null | undefined,
  item: BlindInputs
): number {
  return getBlindType(blindsType).calculateUnitPrice(item);
}

/**
 * Line total for a blind (default unit price × quantity), rounded to 2
 * decimals. The editor computes per-type totals via
 * `calculateBlindUnitPriceForType`; this default-formula helper backs
 * the shared money-math test suite.
 */
export function calculateBlindLineTotal(item: BlindInputs): number {
  return Math.round(calculateBlindUnitPrice(item) * item.quantity * 100) / 100;
}
