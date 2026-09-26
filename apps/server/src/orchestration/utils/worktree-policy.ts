import type {
  OrchestrationWorktree,
  WorktreeCleanupEligibility,
  SessionDeletionState,
} from '@workspace/contracts'

type Reference = {
  readonly deletedAt: string | null
  readonly deletion: SessionDeletionState | null
}

export function worktreeCleanupEligibility(
  worktree: Pick<
    OrchestrationWorktree,
    | 'ownership'
    | 'lifecycle'
    | 'activeTerminalCount'
    | 'terminalOwnershipUnknown'
    | 'externalDriverUnverified'
  >,
  references: readonly Reference[],
): WorktreeCleanupEligibility {
  const nonDeletedSessionCount = references.filter((session) => !session.deletedAt).length
  const blocking = cleanupBlocker(worktree, references, nonDeletedSessionCount)
  const state = worktree.lifecycle.state
  const canResolveMissing =
    !blocking && ['missing', 'creation-failed', 'cleanup-failed'].includes(state)
  if (blocking) return { reason: blocking, nonDeletedSessionCount, canResolveMissing: false }
  if (state === 'missing' || state === 'creation-failed')
    return { reason: 'missing', nonDeletedSessionCount, canResolveMissing }
  if (
    state === 'provisioning' ||
    state === 'cleanup-requested' ||
    state === 'retired' ||
    state === 'removed'
  )
    return { reason: 'not-ready', nonDeletedSessionCount, canResolveMissing: false }
  return { reason: 'eligible', nonDeletedSessionCount, canResolveMissing }
}

function cleanupBlocker(
  worktree: Parameters<typeof worktreeCleanupEligibility>[0],
  references: readonly Reference[],
  count: number,
): WorktreeCleanupEligibility['reason'] | null {
  if (worktree.ownership === 'protected') return 'protected'
  if (worktree.ownership === 'external') return 'external'
  if (worktree.ownership === 'unclaimed') return 'unclaimed'
  if (count > 0) return 'referenced'
  if (references.some((session) => session.deletion?.providerStop === 'failed'))
    return 'provider-stop-failed'
  if (
    references.some(
      (session) =>
        !session.deletion || !['completed', 'no-binding'].includes(session.deletion.providerStop),
    )
  )
    return 'provider-stop-pending'
  if (worktree.terminalOwnershipUnknown) return 'terminal-ownership-unknown'
  if (worktree.externalDriverUnverified) return 'external-driver-unverified'
  if (worktree.activeTerminalCount > 0) return 'active-terminal'
  return null
}
