import type { GitAutoPullState } from '@workspace/contracts'

/** Why the checkout is not following its upstream on its own, or null when nothing needs saying. */
export function autoPullLabel(state: GitAutoPullState | null): string | null {
  if (state?.state === 'failed') return `Auto-pull failed: ${state.message}`
  if (state?.state !== 'skipped') return null
  switch (state.reason) {
    case 'changes':
      return 'Auto-pull paused: uncommitted changes'
    case 'ahead':
      return 'Auto-pull paused: local commits are not pushed'
    case 'diverged':
      return 'Auto-pull paused: the branch has diverged from its upstream'
    case 'detached':
      return 'Auto-pull paused: detached HEAD'
    case 'no-upstream':
      return 'Auto-pull paused: the branch has no upstream'
    case 'no-default-branch':
      return 'Auto-pull paused: the remote names no default branch'
    case 'other-branch':
      return `Auto-pull follows ${state.defaultBranch ?? 'the default branch'} only`
  }
}
