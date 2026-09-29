import type { GitAutoPullState } from '@workspace/contracts'

/** Why the checkout is not following its upstream on its own, or null when nothing needs saying. */
export function autoPullLabel(state: GitAutoPullState | null): string | null {
  if (state?.state === 'failed') return `Auto-pull failed: ${state.message}`
  if (state?.state !== 'skipped') return null
  switch (state.reason) {
    case 'changes':
      return 'Auto-pull paused: uncommitted changes'
    case 'ahead':
      return 'Auto-pull paused: this branch has commits you have not pushed'
    case 'diverged':
      return 'Auto-pull paused: this branch and its remote branch both have new commits'
    case 'detached':
      return 'Auto-pull paused: no branch is checked out'
    case 'no-upstream':
      return 'Auto-pull paused: this branch has no remote branch to pull from'
    case 'no-default-branch':
      return 'Auto-pull paused: the remote has no default branch'
    case 'other-branch':
      return `Auto-pull follows ${state.defaultBranch ?? 'the default branch'} only`
  }
}
