import { useMemo } from 'react'
import { useEditorDocumentStoreApi } from '@/features/editor/state/document-state'
import { useOptionalWorkspaceEditService } from '@/features/editor/providers/workspace-edit-context'
import { createUndoBarrierPlugin, notifyUndoBarrier } from '@/keymap/state/undo-barrier'
import type { DocumentKey } from '@/lib/documents/utils/types'

export function useUndoBarrierPlugin(key: DocumentKey) {
  const store = useEditorDocumentStoreApi()
  const workspaceEdits = useOptionalWorkspaceEditService()
  // Plugin identity owns its registered command contribution in useEditor.
  return useMemo(
    () =>
      createUndoBarrierPlugin(() => {
        if (!workspaceEdits) return
        notifyUndoBarrier(
          { documents: { store }, workspaceEdits },
          {
            kind: 'editor',
            key,
            surface: 'document',
          },
        )
      }),
    [key, store, workspaceEdits],
  )
}
