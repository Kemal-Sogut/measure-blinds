// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Bottom rail options settings page — CRUD list priced per meter of
 * width, the same basis as cassettes. Both shipped options (Regular and
 * Pear) are seeded at 0, so editing a price here is what first makes the
 * rail cost anything; only orders saved AFTER that pick up the new rate,
 * because each line item snapshots the price it was quoted at.
 */

import PageHeader from '../../components/PageHeader';
import CatalogEditor from '../../components/CatalogEditor';

export default function BottomRailOptions() {
  return (
    <div className="min-h-screen bg-surface-muted">
      <PageHeader title="Bottom Rail Options" backTo="/settings" />
      <CatalogEditor
        config={{
          path: 'bottom-rail-options',
          priceKey: 'price_per_m',
          priceLabel: 'per m',
          noun: 'bottom rail option',
        }}
      />
    </div>
  );
}
