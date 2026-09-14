import { useSyncExternalStore } from 'react'

import { useWorkspaceEditService } from '@/features/editor/providers/workspace-edit-context'
import type { WorkspaceEditServiceSnapshot } from '@/features/editor/state/workspace-edit-service'

export function useWorkspaceEditState<T>(select: (snapshot: WorkspaceEditServiceSnapshot) => T): T {
  const service = useWorkspaceEditService()
  const getSnapshot = () => select(service.getSnapshot())
  return useSyncExternalStore(service.subscribe, getSnapshot, getSnapshot)
}
