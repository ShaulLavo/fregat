import type { EnvironmentId, OrchestrationWorktreeShell, ProjectId } from '@workspace/contracts'
import type { SessionSelection } from '@/features/chat-mode/utils/active-session'

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
  readonly selection: SessionSelection
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
