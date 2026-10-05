// Local UI caches are dropped on a version mismatch.
export const WORKSPACE_CACHE_VERSION = 22
export const WORKSPACE_CACHE_STORAGE_PREFIX = `platform.workspace-state.v${WORKSPACE_CACHE_VERSION}`
export const WORKSPACE_CACHE_STORAGE_NAMESPACE = 'platform.workspace-state.v'

export function workspaceCacheStorageKey(suffix: string) {
  return `${WORKSPACE_CACHE_STORAGE_PREFIX}.${suffix}`
}

export const WORKSPACE_CACHE_STORAGE_KEYS = {
  chatModePanels: workspaceCacheStorageKey('chatModePanels'),
  chatModeSelection: workspaceCacheStorageKey('chatModeSelection'),
  rootFolder: workspaceCacheStorageKey('rootFolder'),
  uiMode: workspaceCacheStorageKey('uiMode'),
  workbenchLayout: workspaceCacheStorageKey('workbenchLayout'),
  workspaceIndex: workspaceCacheStorageKey('workspaces'),
} as const
