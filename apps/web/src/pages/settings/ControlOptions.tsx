// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/** Control options settings page — CRUD list priced per panel. */

import PageHeader from '../../components/PageHeader';
import CatalogEditor from '../../components/CatalogEditor';

export default function ControlOptions() {
  return (
    <div className="min-h-screen bg-surface-muted">
      <PageHeader title="Control Options" backTo="/settings" />
      <CatalogEditor
        config={{
          path: 'control-options',
          priceKey: 'price_per_item',
          priceLabel: 'per panel',
          noun: 'control option',
        }}
      />
    </div>
  );
}
