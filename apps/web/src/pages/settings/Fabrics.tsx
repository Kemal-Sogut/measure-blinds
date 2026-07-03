// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/** Fabrics settings page — CRUD list of fabrics priced per square meter. */

import PageHeader from '../../components/PageHeader';
import CatalogEditor from '../../components/CatalogEditor';

export default function Fabrics() {
  return (
    <div className="min-h-screen bg-surface-muted">
      <PageHeader title="Fabrics" backTo="/settings" />
      <CatalogEditor
        config={{
          path: 'fabrics',
          priceKey: 'price_per_sqm',
          priceLabel: 'per m²',
          noun: 'fabric',
        }}
      />
    </div>
  );
}
