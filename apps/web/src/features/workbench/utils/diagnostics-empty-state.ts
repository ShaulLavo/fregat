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
): DiagnosticsEmptyState {
  if (status === 'idle') return 'clean'
  if (status === 'loading' || freshness === 'awaiting') return 'loading'
  if (status === 'error' || freshness === 'unavailable') return 'unavailable'
  if (freshness === 'refreshing') return 'rechecking'
  if (freshness === 'current') return 'clean'
  return 'silent'
}
