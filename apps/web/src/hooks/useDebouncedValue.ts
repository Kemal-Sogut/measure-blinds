// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Debounce hook — returns a value that only updates after the source
 * has been stable for `delayMs`. Used to throttle search-as-you-type
 * queries (customer search here; estimate search in Phase 7) so each
 * keystroke doesn't fire an API request on a slow field connection.
 */

import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
}
