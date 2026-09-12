import {
  type ClientOrchestrationCommand,
  type SessionId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReplayEventsInput,
} from '@workspace/contracts'
import { recordProcessInfo, recordProcessWarning, type OperationContext } from '../observability'

import type {
  ProviderRuntimeEvent,
  ProviderTurnControlInput,
  ProviderTurnInput,
} from '../provider/types'
import type { ProviderRuntimeBindingWithMetadata } from '../provider/provider-session-directory'

type ChatPipelineContext = Record<string, unknown>

/**
 * Result of the attachment write-through at command ingest. It rides on the
 * command summary rather than its own log line: a silently dropped image has to
 * be visible on the same wide event that reports `attachmentCount`.
 */
export type CommandAttachmentIngest = {
  readonly bytesPersisted: number
  readonly dropReasons: readonly string[]
  readonly dropped: number
  readonly persisted: number
}

export function recordChatPipelineInfo(action: string, context: ChatPipelineContext = {}) {
  recordProcessInfo(action, chatPipelineContext(context))
}

export function recordChatPipelineWarning(action: string, context: ChatPipelineContext = {}) {
  recordProcessWarning(action, chatPipelineContext(context))
}

export function chatOperationContext(
  operation: string,
  context: ChatPipelineContext = {},
): OperationContext {
  return {
    area: 'chat',
    operation,
    pipeline: 'chat',
    ...context,
  }
}

export function orchestrationCommandSummary(
  command: OrchestrationCommand | ClientOrchestrationCommand,
  attachmentIngest?: CommandAttachmentIngest,
) {
  const summary: ChatPipelineContext = {
    commandId: command.commandId,
    commandType: command.type,
  }

  if ('sessionId' in command) summary.sessionId = command.sessionId
  if ('projectId' in command) summary.projectId = command.projectId
  if ('turnId' in command) summary.turnId = command.turnId

  if (command.type === 'session.turn.start') {
    summary.attachmentCount = command.message.attachments.length
    summary.bootstrapCreateSession = Boolean(command.bootstrap?.createSession)
    summary.interactionMode = command.interactionMode
    summary.messageId = command.message.messageId
    summary.model = command.modelSelection?.model
    summary.providerInstanceId = command.modelSelection?.providerInstanceId
    summary.worktreeId = command.bootstrap?.createSession?.worktreeTarget.worktreeId
    summary.runtimeMode = command.runtimeMode
    summary.textLength = command.message.text.length
  }

  if (!attachmentIngest) return summary

  summary.attachmentBytesPersisted = attachmentIngest.bytesPersisted
  summary.attachmentsDropped = attachmentIngest.dropped
  summary.attachmentsPersisted = attachmentIngest.persisted
  if (attachmentIngest.dropReasons.length > 0) {
    summary.attachmentDropReasons = attachmentIngest.dropReasons
  }

  return summary
}

export function orchestrationEventSummary(event: OrchestrationEvent) {
  return {
    actorKind: event.actorKind,
    aggregateId: event.aggregateId,
    aggregateKind: event.aggregateKind,
    commandId: event.commandId,
    eventId: event.eventId,
    eventType: event.type,
    sequence: event.sequence,
    sessionId: sessionIdFromEvent(event),
    ...eventPayloadSummary(event),
  }
}

export function orchestrationEventBatchSummary(events: readonly OrchestrationEvent[]) {
  return {
    eventCount: events.length,
    eventTypes: events.map((event) => event.type),
    maxSequence: events.at(-1)?.sequence ?? null,
    sequences: events.map((event) => event.sequence),
    sessionIds: uniqueValues(sessionIdsFromEvents(events)),
  }
}

export function orchestrationReplaySummary(input: OrchestrationReplayEventsInput) {
  return {
    afterSequence: input.afterSequence,
    aggregateId: input.aggregateId,
    aggregateKind: input.aggregateKind,
    sessionId: input.sessionId,
  }
}

export function providerRuntimeEventSummary(event: ProviderRuntimeEvent) {
  const summary: ChatPipelineContext = {
    eventId: event.eventId,
    eventType: event.type,
    sessionId: event.sessionId,
  }

  if ('turnId' in event) summary.turnId = event.turnId
  if ('providerRefs' in event) Object.assign(summary, event.providerRefs)
  if ('agent' in event && event.agent) {
    summary.agentThreadId = event.agent.threadId
    summary.agentPath = event.agent.path
    summary.agentStatus = event.agent.status
  }
  if ('providerInstanceId' in event) summary.providerInstanceId = event.providerInstanceId

  if (event.type === 'runtime.set') {
    summary.activeTurnId = event.turnId
    summary.providerBindingHandle = event.providerBindingHandle
    summary.runtimeMode = event.runtimeMode
    summary.sessionStatus = event.status
  }
  if (event.type === 'assistant.delta') {
    summary.deltaLength = event.delta.length
    summary.messageId = event.messageId
  }
  if (event.type === 'assistant.complete') {
    summary.messageId = event.messageId
  }
  if (event.type === 'activity.append') {
    summary.activityKind = event.kind
    summary.tone = event.tone
  }
  if (event.type === 'proposed-plan.upsert') {
    summary.planId = event.planId
    summary.planLength = event.planMarkdown.length
  }

  return summary
}

export function providerTurnSummary(input: ProviderTurnInput) {
  return {
    attachmentCount: input.attachments.length,
    interactionMode: input.interactionMode,
    model: input.modelSelection.model,
    providerInstanceId: input.providerInstanceId,
    runtimeMode: input.runtimeMode,
    textLength: input.messageText.length,
    sessionId: input.sessionId,
    turnId: input.turnId,
  }
}

export function providerTurnControlSummary(input: ProviderTurnControlInput) {
  return {
    sessionId: input.sessionId,
    turnId: input.turnId,
  }
}

export function providerBindingSummary(binding: ProviderRuntimeBindingWithMetadata | null) {
  if (!binding) return { binding: null }

  return {
    adapterKey: binding.adapterKey,
    providerDriverKind: binding.providerDriverKind,
    providerInstanceId: binding.providerInstanceId,
    providerBindingHandle: binding.providerBindingHandle,
    runtimeMode: binding.runtimeMode,
    sessionId: binding.sessionId,
  }
}

function chatPipelineContext(context: ChatPipelineContext) {
  return {
    area: 'chat',
    pipeline: 'chat',
    ...context,
    ...('error' in context ? { error: serializableError(context.error) } : {}),
  }
}

/**
 * `Error` own properties are non-enumerable, so a raw error placed on a log
 * field serializes to `{}` and the failure becomes invisible in `logs/*.jsonl`.
 * Every field a caller needs to diagnose a provider launch failure has to be
 * lifted onto a plain object here.
 */
function serializableError(value: unknown): unknown {
  if (!(value instanceof Error)) return value

  const cause = value.cause
  return {
    message: value.message,
    name: value.name,
    ...errorField(value, 'code'),
    ...errorField(value, 'status'),
    ...errorField(value, 'why'),
    ...errorField(value, 'fix'),
    ...(value.stack ? { stack: value.stack.split('\n').slice(0, 6).join('\n') } : {}),
    ...(cause === undefined ? {} : { cause: serializableError(cause) }),
  }
}

function errorField(error: Error, key: string) {
  const value = (error as unknown as Record<string, unknown>)[key]
  if (value === undefined) return {}

  return { [key]: value }
}

function eventPayloadSummary(event: OrchestrationEvent): ChatPipelineContext {
  if (event.type === 'session.message-sent') {
    return {
      messageId: event.payload.messageId,
      messageRole: event.payload.role,
      streaming: event.payload.streaming,
      textLength: event.payload.text.length,
      turnId: event.payload.turnId,
    }
  }
  if (event.type === 'session.turn-start-requested') {
    return {
      messageId: event.payload.messageId,
      turnId: event.payload.turnId,
    }
  }
  if (event.type === 'session.runtime-set') {
    return {
      activeTurnId: event.payload.runtime.activeTurnId,
      providerInstanceId: event.payload.runtime.providerInstanceId,
      providerBindingHandle: event.payload.runtime.providerBindingHandle,
      sessionStatus: event.payload.runtime.status,
    }
  }
  if (event.type === 'session.activity-appended') {
    return {
      activityId: event.payload.activity.id,
      activityKind: event.payload.activity.kind,
      tone: event.payload.activity.tone,
      turnId: event.payload.activity.turnId,
    }
  }

  return {}
}

function sessionIdFromEvent(event: OrchestrationEvent): SessionId | undefined {
  if ('sessionId' in event.payload) return event.payload.sessionId
  if (event.aggregateKind === 'session') return event.aggregateId as SessionId

  return undefined
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values))
}

function sessionIdsFromEvents(events: readonly OrchestrationEvent[]) {
  const sessionIds: string[] = []

  for (const event of events) {
    const sessionId = sessionIdFromEvent(event)
    if (!sessionId) continue

    sessionIds.push(sessionId)
  }

  return sessionIds
}
