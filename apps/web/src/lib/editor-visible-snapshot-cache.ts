import type { Editor } from '@singapore-editor/core/editor'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import {
  readWorkspaceCacheEntry,
  removeWorkspaceCacheEntry,
  workspaceCacheStorageKey,
  workspaceCacheSerializedBytes,
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
  return (
    readStoredEditorVisibleSnapshots(storage).find((cached) => sameSnapshotKey(cached, key)) ?? null
  )
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

  const records = readStoredEditorVisibleSnapshots(storage).filter(
    (cached) => !sameSnapshotKey(cached, record),
  )
  records.push(parsed.output)
  while (
    records.length > 1 &&
    workspaceCacheSerializedBytes(JSON.stringify(records)) > EDITOR_VISIBLE_SNAPSHOT_CACHE_MAX_BYTES
  )
    records.shift()

  const result = writeWorkspaceCacheEntry(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY, records, {
    storage,
    maxSerializedBytes: EDITOR_VISIBLE_SNAPSHOT_CACHE_MAX_BYTES,
  })
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
  removeMatchingSnapshots(storage, (cached) => cached.rootPath === rootPath && cached.path === path)
}

export function removeEditorVisibleSnapshotCacheForRoot(storage: ScopedStorage, rootPath: string) {
  removeMatchingSnapshots(storage, (cached) => cached.rootPath === rootPath)
}

function removeMatchingSnapshots(
  storage: ScopedStorage,
  matches: (record: CachedEditorVisibleSnapshot) => boolean,
) {
  const records = readStoredEditorVisibleSnapshots(storage)
  const remaining = records.filter((record) => !matches(record))
  if (remaining.length === records.length) return
  if (remaining.length === 0) {
    removeWorkspaceCacheEntry(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY, storage)
    return
  }
  writeWorkspaceCacheEntry(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY, remaining, { storage })
}

function sameSnapshotKey(
  left: EditorVisibleSnapshotCacheKey,
  right: EditorVisibleSnapshotCacheKey,
) {
  return (
    left.rootPath === right.rootPath && left.path === right.path && left.themeId === right.themeId
  )
}

const cachedEditorVisibleSnapshotsSchema = v.array(cachedEditorVisibleSnapshotSchema)

function readStoredEditorVisibleSnapshots(storage: ScopedStorage) {
  return readWorkspaceCacheEntry<CachedEditorVisibleSnapshot[]>(
    EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY,
    cachedEditorVisibleSnapshotsSchema,
    [],
    { storage, maxSerializedBytes: EDITOR_VISIBLE_SNAPSHOT_CACHE_MAX_BYTES },
  )
}
