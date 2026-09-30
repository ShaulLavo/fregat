import type { WorktreeId } from '@workspace/contracts'
import { workspaceLocationId } from './workspace-location.ts'

// Local-only UI cache versions are dropped on mismatch, never migrated.
export const WORKSPACE_CACHE_VERSION = 22
export const WORKSPACE_CACHE_STORAGE_PREFIX = `platform.workspace-state.v${WORKSPACE_CACHE_VERSION}`
export const WORKSPACE_CACHE_STORAGE_NAMESPACE = 'platform.workspace-state.v'

export function workspaceCacheStorageKey(suffix: string) {
  return `${WORKSPACE_CACHE_STORAGE_PREFIX}.${suffix}`
}

const WORKSPACE_SLICE_KEY_PREFIX = workspaceCacheStorageKey('workspace:')
const SEARCH_BUFFER_KEY_PREFIX = workspaceCacheStorageKey('search:')

export const WORKSPACE_CACHE_STORAGE_KEYS = {
  chatModePanels: workspaceCacheStorageKey('chatModePanels'),
  chatModeSelection: workspaceCacheStorageKey('chatModeSelection'),
  rootFolder: workspaceCacheStorageKey('rootFolder'),
  uiMode: workspaceCacheStorageKey('uiMode'),
  workbenchLayout: workspaceCacheStorageKey('workbenchLayout'),
  workspaceIndex: workspaceCacheStorageKey('workspaces'),
} as const

/** Per-project state lives under its own key so switching never rewrites another project's. */
export function workspaceSliceStorageKey(rootPath: string, worktreeId: WorktreeId | null = null) {
  return `${WORKSPACE_SLICE_KEY_PREFIX}${workspaceLocationId(rootPath, worktreeId)}`
}

/**
 * Search results are the one bulky entry — a full match list. Splitting them from the
 * slice keeps a quota failure on search from taking the project's open tabs with it.
 */
export function searchBufferStorageKey(rootPath: string, worktreeId: WorktreeId | null = null) {
  return `${SEARCH_BUFFER_KEY_PREFIX}${workspaceLocationId(rootPath, worktreeId)}`
}
