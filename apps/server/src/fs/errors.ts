import { isRecord } from '@workspace/contracts'
import { EvlogError } from 'evlog'

export type FsErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN_ORIGIN'
  | 'PATH_OUTSIDE_WORKSPACE'
  | 'GIT_COMMAND_FAILED'
  | 'GIT_REPOSITORY_NOT_FOUND'
  | 'NOT_FOUND'
  | 'WORKSPACE_ADDRESS_NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'FILE_CHANGED'
  | 'INVALID_PATH'
  | 'NOT_A_FILE'
  | 'NOT_A_DIRECTORY'
  | 'FILE_TOO_LARGE'
  | 'FILE_IS_BINARY'
  | 'LOSSY_WRITE_BLOCKED'
  | 'WORKSPACE_EDIT_INVALID'
  | 'WORKSPACE_EDIT_STALE'
  | 'WORKSPACE_EDIT_BUSY'
  | 'WORKSPACE_EDIT_NOT_FOUND'
  | 'WORKSPACE_EDIT_DEVICE_UNSUPPORTED'
  | 'WORKSPACE_EDIT_QUOTA'
  | 'WORKSPACE_EDIT_PARTIAL'
  | 'OPERATION_FAILED'

const redactedDiagnosticValue = '[redacted]'
const sensitiveCauseFields = new Set([
  'absolutePath',
  'cwd',
  'dest',
  'destination',
  'fileName',
  'filename',
  'path',
])

const statusByCode: Record<FsErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN_ORIGIN: 403,
  PATH_OUTSIDE_WORKSPACE: 403,
  GIT_COMMAND_FAILED: 500,
  GIT_REPOSITORY_NOT_FOUND: 404,
  NOT_FOUND: 404,
  WORKSPACE_ADDRESS_NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  FILE_CHANGED: 409,
  INVALID_PATH: 400,
  NOT_A_FILE: 400,
  NOT_A_DIRECTORY: 400,
  FILE_TOO_LARGE: 413,
  FILE_IS_BINARY: 415,
  LOSSY_WRITE_BLOCKED: 409,
  WORKSPACE_EDIT_INVALID: 400,
  WORKSPACE_EDIT_STALE: 409,
  WORKSPACE_EDIT_BUSY: 409,
  WORKSPACE_EDIT_NOT_FOUND: 404,
  WORKSPACE_EDIT_DEVICE_UNSUPPORTED: 409,
  WORKSPACE_EDIT_QUOTA: 507,
  WORKSPACE_EDIT_PARTIAL: 409,
  OPERATION_FAILED: 500,
}

const messageByCode: Record<FsErrorCode, string> = {
  UNAUTHORIZED: 'request is not from a trusted local app origin',
  FORBIDDEN_ORIGIN: 'origin is not allowed',
  PATH_OUTSIDE_WORKSPACE: 'path is outside the workspace',
  GIT_COMMAND_FAILED: 'git command failed',
  GIT_REPOSITORY_NOT_FOUND: 'git repository not found',
  NOT_FOUND: 'file not found',
  WORKSPACE_ADDRESS_NOT_FOUND: 'workspace address was not found',
  ALREADY_EXISTS: 'target already exists',
  FILE_CHANGED: 'file changed on disk',
  INVALID_PATH: 'invalid path',
  NOT_A_FILE: 'path is not a file',
  NOT_A_DIRECTORY: 'path is not a directory',
  FILE_TOO_LARGE: 'file is too large',
  FILE_IS_BINARY: 'file seems to be binary and was not decoded as text',
  LOSSY_WRITE_BLOCKED: 'refusing to overwrite a file whose bytes do not round-trip as UTF-8 text',
  WORKSPACE_EDIT_INVALID: 'workspace edit is invalid',
  WORKSPACE_EDIT_STALE: 'workspace edit state is stale',
  WORKSPACE_EDIT_BUSY: 'workspace is busy with another mutation',
  WORKSPACE_EDIT_NOT_FOUND: 'workspace edit was not found',
  WORKSPACE_EDIT_DEVICE_UNSUPPORTED: 'workspace edit resource paths are on unsupported devices',
  WORKSPACE_EDIT_QUOTA: 'workspace edit journal quota exceeded',
  WORKSPACE_EDIT_PARTIAL: 'workspace edit requires recovery',
  OPERATION_FAILED: 'filesystem operation failed',
}

export class FsError extends EvlogError {
  declare readonly code: FsErrorCode

  constructor(code: FsErrorCode, message = messageByCode[code], cause?: unknown) {
    super({
      cause: sanitizeCause(cause) as Error | undefined,
      code,
      internal: cause === undefined ? undefined : { cause: sanitizeCause(cause) },
      message,
      status: statusByCode[code],
    })
    this.name = 'FsError'
  }
}

export function isFsError(error: unknown): error is FsError {
  return error instanceof FsError
}

export function mapNodeError(error: unknown): FsError {
  const code = nodeErrorCode(error)

  if (code === 'ENOENT') return new FsError('NOT_FOUND', undefined, error)
  if (code === 'EEXIST') return new FsError('ALREADY_EXISTS', undefined, error)
  if (code === 'ENOTDIR') return new FsError('NOT_A_DIRECTORY', undefined, error)
  if (code === 'EISDIR') return new FsError('NOT_A_FILE', undefined, error)

  return new FsError('OPERATION_FAILED', undefined, error)
}

export function errorPayload(error: FsError) {
  return {
    error: {
      code: error.code,
      message: error.message,
    },
  }
}

export function nodeErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return null
  if (!('code' in error)) return null

  const code = error.code
  return typeof code === 'string' ? code : null
}

function sanitizeCause(cause: unknown, seen = new WeakSet<object>()): unknown {
  if (cause === undefined) return undefined
  if (cause instanceof Error) return sanitizeCauseError(cause, seen)
  if (Array.isArray(cause)) return cause.map((value) => sanitizeCause(value, seen))
  if (!isRecord(cause)) return cause
  if (seen.has(cause)) return '[circular]'

  seen.add(cause)
  return sanitizeCauseRecord(cause, seen)
}

function sanitizeCauseError(error: Error, seen: WeakSet<object>) {
  if (seen.has(error)) return '[circular]'

  seen.add(error)
  const summary: Record<string, unknown> = {
    message: sanitizeCauseMessage(error.message),
    name: error.name,
  }
  copyCauseFields(error, summary, seen)

  return summary
}

function sanitizeCauseRecord(record: Record<string, unknown>, seen: WeakSet<object>) {
  const safe: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(record)) {
    safe[key] = sensitiveCauseFields.has(key) ? redactedDiagnosticValue : sanitizeCause(value, seen)
  }

  return safe
}

function copyCauseFields(source: Error, target: Record<string, unknown>, seen: WeakSet<object>) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = sensitiveCauseFields.has(key)
      ? redactedDiagnosticValue
      : sanitizeCause(value, seen)
  }
}

function sanitizeCauseMessage(message: string) {
  return message.replaceAll(/'[^']*'/g, `'${redactedDiagnosticValue}'`)
}
