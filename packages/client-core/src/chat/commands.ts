import { createProjectRegistrationCommand } from './registration'
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  commandIdSchema,
  messageIdSchema,
  sessionIdSchema,
  turnIdSchema,
  type ApprovalRequestId,
  type CommandId,
  type ChatAttachment,
  type ChatAttachmentUpload,
  type InteractionMode,
  type MessageId,
  type ModelSelection,
  type OrchestrationMessage,
  type OrchestrationProjectScript,
  type ProjectCreateCommand,
  type ProjectDeleteCommand,
  type ProjectId,
  type ProjectMetaUpdateCommand,
  type ProjectReorderCommand,
  type ProviderApprovalDecision,
  type ProviderUserInputAnswers,
  type RuntimeMode,
  type SessionApprovalRespondCommand,
  type SessionArchiveCommand,
  type SessionCheckpointRevertCommand,
  type SessionDeleteCommand,
  type SessionId,
  type SessionWorktreeTarget,
  type SessionInteractionModeSetCommand,
  type SessionMetaUpdateCommand,
  type SessionPinCommand,
  type SessionPinReorderCommand,
  type SessionRuntimeModeSetCommand,
  type SessionRuntimeStopCommand,
  type SessionTurnInterruptCommand,
  type SessionTurnStartCommand,
  type SessionTurnSteerCommand,
  type SessionUnarchiveCommand,
  type SessionUserInputRespondCommand,
  type UserInputAttachmentUploads,
  type SessionUserInputDismissCommand,
  type TurnId,
} from '@workspace/contracts'
import * as v from 'valibot'

import { workspacePathLeaf } from '@workspace/client-core/files/path'

import { appendTerminalContextsToPrompt, type TerminalContextSelection } from './terminal-context'

const NO_TERMINAL_CONTEXTS: readonly TerminalContextSelection[] = []
const SESSION_TITLE_MAX_LENGTH = 48
const SENSITIVE_SESSION_TITLE_WORDS = new Set([
  'apikey',
  'bearer',
  'credential',
  'credentials',
  'keystore',
  'oauth',
  'passwd',
  'password',
  'passwords',
  'pat',
  'secret',
  'secrets',
  'token',
  'tokens',
])
const SENSITIVE_SESSION_TITLE_COMPOUNDS = ['accesskey', 'apikey', 'privatekey'] as const

/**
 * The plan an implementation turn came from. The server stamps that plan
 * implemented when the turn starts, which is what stops every surface offering
 * "Implement" a second time.
 */
export type SourceProposedPlanReference = NonNullable<SessionTurnStartCommand['sourceProposedPlan']>

export type ChatTurnSubmission = {
  command: SessionTurnStartCommand
  optimisticMessage: OrchestrationMessage
}

export type DraftSessionSubmission = {
  command: SessionTurnStartCommand
  optimisticMessage: OrchestrationMessage
}

export function createWorkspaceProjectCommand({
  rootPath,
}: {
  rootPath: string
}): ProjectCreateCommand {
  return createProjectRegistrationCommand({
    workspaceRoot: rootPath,
    title: workspaceProjectTitle(rootPath),
  })
}

export function createTurnSubmission({
  attachments = [],
  createdAt,
  interactionMode,
  modelSelection,
  runtimeMode,
  sourceProposedPlan,
  terminalContexts = NO_TERMINAL_CONTEXTS,
  text,
  sessionId,
}: {
  attachments?: ChatAttachmentUpload[]
  createdAt: string
  interactionMode: InteractionMode
  modelSelection: ModelSelection
  runtimeMode: RuntimeMode
  sourceProposedPlan?: SourceProposedPlanReference
  terminalContexts?: readonly TerminalContextSelection[]
  text: string
  sessionId: SessionId
}): ChatTurnSubmission {
  const commandId = createCommandId()
  const messageId = createMessageId()
  const turnId = createTurnId()
  // The serialized block is appended here rather than in the composer so the
  // title keeps reading the typed text: a send that is nothing but captured
  // output would otherwise name the session `<terminal_context>`.
  const prompt = appendTerminalContextsToPrompt(text, terminalContexts)

  return {
    command: {
      commandId,
      interactionMode,
      message: {
        attachments,
        messageId,
        role: 'user',
        text: prompt,
      },
      modelSelection,
      runtimeMode,
      sourceProposedPlan,
      sessionId,
      titleSeed: sessionTitleFromPrompt(text),
      turnId,
      type: 'session.turn.start',
    },
    optimisticMessage: {
      // Metadata only: the base64 bytes belong on the wire, not in the
      // projection the timeline renders from.
      attachments: attachments.map(chatAttachmentMetadata),
      createdAt,
      id: messageId,
      role: 'user',
      streaming: false,
      text: prompt,
      sessionId,
      turnId,
      updatedAt: createdAt,
    },
  }
}

export function createSteerSubmission({
  turnId,
  ...input
}: Parameters<typeof createTurnSubmission>[0] & { turnId: TurnId }): {
  command: SessionTurnSteerCommand
  optimisticMessage: OrchestrationMessage
} {
  const submission = createTurnSubmission(input)
  return {
    command: {
      commandId: submission.command.commandId,
      type: 'session.turn.steer',
      sessionId: input.sessionId,
      turnId,
      message: submission.command.message,
    },
    optimisticMessage: { ...submission.optimisticMessage, turnId },
  }
}

export function createDraftSessionSubmission({
  attachments = [],
  createdAt,
  interactionMode = DEFAULT_INTERACTION_MODE,
  modelSelection,
  worktreeTarget,
  runtimeMode = DEFAULT_RUNTIME_MODE,
  sourceProposedPlan,
  terminalContexts = NO_TERMINAL_CONTEXTS,
  text,
  title: titleOverride,
}: {
  attachments?: ChatAttachmentUpload[]
  createdAt: string
  interactionMode?: InteractionMode
  modelSelection: ModelSelection
  worktreeTarget: SessionWorktreeTarget
  runtimeMode?: RuntimeMode
  sourceProposedPlan?: SourceProposedPlanReference
  terminalContexts?: readonly TerminalContextSelection[]
  text: string
  /**
   * Overrides the title derived from the prompt. A turn the user did not type —
   * a plan handed to a new session — would otherwise be named after the
   * instruction that carries it.
   */
  title?: string
}): DraftSessionSubmission {
  const sessionId = createSessionId()
  const title = titleOverride ?? sessionTitleFromPrompt(text) ?? 'New chat'
  const submission = createTurnSubmission({
    attachments,
    createdAt,
    interactionMode,
    modelSelection,
    runtimeMode,
    sourceProposedPlan,
    terminalContexts,
    text,
    sessionId,
  })

  return {
    command: {
      ...submission.command,
      bootstrap: {
        createSession: {
          interactionMode,
          modelSelection,
          worktreeTarget,
          runtimeMode,
          title,
        },
      },
      titleSeed: title,
    },
    optimisticMessage: submission.optimisticMessage,
  }
}

export function createSessionInterruptCommand({
  sessionId,
  turnId,
}: {
  sessionId: SessionId
  turnId?: TurnId
}): SessionTurnInterruptCommand {
  return {
    commandId: createCommandId(),
    sessionId,
    turnId,
    type: 'session.turn.interrupt',
  }
}

export function createSessionRuntimeStopCommand({
  sessionId,
}: {
  sessionId: SessionId
}): SessionRuntimeStopCommand {
  return {
    commandId: createCommandId(),
    sessionId,
    type: 'session.runtime.stop',
  }
}

/**
 * Sets only the title. Every other field is deliberately omitted so the
 * projection's compact patch leaves the model, branch, and worktree alone.
 * The title must already be trimmed and non-empty — the server rejects blanks.
 */
export function createSessionRenameCommand({
  sessionId,
  title,
}: {
  sessionId: SessionId
  title: string
}): SessionMetaUpdateCommand {
  return {
    commandId: createCommandId(),
    sessionId,
    title,
    type: 'session.meta.update',
  }
}

export function createSessionRegenerateTitleCommand(
  sessionId: SessionId,
): SessionMetaUpdateCommand {
  return {
    type: 'session.meta.update',
    commandId: createCommandId(),
    sessionId,
    regenerateTitle: true,
  }
}

export function createSessionArchiveCommand({
  sessionId,
}: {
  sessionId: SessionId
}): SessionArchiveCommand {
  return {
    commandId: createCommandId(),
    sessionId,
    type: 'session.archive',
  }
}

export function createSessionUnarchiveCommand({
  sessionId,
}: {
  sessionId: SessionId
}): SessionUnarchiveCommand {
  return {
    commandId: createCommandId(),
    sessionId,
    type: 'session.unarchive',
  }
}

export function createSessionDeleteCommand({
  sessionId,
  removeWorktree,
}: {
  sessionId: SessionId
  removeWorktree?: boolean
}): SessionDeleteCommand {
  return {
    commandId: createCommandId(),
    sessionId,
    type: 'session.delete',
    ...(removeWorktree ? { removeWorktree } : {}),
  }
}

export function createApprovalRespondCommand({
  decision,
  requestId,
  sessionId,
}: {
  decision: ProviderApprovalDecision
  requestId: ApprovalRequestId
  sessionId: SessionId
}): SessionApprovalRespondCommand {
  return {
    commandId: createCommandId(),
    decision,
    requestId,
    sessionId,
    type: 'session.approval.respond',
  }
}

export function createUserInputRespondCommand({
  answers,
  attachmentsByQuestionId,
  requestId,
  sessionId,
}: {
  attachmentsByQuestionId?: UserInputAttachmentUploads
  answers: ProviderUserInputAnswers
  requestId: ApprovalRequestId
  sessionId: SessionId
}): SessionUserInputRespondCommand {
  return {
    answers,
    attachmentsByQuestionId,
    commandId: createCommandId(),
    requestId,
    sessionId,
    type: 'session.user-input.respond',
  }
}

export function createRuntimeModeSetCommand({
  runtimeMode,
  sessionId,
}: {
  runtimeMode: RuntimeMode
  sessionId: SessionId
}): SessionRuntimeModeSetCommand {
  return {
    commandId: createCommandId(),
    runtimeMode,
    sessionId,
    type: 'session.runtime-mode.set',
  }
}

export function createInteractionModeSetCommand({
  interactionMode,
  sessionId,
}: {
  interactionMode: InteractionMode
  sessionId: SessionId
}): SessionInteractionModeSetCommand {
  return {
    commandId: createCommandId(),
    interactionMode,
    sessionId,
    type: 'session.interaction-mode.set',
  }
}

export function createCheckpointRevertCommand({
  sessionId,
  turnCount,
  restoreFiles,
}: {
  sessionId: SessionId
  turnCount: number
  restoreFiles: boolean
}): SessionCheckpointRevertCommand {
  return {
    commandId: createCommandId(),
    sessionId,
    turnCount,
    restoreFiles,
    type: 'session.checkpoint.revert',
  }
}

/**
 * Updates only the project's default model. Title and workspaceRoot are deliberately
 * omitted so the projection's compact patch leaves them untouched.
 */
export function createProjectDefaultModelCommand({
  defaultModelSelection,
  projectId,
}: {
  defaultModelSelection: ModelSelection
  projectId: ProjectId
}): ProjectMetaUpdateCommand {
  return {
    commandId: createCommandId(),
    defaultModelSelection,
    projectId,
    type: 'project.meta.update',
  }
}

/**
 * Renames a project, or repoints it at a different folder.
 *
 * Both fields are optional and omitted when absent, because the projection
 * patches compactly: sending `title` alone must leave the workspace root and
 * the default model exactly as they were.
 */
export function createProjectMetaCommand({
  projectId,
  title,
}: {
  projectId: ProjectId
  title?: string
}): ProjectMetaUpdateCommand {
  return {
    commandId: createCommandId(),
    projectId,
    type: 'project.meta.update',
    ...(title === undefined ? {} : { title }),
  }
}

/**
 * Writes the project's saved scripts. The whole list every time — scripts are
 * renamed and reordered as a set, and an empty array is how the user clears
 * them, which is why the command distinguishes absent from empty.
 */
export function createProjectScriptsCommand({
  projectId,
  scripts,
}: {
  projectId: ProjectId
  scripts: readonly OrchestrationProjectScript[]
}): ProjectMetaUpdateCommand {
  return {
    commandId: createCommandId(),
    projectId,
    scripts: [...scripts],
    type: 'project.meta.update',
  }
}

/**
 * `force` is always true from the client: the confirmation dialog the caller just
 * ran is the explicit opt-in the command's guard exists to demand. The server
 * cascades the project's sessions in the same transaction.
 */
export function createProjectDeleteCommand({
  projectId,
}: {
  projectId: ProjectId
}): ProjectDeleteCommand {
  return {
    commandId: createCommandId(),
    force: true,
    projectId,
    type: 'project.delete',
  }
}

/**
 * One drag, one key, one row. The key already sorts between the drop position's
 * neighbours, so the projects either side of it are never rewritten and two
 * clients that saw the same drop converge without a shared counter.
 */
export function createProjectReorderCommand({
  orderKey,
  projectId,
}: {
  orderKey: string
  projectId: ProjectId
}): ProjectReorderCommand {
  return {
    commandId: createCommandId(),
    orderKey,
    projectId,
    type: 'project.reorder',
  }
}

/** Moves a session that already holds a slot in its project's arranged run. */
export function createSessionReorderCommand({
  orderKey,
  sessionId,
}: {
  orderKey: string
  sessionId: SessionId
}): SessionPinReorderCommand {
  return {
    commandId: createCommandId(),
    orderKey,
    sessionId,
    type: 'session.pin.reorder',
  }
}

/**
 * The first drag of a session, which is also what puts it in the arranged run:
 * the server refuses `session.pin.reorder` for a session that holds no slot yet,
 * so the same key arrives as the pin's opening position instead.
 */
export function createSessionPlaceCommand({
  orderKey,
  sessionId,
}: {
  orderKey: string
  sessionId: SessionId
}): SessionPinCommand {
  return {
    commandId: createCommandId(),
    orderKey,
    sessionId,
    type: 'session.pin',
  }
}

export function workspaceProjectTitle(rootPath: string) {
  return workspacePathLeaf(rootPath)
}

export function sessionTitleFromPrompt(prompt: string) {
  return cleanSessionTitle(prompt.split(/\r?\n/)[0])
}

function chatAttachmentMetadata(attachment: ChatAttachmentUpload): ChatAttachment {
  return {
    id: attachment.id,
    mimeType: attachment.mimeType,
    name: attachment.name,
    sizeBytes: attachment.sizeBytes,
    type: attachment.type,
  }
}

function createCommandId(): CommandId {
  return v.parse(commandIdSchema, `command-${crypto.randomUUID()}`)
}

function createSessionId(): SessionId {
  return v.parse(sessionIdSchema, crypto.randomUUID())
}

function createMessageId(): MessageId {
  return v.parse(messageIdSchema, `message-${crypto.randomUUID()}`)
}

function createTurnId(): TurnId {
  return v.parse(turnIdSchema, `turn-${crypto.randomUUID()}`)
}

function cleanSessionTitle(value: string | undefined) {
  const title = value?.trim().replaceAll(/\s+/g, ' ')
  if (!title) return undefined
  if (hasSensitiveSessionTitleWord(title)) return undefined
  if (title.length <= SESSION_TITLE_MAX_LENGTH) return title

  return `${title.slice(0, SESSION_TITLE_MAX_LENGTH - 1).trim()}…`
}

function hasSensitiveSessionTitleWord(title: string) {
  const words = title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  if (words.some((word) => SENSITIVE_SESSION_TITLE_WORDS.has(word))) return true

  const compact = words.join('')
  return SENSITIVE_SESSION_TITLE_COMPOUNDS.some((word) => compact.includes(word))
}

export function createUserInputDismissCommand(input: {
  sessionId: SessionId
  requestId: ApprovalRequestId
}): SessionUserInputDismissCommand {
  return { ...input, type: 'session.user-input.dismiss', commandId: createCommandId() }
}

export type SessionLifecycleChange =
  | { readonly type: 'settle' | 'unsettle' | 'unsnooze' | 'pin' | 'unpin' }
  | { readonly type: 'snooze'; readonly snoozedUntil: string }

export function createSessionActiveReorderCommand({
  sessionId,
  orderKey,
}: {
  readonly sessionId: SessionId
  readonly orderKey: string
}) {
  return {
    type: 'session.active.reorder' as const,
    commandId: createCommandId(),
    sessionId,
    orderKey,
  }
}

export function createSessionLifecycleCommand(
  sessionId: SessionId,
  change: SessionLifecycleChange,
): import('@workspace/contracts').ClientOrchestrationCommand {
  const commandId = createCommandId()
  switch (change.type) {
    case 'settle':
      return { type: 'session.settle', commandId, sessionId }
    case 'unsettle':
      return { type: 'session.unsettle', commandId, sessionId, reason: 'user' }
    case 'snooze':
      return { type: 'session.snooze', commandId, sessionId, snoozedUntil: change.snoozedUntil }
    case 'unsnooze':
      return { type: 'session.unsnooze', commandId, sessionId, reason: 'user' }
    case 'pin':
      return { type: 'session.pin', commandId, sessionId }
    case 'unpin':
      return { type: 'session.unpin', commandId, sessionId }
  }
}
