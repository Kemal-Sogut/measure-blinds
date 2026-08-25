// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Standing reminder that customer-facing maintenance mode is ON.
 *
 * Maintenance mode (migration 40) closes `/public/*` — the token'd
 * estimate and appointment pages — while leaving the staff app fully
 * working. That asymmetry is the feature's point AND its one hazard:
 * nothing in the authenticated app looks any different, so a switch
 * flipped on Monday can keep turning customers away all week without a
 * single visible symptom. This strip is that symptom, mounted once in
 * `Layout` so it rides above every authenticated page, and it links
 * straight to the switch that turns it off.
 *
 * Renders nothing when the flag is off, while the query is loading, or
 * when it fails — a settings fetch error must not put a false "your
 * site is closed" claim on screen.
 */

import { Link } from 'react-router-dom';
import { useCompanySettings } from '../hooks/useSettings';

export default function MaintenanceBanner() {
  const { data } = useCompanySettings();
  if (!data?.maintenance_mode) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-warning px-4 py-2 text-center text-sm font-medium text-white">
      <span>Maintenance mode is on — customer estimate and appointment links are closed.</span>
      <Link to="/settings/company" className="underline underline-offset-2">
        Turn it off
      </Link>
    </div>
  );
}
