import type { DocumentKey, FilesystemPath } from '@/lib/documents/utils/types'
import type { EditorTextBuffer } from '@singapore-editor/core/document'
import type { EditorPlugin } from '@singapore-editor/core/extensions'
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'

import { createSnapshotCapture } from '@/features/workbench/state/snapshot-capture'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import {
  readEditorVisibleSnapshotCache,
  removeEditorVisibleSnapshotCacheForPath,
} from '@/lib/editor-visible-snapshot-cache'
import { addLifecycleFlush } from '@/lib/lifecycle-flush'

type SnapshotTarget = {
  readonly contentVersion: string | null
  readonly path: FilesystemPath
  readonly rootPath: FilesystemPath
}

type SnapshotTheme = {
  readonly appliedThemeId: string | null
  readonly committedThemeId: string
  readonly selectedThemeId: string
}

type SnapshotOptions = {
  readonly storage: ScopedStorage
  readonly active: boolean
  readonly documentKey: DocumentKey
  readonly renderedDocument: {
    readonly buffer: EditorTextBuffer
    readonly documentKey: DocumentKey
    readonly path: FilesystemPath
    readonly rootPath: FilesystemPath
  } | null
  readonly selectedTarget: SnapshotTarget | null
  readonly theme: SnapshotTheme
}

export function useEditorVisibleSnapshot({
  storage,
  active,
  documentKey,
  renderedDocument,
  selectedTarget,
  theme,
}: SnapshotOptions) {
  const contentVersion = selectedTarget?.contentVersion ?? null
  const path = selectedTarget?.path ?? null
  const rootPath = selectedTarget?.rootPath ?? null
  const { appliedThemeId, committedThemeId, selectedThemeId } = theme
  // Keyed by the document, not the file: a null key detaches the document inside useEditor,
  // and the kinds without a filesystem resource still render one.
  const paintKey = `${storage.environmentId}\u0000${documentKey}`
  const cacheKey = `${paintKey}\u0000${committedThemeId}`
  const [cached, setCached] = useState(() => ({
    key: cacheKey,
    record: selectedTarget
      ? readEditorVisibleSnapshotCache(storage, { ...selectedTarget, themeId: committedThemeId })
      : null,
  }))
  if (cached.key !== cacheKey) {
    setCached({
      key: cacheKey,
      record: selectedTarget
        ? readEditorVisibleSnapshotCache(storage, { ...selectedTarget, themeId: committedThemeId })
        : null,
    })
  }

  // The plugin and capture source survive ordinary document changes in this host.
  const capture = useMemo(() => createSnapshotCapture(storage), [storage])
  const additionalPlugins = useMemo<readonly EditorPlugin[]>(
    () => [
      {
        name: 'platform-snapshot-capture',
        activate: (context) =>
          context.registerViewContribution({
            createContribution: () => ({ update: capture.schedule, dispose: capture.flush }),
          }),
      },
    ],
    [capture],
  )
  const buffer = renderedDocument?.buffer ?? null
  const key = renderedDocument?.documentKey ?? null
  const matchesTarget =
    renderedDocument === null ||
    (renderedDocument.path === path && renderedDocument.rootPath === rootPath)
  const themeReady = appliedThemeId === committedThemeId && selectedThemeId === committedThemeId

  useLayoutEffect(() => {
    if (path === null || rootPath === null) {
      capture.setIdentity(null)
      return
    }
    capture.setIdentity({
      active: active && matchesTarget,
      buffer,
      contentVersion,
      key,
      paintKey,
      path,
      rootPath,
      themeId: themeReady ? appliedThemeId : null,
    })
    capture.schedule()
  }, [
    active,
    appliedThemeId,
    buffer,
    capture,
    contentVersion,
    key,
    paintKey,
    matchesTarget,
    path,
    rootPath,
    themeReady,
  ])

  useLayoutEffect(() => {
    if (!buffer || !matchesTarget || path === null || rootPath === null) return
    const discardDirty = () => {
      if (!buffer.isDirty()) return
      capture.cancel()
      removeEditorVisibleSnapshotCacheForPath(storage, { path, rootPath })
      setCached((current) => (current.record ? { ...current, record: null } : current))
    }
    discardDirty()
    return buffer.subscribe(discardDirty)
  }, [buffer, capture, matchesTarget, path, rootPath, storage])

  useEffect(() => addLifecycleFlush(capture.flush), [capture])
  useLayoutEffect(
    () => () => {
      capture.flush()
      capture.cancel()
    },
    [capture],
  )

  const record = cached.key === cacheKey ? cached.record : null
  const eligible =
    active &&
    matchesTarget &&
    themeReady &&
    !buffer?.isDirty() &&
    (contentVersion === null || record?.contentVersion === contentVersion)
  return {
    additionalPlugins,
    paintKey,
    onCaptureSourceChange: capture.setSource,
    snapshot: eligible ? (record?.paint ?? null) : null,
  }
}
