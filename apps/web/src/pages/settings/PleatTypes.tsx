// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pleat types settings page — the fullness ratios the Curtains formula
 * multiplies fabric by. Reached from the Curtains materials page rather
 * than the Settings index, because a pleat is only meaningful alongside
 * the fabric it gathers.
 *
 * The value here is a RATIO, not money: 2.5 means a 3 m curtain consumes
 * 7.5 m of fabric. Migration 30 seeds all three shipped types at 1.0 so
 * applying it cannot move an existing order's total — which also means a
 * curtain prices as flat fabric until someone sets the real ratios. The
 * standing note says so.
 *
 * Renaming or re-rating a pleat never rewrites a historical order: each
 * line item snapshots the name and multiplier it was quoted at.
 */

import PageHeader from '../../components/PageHeader';
import CatalogEditor from '../../components/CatalogEditor';

export default function PleatTypes() {
  return (
    <div className="min-h-screen bg-surface-muted">
      <PageHeader title="Pleat Types" backTo="/settings/materials" />
      <CatalogEditor
        config={{
          path: 'pleat-types',
          priceKey: 'multiplier',
          priceLabel: 'fullness',
          priceUnit: 'plain',
          priceMin: 0.01,
          noun: 'pleat type',
          note: 'Fullness is metres of fabric per metre of finished curtain width. A value of 1.0 prices the curtain as flat fabric — set the real ratios before quoting.',
        }}
      />
    </div>
  );
}
