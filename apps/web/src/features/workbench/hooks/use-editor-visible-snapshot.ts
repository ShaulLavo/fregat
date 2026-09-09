import type { EditorPlugin, EditorTextBuffer } from '@singapor/core'
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
  readonly path: string
  readonly rootPath: string
}

type SnapshotTheme = {
  readonly appliedThemeId: string | null
  readonly committedThemeId: string
  readonly selectedThemeId: string
}

type SnapshotOptions = {
  readonly storage: ScopedStorage
  readonly active: boolean
  readonly renderedDocument: {
    readonly buffer: EditorTextBuffer
    readonly documentId: string
    readonly path: string
    readonly rootPath: string
  } | null
  readonly selectedTarget: SnapshotTarget
  readonly theme: SnapshotTheme
}

export function useEditorVisibleSnapshot({
  storage,
  active,
  renderedDocument,
  selectedTarget,
  theme,
}: SnapshotOptions) {
  const { contentVersion, path, rootPath } = selectedTarget
  const { appliedThemeId, committedThemeId, selectedThemeId } = theme
  const documentKey = `${storage.environmentId}\u0000${rootPath}\u0000${path}`
  const cacheKey = `${documentKey}\u0000${committedThemeId}`
  const [cached, setCached] = useState(() => ({
    key: cacheKey,
    record: readEditorVisibleSnapshotCache(storage, { path, rootPath, themeId: committedThemeId }),
  }))
  if (cached.key !== cacheKey) {
    setCached({
      key: cacheKey,
      record: readEditorVisibleSnapshotCache(storage, {
        path,
        rootPath,
        themeId: committedThemeId,
      }),
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
  const documentId = renderedDocument?.documentId ?? null
  const matchesTarget =
    renderedDocument === null ||
    (renderedDocument.path === path && renderedDocument.rootPath === rootPath)
  const themeReady = appliedThemeId === committedThemeId && selectedThemeId === committedThemeId

  useLayoutEffect(() => {
    capture.setIdentity({
      active: active && matchesTarget,
      buffer,
      contentVersion,
      documentId,
      documentKey,
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
    documentId,
    documentKey,
    matchesTarget,
    path,
    rootPath,
    themeReady,
  ])

  useLayoutEffect(() => {
    if (!buffer || !matchesTarget) return
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
    documentKey,
    onCaptureSourceChange: capture.setSource,
    snapshot: eligible ? (record?.paint ?? null) : null,
  }
}
