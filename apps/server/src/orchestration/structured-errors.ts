import { defineErrorCatalog } from 'evlog'

/**
 * Checkpoint diff failures the client has to branch on. They used to be
 * untyped prose, which forced the browser retry policy to substring-match the
 * message — a rewording silently turned a permanent failure into a retry loop.
 */
export const checkpointErrors = defineErrorCatalog('checkpoint', {
  WORKSPACE_BUSY: {
    status: 409,
    message: 'The checkout is being updated.',
    why: 'A checkpoint change is being undone or reapplied.',
    fix: 'Retry after the change finishes.',
  },
  HUNK_CONFLICT: {
    status: 409,
    message: ({ action, path }: { action: 'undone' | 'reapplied'; path: string }) =>
      `The change to ${path} no longer matches the file, so it cannot be ${action} on its own`,
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
    message: 'Rewinding files needs a session with its own worktree.',
    why: 'Rewinding files in this folder could undo work from another session or the main checkout.',
    fix: 'Rewind only the conversation and leave the files as they are.',
  },
  RANGE_INVALID: {
    status: 400,
    message: ({ fromTurnCount, toTurnCount }: { fromTurnCount: number; toTurnCount: number }) =>
      `Checkpoint diff range is inverted: fromTurnCount ${fromTurnCount} is after toTurnCount ${toTurnCount}`,
    why: 'A diff range must run forwards; the caller asked for a range that ends before it starts.',
    fix: 'Reload the turn changes and try again.',
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
    why: 'The session has no checkpoint that far along: the turn never finished, or it was rewound.',
    fix: 'Reload the session and pick a turn it still shows.',
  },
  REF_UNAVAILABLE: {
    status: 404,
    message: ({ turnCount }: { turnCount: number }) =>
      `Checkpoint ref is unavailable for turn ${turnCount}`,
    why: 'The checkpoint for this turn is missing or failed to save.',
    fix: 'Wait for the turn to finish saving its checkpoint and reopen the diff, or pick another turn.',
  },
})

export const sessionDomainErrors = defineErrorCatalog('orchestration', {
  PULL_REQUEST_REFERENCE_INVALID: {
    status: 400,
    message: 'That does not name a pull request.',
    why: 'A pull request is named by its URL, its number (#123), or a forge checkout command.',
    fix: 'Paste the pull request URL or its number.',
  },
  PULL_REQUEST_OTHER_REPOSITORY: {
    status: 400,
    message: ({ repository }: { repository: string }) =>
      `That pull request belongs to ${repository}, which this checkout does not track.`,
    why: 'A pull request session starts from a checkout of the repository the pull request is in.',
    fix: 'Open that repository as a project and start the session there.',
  },
  PULL_REQUEST_WORKTREE_FAILED: {
    status: 409,
    message: ({ number }: { number: number }) =>
      `The worktree for pull request #${number} could not be created.`,
    why: 'The session started, but its worktree could not be created. The session shows why.',
    fix: 'Open the session and try creating its worktree again.',
  },
  AUTO_SETTLE_STALE: {
    status: 409,
    message: ({ sessionId }: { sessionId: string }) =>
      `Session ${sessionId} changed before automatic settlement`,
    why: 'The session received activity, a lifecycle choice or live background work after the settlement decision was made.',
    fix: 'Nothing to do; the next settlement sweep decides again from the current state.',
  },
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
  COMPACT_EMPTY: {
    status: 409,
    message: 'There is no conversation to compact yet.',
    why: 'Compaction summarises earlier turns, and this session has none.',
    fix: 'Send a message first.',
  },
  FORK_TURN_RUNNING: {
    status: 409,
    message: 'A turn still running cannot be forked.',
    why: 'A fork carries the conversation through a finished turn; this one has not finished.',
    fix: 'Wait for the turn to finish, or fork from an earlier turn.',
  },
  FORK_TURN_NOT_FOUND: {
    status: 404,
    message: 'That turn is not in the session any more.',
    why: 'The fork point names a turn the session no longer holds, usually after a rewind.',
    fix: 'Reload the session and fork from a turn the timeline shows.',
  },
  LIFECYCLE_RESTORE_UNAVAILABLE: {
    status: 409,
    message: 'The original session action is unavailable.',
    why: 'The app has no record of the session change to undo.',
    fix: 'Change the session by hand from where it is now.',
  },
  LIFECYCLE_CONFLICT: {
    status: 409,
    message: 'The session changed after this action.',
    why: 'Undo and redo only work while the session is still as that change left it.',
    fix: 'Check the session and change it by hand.',
  },
  STEER_TURN_NOT_ACTIVE: {
    status: 409,
    message: 'The turn has finished or is waiting for a response. Your message was not sent.',
    why: 'A message sent mid-turn only reaches a turn that is running and not waiting on your answer.',
    fix: 'Answer the waiting request, or send your message as a new turn.',
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
    why: 'Sessions and terminals need a folder the app has added.',
    fix: 'Add the folder as a project, then start the session.',
  },
  IDENTITY_COLLISION: {
    status: 409,
    message: ({ id }: { id: string }) =>
      `This repository or folder clashes with one already added: ${id}`,
    why: 'Its ID is already taken by a different project or folder.',
    fix: 'Reload the project list and try again. If it keeps failing, open the Logs panel to see what went wrong.',
  },
  WORKTREE_PATH_TAKEN: {
    status: 409,
    message: ({ worktreeId }: { worktreeId: string }) =>
      `This folder is already added: ${worktreeId}`,
    why: 'A folder can be added only once.',
    fix: 'Use the folder already in the list.',
  },
  PROVIDER_INSTANCE_IMMUTABLE: {
    status: 409,
    message: ({ sessionId }: { sessionId: string }) =>
      `A session cannot switch providers: ${sessionId}`,
    why: 'A session stays with the provider and account it started with.',
    fix: 'Start a new session to use another provider.',
  },
  SESSION_REPARENT_CONFLICT: {
    status: 409,
    message: ({ sessionId }: { sessionId: string }) =>
      `A session cannot move to another folder: ${sessionId}`,
    why: 'A saved session names a different folder than the one it already belongs to.',
    fix: 'Open the session from its original folder.',
  },
  START_STATE_CONFLICT: {
    status: 409,
    message: ({ sessionId }: { sessionId: string }) =>
      `The session changed while it was starting: ${sessionId}`,
    why: 'Another start or stop reached this session first.',
    fix: 'Try again.',
  },
  SERVER_RESTARTING: {
    status: 503,
    message: 'The server is restarting.',
    why: 'The server is restarting into a new version and starts no new agent work or rewinds until it is back.',
    fix: 'Wait for it to reconnect, then try again.',
  },
  REGISTRATION_BUSY: {
    status: 409,
    message: ({ projectId }: { projectId: string }) =>
      `A deleted session in this project is still stopping: ${projectId}`,
    why: 'A session you deleted is still shutting down its agent.',
    fix: 'Wait a moment, then add the project or folder again.',
  },
  REPOSITORY_IDENTITY_UNAVAILABLE: {
    status: 409,
    message: 'This repository cannot be recognised across machines',
    why: 'It has no origin remote and no first commit, so nothing identifies it the same way everywhere.',
    fix: 'Add an origin remote or make the first commit, then add the project again.',
  },
  COMMAND_ID_COLLISION: {
    status: 409,
    message: ({ commandId }: { commandId: string }) => `Command ID was reused: ${commandId}`,
    why: 'The app sent a request with an ID already used by a different request.',
    fix: 'Reload the app and try again.',
  },
  CLEANUP_FAILED: {
    status: 503,
    message: ({ sessionId }: { sessionId: string }) =>
      `The session did not finish shutting down: ${sessionId}`,
    why: 'Stopping its agent or removing its attachments failed or took too long.',
    fix: 'Try again. If it keeps failing, open the Logs panel to see what went wrong.',
  },
})
