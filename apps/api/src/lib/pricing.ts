// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Server-side blind pricing entry points — the AUTHORITATIVE half of
 * the IMPLEMENTATION.md §5 formula. The Worker recomputes every line
 * item from catalog prices it fetched itself, so client-supplied prices
 * never reach the database.
 *
 * The actual math lives in the calculator hierarchy
 * (`./calculators/*`): a `BaseBlindCalculator` holds the shared default
 * formula and each blind type has a subclass that (for now) inherits it
 * unchanged. This module is a thin façade that keeps the historical
 * function API stable and adds a type-aware dispatch:
 *   - `calculateBlindUnitPrice` — the type-agnostic default (base).
 *   - `calculateBlindUnitPriceForType` — dispatches to the blind type's
 *     own calculator via the registry.
 *
 * Mirrors `apps/web/src/lib/pricing.ts` (live keystroke previews); the
 * two, and their `pricing.test.ts` suites, MUST stay in sync.
 */

import { BaseBlindCalculator, type BlindPricingInputs } from './calculators/base';
import { getCalculator } from './calculators/registry';

export type { BlindPricingInputs };

/** Shared default calculator instance for the type-agnostic helpers. */
const defaultCalculator = new BaseBlindCalculator();

/** Applies the minimum width rule: widths below 100cm are charged as 100cm. */
export function applyWidthMinimum(totalCm: number): number {
  return defaultCalculator.applyWidthMinimum(totalCm);
}

/**
 * Applies the tiered minimum height rule:
 * <100cm → 100cm; 100–199cm → 200cm; ≥200cm → actual.
 */
export function applyHeightMinimum(heightCm: number): number {
  return defaultCalculator.applyHeightMinimum(heightCm);
}

/**
 * Computes the unit price of one blind using the shared DEFAULT formula
 * (material + cassette + control, minimums applied first, 2dp). Use
 * `calculateBlindUnitPriceForType` when the blind type is known so a
 * type-specific calculator can apply.
 */
export function calculateBlindUnitPrice(item: BlindPricingInputs): number {
  return defaultCalculator.calculateUnitPrice(item);
}

/**
 * Type-aware unit price: resolves the blind type's calculator from the
 * registry (falling back to the default when unknown) and prices with
 * it. `blindsType` is the snapshotted `line_items.blinds_type` name.
 */
export function calculateBlindUnitPriceForType(
  blindsType: string | null | undefined,
  item: BlindPricingInputs
): number {
  return getCalculator(blindsType).calculateUnitPrice(item);
}
