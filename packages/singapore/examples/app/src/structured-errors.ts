import { defineErrorCatalog } from 'evlog'

const definitions = {
  FETCH_FAILED: {
    status: 502,
    message: 'Source download failed',
    why: 'GitHub could not supply the requested source.',
    fix: 'Select the file again to retry.',
  },
  INVALID_RESPONSE: {
    status: 502,
    message: 'GitHub source response is incomplete',
    why: 'The response must contain a commit and a complete file tree.',
    fix: 'Reload the demo to retry.',
  },
  CACHE_UNAVAILABLE: {
    status: 500,
    message: 'Source cache is unavailable',
    why: 'Browser storage could not save source files.',
    fix: 'Allow browser storage to keep downloaded files between visits.',
  },
} as const

const sourceErrors = defineErrorCatalog('demo.source', definitions)

export function createStructuredError(
  code: keyof typeof definitions,
  internal: Record<string, unknown>,
) {
  return sourceErrors[code]({ internal })
}
