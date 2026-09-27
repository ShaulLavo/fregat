import { defineErrorCatalog } from 'evlog'

export const updateErrors = defineErrorCatalog('update', {
  NO_UPDATE_STAGED: {
    status: 409,
    message: 'No update is staged.',
    why: 'Restart switches the server to a staged release, and no deploy has staged one.',
    fix: 'Stage a release with bun run deploy --server, then restart.',
  },
  STAGED_RELEASE_CHANGED: {
    status: 409,
    message: 'The staged release changed while the restart was waiting.',
    why: 'A deploy staged a different release after the restart was requested.',
    fix: 'Review the new update, then restart again.',
  },
  LIVE_CHECK_FAILED: {
    status: 500,
    message: 'Deployment check failed',
    why: 'The deployment verification found a failure while checking the served app.',
    fix: 'Review the failed check in the deployment report and retry the check.',
  },
})
