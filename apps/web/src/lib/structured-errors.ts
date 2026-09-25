import { defineErrorCatalog } from 'evlog'
import { createClientError } from '@workspace/client-core/errors'
import { rpcErrorPayload } from '@workspace/client-core/transport/rpc-error'

import { toClientError } from './client-error-taxonomy'

export const clientErrors = defineErrorCatalog('client', {
  CLIENT_INVARIANT_ERROR: {
    status: 500,
    message: ({ message }: { message: string }) => message,
    why: 'A client-side invariant failed while handling application state.',
    fix: 'Inspect the client state and fix the invariant at the throwing call site.',
  },
  SCREEN_CAPTURE_FAILED: {
    status: 500,
    message: 'The screenshot could not be taken.',
    why: 'The browser refused screen capture or never delivered a frame.',
    fix: 'Your browser did not allow screen capture. Attach the image as a file instead.',
  },
  CONTEXT_MISSING: {
    status: 500,
    message: ({ message }: { message: string }) => message,
    why: 'A component hook was rendered outside its required provider.',
    fix: 'Render the component under the provider named in the error message.',
  },
  CURRENT_PATH_NOT_FOLDER: {
    status: 400,
    message: 'The current path is not a folder.',
    why: 'The file picker expected a directory entry for the active path.',
    fix: 'Select an existing folder path before opening directory contents.',
  },
  DIFF_LANGUAGE_REQUEST_FAILED: {
    status: 502,
    message: ({ method }: { method: string }) => `Diff language request ${method} failed`,
    why: 'The language server returned an error for a request made from a diff view.',
    fix: 'Check the language server session for this root and retry once it recovers.',
  },
  DIFF_LANGUAGE_SESSION_CLOSED: {
    status: 502,
    message: 'Diff language session closed',
    why: 'The diff view socket closed before the language server answered.',
    fix: 'Reopen the diff to establish a new language server session.',
  },
  DOCUMENT_SYMBOL_ABORTED: {
    status: 499,
    message: 'Document symbol request aborted',
    why: 'The document symbol request was cancelled before the server responded.',
    fix: 'Retry the symbol request if the document is still open.',
  },
  DOCUMENT_SYMBOL_FAILED: {
    status: 502,
    message: 'Document symbol failed',
    why: 'The language server returned an error for the symbol request.',
    fix: 'Check the language server session and retry after it recovers.',
  },
  DOCUMENT_SYMBOL_SOCKET_CLOSED: {
    status: 502,
    message: 'Document symbol socket closed',
    why: 'The document symbol socket closed before a successful response arrived.',
    fix: 'Reconnect the language server socket and retry the request.',
  },
  DOCUMENT_SYMBOL_SOCKET_FAILED: {
    status: 502,
    message: 'Document symbol socket failed',
    why: 'The document symbol socket reported a transport failure.',
    fix: 'Reconnect the language server socket and retry the request.',
  },
  FONT_LOAD_FAILED: {
    status: 502,
    message: ({ ref }: { ref: string }) => `Font ${ref} did not load`,
    why: 'The server could not deliver the font, or the browser rejected the file.',
    fix: 'Check the connection to the server or pick another font; text stays in the bundled face meanwhile.',
  },
  INVALID_OPTION: {
    status: 500,
    message: ({ message }: { message: string }) => message,
    why: 'A component received a value outside the supported option set.',
    fix: 'Pass one of the documented component option values.',
  },
  RPC_FAILED: {
    status: 502,
    message: 'Remote procedure call failed.',
    why: 'The server returned an error response for a client RPC call.',
    fix: 'Inspect the structured RPC payload and retry once the server issue is resolved.',
  },
  SCREEN_STREAM_LOAD_FAILED: {
    status: 400,
    message: 'Failed to load screen stream',
    why: 'The browser media element could not load the captured screen stream.',
    fix: 'Retry screen capture and verify the browser has permission to share the screen.',
  },
  WATCH_FAILED: {
    status: 502,
    message: ({ status }: { status: number | string | undefined }) =>
      status === undefined
        ? 'File watcher connection failed before receiving a response.'
        : `File watcher failed with status ${status}`,
    why: 'The file watcher subscription could not be opened.',
    fix: 'Retry the watcher subscription and inspect server logs if it keeps failing.',
  },
})

export function createClientInvariantError(message: string, cause?: unknown) {
  return createClientError({
    cause,
    code: clientErrors.CLIENT_INVARIANT_ERROR.code,
    fix: clientErrors.CLIENT_INVARIANT_ERROR.fix,
    message,
    status: clientErrors.CLIENT_INVARIANT_ERROR.status,
    why: clientErrors.CLIENT_INVARIANT_ERROR.why,
  })
}

/**
 * The server catalog already answered "why" and "what do I do"; overwriting
 * them with the generic RPC pair is how a precise rejection reached the user as
 * "inspect the structured RPC payload". Keep the server's when it sent them.
 */
export function createRpcError(error: unknown) {
  const clientError = toClientError(error)
  const code = rpcErrorCode(error) ?? clientErrors.RPC_FAILED.code

  return createClientError({
    cause: error,
    code,
    message: clientError.message,
    status: statusFromRpcError(error),
    why: clientError.why ?? clientErrors.RPC_FAILED.why,
    fix: clientError.fix ?? clientErrors.RPC_FAILED.fix,
  })
}

function rpcErrorCode(error: unknown) {
  const payload = rpcErrorPayload(error)
  if (!payload || typeof payload !== 'object') return null
  if (!('code' in payload)) return null

  const code = payload.code
  return typeof code === 'string' ? code : null
}

function statusFromRpcError(error: unknown) {
  if (!error || typeof error !== 'object') return clientErrors.RPC_FAILED.status
  if (!('status' in error)) return clientErrors.RPC_FAILED.status

  const status = error.status
  return typeof status === 'number' ? status : clientErrors.RPC_FAILED.status
}
