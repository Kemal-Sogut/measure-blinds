// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Cassette options settings page — CRUD list priced per meter of width.
 *
 * Each option carries the blind types it is offered for. A type with no
 * cassette scoped to it loses the Cassette dropdown on the line-item form
 * entirely and stops being charged for one, which is how the slot is
 * switched off per type (migration 35).
 */

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
          scoped: true,
          note: 'A cassette is offered only for the blind types picked here. Leave a type off every cassette and the Cassette dropdown disappears for it.',
        }}
      />
    </div>
  );
}
