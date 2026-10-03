import { nodeErrorCode } from '@workspace/contracts'
import {
  redactedDiagnosticValue,
  sanitizeErrorMessage as sanitizeCauseMessage,
  sensitiveErrorFields,
} from '../observability/sanitize-message'
import { isRecord } from '@workspace/utils/objects'
import { EvlogError } from 'evlog'

export type FsErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN_ORIGIN'
  | 'DEVICE_NOT_PAIRED'
  | 'PATH_OUTSIDE_WORKSPACE'
  | 'GIT_COMMAND_FAILED'
  | 'GIT_REPOSITORY_NOT_FOUND'
  | 'NOT_FOUND'
  | 'ROUTE_NOT_FOUND'
  | 'WORKSPACE_ADDRESS_NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'FILE_CHANGED'
  | 'INVALID_PATH'
  | 'NOT_A_FILE'
  | 'NOT_A_DIRECTORY'
  | 'PERMISSION_DENIED'
  | 'FILE_TOO_LARGE'
  | 'READ_SESSION_EXPIRED'
  | 'READ_SESSION_LIMIT'
  | 'READ_RANGE_INVALID'
  | 'FILE_IS_BINARY'
  | 'LOSSY_WRITE_BLOCKED'
  | 'WORKSPACE_EDIT_INVALID'
  | 'WORKSPACE_EDIT_STALE'
  | 'WORKSPACE_EDIT_BUSY'
  | 'WORKSPACE_EDIT_NOT_FOUND'
  | 'WORKSPACE_EDIT_DEVICE_UNSUPPORTED'
  | 'WORKSPACE_EDIT_QUOTA'
  | 'WORKSPACE_EDIT_PARTIAL'
  | 'WORKSPACE_EDIT_TARGET_OCCUPIED'
  | 'WORKSPACE_EDIT_NOT_HEAD'
  | 'OPERATION_FAILED'

const statusByCode: Record<FsErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN_ORIGIN: 403,
  DEVICE_NOT_PAIRED: 401,
  PATH_OUTSIDE_WORKSPACE: 403,
  GIT_COMMAND_FAILED: 500,
  GIT_REPOSITORY_NOT_FOUND: 404,
  NOT_FOUND: 404,
  ROUTE_NOT_FOUND: 404,
  WORKSPACE_ADDRESS_NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  FILE_CHANGED: 409,
  INVALID_PATH: 400,
  NOT_A_FILE: 400,
  NOT_A_DIRECTORY: 400,
  PERMISSION_DENIED: 403,
  FILE_TOO_LARGE: 413,
  READ_SESSION_EXPIRED: 410,
  READ_SESSION_LIMIT: 429,
  READ_RANGE_INVALID: 416,
  FILE_IS_BINARY: 415,
  LOSSY_WRITE_BLOCKED: 409,
  WORKSPACE_EDIT_INVALID: 400,
  WORKSPACE_EDIT_STALE: 409,
  WORKSPACE_EDIT_BUSY: 409,
  WORKSPACE_EDIT_NOT_FOUND: 404,
  WORKSPACE_EDIT_DEVICE_UNSUPPORTED: 409,
  WORKSPACE_EDIT_QUOTA: 507,
  WORKSPACE_EDIT_PARTIAL: 409,
  WORKSPACE_EDIT_TARGET_OCCUPIED: 409,
  WORKSPACE_EDIT_NOT_HEAD: 409,
  OPERATION_FAILED: 500,
}

type FsErrorCopy = { readonly message: string; readonly why: string; readonly fix: string }

const copyByCode: Record<FsErrorCode, FsErrorCopy> = {
  UNAUTHORIZED: {
    message: 'This app could not connect to the machine.',
    why: 'The machine could not verify that this request came from a trusted app.',
    fix: 'Open Fregat from this machine or reconnect it through Connect machine.',
  },
  FORBIDDEN_ORIGIN: {
    message: 'This app address cannot access the machine.',
    why: 'The machine accepts requests from its configured app addresses.',
    fix: 'Open Fregat at the address supplied by this machine.',
  },
  DEVICE_NOT_PAIRED: {
    message: 'Connect this device to the machine.',
    why: 'The machine requires device pairing before granting access.',
    fix: 'Open Connect machine and pair this device.',
  },
  PATH_OUTSIDE_WORKSPACE: {
    message: 'This path is outside the open workspace.',
    why: 'File operations are limited to the workspace folder.',
    fix: 'Open the folder containing this item and try again.',
  },
  GIT_COMMAND_FAILED: {
    message: 'The Git operation failed.',
    why: 'Git could not complete the requested operation.',
    fix: 'Open the Logs panel for the Git error, resolve it, then try again.',
  },
  GIT_REPOSITORY_NOT_FOUND: {
    message: 'This folder has no Git repository.',
    why: 'Git needs a repository to show history and changes.',
    fix: 'Open a folder containing a Git repository, or initialize one in this folder.',
  },
  NOT_FOUND: {
    message: 'The file or folder could not be found.',
    why: 'The requested item is missing from this machine.',
    fix: 'Refresh the folder. If the item was moved or renamed, open it from its current location.',
  },
  ROUTE_NOT_FOUND: {
    message: 'The machine could not handle this request.',
    why: 'The requested operation is unavailable on this server.',
    fix: 'Reload the app. If it keeps failing, update the app and server together.',
  },
  WORKSPACE_ADDRESS_NOT_FOUND: {
    message: 'This workspace link is unavailable.',
    why: 'This machine has no saved workspace for this link.',
    fix: 'Choose a folder on this machine to open the workspace.',
  },
  ALREADY_EXISTS: {
    message: 'An item with this name already exists.',
    why: 'The destination is already occupied by a file or folder.',
    fix: 'Choose another name or destination and try again.',
  },
  FILE_CHANGED: {
    message: 'The file changed on disk.',
    why: 'Another program or window saved the file after it was opened.',
    fix: 'Compare your changes with the file on disk before saving again.',
  },
  INVALID_PATH: {
    message: 'This file or folder path is invalid.',
    why: 'The path does not meet the requirements for this operation.',
    fix: 'Choose the item through the folder picker or check the path and try again.',
  },
  NOT_A_FILE: {
    message: 'This operation requires a file.',
    why: 'The selected path points to another kind of item.',
    fix: 'Select a file and try again.',
  },
  NOT_A_DIRECTORY: {
    message: 'This operation requires a folder.',
    why: 'The selected path points to another kind of item.',
    fix: 'Select a folder and try again.',
  },
  PERMISSION_DENIED: {
    message: 'Access to this file or folder was denied.',
    why: 'The account running Fregat on this machine needs permission to read or change the item.',
    fix: 'Grant that account access, or choose a folder it can read.',
  },
  FILE_TOO_LARGE: {
    message: 'The file exceeds the size limit for this operation.',
    why: 'This operation has a limit on the amount of file data it can process.',
    fix: 'Choose a smaller file or open this file in an app that supports its size.',
  },
  READ_SESSION_EXPIRED: {
    message: 'The file reading session expired.',
    why: 'The machine released the session used to read this file.',
    fix: 'Close and reopen the file to start a new reading session.',
  },
  READ_SESSION_LIMIT: {
    message: 'The machine is busy reading other files.',
    why: 'All available file reading sessions are in use.',
    fix: 'Close an unused file tab, wait a moment, then reopen this file.',
  },
  READ_RANGE_INVALID: {
    message: 'This part of the file could not be read.',
    why: 'The requested range falls outside the available file data.',
    fix: 'Close and reopen the file to read its current contents.',
  },
  FILE_IS_BINARY: {
    message: 'This file contains binary data.',
    why: 'The text editor requires a file that can be decoded as text.',
    fix: 'Open the file in an app that supports its format.',
  },
  LOSSY_WRITE_BLOCKED: {
    message: 'Saving would change the file encoding.',
    why: 'Some original bytes cannot be preserved when saving this file as UTF-8 text.',
    fix: 'Save a copy, or edit the original in an app that supports its encoding.',
  },
  WORKSPACE_EDIT_INVALID: {
    message: 'The file operation could not be applied.',
    why: 'The requested changes do not form a valid workspace edit.',
    fix: 'Refresh the folder and start the operation again.',
  },
  WORKSPACE_EDIT_STALE: {
    message: 'The files changed before the operation finished.',
    why: 'The operation was prepared against an earlier state of the workspace.',
    fix: 'Refresh the folder, review the current files, then try again.',
  },
  WORKSPACE_EDIT_BUSY: {
    message: 'Another file operation is still running.',
    why: 'Workspace changes run one operation at a time.',
    fix: 'Wait for the current operation to finish, then try again.',
  },
  WORKSPACE_EDIT_NOT_FOUND: {
    message: 'This file operation is unavailable.',
    why: 'Its saved operation record could not be found.',
    fix: 'Refresh the file history and select an available operation.',
  },
  WORKSPACE_EDIT_DEVICE_UNSUPPORTED: {
    message: 'These files are on an unsupported device.',
    why: 'The workspace history requires storage that supports the requested file changes.',
    fix: 'Move the workspace to local storage and try again.',
  },
  WORKSPACE_EDIT_QUOTA: {
    message: 'The file history storage limit was reached.',
    why: 'The workspace cannot store another recoverable file operation.',
    fix: 'Wait for older undo history to expire before retrying the operation.',
  },
  WORKSPACE_EDIT_PARTIAL: {
    message: 'The file operation needs recovery.',
    why: 'Only part of the requested changes completed.',
    fix: 'Review the file history and recover the operation before making more changes.',
  },
  WORKSPACE_EDIT_TARGET_OCCUPIED: {
    message: 'An item is blocking the file restore.',
    why: 'A file or folder now occupies a path the operation needs to restore.',
    fix: 'Move or rename the item at the destination, then retry the restore.',
  },
  WORKSPACE_EDIT_NOT_HEAD: {
    message: 'A newer file operation must be handled first.',
    why: 'File history is undone or redone in order.',
    fix: 'Undo or redo the newest available operation first.',
  },
  OPERATION_FAILED: {
    message: 'The file operation could not be completed.',
    why: 'The machine encountered an error while working with the file or folder.',
    fix: 'Try again. If it keeps failing, open the Logs panel for details.',
  },
}

/** Runtime facts and user guidance an FsError carries beyond its code and message. */
export type FsErrorDetails = {
  readonly fix?: string
  readonly internal?: Record<string, unknown>
  readonly why?: string
}

export class FsError extends EvlogError {
  declare readonly code: FsErrorCode

  constructor(
    code: FsErrorCode,
    message = copyByCode[code].message,
    cause?: unknown,
    details: FsErrorDetails = {},
  ) {
    super({
      cause: sanitizeCause(cause) as Error | undefined,
      code,
      fix: details.fix ?? copyByCode[code].fix,
      internal: errorInternal(cause, details.internal),
      message,
      status: statusByCode[code],
      why: details.why ?? copyByCode[code].why,
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
  if (code === 'EACCES' || code === 'EPERM')
    return new FsError('PERMISSION_DENIED', undefined, error)

  return new FsError('OPERATION_FAILED', undefined, error)
}

export function errorPayload(error: FsError) {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.why === undefined ? {} : { why: error.why }),
      ...(error.fix === undefined ? {} : { fix: error.fix }),
    },
  }
}

function errorInternal(cause: unknown, internal: Record<string, unknown> | undefined) {
  if (cause === undefined) return internal
  return { ...internal, cause: sanitizeCause(cause) }
}

// Stays off the shared observability sanitizer, which keeps the quoted substrings this strips.
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
    safe[key] = sensitiveErrorFields.has(key) ? redactedDiagnosticValue : sanitizeCause(value, seen)
  }

  return safe
}

function copyCauseFields(source: Error, target: Record<string, unknown>, seen: WeakSet<object>) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = sensitiveErrorFields.has(key)
      ? redactedDiagnosticValue
      : sanitizeCause(value, seen)
  }
}
