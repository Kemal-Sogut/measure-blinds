// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/** Blind types settings page — CRUD list of blind type labels (no price). */

import PageHeader from '../../components/PageHeader';
import CatalogEditor from '../../components/CatalogEditor';

export default function BlindTypes() {
  return (
    <div className="min-h-screen bg-surface-muted">
      <PageHeader title="Blind Types" backTo="/settings" />
      <CatalogEditor
        config={{
          path: 'blind-types',
          noun: 'blind type',
        }}
      />
    </div>
  );
}
