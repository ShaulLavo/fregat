import { defineErrorCatalog } from 'evlog'

/**
 * Checkpoint diff failures the client has to branch on. They used to be
 * untyped prose, which forced the browser retry policy to substring-match the
 * message — a rewording silently turned a permanent failure into a retry loop.
 */
export const checkpointErrors = defineErrorCatalog('checkpoint', {
  HUNK_CONFLICT: {
    status: 409,
    message: ({ path }: { path: string }) =>
      `The change to ${path} no longer matches the file, so it cannot be undone on its own`,
    why: 'The lines this change touched were edited again after the turn, by the agent or by hand.',
    fix: 'Open the file and edit it directly, or rewind the whole turn.',
  },
  HUNK_NOT_FOUND: {
    status: 404,
    message: ({ path }: { path: string }) => `That change to ${path} is not in this turn`,
    why: 'The turn diff no longer contains a change with this id; the page may be showing an older diff.',
    fix: 'Reload the turn changes and pick the change again.',
  },
  WORKSPACE_NOT_ISOLATED: {
    status: 409,
    message: 'File restore requires an isolated worktree.',
    why: 'Restoring this checkout could overwrite another session or the main workspace.',
    fix: 'Rewind the conversation without restoring files.',
  },
  RANGE_INVALID: {
    status: 400,
    message: ({ fromTurnCount, toTurnCount }: { fromTurnCount: number; toTurnCount: number }) =>
      `Checkpoint diff range is inverted: fromTurnCount ${fromTurnCount} is after toTurnCount ${toTurnCount}`,
    why: 'A diff range must run forwards; the caller asked for a range that ends before it starts.',
    fix: 'Send fromTurnCount less than or equal to toTurnCount. Retrying the same range cannot succeed.',
  },
  RANGE_EXCEEDS_TURN_COUNT: {
    status: 404,
    message: ({
      availableTurnCount,
      requestedTurnCount,
    }: {
      availableTurnCount: number
      requestedTurnCount: number
    }) =>
      `Checkpoint diff range exceeds current turn count: requested ${requestedTurnCount}, current ${availableTurnCount}`,
    why: 'The session has no checkpoint that far along — the turn either never completed or was reverted away.',
    fix: 'Reload the session and request a range within its current checkpoint count.',
  },
  REF_UNAVAILABLE: {
    status: 404,
    message: ({ turnCount }: { turnCount: number }) =>
      `Checkpoint ref is unavailable for turn ${turnCount}`,
    why: 'The checkpoint for this turn is missing, errored, or its git ref is gone from the workspace.',
    fix: 'Reopen the diff after the turn finishes capturing, or pick a turn whose checkpoint is ready.',
  },
})

export const sessionDomainErrors = defineErrorCatalog('orchestration', {
  APPROVAL_REQUEST_UNKNOWN: {
    status: 404,
    message: 'This approval request is unavailable.',
    why: 'The session has no record of this request.',
    fix: 'Refresh the session to see its current requests.',
  },
  APPROVAL_ALREADY_DECIDED: {
    status: 409,
    message: 'This approval was already answered with a different choice.',
    why: 'Another window or an earlier click answered it first, and an agent takes one answer per request.',
    fix: 'The first answer stands. Check the transcript for what was decided.',
  },
  APPROVAL_REQUEST_ENDED: {
    status: 410,
    message: 'This approval ended before your answer arrived.',
    why: 'The turn that asked finished, was stopped, or the server restarted, so the agent stopped waiting.',
    fix: 'Send a new message if the agent should try again.',
  },
  STEER_TURN_NOT_ACTIVE: {
    status: 409,
    message: 'The turn has finished or is waiting for a response. Your message was not sent.',
    why: 'A correction must name the currently running turn and cannot bypass a pending request.',
    fix: 'Answer the pending request or send the message as a new turn.',
  },
  SOURCE_PLAN_PROJECT_MISMATCH: {
    status: 409,
    message: 'The proposed plan belongs to another project.',
    why: 'A plan implementation must run in the project where the plan was written.',
    fix: 'Implement the plan from its own session or another checkout of the same project.',
  },
  WORKTREE_NOT_FOUND: {
    status: 404,
    message: ({ worktreeId }: { worktreeId: string }) => `Worktree not found: ${worktreeId}`,
    why: 'Sessions and terminal processes require a registered, live checkout.',
    fix: 'Register the checkout before starting a session.',
  },
  IDENTITY_COLLISION: {
    status: 409,
    message: ({ id }: { id: string }) => `Repository or checkout identity collision: ${id}`,
    why: 'A deterministic identifier is already assigned to different registration facts.',
    fix: 'Inspect the existing registration and repository identity before retrying.',
  },
  WORKTREE_PATH_TAKEN: {
    status: 409,
    message: ({ worktreeId }: { worktreeId: string }) =>
      `Checkout is already registered: ${worktreeId}`,
    why: 'One canonical checkout path cannot belong to two live worktree registrations.',
    fix: 'Use the existing checkout registration.',
  },
  PROVIDER_INSTANCE_IMMUTABLE: {
    status: 409,
    message: ({ sessionId }: { sessionId: string }) =>
      `Session provider cannot change: ${sessionId}`,
    why: 'A durable session belongs to one provider instance and account.',
    fix: 'Create another session to use a different provider instance.',
  },
  SESSION_REPARENT_CONFLICT: {
    status: 409,
    message: ({ sessionId }: { sessionId: string }) =>
      `Session checkout cannot change: ${sessionId}`,
    why: 'Discovered metadata names a different checkout for an existing session UUID.',
    fix: 'Verify the discovery directory and existing worktree registration.',
  },
  START_STATE_CONFLICT: {
    status: 409,
    message: ({ sessionId }: { sessionId: string }) => `Provider start changed: ${sessionId}`,
    why: 'The observed turn generation or start sequence no longer matches the durable state.',
    fix: 'Read the current turn and retry its permitted transition.',
  },
  REGISTRATION_BUSY: {
    status: 409,
    message: ({ projectId }: { projectId: string }) =>
      `Project still has provider ownership: ${projectId}`,
    why: 'A deleted session has not completed provider stop or still has a live adapter.',
    fix: 'Finish session cleanup before reviving the project or checkout.',
  },
  REPOSITORY_IDENTITY_UNAVAILABLE: {
    status: 409,
    message: 'Git repository has no machine-independent identity',
    why: 'The checkout has neither a supported origin remote nor a reachable root commit.',
    fix: 'Configure an origin remote or create the initial commit, then register again.',
  },
  COMMAND_ID_COLLISION: {
    status: 409,
    message: ({ commandId }: { commandId: string }) => `Command ID was reused: ${commandId}`,
    why: 'The durable receipt belongs to a different command type or wire intent.',
    fix: 'Reuse the original intent for a retry, or create a new command ID.',
  },
  CLEANUP_FAILED: {
    status: 503,
    message: ({ sessionId }: { sessionId: string }) =>
      `Session cleanup needs a retry: ${sessionId}`,
    why: 'The provider stop or attachment cleanup failed or exceeded its operation timeout.',
    fix: 'Retry cleanup after resolving the reported provider or filesystem failure.',
  },
})
