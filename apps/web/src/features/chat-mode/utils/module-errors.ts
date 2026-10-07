import { defineErrorCatalog } from 'evlog'
import { createClientError } from '@workspace/client-core/errors'

const errors = defineErrorCatalog('chat-mode', {
  MODULE_UNAVAILABLE: {
    status: 503,
    message: 'The chat workspace could not be loaded',
    why: 'The browser request for the chat workspace code failed.',
    fix: 'Check your connection and reload the app to open the chat workspace.',
  },
})

export function surfaceModuleError(cause: unknown) {
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
