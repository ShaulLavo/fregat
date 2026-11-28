import { defineErrorCatalog } from 'evlog'

export const worktreeRuntimeErrors = defineErrorCatalog('worktree', {
  UNAVAILABLE: {
    status: 409,
    message: 'This worktree cannot be used for that right now.',
    why: 'The worktree folder is missing, belongs to another repository, or is not ready yet.',
    fix: 'Refresh the worktree list, fix the worktree it shows, then try again.',
  },
  NOT_GIT: {
    status: 409,
    message: 'This workspace does not support new Git worktrees.',
    why: 'The project is a directory without a Git repository.',
    fix: 'Send to the project folder itself, or run git init there first.',
  },
  RECONFIRM: {
    status: 409,
    message: 'The worktree changed after the preview.',
    why: 'The files or Git state of the worktree changed since the preview was made.',
    fix: 'Refresh the preview, check it, and confirm again.',
  },
  ACTIVE: {
    status: 409,
    message: 'Something is still running in this worktree.',
    why: 'An agent or terminal in it has not stopped yet.',
    fix: 'Stop the agent or terminal and try again, or let go of the worktree and remove it yourself.',
  },
})
