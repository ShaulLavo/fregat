import type { EnvironmentId, OrchestrationWorktreeShell, ProjectId } from '@workspace/contracts'
import type { ChatSelection } from '@/lib/chat-selection'

export function activeWorktree({
  environmentId,
  projectId,
  selection,
  sessionWorktree,
  draftWorktree,
  currentWorktree,
}: {
  readonly environmentId: EnvironmentId
  readonly projectId: ProjectId | null
  readonly selection: ChatSelection
  readonly sessionWorktree: OrchestrationWorktreeShell | null | undefined
  readonly draftWorktree: OrchestrationWorktreeShell | null | undefined
  readonly currentWorktree: OrchestrationWorktreeShell | null | undefined
}): OrchestrationWorktreeShell | null {
  if (sessionWorktree) return sessionWorktree
  if (
    selection.kind === 'draft' &&
    selection.environmentId === environmentId &&
    selection.projectId === projectId
  )
    return draftWorktree?.projectId === projectId ? draftWorktree : null
  return currentWorktree ?? null
}
