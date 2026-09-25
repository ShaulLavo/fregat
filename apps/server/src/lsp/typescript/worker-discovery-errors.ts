import { EvlogError } from 'evlog'
import * as v from 'valibot'
import { lspErrors } from '../../observability/structured-errors'

const factories = {
  'lsp.PROGRAM_LIST_FAILED': lspErrors.PROGRAM_LIST_FAILED,
  'lsp.PROGRAM_LIST_LIMIT': lspErrors.PROGRAM_LIST_LIMIT,
  'lsp.PROGRAM_NO_PROJECT': lspErrors.PROGRAM_NO_PROJECT,
  'lsp.PROGRAM_TSCONFIG_OUTSIDE_ROOT': lspErrors.PROGRAM_TSCONFIG_OUTSIDE_ROOT,
}
const failureSchema = v.object({
  code: v.picklist([
    'lsp.PROGRAM_LIST_FAILED',
    'lsp.PROGRAM_LIST_LIMIT',
    'lsp.PROGRAM_NO_PROJECT',
    'lsp.PROGRAM_TSCONFIG_OUTSIDE_ROOT',
  ]),
  internal: v.optional(v.record(v.string(), v.unknown())),
})

export function serializeDiscoveryError(error: unknown): string {
  if (EvlogError.isEvlogError(error))
    return JSON.stringify({ code: error.code, internal: error.internal })
  return JSON.stringify({ code: 'lsp.PROGRAM_LIST_FAILED', internal: { reason: String(error) } })
}

export function discoveryProcessError(stderr: string, context: { root: string; document: string }) {
  const failure = parseFailure(stderr)
  if (!failure) return lspErrors.PROGRAM_LIST_FAILED({ internal: { ...context, reason: stderr } })
  return factories[failure.code]({ internal: { ...context, ...failure.internal } })
}

function parseFailure(stderr: string) {
  try {
    const result = v.safeParse(failureSchema, JSON.parse(stderr))
    return result.success ? result.output : null
  } catch {
    return null
  }
}
