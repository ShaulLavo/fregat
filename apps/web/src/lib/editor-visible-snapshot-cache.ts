import type { Editor } from '@singapor/core'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import {
  readWorkspaceCacheEntry,
  removeWorkspaceCacheEntry,
  workspaceCacheStorageKey,
  writeWorkspaceCacheEntry,
  type WorkspaceCacheWriteResult,
} from '@/lib/workspace-cache-storage'
import { log } from '@/lib/client-logging'
import * as v from 'valibot'

export const EDITOR_VISIBLE_SNAPSHOT_CACHE_MAX_BYTES = 262_144
export const EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY =
  workspaceCacheStorageKey('editorVisibleSnapshot')

export type SnapshotCaptureSource = () => ReturnType<Editor['captureSnapshot']>

export type CachedEditorVisibleSnapshot = {
  readonly cacheVersion: 5
  readonly contentVersion: string
  readonly rootPath: string
  readonly path: string
  readonly themeId: string
  readonly paint: string
}

export type EditorVisibleSnapshotCacheKey = Pick<
  CachedEditorVisibleSnapshot,
  'rootPath' | 'path' | 'themeId'
>

export type EditorVisibleSnapshotCacheWriteResult =
  | WorkspaceCacheWriteResult
  | {
      readonly serializedBytes: null
      readonly status: 'invalid'
    }

const cachedEditorVisibleSnapshotSchema = v.strictObject({
  cacheVersion: v.literal(5),
  contentVersion: v.string(),
  rootPath: v.string(),
  path: v.string(),
  themeId: v.string(),
  paint: v.pipe(v.string(), v.minLength(1)),
})

export function readEditorVisibleSnapshotCache(
  storage: ScopedStorage,
  key: EditorVisibleSnapshotCacheKey,
): CachedEditorVisibleSnapshot | null {
  const cached = readStoredEditorVisibleSnapshot(storage)
  if (!cached) return null
  if (cached.rootPath !== key.rootPath) return null
  if (cached.path !== key.path) return null
  if (cached.themeId !== key.themeId) return null
  return cached
}

export function writeEditorVisibleSnapshotCache(
  storage: ScopedStorage,
  record: CachedEditorVisibleSnapshot,
): EditorVisibleSnapshotCacheWriteResult {
  const parsed = v.safeParse(cachedEditorVisibleSnapshotSchema, record)
  if (!parsed.success) {
    log.warn({
      action: 'editor.visible_snapshot.cache_write',
      area: 'editor',
      outcome: 'invalid',
      validationIssueCount: parsed.issues.length,
    })
    return { serializedBytes: null, status: 'invalid' }
  }

  const result = writeWorkspaceCacheEntry(
    EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY,
    parsed.output,
    {
      storage,
      maxSerializedBytes: EDITOR_VISIBLE_SNAPSHOT_CACHE_MAX_BYTES,
    },
  )
  if (result.status === 'written' || result.status === 'unavailable') return result

  log.warn({
    action: 'editor.visible_snapshot.cache_write',
    area: 'editor',
    outcome: result.status,
    path: parsed.output.path,
    rootPath: parsed.output.rootPath,
    serializedBytes: result.serializedBytes,
  })
  return result
}

export function removeEditorVisibleSnapshotCacheForPath(
  storage: ScopedStorage,
  { rootPath, path }: Pick<EditorVisibleSnapshotCacheKey, 'rootPath' | 'path'>,
) {
  const cached = readStoredEditorVisibleSnapshot(storage)
  if (!cached) return
  if (cached.rootPath !== rootPath || cached.path !== path) return

  removeEditorVisibleSnapshotCache(storage)
}

export function removeEditorVisibleSnapshotCacheForRoot(storage: ScopedStorage, rootPath: string) {
  const cached = readStoredEditorVisibleSnapshot(storage)
  if (!cached || cached.rootPath !== rootPath) return

  removeEditorVisibleSnapshotCache(storage)
}

export function removeEditorVisibleSnapshotCache(storage: ScopedStorage) {
  removeWorkspaceCacheEntry(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY, storage)
}

function readStoredEditorVisibleSnapshot(storage: ScopedStorage) {
  return readWorkspaceCacheEntry<CachedEditorVisibleSnapshot | null>(
    EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY,
    cachedEditorVisibleSnapshotSchema,
    null,
    { storage, maxSerializedBytes: EDITOR_VISIBLE_SNAPSHOT_CACHE_MAX_BYTES },
  )
}
