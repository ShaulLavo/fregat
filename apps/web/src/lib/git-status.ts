import type { GitFileStatus } from '@workspace/contracts'
export function isStagedStatus(status: GitFileStatus['index']) {
  return status !== 'unmodified' && status !== 'untracked'
}

export function isWorktreeStatus(status: GitFileStatus['worktree']) {
  return status !== 'unmodified'
}
