import { readWorkspaceCacheEntry, writeWorkspaceCacheEntry } from '@/lib/workspace-cache-storage'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { projectIdSchema, type ProjectId } from '@workspace/contracts'
import * as v from 'valibot'

const RAIL_COLLAPSE_STORAGE_KEY = 'platform.chat-rail-collapse.v1'
const RAIL_COLLAPSE_STORAGE_VERSION = 1
/**
 * Nothing prunes ids for projects that were removed elsewhere, so the list is
 * bounded here. Losing an entry only re-expands one group once, which is the
 * cheapest possible failure for this state.
 */
const MAX_COLLAPSED_PROJECTS = 200

const persistedRailCollapseSchema = v.object({
  collapsedProjectIds: v.array(projectIdSchema),
  version: v.literal(RAIL_COLLAPSE_STORAGE_VERSION),
})

const NO_PROJECT_IDS: readonly ProjectId[] = []

export function readPersistedRailCollapse(storage: ScopedStorage): readonly ProjectId[] {
  const stored = readWorkspaceCacheEntry<v.InferOutput<typeof persistedRailCollapseSchema> | null>(
    RAIL_COLLAPSE_STORAGE_KEY,
    persistedRailCollapseSchema,
    null,
    { storage },
  )
  return stored?.collapsedProjectIds ?? NO_PROJECT_IDS
}

export function writePersistedRailCollapse(
  storage: ScopedStorage,
  collapsedProjectIds: readonly ProjectId[],
) {
  return writeWorkspaceCacheEntry(
    RAIL_COLLAPSE_STORAGE_KEY,
    {
      collapsedProjectIds: collapsedProjectIds.slice(0, MAX_COLLAPSED_PROJECTS),
      version: RAIL_COLLAPSE_STORAGE_VERSION,
    },
    { storage },
  )
}
