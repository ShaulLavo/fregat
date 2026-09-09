import type { OrchestrationWorktreeShell, WorktreeCleanupEligibility } from '@workspace/contracts'

export function cleanupEligibilityLabel(eligibility: WorktreeCleanupEligibility): string {
  switch (eligibility.reason) {
    case 'eligible':
      return 'Ready to check for cleanup. Running processes and changes are checked before removal.'
    case 'referenced':
      return `${eligibility.nonDeletedSessionCount} sessions still use this checkout. Delete them before cleanup.`
    case 'provider-stop-pending':
      return 'Waiting for the agent to stop.'
    case 'provider-stop-failed':
      return 'The agent could not stop. Retry stopping it before cleanup.'
    case 'active-runtime':
      return 'An agent is still running in this checkout.'
    case 'active-terminal':
      return 'A terminal is still running. Dispose of it and wait for it to exit.'
    case 'terminal-ownership-unknown':
      return 'Terminal ownership could not be verified after restart. Release this checkout for manual cleanup.'
    case 'external-driver-unverified':
      return 'An external agent may still be running. Release this checkout for manual cleanup.'
    case 'protected':
      return 'The main checkout is protected from removal.'
    case 'external':
      return 'This checkout is managed outside Platform.'
    case 'unclaimed':
      return 'Adopt this checkout before Platform can clean it up.'
    case 'missing':
      return 'This checkout is absent. Confirm its absence to resolve the record.'
    case 'not-ready':
      return 'This checkout is not ready for cleanup.'
  }
}

export function cleanupStatusLabel(worktree: OrchestrationWorktreeShell): string {
  if (worktree.lifecycle.state === 'removed')
    return 'Checkout removed. Its branch and commits were retained.'
  if (worktree.lifecycle.state !== 'cleanup-blocked')
    return cleanupEligibilityLabel(worktree.cleanupEligibility)
  if (worktree.lifecycle.reason === 'active-runtime')
    return 'The last cleanup attempt found a running agent. Retry checks again before removing files.'
  if (worktree.lifecycle.reason === 'active-terminal')
    return 'The last cleanup attempt found a running terminal. Retry checks again before removing files.'
  return cleanupEligibilityLabel(worktree.cleanupEligibility)
}

export function canForceCleanupWorktree(worktree: OrchestrationWorktreeShell) {
  if (worktree.cleanupEligibility.reason !== 'eligible') return false
  if (worktree.lifecycle.state === 'removed') return false
  if (worktree.lifecycle.state !== 'cleanup-blocked') return true
  return (
    worktree.lifecycle.reason !== 'active-runtime' &&
    worktree.lifecycle.reason !== 'active-terminal'
  )
}

export function canRetainWorktree(worktree: OrchestrationWorktreeShell) {
  if (worktree.ownership !== 'platform') return false
  return (
    worktree.lifecycle.state === 'cleanup-blocked' || worktree.lifecycle.state === 'cleanup-failed'
  )
}

export function canRetryWorktree(worktree: OrchestrationWorktreeShell) {
  if (worktree.ownership !== 'platform') return false
  if (worktree.lifecycle.state === 'creation-failed') return true
  return canRetainWorktree(worktree) && worktree.cleanupEligibility.reason === 'eligible'
}

export function canReleaseWorktree(worktree: OrchestrationWorktreeShell) {
  return (
    (worktree.ownership === 'platform' || worktree.ownership === 'unclaimed') &&
    worktree.cleanupEligibility.nonDeletedSessionCount === 0 &&
    worktree.lifecycle.state !== 'removed' &&
    worktree.lifecycle.state !== 'cleanup-requested' &&
    worktree.lifecycle.state !== 'provisioning'
  )
}
