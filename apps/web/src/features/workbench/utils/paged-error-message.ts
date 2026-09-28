import { isObject } from '@workspace/utils/objects'
import { rpcErrorPayload } from '@workspace/client-core/transport/rpc-error'
import { clientErrorMessage } from '@/lib/client-error-taxonomy'

export function pagedErrorMessage(error: unknown) {
  const payload = rpcErrorPayload(error)
  const code = isObject(payload) ? payload.code : undefined
  if (code === 'PAGED_ENCODING_UNSUPPORTED')
    return 'This read-only viewer supports UTF-8 files. This file uses UTF-16.'
  // Changed files and expired sessions both arrive as a stale paged document.
  if (
    code === 'FILE_CHANGED' ||
    code === 'PAGED_DOCUMENT_STALE' ||
    code === 'PAGED_DOCUMENT_INVALID'
  )
    return 'This file version is no longer available. Reopen it to read the current version.'
  return clientErrorMessage(error)
}
