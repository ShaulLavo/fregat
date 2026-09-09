import type { EditorTextBuffer } from '@singapor/core'

import { log } from '@/lib/client-logging'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import {
  removeEditorVisibleSnapshotCacheForPath,
  writeEditorVisibleSnapshotCache,
  type SnapshotCaptureSource,
} from '@/lib/editor-visible-snapshot-cache'

export type SnapshotCaptureIdentity = {
  readonly active: boolean
  readonly buffer: EditorTextBuffer | null
  readonly contentVersion: string | null
  readonly documentId: string | null
  readonly documentKey: string
  readonly path: string
  readonly rootPath: string
  readonly themeId: string | null
}

export function createSnapshotCapture(storage: ScopedStorage) {
  let identity: SnapshotCaptureIdentity | null = null
  let source: SnapshotCaptureSource | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending = false

  function cancel() {
    if (timer !== null) clearTimeout(timer)
    timer = null
    pending = false
  }

  function flush() {
    const requested = pending
    cancel()
    if (!requested || !identity || !source) return
    persistSnapshot(storage, identity, source)
  }

  return {
    cancel,
    flush,
    setIdentity(next: SnapshotCaptureIdentity) {
      flush()
      identity = next
    },
    setSource(next: SnapshotCaptureSource | null) {
      flush()
      source = next
    },
    schedule() {
      cancel()
      pending = true
      timer = setTimeout(flush, 350)
    },
  }
}

function persistSnapshot(
  storage: ScopedStorage,
  identity: SnapshotCaptureIdentity,
  source: SnapshotCaptureSource,
) {
  const { active, buffer, contentVersion, themeId } = identity
  if (!active || !buffer || contentVersion === null || themeId === null) return
  if (buffer.isDirty()) {
    removeEditorVisibleSnapshotCacheForPath(storage, identity)
    return
  }

  const started = performance.now()
  const capture = source()
  if (!capture || capture.documentKey !== identity.documentKey) return
  if (capture.documentId !== identity.documentId || capture.buffer !== buffer) return
  if (capture.bufferRevision !== buffer.getRevision()) return

  const result = writeEditorVisibleSnapshotCache(storage, {
    cacheVersion: 5,
    contentVersion,
    path: identity.path,
    rootPath: identity.rootPath,
    paint: capture.paint,
    themeId,
  })
  performance.measure('editor.visible_snapshot.capture', {
    start: started,
    detail: { outcome: result.status, serializedBytes: result.serializedBytes },
  })
  if (result.status !== 'invalid') return
  log.warn({
    area: 'editor',
    action: 'snapshot.capture',
    path: identity.path,
    outcome: result.status,
  })
}
