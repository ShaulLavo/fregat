import { createError, defineErrorCatalog, type ErrorOptions, type EvlogError } from 'evlog'

export type StructuredErrorOptions = Omit<ErrorOptions, 'cause'> & {
  cause?: unknown
}

export const serverErrors = defineErrorCatalog('server', {
  INTERNAL_ERROR: {
    status: 500,
    message: ({ message }: { message: string }) => message,
    why: 'The server reached a state it does not expect while handling this request.',
    fix: 'Try again. If it keeps failing, open the Logs panel to see what went wrong.',
  },
  LOOPBACK_HOST_REQUIRED: {
    status: 500,
    message: 'FS RPC server must bind to a loopback host',
    why: 'Binding the filesystem RPC server to a non-loopback host can expose local workspace access.',
    fix: 'Configure the server host as localhost, 127.0.0.1, or ::1.',
  },
})

export const orchestrationErrors = defineErrorCatalog('orchestration', {
  TERMINAL_LEASE_UNPERSISTED: {
    status: 503,
    message: ({ command, attempts }: { command: string; attempts: number }) =>
      `${command} could not be saved after ${attempts} attempts`,
    why: 'The server could not record which terminal runs this session.',
    fix: 'Check that the disk has free space and no other Platform server holds the database, then open the terminal again.',
  },
  COMMAND_PREVIOUSLY_REJECTED: {
    status: 409,
    message: ({ commandId }: { commandId: string }) =>
      `This request was already turned down: ${commandId}`,
    why: 'The server refused this same request earlier.',
    fix: 'Reload the app and try again.',
  },
  EVENT_JSON_INVALID: {
    status: 500,
    message: ({ field, sequence }: { field: string; sequence: number }) =>
      `Invalid orchestration event ${field} JSON at sequence ${sequence}`,
    why: 'A persisted orchestration event row contains malformed JSON.',
    fix: 'Inspect the stored orchestration event row and repair or remove the malformed JSON field.',
  },
  WORKSPACE_ROOT_NOT_DIRECTORY: {
    status: 409,
    message: ({ workspaceRoot }: { workspaceRoot: string }) =>
      `Workspace root is not a directory: ${workspaceRoot}`,
    why: 'A file already occupies the path the project would be rooted at.',
    fix: 'Point the project at a directory, or move the file that is in the way.',
  },
  WORKSPACE_ROOT_CREATE_FAILED: {
    status: 500,
    message: ({ workspaceRoot }: { workspaceRoot: string }) =>
      `Workspace root could not be created: ${workspaceRoot}`,
    why: 'The project asked for its workspace root to be created and the filesystem refused.',
    fix: 'Check that the parent folder exists and you can write to it, then try again.',
  },
  PROJECT_ALREADY_EXISTS: {
    status: 409,
    message: ({ projectId }: { projectId: string }) => `Project already exists: ${projectId}`,
    why: 'A project with this ID already exists.',
    fix: 'Open the existing project.',
  },
  PROJECT_NOT_EMPTY: {
    status: 409,
    message: ({ projectId, sessionCount }: { projectId: string; sessionCount: number }) =>
      `Project ${projectId} still has ${sessionCount} live session(s)`,
    why: 'Deleting a project also deletes every session in it, so the app asks first.',
    fix: 'Delete its sessions first, or confirm deleting the project together with its sessions.',
  },
  PROJECT_NOT_FOUND: {
    status: 404,
    message: ({ projectId }: { projectId: string }) => `Project not found: ${projectId}`,
    why: 'The project is missing or was deleted.',
    fix: 'Reload the app and pick a project that still exists.',
  },
  PROJECT_WORKSPACE_ROOT_TAKEN: {
    status: 409,
    message: ({ projectId, workspaceRoot }: { projectId: string; workspaceRoot: string }) =>
      `Workspace root ${workspaceRoot} already belongs to project ${projectId}`,
    why: 'Two active projects on one workspace root would fight over the same worktrees and checkpoints.',
    fix: 'Open the existing project for this workspace root, or delete it before recreating.',
  },
  SESSION_ALREADY_EXISTS: {
    status: 409,
    message: ({ sessionId }: { sessionId: string }) => `Session already exists: ${sessionId}`,
    why: 'A session with this ID already exists.',
    fix: 'Open the existing session.',
  },
  SESSION_ARCHIVED: {
    status: 409,
    message: ({ commandType, sessionId }: { commandType: string; sessionId: string }) =>
      `Session ${sessionId} is archived and cannot handle ${commandType}`,
    why: 'An archived session is put away, and working in it would bring it back without you seeing it.',
    fix: 'Unarchive the session before sending this command.',
  },
  SESSION_BRANCH_CONFLICT: {
    status: 409,
    message: ({
      actualBranch,
      expectedBranch,
      sessionId,
    }: {
      actualBranch: string | null
      expectedBranch: string | null
      sessionId: string
    }) =>
      `Session ${sessionId} is on branch ${actualBranch ?? 'none'}; the update expected ${expectedBranch ?? 'none'}`,
    why: 'The session switched branches after this page last loaded it.',
    fix: 'Reload the session and make the change again.',
  },
  SESSION_NOT_ARCHIVED: {
    status: 409,
    message: ({ sessionId }: { sessionId: string }) => `Session is not archived: ${sessionId}`,
    why: 'Unarchiving only applies to a session that is currently archived.',
    fix: 'Reload the app. The session is already active.',
  },
  SESSION_NOT_FOUND: {
    status: 404,
    message: ({ sessionId }: { sessionId: string }) => `Session not found: ${sessionId}`,
    why: 'The session is missing or was deleted.',
    fix: 'Reload the app and pick a session that still exists.',
  },
  SOURCE_PLAN_NOT_ACTIONABLE: {
    status: 409,
    message: ({ planSessionId }: { planSessionId: string }) =>
      `Session ${planSessionId} has no actionable proposed plan to implement`,
    why: 'The plan this turn points to cannot be carried out any more: it was already carried out, it was rewound, or this page shows an old copy.',
    fix: 'Reload the session and start the turn from the plan the timeline currently shows.',
  },
})

export const providerErrors = defineErrorCatalog('provider', {
  INSTANCE_NOT_FOUND: {
    status: 404,
    message: ({ providerInstanceId }: { providerInstanceId: string }) =>
      `Provider instance not found: ${providerInstanceId}`,
    why: 'This provider is not set up on the server.',
    fix: 'Reload the provider list and pick a provider from it.',
  },
  LOGIN_ATTEMPT_NOT_FOUND: {
    status: 404,
    message: ({ attemptId }: { attemptId: string }) => `Login attempt not found: ${attemptId}`,
    why: 'A newer sign-in replaced it, or the server restarted.',
    fix: 'Start the sign-in again.',
  },
  SIGN_IN_UNSUPPORTED: {
    status: 400,
    message: ({ providerInstanceId }: { providerInstanceId: string }) =>
      `Provider does not support in-app sign-in: ${providerInstanceId}`,
    why: 'This provider cannot sign in from the app.',
    fix: 'Sign in with the provider’s own command line.',
  },
})

export const lspErrors = defineErrorCatalog('lsp', {
  PACKAGE_INSTALL_FAILED: {
    status: 500,
    message: ({ packageName }: { packageName: string }) => `Failed to install ${packageName}`,
    why: 'The installer for this language server failed.',
    fix: 'Try the install again. If it keeps failing, open the Logs panel to see the installer output.',
  },
  SERVER_EXITED: {
    status: 502,
    message: ({ serverId }: { serverId: string }) => `The ${serverId} language server stopped`,
    why: 'The language server process exited or failed while the editor was connected to it.',
    fix: 'Run the language server from a terminal to see why it exits, then reopen the file.',
  },
  WATCHED_FILES_REGISTRATION_INVALID: {
    status: 400,
    message: 'The language server asked to watch files in a form this client does not read',
    why: 'A workspace/didChangeWatchedFiles registration had no watchers or an unsupported glob pattern.',
    fix: 'Report the language server and its version; changes it asked to watch will not reach it.',
  },
})

export function createInternalError(message: string, cause?: unknown) {
  return createStructuredError({
    cause,
    code: serverErrors.INTERNAL_ERROR.code,
    fix: serverErrors.INTERNAL_ERROR.fix,
    message,
    status: serverErrors.INTERNAL_ERROR.status,
    why: serverErrors.INTERNAL_ERROR.why,
  })
}

export function createStructuredError(options: StructuredErrorOptions) {
  const { cause, internal, ...rest } = options
  const safeInternal = mergedInternal(internal, cause)

  return createError({
    ...rest,
    ...(cause instanceof Error ? { cause } : {}),
    ...(safeInternal ? { internal: safeInternal } : {}),
  })
}

export function isEvlogError(error: unknown): error is EvlogError {
  return error instanceof Error && error.name === 'EvlogError'
}

function mergedInternal(internal: Record<string, unknown> | undefined, cause: unknown) {
  if (cause === undefined || cause instanceof Error) return internal

  return {
    ...internal,
    cause,
  }
}
