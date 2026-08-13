// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Control options settings page — CRUD list priced per panel.
 *
 * Each option carries the blind types it is offered for. A type with no
 * control scoped to it loses the Control dropdown on the line-item form
 * entirely and stops being charged for one, which is how the slot is
 * switched off per type (migration 35).
 */

import PageHeader from '../../components/PageHeader';
import CatalogEditor from '../../components/CatalogEditor';

export default function ControlOptions() {
  return (
    <div className="min-h-screen bg-surface-muted">
      <PageHeader title="Control Options" backTo="/settings" />
      <CatalogEditor
        config={{
          path: 'control-options',
          priceKey: 'price',
          basis: true,
          noun: 'control option',
          scoped: true,
          note: 'A control is offered only for the blind types picked here. Leave a type off every control and the Control dropdown disappears for it. Each option also chooses how its price is charged — per m, per m², per unit or per panel.',
        }}
      />
    </div>
  );
}
