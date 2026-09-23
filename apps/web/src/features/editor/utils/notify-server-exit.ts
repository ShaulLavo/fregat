import { toast } from 'sonner'

import { toClientError } from '@/lib/client-error-taxonomy'

/** Only a backend that died carries an error; one this app closed says nothing. */
export function notifyServerExit(serverId: string, params: unknown) {
  const error = toClientError(params)
  if (!error.code) return

  toast.error(error.message, { id: `language-server-exit:${serverId}`, description: error.fix })
}
