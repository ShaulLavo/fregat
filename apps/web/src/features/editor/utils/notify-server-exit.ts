import { LspServerExitedError } from '@singapore-editor/lsp'

import { toastError } from '@/lib/toast-error'

/** Only a backend that died carries guidance; one this app closed, or a lost socket, says nothing. */
export function notifyServerExit(serverId: string, error: unknown) {
  if (!(error instanceof LspServerExitedError)) return
  const guidance = error.params.error
  if (!guidance) return

  toastError(
    guidance.message,
    { id: `language-server-exit:${serverId}`, description: guidance.fix },
    guidance,
  )
}
