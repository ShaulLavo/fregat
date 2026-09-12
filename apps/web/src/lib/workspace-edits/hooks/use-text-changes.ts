import { use } from 'react'
import { WorkspaceTextChangesContext } from '@/lib/workspace-edits/providers/context'
import { clientErrors } from '@/lib/structured-errors'

export function useWorkspaceTextChanges() {
  const service = use(WorkspaceTextChangesContext)
  if (service) return service
  throw clientErrors.CONTEXT_MISSING({ message: 'Workspace text changes are unavailable' })
}
