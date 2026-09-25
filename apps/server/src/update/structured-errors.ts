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
    message: ({ release }: { release: string }) => `${release} failed its live check`,
    why: 'The headless check of the page through the mesh found a failure the previous release did not have.',
    fix: 'Run bun run deploy --rollback from the checkout that deployed it.',
  },
})
