// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/** Preset line items settings page — reusable services with fixed prices. */

import PageHeader from '../../components/PageHeader';
import CatalogEditor from '../../components/CatalogEditor';

export default function PresetLineItems() {
  return (
    <div className="min-h-screen bg-surface-muted">
      <PageHeader title="Preset Line Items" backTo="/settings" />
      <CatalogEditor
        config={{
          path: 'presets',
          priceKey: 'unit_price',
          priceLabel: 'each',
          noun: 'preset item',
          hasDescription: true,
        }}
      />
    </div>
  );
}
