import { defineErrorCatalog } from 'evlog'
import { createClientError } from '@workspace/client-core/errors'
import { rpcErrorPayload } from '@workspace/client-core/transport/rpc-error'

import { toClientError } from './client-error-taxonomy'

export const clientErrors = defineErrorCatalog('client', {
  BINARY_TEXT_UNAVAILABLE: {
    status: 415,
    message: 'This file contains binary data.',
    why: 'Text editing and line viewing require a text file.',
    fix: 'Open the file tab to view its size and type.',
  },
  BOOT_FAILED: {
    status: 500,
    message: 'App could not start',
    why: 'Application startup failed before the interface was ready.',
    fix: 'Reload the app to try again.',
  },
  CLIENT_INVARIANT_ERROR: {
    status: 500,
    message: ({ message }: { message: string }) => message,
    why: 'The app reached a state it does not expect while handling this action.',
    fix: 'Reload the app and try again.',
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
    why: 'Part of the screen loaded without the app data it needs.',
    fix: 'Reload the app and try again.',
  },
  CURRENT_PATH_NOT_FOLDER: {
    status: 400,
    message: 'The current path is not a folder.',
    why: 'The file picker can only list the contents of a folder.',
    fix: 'Pick a folder that exists.',
  },
  CHAT_DRAFT_UNAVAILABLE: {
    status: 409,
    message: 'The chat draft could not be opened.',
    why: 'The destination workspace became unavailable or navigation was superseded.',
    fix: 'Open the workspace and try Fix with AI again.',
  },
  DIAGNOSTIC_CHANGED: {
    status: 409,
    message: ({ path }: { path: string }) => `The problem in ${path} no longer matches the file`,
    why: 'The file changed after the language server reported this problem, so its lines point elsewhere now.',
    fix: 'Wait for the Problems list to refresh, then try Fix with AI again.',
  },
  DIFF_LANGUAGE_REQUEST_FAILED: {
    status: 502,
    message: ({ method }: { method: string }) =>
      `The language server could not answer ${method} for this diff`,
    why: 'The language server returned an error for a request from this diff.',
    fix: 'Wait for the language server to recover, then try again.',
  },
  DIFF_LANGUAGE_SESSION_CLOSED: {
    status: 502,
    message: 'The diff lost its connection to the language server',
    why: 'The connection closed before the language server answered.',
    fix: 'Close and reopen the diff.',
  },
  DOCUMENT_SYMBOL_ABORTED: {
    status: 499,
    message: 'Listing the symbols in this file was cancelled',
    why: 'The request was cancelled before the language server answered.',
    fix: 'Try again while the file is open.',
  },
  DOCUMENT_SYMBOL_FAILED: {
    status: 502,
    message: 'Could not list the symbols in this file',
    why: 'The language server returned an error.',
    fix: 'Wait for the language server to recover, then try again.',
  },
  DOCUMENT_SYMBOL_SOCKET_CLOSED: {
    status: 502,
    message: 'Could not list the symbols in this file',
    why: 'The connection to the language server closed before it answered.',
    fix: 'Try again once the connection is back.',
  },
  DOCUMENT_SYMBOL_SOCKET_FAILED: {
    status: 502,
    message: 'Could not list the symbols in this file',
    why: 'The connection to the language server failed.',
    fix: 'Try again once the connection is back.',
  },
  FONT_LOAD_FAILED: {
    status: 502,
    message: ({ ref }: { ref: string }) => `Font ${ref} did not load`,
    why: 'The server could not deliver the font, or the browser rejected the file.',
    fix: 'Check the connection to the server or pick another font. Text uses the built-in font until then.',
  },
  INVALID_OPTION: {
    status: 500,
    message: ({ message }: { message: string }) => message,
    why: 'Part of the screen received a value it does not support.',
    fix: 'Reload the app and try again.',
  },
  RPC_FAILED: {
    status: 502,
    message: 'The server request failed.',
    why: 'The server answered with an error.',
    fix: 'Try again. If it keeps failing, open the Logs panel to see what went wrong.',
  },
  SCREEN_STREAM_LOAD_FAILED: {
    status: 400,
    message: 'The screen capture did not load',
    why: 'The browser could not play the captured screen.',
    fix: 'Try the capture again and allow screen sharing when the browser asks.',
  },
  WATCH_FAILED: {
    status: 502,
    message: ({ status }: { status: number | string | undefined }) =>
      status === undefined
        ? 'Could not start watching files for changes.'
        : `Could not start watching files for changes (status ${status})`,
    why: 'The server did not start watching these files, so changes on disk may not show up.',
    fix: 'Try again. If it keeps failing, open the Logs panel to see what went wrong.',
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

export function createBootError(cause: unknown) {
  return createClientError({
    code: clientErrors.BOOT_FAILED.code,
    status: clientErrors.BOOT_FAILED.status,
    message: clientErrors.BOOT_FAILED.message,
    why: clientErrors.BOOT_FAILED.why,
    fix: clientErrors.BOOT_FAILED.fix,
    cause,
    internal: { phase: 'startup', causeType: typeof cause },
  })
}

export function createBinaryFileError(size: number) {
  return createClientError({
    code: clientErrors.BINARY_TEXT_UNAVAILABLE.code,
    status: clientErrors.BINARY_TEXT_UNAVAILABLE.status,
    message: clientErrors.BINARY_TEXT_UNAVAILABLE.message,
    why: clientErrors.BINARY_TEXT_UNAVAILABLE.why,
    fix: clientErrors.BINARY_TEXT_UNAVAILABLE.fix,
    internal: { size, seemsBinary: true },
  })
}
