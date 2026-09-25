import { defineErrorCatalog } from 'evlog'

export const chatErrors = defineErrorCatalog('chat', {
  PROJECTION_SYNC_FAILED: {
    status: 503,
    message: 'Your response was accepted. Session updates are unavailable.',
    why: 'The connection could not refresh the session after the response.',
    fix: 'Reconnect to refresh the request status.',
  },
})
