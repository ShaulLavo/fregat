import { useCallback, useEffect, useRef } from 'react'

import {
  cancelConflictResolutions,
  scheduleConflictResolution,
  resolveConflictEditorSnapshot,
  type ConflictResolutionDebouncers,
} from '@/features/workspace/utils/conflict-editor-resolution'
import { documentKey } from '@/lib/documents/utils/identity'
import type { DocumentRef, FilesystemPath } from '@/lib/documents/utils/types'
import { useEditorConflictStoreApi } from '@/features/editor/state/conflict-state'
import type { FileResult } from '@/lib/file-system-types'
import type { TextSnapshot } from '@singapor/core'
import { useQueryClient } from '@tanstack/react-query'

export function useConflictEditorResolution({
  discardLiveEditorDocument,
  forceReplaceLiveEditorDocument,
  renameLiveEditorDocument,
}: {
  discardLiveEditorDocument: (document: DocumentRef) => { wasDirty: boolean }
  forceReplaceLiveEditorDocument: (file: FileResult) => { wasDirty: boolean }
  renameLiveEditorDocument: (from: FilesystemPath, to: FilesystemPath) => { wasDirty: boolean }
}) {
  const conflictStore = useEditorConflictStoreApi()
  const queryClient = useQueryClient()
  const resolvingConflictIds = useRef(new Set<string>())
  const pendingResolutions = useRef<ConflictResolutionDebouncers>(new Map())

  useEffect(() => () => cancelConflictResolutions(pendingResolutions.current), [])

  return useCallback(
    (target: Extract<DocumentRef, { kind: 'conflict' }>, textSnapshot: TextSnapshot) => {
      const key = documentKey(target)

      scheduleConflictResolution(pendingResolutions.current, key, () => {
        pendingResolutions.current.delete(key)
        resolveConflictEditorSnapshot(target, textSnapshot, {
          conflictStore,
          discardLiveEditorDocument,
          forceReplaceLiveEditorDocument,
          queryClient,
          renameLiveEditorDocument,
          resolvingConflictIds,
        })
      })
    },
    [
      conflictStore,
      discardLiveEditorDocument,
      forceReplaceLiveEditorDocument,
      queryClient,
      renameLiveEditorDocument,
    ],
  )
}
