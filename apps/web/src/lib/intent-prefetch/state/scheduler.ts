import type { QueryClient, QueryFilters } from '@tanstack/react-query'

import { readSettingsMirror } from '@/lib/settings-boot-mirror'

/** A family of presses that prefetch on intent. `folders` is directory listings in trees and pickers. */
export type PrefetchSurface = 'files' | 'folders'

// A long list raises an intent for every row a pointer path or a held arrow key passes over.
const SPECULATIVE_PREFETCH_LIMIT = 4

/** Whether guesses for `surface` may start; each surface has a switch under `prefetch.enabled`. */
export function prefetchSurfaceEnabled(surface: PrefetchSurface): boolean {
  const values = readSettingsMirror()
  if (surface === 'folders') return values['prefetch.enabled']
  return values['prefetch.enabled'] && values['prefetch.files']
}

/**
 * Whether a guessed prefetch may start: its surface is on and fewer than four fetches match
 * `filters`. A click reuses the same keys, so it counts too.
 */
export function hasPrefetchRoom(
  surface: PrefetchSurface,
  queryClient: QueryClient,
  filters: QueryFilters,
) {
  if (!prefetchSurfaceEnabled(surface)) return false
  return queryClient.isFetching(filters) < SPECULATIVE_PREFETCH_LIMIT
}
