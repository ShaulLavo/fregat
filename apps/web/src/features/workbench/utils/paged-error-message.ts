import { PagedSourceError, PagedSourceInvalidatedError } from '@singapore-editor/paged'
import { isObject } from '@workspace/utils/objects'
import { rpcErrorPayload } from '@workspace/client-core/transport/rpc-error'
import { clientErrorMessage } from '@/lib/client-error-taxonomy'

export function pagedErrorMessage(error: unknown) {
  const payload = rpcErrorPayload(error)
  const code = isObject(payload) ? payload.code : undefined
  if (error instanceof PagedSourceInvalidatedError || code === 'FILE_CHANGED')
    return 'This file version is no longer available. Reopen it to read the current version.'
  if (error instanceof PagedSourceError) return error.message
  return clientErrorMessage(error)
}
