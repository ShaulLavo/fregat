import type {
  LanguageServerDiagnosticsFreshness,
  LanguageServerStatus,
} from '@singapore-editor/lsp-plugin/websocket'

export type DiagnosticsEmptyState = 'clean' | 'loading' | 'unavailable' | 'silent' | 'rechecking'

/**
 * What an empty Problems list means. Only an answer for the current text reads as clean; a server
 * that has said nothing is `silent`, not pending, because a push-only server may never publish.
 */
export function diagnosticsEmptyState(
  status: LanguageServerStatus,
  freshness: LanguageServerDiagnosticsFreshness | undefined,
  servers: { failed: number; pending: number },
): DiagnosticsEmptyState {
  if (status === 'idle') return 'clean'
  // One server's clean answer says nothing about a server that failed or has not answered yet.
  if (status === 'error' || freshness === 'unavailable' || servers.failed > 0) return 'unavailable'
  if (status === 'loading' || freshness === 'awaiting' || servers.pending > 0) return 'loading'
  if (freshness === 'refreshing') return 'rechecking'
  if (freshness === 'current') return 'clean'
  return 'silent'
}
