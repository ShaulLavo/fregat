import { defineErrorCatalog } from 'evlog'

export const updateErrors = defineErrorCatalog('update', {
  NO_UPDATE_STAGED: {
    status: 409,
    message: 'No update is staged.',
    why: 'Restart switches the server to a waiting update, and no deploy has prepared one.',
    fix: 'Stage a release with bun run deploy --server, then restart.',
  },
  STAGED_RELEASE_CHANGED: {
    status: 409,
    message: 'The waiting update changed while the restart was pending.',
    why: 'A newer deploy replaced the update after you asked to restart.',
    fix: 'Review the new update, then restart again.',
  },
  LIVE_CHECK_FAILED: {
    status: 500,
    message: 'Deployment check failed',
    why: 'The deployment verification found a failure while checking the served app.',
    fix: 'Review the failed check in the deployment report and retry the check.',
  },
})
