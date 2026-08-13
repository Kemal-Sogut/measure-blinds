// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Installation options settings page — rod and track, charged as a FIXED
 * amount per blind rather than per metre of width like the cassette and
 * bottom rail.
 *
 * Seeded as Curtains-only, but that is DATA now: migration 35 made
 * installation a shared hardware slot, so scoping an option to another
 * blind type here is all it takes to offer it there. A type with no
 * installation option scoped to it has no Installation dropdown at all.
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
          priceKey: 'price',
          basis: true,
          noun: 'installation option',
          scoped: true,
          note: 'An installation option is offered only for the blind types picked here. Leave a type off every option and the Installation dropdown disappears for it. Each option also chooses how its price is charged — per m, per m², per unit or per panel.',
        }}
      />
    </div>
  );
}
