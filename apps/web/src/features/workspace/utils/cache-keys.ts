import type { WorktreeId } from '@workspace/contracts'
import { workspaceCacheStorageKey } from '@/lib/workspace-cache-keys'
import { workspaceLocationId } from '@/features/workspace/utils/location'

export function workspaceSliceStorageKey(rootPath: string, worktreeId: WorktreeId | null = null) {
  return `${workspaceCacheStorageKey('workspace:')}${workspaceLocationId(rootPath, worktreeId)}`
}

export function searchBufferStorageKey(rootPath: string, worktreeId: WorktreeId | null = null) {
  return `${workspaceCacheStorageKey('search:')}${workspaceLocationId(rootPath, worktreeId)}`
}
