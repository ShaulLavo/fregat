import { createContext, use } from 'react'

import type { WorkspaceEditService } from '@/features/editor/state/workspace-edit-service'
import { requireContext } from '@/lib/require-context'

export const WorkspaceEditServiceContext = createContext<WorkspaceEditService | null>(null)

export function useWorkspaceEditService(): WorkspaceEditService {
  const service = use(WorkspaceEditServiceContext)
  requireContext(service, 'useWorkspaceEditService must be used within WorkspaceEditProvider')
  return service
}

export function useOptionalWorkspaceEditService(): WorkspaceEditService | null {
  return use(WorkspaceEditServiceContext)
}
