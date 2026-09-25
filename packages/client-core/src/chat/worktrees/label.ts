import type {
  OrchestrationProjectShell,
  OrchestrationWorktreeShell,
  WorktreeLifecycle,
} from '@workspace/contracts'

export function worktreeLabel(
  worktree: OrchestrationWorktreeShell,
  repositoryKind: OrchestrationProjectShell['repositoryKind'],
) {
  if (repositoryKind !== 'git') return 'Workspace'
  return worktree.branch ?? `Detached · ${worktree.id.slice(0, 8)}`
}

export function worktreeLifecycleLabel(lifecycle: WorktreeLifecycle): string {
  switch (lifecycle.state) {
    case 'provisioning':
      return 'Creating worktree'
    case 'ready':
      return 'Ready'
    case 'creation-failed':
      return 'Creation failed'
    case 'orphaned':
      return 'Unclaimed worktree'
    case 'missing':
      return 'Checkout missing'
    case 'retired':
      return 'Retired'
    case 'cleanup-requested':
      return 'Cleaning up'
    case 'cleanup-failed':
      return 'Cleanup failed'
    case 'removed':
      return 'Removed'
    case 'cleanup-blocked':
      return cleanupBlockerLabel(lifecycle.reason)
  }
}

function cleanupBlockerLabel(
  reason: Extract<WorktreeLifecycle, { state: 'cleanup-blocked' }>['reason'],
) {
  switch (reason) {
    case 'dirty':
      return 'Working changes retained'
    case 'needs-reconfirmation':
      return 'Changes need a new confirmation'
    case 'active-runtime':
      return 'Agent still running'
    case 'active-terminal':
      return 'Terminal still running'
  }
}
