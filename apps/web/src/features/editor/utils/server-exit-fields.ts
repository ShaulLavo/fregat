import { LspServerExitedError } from '@singapore-editor/lsp'

/** What the exit notice before a close said. `exitOutcome`, so an event keeps its own `outcome`. */
export function serverExitFields(error: unknown) {
  if (!(error instanceof LspServerExitedError)) return {}

  const { exitCode, exitSignal, outcome } = error.params
  return {
    exitCode,
    exitOutcome: outcome,
    exitSignal,
    serverFailed: error.params.error !== undefined,
  }
}
