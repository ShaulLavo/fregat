import { toClientError } from '@/lib/client-error-taxonomy'
import { toastError } from '@/lib/toast-error'

/** Only a backend that died carries an error; one this app closed says nothing. */
export function notifyServerExit(serverId: string, params: unknown) {
  const error = toClientError(params)
  if (!error.code) return

  toastError(
    error.message,
    { id: `language-server-exit:${serverId}`, description: error.fix },
    error,
  )
}
