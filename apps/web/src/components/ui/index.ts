// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Barrel for the redesign's shared UI primitives. Pages import from
 * `components/ui` rather than reaching into individual files, so the
 * primitive set stays a single, reviewable surface and a future visual
 * change is a primitive-level edit instead of a sweep through pages.
 */

export { default as Pill } from './Pill';
export { Card, CardHeader, CardBody, CardFooter } from './Card';
export type { CardAccent } from './Card';
export { default as Button } from './Button';
export { default as Field, inputClass } from './Field';
export { default as Modal } from './Modal';
export { default as StatTile } from './StatTile';
