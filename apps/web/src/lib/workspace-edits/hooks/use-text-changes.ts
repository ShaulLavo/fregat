import { use } from 'react'
import { WorkspaceTextChangesContext } from '@/lib/workspace-edits/providers/context'
import { requireContext } from '@/lib/require-context'

export function useWorkspaceTextChanges() {
  const service = use(WorkspaceTextChangesContext)
  requireContext(service, 'Workspace text changes are unavailable')
  return service
}
