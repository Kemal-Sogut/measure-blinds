// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/** Unit tests for the constant-time secret comparison. */

import { describe, it, expect } from 'vitest';
import { secretsMatch } from './secretCompare';

describe('secretsMatch', () => {
  it('accepts identical strings', async () => {
    expect(await secretsMatch('Bearer s3cret', 'Bearer s3cret')).toBe(true);
  });

  it('rejects a different string of the same length', async () => {
    expect(await secretsMatch('Bearer s3cret', 'Bearer s3creT')).toBe(false);
  });

  it('rejects a prefix and an empty string', async () => {
    expect(await secretsMatch('Bearer s3cret', 'Bearer s3cre')).toBe(false);
    expect(await secretsMatch('Bearer s3cret', '')).toBe(false);
  });
});
