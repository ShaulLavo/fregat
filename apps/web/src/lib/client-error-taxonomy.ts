import { isConnectivityError } from '@workspace/client-core/transport/connectivity-error'
import { toast } from 'sonner'
import type { ErrorCategory } from '@workspace/contracts'
import { clientErrorMetadata } from './client-error-context'
import { reportClientError } from './client-error-reporting'

export type { ErrorCategory }

export type ClientError = {
  readonly category: ErrorCategory
  readonly message: string
  readonly cause?: unknown
  readonly context?: Readonly<Record<string, unknown>>
  readonly operation?: string
}

const messagesByCategory: Record<ErrorCategory, string> = {
  not_found: 'The requested file or folder could not be found.',
  permission_denied: 'You do not have permission to access that path.',
  not_a_file: 'That path is a directory, not a file.',
  not_a_directory: 'That path is a file, not a directory.',
  too_large: 'The file is larger than the workspace size limit.',
  binary_file: 'The file appears to be binary.',
  lossy_write: 'Saving would rewrite bytes this file never showed you, so the write was refused.',
  invalid_path: 'The path is invalid or conflicts with an existing entry.',
  io_error: 'The file server could not complete the filesystem operation.',
  connectivity: 'Could not reach the server.',
  unknown: 'Something unexpected went wrong.',
}

type FsErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN_ORIGIN'
  | 'PATH_OUTSIDE_WORKSPACE'
  | 'GIT_COMMAND_FAILED'
  | 'GIT_REPOSITORY_NOT_FOUND'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'FILE_CHANGED'
  | 'INVALID_PATH'
  | 'NOT_A_FILE'
  | 'NOT_A_DIRECTORY'
  | 'FILE_TOO_LARGE'
  | 'FILE_IS_BINARY'
  | 'LOSSY_WRITE_BLOCKED'
  | 'OPERATION_FAILED'
  | 'WATCH_FAILED'

const categoryByFsErrorCode: Record<FsErrorCode, ErrorCategory> = {
  NOT_FOUND: 'not_found',
  PATH_OUTSIDE_WORKSPACE: 'permission_denied',
  UNAUTHORIZED: 'permission_denied',
  FORBIDDEN_ORIGIN: 'permission_denied',
  NOT_A_FILE: 'not_a_file',
  NOT_A_DIRECTORY: 'not_a_directory',
  FILE_TOO_LARGE: 'too_large',
  FILE_IS_BINARY: 'binary_file',
  LOSSY_WRITE_BLOCKED: 'lossy_write',
  INVALID_PATH: 'invalid_path',
  ALREADY_EXISTS: 'invalid_path',
  FILE_CHANGED: 'invalid_path',
  OPERATION_FAILED: 'io_error',
  GIT_COMMAND_FAILED: 'io_error',
  GIT_REPOSITORY_NOT_FOUND: 'io_error',
  WATCH_FAILED: 'io_error',
}

export function toClientError(input: unknown): ClientError {
  if (isAbortError(input)) {
    return categorizedClientError('unknown', input)
  }

  if (isConnectivityError(input)) return categorizedClientError('connectivity', input)

  const code = extractFsErrorCode(input)
  if (code) return categorizedClientError(categoryByFsErrorCode[code], input)

  // Structured errors from any non-fs catalog — settings, orchestration — carry
  // their own message, `why` and `fix`. Falling through to `unknown` here is
  // what made every rejected settings save silent: `notifySaveError` returns
  // before its toast on `unknown`, so the user saw nothing at all.
  const structured = structuredErrorMessage(input)
  if (structured) return categorizedClientError('io_error', input, structured)

  return categorizedClientError('unknown', input)
}

export function clientErrorMessage(input: unknown): string {
  return toClientError(input).message
}

export function reportError(error: ClientError): void {
  if (isAbortError(error.cause)) return

  if (!clientErrorMetadata(error.cause)) {
    reportClientError({
      area: 'client-error-taxonomy',
      category: error.category,
      cause: error.cause,
      context: error.context,
      message: error.message,
      operation: error.operation ?? 'report',
    })
  }

  if (!shouldToastCategory(error.category)) return

  toast.error(titleByCategory[error.category], {
    description: error.message,
  })
}

const toastableCategories: ReadonlySet<ErrorCategory> = new Set<ErrorCategory>([
  'not_found',
  'permission_denied',
  'too_large',
  'invalid_path',
  'io_error',
  'lossy_write',
])

function shouldToastCategory(category: ErrorCategory): boolean {
  return toastableCategories.has(category)
}

const titleByCategory: Record<ErrorCategory, string> = {
  not_found: 'File not found',
  permission_denied: 'Access denied',
  not_a_file: 'Not a file',
  not_a_directory: 'Not a folder',
  too_large: 'File too large',
  binary_file: 'Binary file',
  lossy_write: 'Save refused',
  invalid_path: 'Invalid path',
  io_error: 'Filesystem error',
  connectivity: 'Connection failed',
  unknown: 'Unexpected error',
}

function categorizedClientError(
  category: ErrorCategory,
  cause: unknown,
  message = messagesByCategory[category],
): ClientError {
  const metadata = clientErrorMetadata(cause)

  return {
    category,
    cause,
    context: metadata?.context,
    message,
    operation: metadata?.operation,
  }
}

function isAbortError(input: unknown): boolean {
  if (input instanceof DOMException) return input.name === 'AbortError'
  if (input instanceof Error && input.name === 'AbortError') return true
  return false
}

function extractFsErrorCode(input: unknown): FsErrorCode | null {
  if (!input || typeof input !== 'object') return null

  if ('value' in input) {
    const code = fsErrorCodeFromErrorContainer((input as { value: unknown }).value)
    if (code) return code
  }

  const direct = fsErrorCodeFromErrorContainer(input)
  if (direct) return direct

  if ('code' in input) {
    const raw = (input as { code: unknown }).code
    if (isFsErrorCode(raw)) return raw
  }

  return null
}

function fsErrorCodeFromErrorContainer(value: unknown): FsErrorCode | null {
  if (!value || typeof value !== 'object') return null
  if (!('error' in value)) return null

  const error = (value as { error: unknown }).error
  if (!error || typeof error !== 'object') return null
  if (!('code' in error)) return null

  const code = (error as { code: unknown }).code
  return isFsErrorCode(code) ? code : null
}

function isFsErrorCode(value: unknown): value is FsErrorCode {
  return typeof value === 'string' && value in categoryByFsErrorCode
}

/**
 * Pulls the server's own message out of a structured error envelope.
 *
 * Deliberately message-first rather than code-mapped: a catalog entry already
 * phrases the failure for a person, and re-deriving a generic sentence from its
 * code would throw away the `fix` the server took care to write.
 */
function structuredErrorMessage(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null

  const container = 'value' in input ? (input as { value: unknown }).value : input
  if (!container || typeof container !== 'object') return null

  const error = 'error' in container ? (container as { error: unknown }).error : container
  if (!error || typeof error !== 'object') return null
  if (!('code' in error) || typeof (error as { code: unknown }).code !== 'string') return null

  const message = 'message' in error ? (error as { message: unknown }).message : null

  return typeof message === 'string' && message.length > 0 ? message : null
}
