import { defineErrorCatalog } from 'evlog'

export const worktreeLifecycleErrors = defineErrorCatalog('worktree', {
  NOT_READY: {
    status: 409,
    message: ({ worktreeId }: { worktreeId: string }) => `Worktree is not ready: ${worktreeId}`,
    why: 'This checkout has an unresolved lifecycle operation.',
    fix: 'Resolve its worktree lifecycle before starting execution.',
  },
  UNSUPPORTED_REPOSITORY: {
    status: 409,
    message: ({ worktreeId }: { worktreeId: string }) => `New worktrees require Git: ${worktreeId}`,
    why: 'A directory project has no Git commit from which to branch.',
    fix: 'Use the current workspace.',
  },
  DUPLICATE_ID: {
    status: 409,
    message: ({ worktreeId }: { worktreeId: string }) =>
      `Worktree ID or path already exists: ${worktreeId}`,
    why: 'A new worktree must have an unused ID and canonical path.',
    fix: 'Use the existing worktree or request a fresh ID.',
  },
  INVALID_PREPARATION: {
    status: 409,
    message: ({ worktreeId }: { worktreeId: string }) =>
      `Worktree preparation does not match the target: ${worktreeId}`,
    why: 'The trusted repository observation is absent or names a different target.',
    fix: 'Refresh the target and prepare the operation again.',
  },
  STALE_RESULT: {
    status: 409,
    message: ({ worktreeId }: { worktreeId: string }) =>
      `Worktree operation changed: ${worktreeId}`,
    why: 'The lifecycle, operation ID, mode, or observed metadata version no longer matches.',
    fix: 'Read the current state before issuing another operation.',
  },
  NOT_RETRYABLE: {
    status: 409,
    message: ({ worktreeId }: { worktreeId: string }) =>
      `Worktree operation is unavailable: ${worktreeId}`,
    why: 'This lifecycle state does not permit the requested transition.',
    fix: 'Choose an action offered by the current worktree state.',
  },
  CLEANUP_INELIGIBLE: {
    status: 409,
    message: ({ worktreeId, reason }: { worktreeId: string; reason: string }) =>
      `Worktree cleanup is blocked by ${reason}: ${worktreeId}`,
    why: 'Cleanup requires verified ownership, no session references, and stopped processes.',
    fix: 'Resolve the reported owner or release the checkout for manual cleanup.',
  },
  PROJECT_HAS_WORKTREES: {
    status: 409,
    message: ({ projectId }: { projectId: string }) => `Project still owns worktrees: ${projectId}`,
    why: 'Deleting the project would hide managed checkout ownership.',
    fix: 'Clean up or explicitly release its Platform worktrees first.',
  },
})
