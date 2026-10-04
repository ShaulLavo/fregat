import { log } from '@/lib/client-logging'
import { LspRequestCancelledError } from '@singapore-editor/lsp'

export function reportRequestError(event: {
  readonly error: unknown
  readonly method: string
  readonly serverId: string
}) {
  if (event.error instanceof LspRequestCancelledError) {
    log.debug({ action: 'lsp.request_cancelled', area: 'lsp', ...event })
    return
  }
  log.error({ action: 'lsp.request_failed', area: 'lsp', ...event })
}
