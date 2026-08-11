// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Installation options settings page — rod and track for Curtains,
 * charged as a FIXED amount per curtain rather than per metre of width
 * like the cassette and bottom rail.
 *
 * Both shipped options are seeded at 0, so editing a price here is what
 * first makes installation cost anything; only orders saved AFTER that
 * pick up the new rate, because each line item snapshots the price it
 * was quoted at.
 */

import PageHeader from '../../components/PageHeader';
import CatalogEditor from '../../components/CatalogEditor';

export default function InstallationOptions() {
  return (
    <div className="min-h-screen bg-surface-muted">
      <PageHeader title="Installation Options" backTo="/settings" />
      <CatalogEditor
        config={{
          path: 'installation-options',
          priceKey: 'price_per_item',
          priceLabel: 'per curtain',
          noun: 'installation option',
        }}
      />
    </div>
  );
}
