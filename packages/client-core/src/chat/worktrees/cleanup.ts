import type { OrchestrationWorktreeShell, WorktreeCleanupEligibility } from '@workspace/contracts'

export function cleanupEligibilityLabel(eligibility: WorktreeCleanupEligibility): string {
  switch (eligibility.reason) {
    case 'eligible':
      return 'Can be removed. Platform checks for changes and running processes first.'
    case 'referenced':
      return `${eligibility.nonDeletedSessionCount} sessions still use this worktree. Delete them before removing it.`
    case 'provider-stop-pending':
      return 'Waiting for the agent to stop.'
    case 'provider-stop-failed':
      return 'The agent could not stop. Stop it again before removing the worktree.'
    case 'active-runtime':
      return 'An agent is still running in this worktree.'
    case 'active-terminal':
      return 'A terminal is still running. Close it and wait for it to exit.'
    case 'terminal-ownership-unknown':
      return 'After the restart, Platform cannot tell whether a terminal still runs here. Stop managing this worktree and remove it yourself.'
    case 'external-driver-unverified':
      return 'An agent outside Platform may still be running here. Stop managing this worktree and remove it yourself.'
    case 'protected':
      return 'The main checkout is protected from removal.'
    case 'external':
      return 'This worktree is managed outside Platform.'
    case 'unclaimed':
      return 'Let Platform manage this worktree before it can remove it.'
    case 'missing':
      return 'This worktree folder is gone. Forget it to clear it from the list.'
    case 'not-ready':
      return 'This worktree is not ready to be removed.'
  }
}

export function cleanupStatusLabel(worktree: OrchestrationWorktreeShell): string {
  if (worktree.lifecycle.state === 'removed')
    return 'Worktree removed. Its branch and commits were kept.'
  if (worktree.lifecycle.state !== 'cleanup-blocked')
    return cleanupEligibilityLabel(worktree.cleanupEligibility)
  if (worktree.lifecycle.reason === 'active-runtime')
    return 'The last removal found a running agent. Check again before removing files.'
  if (worktree.lifecycle.reason === 'active-terminal')
    return 'The last removal found a running terminal. Check again before removing files.'
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
