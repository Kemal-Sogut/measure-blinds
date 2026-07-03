// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/** Cassette options settings page — CRUD list priced per meter of width. */

import PageHeader from '../../components/PageHeader';
import CatalogEditor from '../../components/CatalogEditor';

export default function CassetteOptions() {
  return (
    <div className="min-h-screen bg-surface-muted">
      <PageHeader title="Cassette Options" backTo="/settings" />
      <CatalogEditor
        config={{
          path: 'cassette-options',
          priceKey: 'price_per_m',
          priceLabel: 'per m',
          noun: 'cassette option',
        }}
      />
    </div>
  );
}
