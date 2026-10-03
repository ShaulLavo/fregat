import { defineErrorCatalog } from 'evlog'
import { createClientError } from '@workspace/client-core/errors'

const errors = defineErrorCatalog('settings', {
  SHORTCUT_METADATA_UNAVAILABLE: {
    status: 503,
    message: 'The preset report could not be loaded',
    why: 'The browser could not load the preset inventory file.',
    fix: 'Check your connection and reload the app to load the preset report.',
  },
})

export function shortcutMetadataError(cause: unknown) {
  const { code, status, message, why, fix } = errors.SHORTCUT_METADATA_UNAVAILABLE
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
