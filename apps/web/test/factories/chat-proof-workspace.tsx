import { useEffect } from 'react'

import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import type { PickedFsEntry } from '@/lib/file-system-types'

export function ChatProofWorkspace({
  onReady,
}: {
  onReady: (selectRoot: (entry: PickedFsEntry) => void) => void
}) {
  const workspace = useEditorWorkspaceStoreApi()
  useEffect(() => onReady(workspace.getState().switchWorkspace), [onReady, workspace])
  return null
}
