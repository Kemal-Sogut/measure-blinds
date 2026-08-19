// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Hooks barrel export — re-exports all custom hooks from a single location.
 * Import hooks via: `import { useAuth } from '../hooks'`
 */

export { useAuth, type AuthStatus } from './useAuth';
export {
  useCompanySettings,
  useUpdateCompanySettings,
  useUploadLogo,
  useCatalogList,
  useCreateCatalogItem,
  useUpdateCatalogItem,
  useDeleteCatalogItem,
  useBlindTypeDefaults,
  useUpdateBlindTypeDefaults,
  type CatalogPath,
  type CatalogRow,
} from './useSettings';
export {
  useCustomerSearch,
  useCustomer,
  useCreateCustomer,
  useUpdateCustomer,
  useDeleteCustomer,
  type CustomerInput,
} from './useCustomers';
export { useDebouncedValue } from './useDebouncedValue';
export { useKeyboardOpen, isKeyboardOpen, KEYBOARD_MIN_SHRINK_PX } from './useKeyboardOpen';
export {
  usePullToRefresh,
  pullDistance,
  isPullArmed,
  isStandaloneDisplay,
  PULL_TRIGGER_PX,
  PULL_MAX_PX,
  PULL_RESISTANCE,
  REFRESH_MIN_MS,
  type PullToRefreshState,
  type PullToRefreshOptions,
} from './usePullToRefresh';
