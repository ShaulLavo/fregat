import { LspServerExitedError } from '@singapore-editor/lsp'

import { toClientError } from '@/lib/client-error-taxonomy'
import { toastError } from '@/lib/toast-error'

/** Only a backend that died carries guidance; one this app closed, or a lost socket, says nothing. */
export function notifyServerExit(serverId: string, error: unknown) {
  if (!(error instanceof LspServerExitedError)) return
  const exit = toClientError(error.params)
  if (!exit.code) return

  toastError(exit.message, { id: `language-server-exit:${serverId}`, description: exit.fix }, exit)
}
