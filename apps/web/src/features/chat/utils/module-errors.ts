import { defineErrorCatalog } from 'evlog'
import { createClientError } from '@workspace/client-core/errors'

const errors = defineErrorCatalog('chat', {
  MODULE_UNAVAILABLE: {
    status: 503,
    message: 'The chat panel could not be loaded',
    why: 'The browser request for the chat panel code failed.',
    fix: 'Check your connection and reload the app to open the chat panel.',
  },
})

export function sidePanelModuleError(cause: unknown) {
  const { code, status, message, why, fix } = errors.MODULE_UNAVAILABLE
  return createClientError({
    code,
    status,
    message,
    why,
    fix,
    cause,
    internal: { phase: 'import', causeType: typeof cause },
  })
}
