import { defineErrorCatalog } from 'evlog'

export const worktreeLifecycleErrors = defineErrorCatalog('worktree', {
  SETUP_RUNNING: {
    status: 409,
    message: ({ worktreeId }: { worktreeId: string }) => `Setup is already running: ${worktreeId}`,
    why: 'One setup run per worktree at a time; a second would race the first over the same files.',
    fix: 'Wait for it to finish or stop it, then run it again.',
  },
  SETUP_NOT_RUNNING: {
    status: 409,
    message: ({ worktreeId }: { worktreeId: string }) => `No setup is running: ${worktreeId}`,
    why: 'The setup already finished or was never started.',
    fix: 'Nothing to stop.',
  },
  SETUP_NOT_CONFIGURED: {
    status: 409,
    message: ({ worktreeId }: { worktreeId: string }) =>
      `The project has no setup script: ${worktreeId}`,
    why: 'No saved project script is marked to run when a worktree is created.',
    fix: 'Import the project scripts from t3.json, or save a script that runs on worktree creation.',
  },
  NOT_READY: {
    status: 409,
    message: ({ worktreeId }: { worktreeId: string }) => `Worktree is not ready: ${worktreeId}`,
    why: 'The worktree is still being created, removed or set up.',
    fix: 'Wait for that to finish, then try again.',
  },
  UNSUPPORTED_REPOSITORY: {
    status: 409,
    message: ({ worktreeId }: { worktreeId: string }) => `New worktrees require Git: ${worktreeId}`,
    why: 'This project is a plain folder with no Git commit to branch from.',
    fix: 'Work in the project folder itself.',
  },
  DUPLICATE_ID: {
    status: 409,
    message: ({ worktreeId }: { worktreeId: string }) =>
      `Worktree ID or path already exists: ${worktreeId}`,
    why: 'A new worktree needs an ID and folder no other worktree uses.',
    fix: 'Use the existing worktree, or create the new one again.',
  },
  INVALID_PREPARATION: {
    status: 409,
    message: ({ worktreeId }: { worktreeId: string }) =>
      `The worktree request no longer matches the repository: ${worktreeId}`,
    why: 'The repository changed after the request was prepared, or it points somewhere else.',
    fix: 'Refresh, then try again.',
  },
  STALE_RESULT: {
    status: 409,
    message: ({ worktreeId }: { worktreeId: string }) =>
      `The worktree changed while this action ran: ${worktreeId}`,
    why: 'Something else changed the worktree after this action started.',
    fix: 'Refresh to see the worktree as it is now, then try again.',
  },
  NOT_RETRYABLE: {
    status: 409,
    message: ({ worktreeId }: { worktreeId: string }) =>
      `That action is not available for this worktree now: ${worktreeId}`,
    why: 'The worktree is in a state where this action does not apply.',
    fix: 'Pick one of the actions the worktree offers now.',
  },
  CLEANUP_INELIGIBLE: {
    status: 409,
    message: ({ worktreeId, reason }: { worktreeId: string; reason: string }) =>
      `Worktree cleanup is blocked by ${reason}: ${worktreeId}`,
    why: 'Fregat removes a worktree only when it created it, no session uses it, and nothing runs in it.',
    fix: 'Deal with what the message names, or let go of the worktree and remove it yourself.',
  },
  PROJECT_HAS_WORKTREES: {
    status: 409,
    message: ({ projectId }: { projectId: string }) =>
      `The project still has worktrees: ${projectId}`,
    why: 'Deleting the project would leave its worktrees behind with nothing tracking them.',
    fix: 'Remove its worktrees first, or let go of them so they stay on disk.',
  },
})
