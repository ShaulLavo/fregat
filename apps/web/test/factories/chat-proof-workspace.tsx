import { useEffect } from 'react'

import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import type { WorkspaceRootFolder } from '@/lib/file-system-types'

export function ChatProofWorkspace({
  onReady,
}: {
  onReady: (selectRoot: (entry: WorkspaceRootFolder) => void) => void
}) {
  const workspace = useEditorWorkspaceStoreApi()
  useEffect(() => onReady(workspace.getState().switchWorkspace), [onReady, workspace])
  return null
}
