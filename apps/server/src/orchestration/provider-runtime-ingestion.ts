import {
  commandIdSchema,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_USER_INPUT_ANSWER_KIND,
  eventIdSchema,
  messageIdSchema,
  proposedPlanIdSchema,
  sessionRuntimeStateSchema,
  userInputQuestionOptionSchema,
  userInputQuestionSchema,
  type InternalOrchestrationCommand,
  type OrchestrationCommand,
  type MessageId,
  type SessionRuntimeState,
  type OrchestrationSessionActivity,
  type SessionId,
  type TurnId,
  type UserInputQuestion,
  type UserInputQuestionOption,
} from '@workspace/contracts'
import * as v from 'valibot'
import type { ProviderRuntimeEvent } from '../provider/types'
import { checkpointFilesFromUnifiedDiff } from './checkpoint-files'
import { checkpointRefForSessionTurn } from './checkpoint-refs'
import type { OrchestrationProjectedSession, OrchestrationReadModel } from './read-model'
import {
  BoundedTtlCache,
  PROVIDER_RUNTIME_BUFFER_TTL_MS,
  ProviderRuntimeBuffers,
} from './provider-runtime-buffers'
import { SerialWorker } from './serial-worker'

export type ProviderRuntimeDispatch = (
  command: InternalOrchestrationCommand | OrchestrationCommand,
  source: ProviderRuntimeSource,
) => Promise<unknown>
export type ProviderRuntimeSource = Pick<ProviderRuntimeEvent, 'sessionId' | 'runtimeEpoch'>
type ReasoningState = {
  messageId: MessageId
  event: Extract<ProviderRuntimeEvent, { type: 'content.delta' }>
  partIndex?: number
  closed: boolean
  nextChunkIndex: number
}
import type { ResponseStreamingMode } from './response-delivery'

const SEEN_RUNTIME_EVENT_ID_MAX = 20_000
const TOOL_LIFECYCLE_ITEM_TYPES = new Set([
  'command_execution',
  'file_change',
  'mcp_tool_call',
  'dynamic_tool_call',
  'collab_agent_tool_call',
  'web_search',
  'image_view',
])

export class ProviderRuntimeIngestion {
  private readonly responseStreamingMode: (
    projectId: string,
  ) => ResponseStreamingMode | Promise<ResponseStreamingMode>
  private readonly now: () => number
  private readonly reasoning: BoundedTtlCache<string, ReasoningState>
  private readonly buffers: ProviderRuntimeBuffers
  private readonly dispatchCommand: ProviderRuntimeDispatch
  private readonly getReadModel: (() => OrchestrationReadModel) | null
  private readonly onLiveness: ((sessionId: SessionId) => void) | null
  private readonly seenEventIds: BoundedTtlCache<string, true>
  private readonly worker: SerialWorker<ProviderRuntimeEvent>

  constructor(
    dispatch: ProviderRuntimeDispatch,
    options: {
      responseStreamingMode?: (
        projectId: string,
      ) => ResponseStreamingMode | Promise<ResponseStreamingMode>
      buffers?: ProviderRuntimeBuffers
      getReadModel?: () => OrchestrationReadModel
      now?: () => number
      /**
       * Called once per accepted event, before anything is dispatched. This is
       * the signal an idle-session reaper reads: a turn can stream for an hour
       * without a single status transition, so status alone cannot say whether
       * a session is alive.
       */
      onLiveness?: (sessionId: SessionId) => void
    } = {},
  ) {
    this.responseStreamingMode = options.responseStreamingMode ?? (() => 'paragraph')
    this.now = options.now ?? Date.now
    this.reasoning = new BoundedTtlCache({
      capacity: 10_000,
      now: this.now,
      ttlMs: PROVIDER_RUNTIME_BUFFER_TTL_MS,
    })
    this.buffers = options.buffers ?? new ProviderRuntimeBuffers({ now: options.now })
    this.dispatchCommand = dispatch
    this.getReadModel = options.getReadModel ?? null
    this.onLiveness = options.onLiveness ?? null
    this.seenEventIds = new BoundedTtlCache({
      capacity: SEEN_RUNTIME_EVENT_ID_MAX,
      now: options.now,
      ttlMs: PROVIDER_RUNTIME_BUFFER_TTL_MS,
    })
    this.worker = new SerialWorker((event) => this.processEvent(event))
  }

  ingest(event: ProviderRuntimeEvent) {
    return this.worker.enqueue(event)
  }

  drain() {
    return this.worker.drain()
  }

  isIdle() {
    return this.worker.isIdle()
  }

  private dispatch(
    command: InternalOrchestrationCommand | OrchestrationCommand,
    event: ProviderRuntimeEvent,
  ) {
    return this.dispatchCommand(command, {
      sessionId: event.sessionId,
      runtimeEpoch: event.runtimeEpoch,
    })
  }

  private async processEvent(event: ProviderRuntimeEvent) {
    if (this.seenEventIds.has(event.eventId)) return
    const session = this.getReadModel?.().sessions.get(event.sessionId)
    const expectedEpoch = session?.latestTurn?.runtimeEpoch ?? session?.runtime?.runtimeEpoch
    if (expectedEpoch && expectedEpoch !== event.runtimeEpoch) return

    this.seenEventIds.set(event.eventId, true)
    this.onLiveness?.(event.sessionId)
    await this.dispatchSessionCommand(event)
    await this.dispatchMetadataCommands(event)
    await this.dispatchReasoning(event)
    await this.dispatchContentCommands(event)
    await this.dispatchCheckpointPlaceholder(event)
    await this.dispatchActivityCommands(event)
  }

  /**
   * A turn's changed files have to appear while the agent is still working, and
   * the only mid-turn signal is the provider's own unified diff. It lands as a
   * checkpoint with status `missing`: the file list is real, the git ref is not
   * written yet. `CheckpointReactor` upgrades the turn to a captured ref when
   * the turn ends, and the projection refuses the reverse — so a placeholder
   * arriving late can never erase a capture.
   */
  private async dispatchCheckpointPlaceholder(event: ProviderRuntimeEvent) {
    if (event.type !== 'turn.diff.updated') return
    if (!event.turnId) return

    const session = this.getReadModel?.().sessions.get(event.sessionId)
    if (!session || session.deletedAt) return

    const files = checkpointFilesFromUnifiedDiff(event.payload.unifiedDiff)
    if (files.length === 0) return

    const checkpointTurnCount = placeholderCheckpointTurnCount(session, event.turnId)
    await this.dispatch(
      {
        checkpointRef: checkpointRefForSessionTurn(event.sessionId, checkpointTurnCount),
        checkpointTurnCount,
        commandId: providerCommandId(event.eventId, 'turn-diff-placeholder'),
        completedAt: event.createdAt,
        createdAt: event.createdAt,
        files,
        status: 'missing',
        sessionId: event.sessionId,
        turnId: event.turnId,
        type: 'session.turn.diff.complete',
      },
      event,
    )
  }

  private async dispatchSessionCommand(event: ProviderRuntimeEvent) {
    if (!this.shouldApplyLifecycleSession(event)) return
    if (event.type === 'runtime.set') {
      await this.dispatch(sessionSetCommand(event), event)
      return
    }

    const session = sessionFromLifecycleEvent(event)
    if (!session) return

    await this.dispatch(
      {
        commandId: providerCommandId(event.eventId, 'session-set'),
        createdAt: session.updatedAt,
        runtime: this.sessionForCurrentReadModel(event, session),
        sessionId: event.sessionId,
        type: 'session.runtime.set',
      },
      event,
    )
  }

  private async dispatchMetadataCommands(event: ProviderRuntimeEvent) {
    if (event.type !== 'conversation.metadata.updated') return
    if (!event.payload.name) return

    await this.dispatch(
      {
        commandId: providerCommandId(event.eventId, 'session-title-update'),
        sessionId: event.sessionId,
        title: event.payload.name,
        type: 'session.meta.update',
      },
      event,
    )
  }

  private shouldApplyLifecycleSession(event: ProviderRuntimeEvent) {
    const session = this.getReadModel?.().sessions.get(event.sessionId)
    const turn = session?.latestTurn
    if (!turn) return true
    if (turn.providerStartState === 'queued') return false
    if (event.turnId && turn.turnId !== event.turnId) return false
    if (event.type !== 'runtime.started' || event.turnId) return true
    return (
      (turn.providerStartState === 'claimed' || turn.providerStartState === 'adopted') &&
      turn.runtimeEpoch === event.runtimeEpoch
    )
  }

  private sessionForCurrentReadModel(
    event: ProviderRuntimeEvent,
    runtime: SessionRuntimeState,
  ): SessionRuntimeState {
    const session = this.getReadModel?.().sessions.get(event.sessionId)
    const current = {
      ...runtime,
      providerConversationMarker:
        runtime.providerConversationMarker ?? session?.runtime?.providerConversationMarker ?? null,
      providerResumeCursor:
        runtime.providerResumeCursor ?? session?.runtime?.providerResumeCursor ?? null,
    }
    if (!session?.latestTurn || session.latestTurn.state !== 'running') return current
    if (event.type !== 'runtime.started' && event.type !== 'conversation.started') return current
    return { ...current, activeTurnId: session.latestTurn.turnId, status: 'running' }
  }

  private async dispatchContentCommands(event: ProviderRuntimeEvent) {
    switch (event.type) {
      case 'assistant.delta':
        await this.bufferAssistantDelta({
          createdAt: event.createdAt,
          delta: event.delta,
          event,
          messageId: v.parse(messageIdSchema, event.messageId),
          sessionId: event.sessionId,
          turnId: event.turnId,
        })
        return
      case 'assistant.complete':
        await this.completeAssistantMessage({
          completedAt: event.completedAt,
          event,
          messageId: v.parse(messageIdSchema, event.messageId),
          sessionId: event.sessionId,
          turnId: event.turnId,
        })
        return
      case 'content.delta':
        await this.handleContentDelta(event)
        return
      case 'item.completed':
        await this.handleItemCompleted(event)
        return
      case 'request.opened':
      case 'user-input.requested':
        if (event.type === 'user-input.requested' && event.payload.responseMode === 'message')
          return
        await this.pauseAssistantSegment(event)
        return
      case 'proposed-plan.upsert':
        await this.upsertProposedPlan({
          createdAt: event.createdAt,
          event,
          planId: event.planId ?? proposedPlanIdFromEvent(event),
          planMarkdown: event.planMarkdown,
          sessionId: event.sessionId,
          turnId: event.turnId,
          updatedAt: event.updatedAt ?? event.createdAt,
        })
        return
      case 'turn.completed':
        await this.completeTurn(event)
        return
      case 'runtime.exited':
        this.buffers.clearTurnStateForSession(event.sessionId)
        return
    }
  }

  private async bufferAssistantDelta(input: {
    createdAt: string
    delta: string
    event: ProviderRuntimeEvent
    messageId: MessageId
    sessionId: SessionId
    turnId: TurnId | undefined
  }) {
    if (input.delta.length === 0) return
    if (input.turnId)
      this.buffers.rememberAssistantMessageId(input.sessionId, input.turnId, input.messageId)

    const mode = await this.deliveryMode(input.sessionId)
    if (mode === 'token') {
      await this.dispatch(assistantDeltaCommand(input, input.delta, 'assistant-delta'), input.event)
      return
    }

    const spill = this.buffers.appendBufferedAssistantText(
      input.messageId,
      input.delta,
      mode,
      this.now(),
    )
    if (spill.length === 0) return

    await this.dispatch(
      assistantDeltaCommand(input, spill, 'assistant-delta-buffer-spill'),
      input.event,
    )
  }

  private async handleContentDelta(
    event: Extract<ProviderRuntimeEvent, { type: 'content.delta' }>,
  ) {
    if (event.payload.streamKind === 'plan_text') {
      this.buffers.appendBufferedProposedPlan(
        proposedPlanIdFromEvent(event),
        event.payload.delta,
        event.createdAt,
      )
      return
    }
    if (event.payload.streamKind !== 'assistant_text') return

    const messageId = this.buffers.getOrCreateAssistantMessageId({
      baseKey: assistantSegmentBaseKey(event),
      sessionId: event.sessionId,
      turnId: event.turnId,
    })
    await this.bufferAssistantDelta({
      createdAt: event.createdAt,
      delta: event.payload.delta,
      event,
      messageId,
      sessionId: event.sessionId,
      turnId: event.turnId,
    })
  }

  private async completeAssistantMessage(input: {
    completedAt: string
    event: ProviderRuntimeEvent
    fallbackText?: string
    messageId: MessageId
    sessionId: SessionId
    turnId: TurnId | undefined
  }) {
    const hasProjectedMessage = input.turnId
      ? this.buffers.assistantMessageIdsForTurn(input.sessionId, input.turnId).has(input.messageId)
      : true
    await this.finalizeAssistantMessage({
      commandTag: `assistant-complete:${input.messageId}`,
      completedAt: input.completedAt,
      event: input.event,
      fallbackText: hasProjectedMessage ? undefined : input.fallbackText,
      finalDeltaCommandTag: `assistant-delta-finalize:${input.messageId}`,
      hasProjectedMessage,
      messageId: input.messageId,
      sessionId: input.sessionId,
      turnId: input.turnId,
    })
    if (input.turnId)
      this.buffers.forgetAssistantMessageId(input.sessionId, input.turnId, input.messageId)
  }

  private async finalizeAssistantMessage(input: {
    commandTag: string
    completedAt: string
    event: ProviderRuntimeEvent
    fallbackText?: string
    finalDeltaCommandTag: string
    hasProjectedMessage: boolean
    messageId: MessageId
    sessionId: SessionId
    turnId: TurnId | undefined
  }) {
    const bufferedText = this.buffers.takeBufferedAssistantText(input.messageId)
    const text = finalizedAssistantText(bufferedText, input.fallbackText)
    const hasText = hasRenderableText(text)
    if (hasText)
      await this.dispatch(
        assistantDeltaCommand(input, text, input.finalDeltaCommandTag),
        input.event,
      )
    if (!input.hasProjectedMessage && !hasText) return

    await this.dispatch(
      {
        commandId: providerCommandId(input.event.eventId, input.commandTag),
        completedAt: input.completedAt,
        messageId: input.messageId,
        sessionId: input.sessionId,
        turnId: input.turnId,
        type: 'session.message.assistant.complete',
      },
      input.event,
    )
    this.buffers.clearBufferedAssistantText(input.messageId)
  }

  private async handleItemCompleted(
    event: Extract<ProviderRuntimeEvent, { type: 'item.completed' }>,
  ) {
    if (event.payload.itemType !== 'assistant_message') return

    const turnId = event.turnId
    const messageId = this.buffers.getOrCreateAssistantMessageId({
      baseKey: event.itemId ?? event.turnId ?? event.eventId,
      sessionId: event.sessionId,
      turnId,
    })
    await this.completeAssistantMessage({
      completedAt: event.createdAt,
      event,
      fallbackText: event.payload.detail,
      messageId,
      sessionId: event.sessionId,
      turnId,
    })
    if (!turnId) return

    this.buffers.clearAssistantSegmentStateForTurn(event.sessionId, turnId)
  }

  private async pauseAssistantSegment(
    event: Extract<ProviderRuntimeEvent, { type: 'request.opened' | 'user-input.requested' }>,
  ) {
    if (!event.turnId) return

    const messageId = this.buffers.activeAssistantMessageIdForTurn(event.sessionId, event.turnId)
    if (!messageId) return

    await this.completeAssistantMessage({
      completedAt: event.createdAt,
      event,
      messageId,
      sessionId: event.sessionId,
      turnId: event.turnId,
    })
    this.buffers.markActiveAssistantSegmentComplete(event.sessionId, event.turnId)
  }

  private async completeTurn(event: Extract<ProviderRuntimeEvent, { type: 'turn.completed' }>) {
    if (!event.turnId) return

    const messageIds = this.buffers.assistantMessageIdsForTurn(event.sessionId, event.turnId)
    for (const messageId of messageIds) {
      await this.completeAssistantMessage({
        completedAt: event.createdAt,
        event,
        messageId,
        sessionId: event.sessionId,
        turnId: event.turnId,
      })
    }
    this.buffers.clearAssistantMessageIdsForTurn(event.sessionId, event.turnId)
    this.buffers.clearAssistantSegmentStateForTurn(event.sessionId, event.turnId)
    await this.finalizeBufferedProposedPlan({
      event,
      planId: proposedPlanIdForTurn(event.sessionId, event.turnId),
      sessionId: event.sessionId,
      turnId: event.turnId,
      updatedAt: event.createdAt,
    })
  }

  private async finalizeBufferedProposedPlan(input: {
    event: ProviderRuntimeEvent
    fallbackMarkdown?: string
    planId: string
    sessionId: SessionId
    turnId: TurnId | null | undefined
    updatedAt: string
  }) {
    const buffer = this.buffers.takeBufferedProposedPlan(input.planId)
    await this.upsertProposedPlan({
      createdAt: buffer?.createdAt ?? input.updatedAt,
      event: input.event,
      planId: input.planId,
      planMarkdown: normalizeProposedPlanMarkdown(buffer?.text) ?? input.fallbackMarkdown,
      sessionId: input.sessionId,
      turnId: input.turnId ?? null,
      updatedAt: input.updatedAt,
    })
  }

  private async upsertProposedPlan(input: {
    createdAt: string
    event: ProviderRuntimeEvent
    planId: string
    planMarkdown: string | undefined
    sessionId: SessionId
    turnId: TurnId | null | undefined
    updatedAt: string
  }) {
    const planMarkdown = normalizeProposedPlanMarkdown(input.planMarkdown)
    if (!planMarkdown) return

    await this.dispatch(
      {
        commandId: providerCommandId(input.event.eventId, `proposed-plan-upsert:${input.planId}`),
        createdAt: input.updatedAt,
        proposedPlan: {
          createdAt: input.createdAt,
          id: v.parse(proposedPlanIdSchema, input.planId),
          planMarkdown,
          sessionId: input.sessionId,
          turnId: input.turnId ?? null,
          updatedAt: input.updatedAt,
        },
        sessionId: input.sessionId,
        type: 'session.proposed-plan.upsert',
      },
      input.event,
    )
  }

  private deliveryMode(sessionId: SessionId) {
    const model = this.getReadModel?.()
    const session = model?.sessions.get(sessionId)
    const projectId = session ? model?.worktrees.get(session.worktreeId)?.projectId : undefined
    return this.responseStreamingMode(projectId ?? '')
  }

  private async dispatchReasoning(event: ProviderRuntimeEvent) {
    const key = `${event.sessionId}:${event.turnId ?? ''}`
    if (event.type === 'runtime.exited') {
      for (const owned of this.reasoning.keys()) {
        if (!owned.startsWith(`${event.sessionId}:`)) continue
        const state = this.reasoning.get(owned)
        if (state) this.buffers.clearBufferedAssistantText(state.messageId)
        this.reasoning.delete(owned)
      }
      return
    }
    if (event.type === 'content.delta' && isReasoningStreamKind(event.payload.streamKind)) {
      await this.appendReasoning(key, event)
      return
    }
    if (event.type === 'item.completed' && event.payload.itemType === 'reasoning') {
      const state = this.reasoning.get(key)
      if (!state && event.payload.detail?.trim()) {
        await this.appendReasoning(key, {
          ...event,
          type: 'content.delta',
          payload: { streamKind: 'reasoning_text', delta: event.payload.detail },
        })
      }
      await this.finalizeReasoning(key, event)
      return
    }
    const boundary =
      event.type === 'assistant.delta' ||
      (event.type === 'content.delta' && event.payload.streamKind === 'assistant_text') ||
      (event.type === 'item.started' && TOOL_LIFECYCLE_ITEM_TYPES.has(event.payload.itemType)) ||
      event.type === 'request.opened' ||
      (event.type === 'user-input.requested' && event.payload.responseMode !== 'message') ||
      event.type === 'turn.completed'
    if (!boundary) return
    await this.finalizeReasoning(key, event)
    if (event.type === 'turn.completed') this.reasoning.delete(key)
  }

  private async appendReasoning(
    key: string,
    event: Extract<ProviderRuntimeEvent, { type: 'content.delta' }>,
  ) {
    if (!event.payload.delta) return
    let state = this.reasoning.get(key)
    if (state && !state.closed && state.event.itemId !== event.itemId) {
      await this.finalizeReasoning(key, event)
      state = undefined
    }
    if (!state || state.closed) {
      state = {
        messageId: v.parse(
          messageIdSchema,
          `reasoning:${event.sessionId}:${event.turnId ?? ''}:${event.eventId}`,
        ),
        event,
        closed: false,
        nextChunkIndex: 0,
      }
    }
    const partIndex = event.payload.summaryIndex ?? event.payload.contentIndex
    const separator =
      state.partIndex !== undefined && partIndex !== undefined && state.partIndex !== partIndex
        ? '\n\n'
        : ''
    state.partIndex = partIndex
    this.reasoning.set(key, state)
    const mode = await this.deliveryMode(event.sessionId)
    const text = this.buffers.appendBufferedAssistantText(
      state.messageId,
      separator + event.payload.delta,
      mode === 'token' ? 'paragraph' : mode,
      this.now(),
    )
    await this.emitReasoning(state, event, text)
  }

  private async finalizeReasoning(key: string, event: ProviderRuntimeEvent) {
    const state = this.reasoning.get(key)
    if (!state || state.closed) return
    await this.emitReasoning(state, event, this.buffers.takeBufferedAssistantText(state.messageId))
    this.buffers.clearBufferedAssistantText(state.messageId)
    this.reasoning.set(key, { ...state, closed: true })
  }

  private async emitReasoning(state: ReasoningState, event: ProviderRuntimeEvent, text: string) {
    if (!text) return
    // Snapshot cursors order equal timestamps by activity ID.
    const chunkId = `${state.messageId}:${String(state.nextChunkIndex++).padStart(12, '0')}`
    const activity = baseActivity(
      {
        ...state.event,
        eventId: chunkId,
        createdAt: state.event.createdAt,
      },
      'thinking',
      'task.progress',
      'Thinking',
      {
        detail: text,
        summary: text,
        streamKind: state.event.payload.streamKind,
        taskId: state.messageId,
      },
    )
    await this.dispatch(
      {
        activity,
        commandId: providerCommandId(event.eventId, `reasoning:${chunkId}`),
        createdAt: activity.createdAt,
        sessionId: event.sessionId,
        type: 'session.activity.append',
      },
      event,
    )
  }

  private async dispatchActivityCommands(event: ProviderRuntimeEvent) {
    const activities = this.getReadModel?.().sessions.get(event.sessionId)?.activities ?? []
    const taskTitle =
      event.type === 'task.completed' ? taskTitleFromActivities(event, activities) : undefined
    for (const activity of activitiesForRuntimeEvent(event, taskTitle)) {
      await this.dispatch(
        {
          activity,
          commandId: providerCommandId(event.eventId, `activity-append:${activity.kind}`),
          createdAt: activity.createdAt,
          sessionId: activity.sessionId,
          type: 'session.activity.append',
        },
        event,
      )
    }
  }
}

/**
 * A placeholder claims the slot the real capture will land in, so the ref name
 * it advertises is the one `CheckpointReactor` writes. Reusing an existing
 * slot matters: every mid-turn update of the same turn must describe one
 * checkpoint, not push the turn count forward on each diff frame.
 */
function placeholderCheckpointTurnCount(session: OrchestrationProjectedSession, turnId: TurnId) {
  const existing = session.checkpointByTurnId[turnId]
  if (existing) return existing.checkpointTurnCount

  let maxTurnCount = 0
  for (const checkpoint of Object.values(session.checkpointByTurnId)) {
    maxTurnCount = Math.max(maxTurnCount, checkpoint.checkpointTurnCount)
  }

  return maxTurnCount + 1
}

function sessionSetCommand(
  event: Extract<ProviderRuntimeEvent, { type: 'runtime.set' }>,
): InternalOrchestrationCommand {
  return {
    commandId: providerCommandId(event.eventId, 'session-set'),
    createdAt: event.createdAt,
    runtime: sessionFromRuntimeEvent(event),
    sessionId: event.sessionId,
    type: 'session.runtime.set',
  }
}

function sessionFromRuntimeEvent(
  event: Extract<ProviderRuntimeEvent, { type: 'runtime.set' }>,
): SessionRuntimeState {
  return v.parse(sessionRuntimeStateSchema, {
    activeTurnId: event.turnId,
    lastError: event.lastError ?? null,
    providerInstanceId: event.providerInstanceId,
    providerName: event.providerName ?? event.providerInstanceId,
    providerBindingHandle: event.providerBindingHandle,
    runtimeEpoch: event.runtimeEpoch,
    providerConversationMarker: null,
    providerResumeCursor: null,
    runtimeMode: event.runtimeMode ?? DEFAULT_RUNTIME_MODE,
    status: event.status,
    sessionId: event.sessionId,
    updatedAt: event.createdAt,
  })
}

function sessionFromLifecycleEvent(event: ProviderRuntimeEvent): SessionRuntimeState | null {
  if (!isLifecycleSessionEvent(event)) return null
  if (!event.providerInstanceId) return null

  return v.parse(sessionRuntimeStateSchema, {
    activeTurnId: lifecycleActiveTurnId(event),
    lastError: lifecycleLastError(event),
    providerInstanceId: event.providerInstanceId,
    providerName: event.providerName ?? event.providerInstanceId,
    providerBindingHandle: event.providerBindingHandle ?? null,
    runtimeEpoch: event.runtimeEpoch,
    providerConversationMarker:
      event.type === 'conversation.started'
        ? (event.payload.providerConversationMarker ?? null)
        : null,
    providerResumeCursor:
      event.type === 'runtime.started' && typeof event.payload.resume === 'string'
        ? event.payload.resume
        : null,
    runtimeMode: event.runtimeMode ?? DEFAULT_RUNTIME_MODE,
    status: lifecycleSessionStatus(event),
    sessionId: event.sessionId,
    updatedAt: event.createdAt,
  })
}

function lifecycleActiveTurnId(
  event: Extract<ProviderRuntimeEvent, { type: LifecycleSessionType }>,
) {
  if (event.type === 'turn.started') return event.turnId ?? null
  if (event.type === 'turn.completed' || event.type === 'runtime.exited') return null

  return event.turnId ?? null
}

function lifecycleLastError(event: Extract<ProviderRuntimeEvent, { type: LifecycleSessionType }>) {
  if (event.type === 'runtime.error') return event.payload.message
  if (event.type === 'runtime.state.changed' && event.payload.state === 'error')
    return event.payload.reason ?? 'Provider session error'
  if (event.type === 'turn.completed' && event.payload.state === 'failed')
    return event.payload.errorMessage ?? 'Turn failed'

  return null
}

function lifecycleSessionStatus(
  event: Extract<ProviderRuntimeEvent, { type: LifecycleSessionType }>,
) {
  switch (event.type) {
    case 'runtime.started':
    case 'conversation.started':
      return 'ready'
    case 'turn.started':
      return 'running'
    case 'turn.completed':
      return event.payload.state === 'failed' ? 'error' : 'ready'
    case 'runtime.error':
      return 'error'
    case 'runtime.exited':
      return 'stopped'
    case 'runtime.state.changed':
      return event.payload.state
  }
}

type LifecycleSessionType =
  | 'runtime.error'
  | 'runtime.exited'
  | 'runtime.started'
  | 'runtime.state.changed'
  | 'conversation.started'
  | 'turn.completed'
  | 'turn.started'

function isLifecycleSessionEvent(
  event: ProviderRuntimeEvent,
): event is Extract<ProviderRuntimeEvent, { type: LifecycleSessionType }> {
  switch (event.type) {
    case 'runtime.error':
    case 'runtime.exited':
    case 'runtime.started':
    case 'runtime.state.changed':
    case 'conversation.started':
    case 'turn.completed':
    case 'turn.started':
      return true
    default:
      return false
  }
}

function assistantDeltaCommand(
  input: {
    createdAt?: string
    completedAt?: string
    event: ProviderRuntimeEvent
    messageId: MessageId
    sessionId: SessionId
    turnId: TurnId | undefined
  },
  delta: string,
  tag: string,
): InternalOrchestrationCommand {
  return {
    commandId: providerCommandId(input.event.eventId, tag),
    createdAt: input.createdAt ?? input.completedAt ?? new Date().toISOString(),
    delta,
    messageId: input.messageId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    type: 'session.message.assistant.delta',
  }
}

function activitiesForRuntimeEvent(
  event: ProviderRuntimeEvent,
  taskTitle?: string,
): OrchestrationSessionActivity[] {
  switch (event.type) {
    case 'activity.append':
      return [activityFromLegacyEvent(event)]
    case 'content.delta':
      return []
    case 'item.started':
      return toolActivity(event, 'tool.started', `${event.payload.title ?? 'Tool'} started`)
    case 'item.completed':
      return toolActivity(event, 'tool.completed', event.payload.title ?? 'Tool')
    case 'request.opened':
      return requestOpenedActivity(event)
    case 'request.resolved':
      return requestResolvedActivity(event)
    case 'user-input.requested':
      return [userInputRequestedActivity(event)]
    case 'user-input.resolved':
      return [
        baseActivity(event, 'info', 'user-input.resolved', 'User input submitted', {
          answers: event.payload.answers,
          requestId: event.requestId,
        }),
      ]
    case 'task.started':
      return [taskStartedActivity(event)]
    case 'task.progress':
      return [taskProgressActivity(event)]
    case 'task.completed':
      return [taskCompletedActivity(event, taskTitle)]
    case 'turn.plan.updated':
      return [turnPlanUpdatedActivity(event)]
    case 'auth.status':
      return authStatusActivity(event)
    case 'mcp.status.updated':
      return mcpStatusActivity(event)
    case 'mcp.oauth.completed':
      return mcpOauthCompletedActivity(event)
    case 'config.warning':
      return [providerWarningActivity(event, event.payload.summary, event.payload.details)]
    case 'files.persisted':
      return filesPersistedActivity(event)
    case 'conversation.realtime.error':
      return [providerWarningActivity(event, event.payload.message)]
    case 'runtime.warning':
      return [runtimeWarningActivity(event)]
    case 'runtime.error':
      return [runtimeErrorActivity(event)]
    case 'conversation.state.changed':
      return contextCompactionActivity(event)
    case 'conversation.token-usage.updated':
      return tokenUsageActivity(event)
    default:
      return []
  }
}

function activityFromLegacyEvent(
  event: Extract<ProviderRuntimeEvent, { type: 'activity.append' }>,
): OrchestrationSessionActivity {
  return {
    createdAt: event.createdAt,
    id: v.parse(eventIdSchema, event.eventId),
    kind: event.kind,
    payload: event.payload ?? { detail: event.detail ?? null },
    summary: event.summary,
    sessionId: event.sessionId,
    tone: event.tone,
    turnId: event.turnId,
  }
}

function toolActivity(
  event: Extract<ProviderRuntimeEvent, { type: 'item.started' | 'item.completed' }>,
  kind: string,
  summary: string,
) {
  if (!TOOL_LIFECYCLE_ITEM_TYPES.has(event.payload.itemType)) return []

  return [
    baseActivity(event, 'tool', kind, summary, {
      data: event.payload.data,
      detail: truncateDetail(event.payload.detail),
      itemType: event.payload.itemType,
      status: event.payload.status,
      toolCallId: event.itemId,
    }),
  ]
}

function requestOpenedActivity(event: Extract<ProviderRuntimeEvent, { type: 'request.opened' }>) {
  if (event.payload.requestType === 'tool_user_input') return []

  const requestKind = requestKindFromRequestType(event.payload.requestType)
  const summary =
    event.payload.requestType === 'mcp_elicitation_approval'
      ? 'App access approval requested'
      : approvalRequestSummary(requestKind)
  return [
    baseActivity(event, 'approval', 'approval.requested', summary, {
      options: event.payload.options,
      detail: event.payload.detail,
      requestId: event.requestId,
      requestKind,
      requestType: event.payload.requestType,
    }),
  ]
}

function requestResolvedActivity(
  event: Extract<ProviderRuntimeEvent, { type: 'request.resolved' }>,
) {
  if (event.payload.requestType === 'tool_user_input') return []

  return [
    baseActivity(event, 'approval', 'approval.resolved', 'Approval resolved', {
      decision: event.payload.decision,
      requestId: event.requestId,
      requestKind: requestKindFromRequestType(event.payload.requestType),
      requestType: event.payload.requestType,
    }),
  ]
}

function userInputRequestedActivity(
  event: Extract<ProviderRuntimeEvent, { type: 'user-input.requested' }>,
) {
  const { droppedQuestionCount, questions } = normalizeUserInputQuestions(event.payload.questions)

  return baseActivity(event, 'info', 'user-input.requested', 'User input requested', {
    responseMode: event.payload.responseMode,
    // Widening the activity rather than logging a second line: whoever reads
    // the request also sees how much of it we could not read.
    droppedQuestionCount: droppedQuestionCount === 0 ? undefined : droppedQuestionCount,
    questions,
    requestId: event.requestId,
  })
}

/**
 * Providers disagree on the wire shape — Codex sends `question`/`isOther`/
 * `isSecret` and label-only options — so each question is aligned to the
 * contract and then parsed. A question we still cannot read is dropped, never
 * thrown: an unknown shape costs that question, not the turn.
 */
function normalizeUserInputQuestions(rawQuestions: readonly unknown[]) {
  const questions: UserInputQuestion[] = []
  let droppedQuestionCount = 0

  for (const raw of rawQuestions) {
    const parsed = v.safeParse(userInputQuestionSchema, userInputQuestionCandidate(raw))
    if (!parsed.success) {
      droppedQuestionCount += 1
      continue
    }

    questions.push(parsed.output)
  }

  return { droppedQuestionCount, questions }
}

function userInputQuestionCandidate(raw: unknown) {
  if (!isPlainRecord(raw)) return raw

  const options = userInputQuestionOptions(raw.options)

  return {
    ...raw,
    allowOther: firstBoolean(raw.allowOther, raw.isOther),
    answerKind: userInputAnswerKind(raw.answerKind, options),
    header: firstText(raw.header),
    options,
    prompt: firstText(raw.prompt, raw.question),
    secret: firstBoolean(raw.secret, raw.isSecret),
  }
}

/** An option-less question is a text field; options make it a picker. */
function userInputAnswerKind(rawAnswerKind: unknown, options: readonly UserInputQuestionOption[]) {
  if (rawAnswerKind !== undefined) return rawAnswerKind
  if (options.length > 0) return 'single-select'

  return DEFAULT_USER_INPUT_ANSWER_KIND
}

function userInputQuestionOptions(rawOptions: unknown) {
  if (!Array.isArray(rawOptions)) return []

  const options: UserInputQuestionOption[] = []
  for (const raw of rawOptions) {
    const parsed = v.safeParse(userInputQuestionOptionSchema, userInputQuestionOptionCandidate(raw))
    if (!parsed.success) continue

    options.push(parsed.output)
  }

  return options
}

/** Codex options carry no id, so the label doubles as the value sent back. */
function userInputQuestionOptionCandidate(raw: unknown) {
  if (!isPlainRecord(raw)) return raw

  return {
    ...raw,
    description: firstText(raw.description),
    label: firstText(raw.label, raw.value),
    value: firstText(raw.value, raw.label),
  }
}

/** Blank counts as absent: Codex sends `""` where it has no header or description. */
function firstText(...values: readonly unknown[]) {
  for (const value of values) {
    if (typeof value !== 'string') continue
    if (value.trim().length === 0) continue

    return value
  }

  return undefined
}

function firstBoolean(...values: readonly unknown[]) {
  for (const value of values) {
    if (typeof value !== 'boolean') continue

    return value
  }

  return undefined
}

function taskStartedActivity(event: Extract<ProviderRuntimeEvent, { type: 'task.started' }>) {
  const taskType = event.payload.taskType
  const summary = taskType ? `${taskType} task started` : 'Task started'
  return baseActivity(
    event,
    'info',
    'task.started',
    taskType === 'plan' ? 'Plan task started' : summary,
    {
      detail: truncateDetail(event.payload.description),
      taskId: event.payload.taskId,
      taskType,
      title: truncateDetail(event.payload.description, 120),
    },
  )
}

function taskProgressActivity(event: Extract<ProviderRuntimeEvent, { type: 'task.progress' }>) {
  const title = truncateDetail(firstText(event.payload.description), 120)
  const activity = baseActivity(event, 'info', 'task.progress', title || 'Reasoning update', {
    detail: truncateDetail(event.payload.summary ?? event.payload.description),
    lastToolName: event.payload.lastToolName,
    summary: truncateDetail(event.payload.summary),
    taskId: event.payload.taskId,
    title,
    usage: event.payload.usage,
    tool: event.payload.tool,
  })
  return {
    ...activity,
    id: v.parse(
      eventIdSchema,
      `task-progress:${event.sessionId}:${event.turnId ?? 'session'}:${event.payload.taskId}${event.payload.tool ? `:tool:${event.payload.tool.itemId}` : ''}`,
    ),
  }
}

function taskCompletedActivity(
  event: Extract<ProviderRuntimeEvent, { type: 'task.completed' }>,
  title?: string,
) {
  return baseActivity(
    event,
    event.payload.status === 'failed' ? 'error' : 'info',
    'task.completed',
    taskCompletedSummary(event),
    {
      detail: truncateDetail(event.payload.summary),
      status: event.payload.status,
      summary: truncateDetail(event.payload.summary),
      taskId: event.payload.taskId,
      title,
      usage: event.payload.usage,
    },
  )
}

function turnPlanUpdatedActivity(
  event: Extract<ProviderRuntimeEvent, { type: 'turn.plan.updated' }>,
) {
  return baseActivity(event, 'info', 'turn.plan.updated', 'Plan updated', {
    explanation: truncateDetail(event.payload.explanation ?? undefined),
    plan: event.payload.plan,
  })
}

function authStatusActivity(event: Extract<ProviderRuntimeEvent, { type: 'auth.status' }>) {
  if (!event.payload.error) return []

  return [providerWarningActivity(event, `Authentication failed: ${event.payload.error}`)]
}

function mcpStatusActivity(event: Extract<ProviderRuntimeEvent, { type: 'mcp.status.updated' }>) {
  const status = event.payload.status
  if (!isPlainRecord(status)) return []

  const error = firstText(status.error, status.failureReason)
  if (!error && status.status !== 'failed') return []

  const name = firstText(status.name) ?? 'MCP server'
  const message = error ? `${name} connection failed: ${error}` : `${name} connection failed`
  return [providerWarningActivity(event, message)]
}

function mcpOauthCompletedActivity(
  event: Extract<ProviderRuntimeEvent, { type: 'mcp.oauth.completed' }>,
) {
  if (event.payload.success) return []

  const name = event.payload.name ?? 'MCP server'
  const message = event.payload.error
    ? `${name} sign-in failed: ${event.payload.error}`
    : `${name} sign-in failed`
  return [providerWarningActivity(event, message)]
}

function filesPersistedActivity(event: Extract<ProviderRuntimeEvent, { type: 'files.persisted' }>) {
  const failures = event.payload.failed ?? []
  if (failures.length === 0) return []

  const detail = failures.map((failure) => `${failure.filename}: ${failure.error}`).join('\n')
  return [providerWarningActivity(event, 'Could not save files', detail)]
}

function providerWarningActivity(
  event: Parameters<typeof baseActivity>[0],
  message: string,
  detail?: unknown,
) {
  return baseActivity(
    event,
    'info',
    'runtime.warning',
    truncateDetail(message, 120) ?? 'Provider warning',
    {
      detail,
      message: truncateDetail(message),
      sourceEventType: event.type,
    },
  )
}

function runtimeWarningActivity(event: Extract<ProviderRuntimeEvent, { type: 'runtime.warning' }>) {
  return baseActivity(
    event,
    'info',
    'runtime.warning',
    truncateDetail(event.payload.message, 120) ?? 'Runtime warning',
    {
      detail: event.payload.detail,
      message: truncateDetail(event.payload.message),
    },
  )
}

function runtimeErrorActivity(event: Extract<ProviderRuntimeEvent, { type: 'runtime.error' }>) {
  return baseActivity(event, 'error', 'runtime.error', 'Runtime error', {
    class: event.payload.class,
    detail: event.payload.detail,
    message: truncateDetail(event.payload.message),
  })
}

function contextCompactionActivity(
  event: Extract<ProviderRuntimeEvent, { type: 'conversation.state.changed' }>,
) {
  if (event.payload.state !== 'compacted') return []

  return [
    baseActivity(event, 'info', 'context-compaction', 'Context compacted', {
      detail: event.payload.detail,
      state: event.payload.state,
    }),
  ]
}

function tokenUsageActivity(
  event: Extract<ProviderRuntimeEvent, { type: 'conversation.token-usage.updated' }>,
) {
  if ((event.payload.usage.usedTokens ?? 0) <= 0) return []

  return [
    baseActivity(
      event,
      'info',
      'context-window.updated',
      'Context window updated',
      event.payload.usage,
    ),
  ]
}

function isReasoningStreamKind(streamKind: string) {
  return streamKind === 'reasoning_summary_text' || streamKind === 'reasoning_text'
}

function baseActivity(
  event: Extract<
    ProviderRuntimeEvent,
    { createdAt: string; eventId: string; sessionId: SessionId }
  >,
  tone: OrchestrationSessionActivity['tone'],
  kind: string,
  summary: string,
  payload: unknown,
): OrchestrationSessionActivity {
  return {
    createdAt: event.createdAt,
    id: v.parse(eventIdSchema, event.eventId),
    kind,
    payload: compactPayload(
      'agent' in event && event.agent && isPlainRecord(payload)
        ? { ...payload, agent: event.agent }
        : payload,
    ),
    summary,
    sessionId: event.sessionId,
    tone,
    turnId: event.turnId ?? null,
  }
}

function compactPayload(payload: unknown) {
  if (!isPlainRecord(payload)) return payload

  return Object.fromEntries(Object.entries(payload).filter((entry) => entry[1] !== undefined))
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null) return false
  if (typeof value !== 'object') return false

  return !Array.isArray(value)
}

function taskCompletedSummary(event: Extract<ProviderRuntimeEvent, { type: 'task.completed' }>) {
  if (event.payload.status === 'failed') return 'Task failed'
  if (event.payload.status === 'stopped') return 'Task stopped'

  return 'Task completed'
}

function taskTitleFromActivities(
  event: Extract<ProviderRuntimeEvent, { type: 'task.completed' }>,
  activities: readonly OrchestrationSessionActivity[],
) {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index]
    if (!activity || (activity.kind !== 'task.started' && activity.kind !== 'task.progress'))
      continue
    if (activity.turnId !== (event.turnId ?? null)) continue
    if (!isPlainRecord(activity.payload) || activity.payload.taskId !== event.payload.taskId)
      continue

    const detail = activity.kind === 'task.started' ? activity.payload.detail : undefined
    const title = firstText(activity.payload.title, detail)
    if (title) return truncateDetail(title, 120)
  }

  return undefined
}

function approvalRequestSummary(requestKind: ApprovalRequestKind) {
  switch (requestKind) {
    case 'command':
      return 'Command approval requested'
    case 'file-read':
      return 'File-read approval requested'
    case 'file-change':
      return 'File-change approval requested'
    case 'tool':
      return 'Tool approval requested'
  }
}

type ApprovalRequestKind = 'command' | 'file-change' | 'file-read' | 'tool'

/**
 * Every `request.opened` blocks the turn until it is answered, so an
 * unrecognised type falls back to the generic tool kind. Leaving it undefined
 * used to hide MCP and custom-tool approvals (Claude's
 * `dynamic_tool_call_approval`) from the panel while they still blocked.
 */
function requestKindFromRequestType(requestType: string): ApprovalRequestKind {
  switch (requestType) {
    case 'command_execution_approval':
    case 'exec_command_approval':
      return 'command'
    case 'file_read_approval':
      return 'file-read'
    case 'apply_patch_approval':
    case 'file_change_approval':
      return 'file-change'
    default:
      return 'tool'
  }
}

function finalizedAssistantText(bufferedText: string, fallbackText: string | undefined) {
  if (bufferedText.length > 0) return bufferedText
  if (!hasRenderableText(fallbackText)) return ''

  return fallbackText ?? ''
}

function hasRenderableText(text: string | undefined) {
  return (text?.trim().length ?? 0) > 0
}

function normalizeProposedPlanMarkdown(planMarkdown: string | undefined) {
  const trimmed = planMarkdown?.trim()
  if (!trimmed) return undefined

  return trimmed
}

function proposedPlanIdFromEvent(event: ProviderRuntimeEvent) {
  if ('planId' in event && event.planId) return event.planId
  if (event.turnId) return proposedPlanIdForTurn(event.sessionId, event.turnId)
  if ('itemId' in event && event.itemId) return `plan:${event.sessionId}:item:${event.itemId}`

  return `plan:${event.sessionId}:event:${event.eventId}`
}

function proposedPlanIdForTurn(sessionId: SessionId, turnId: TurnId) {
  return `plan:${sessionId}:turn:${turnId}`
}

function assistantSegmentBaseKey(event: Extract<ProviderRuntimeEvent, { type: 'content.delta' }>) {
  return String(event.itemId ?? event.turnId ?? event.eventId)
}

function providerCommandId(eventId: string, tag: string) {
  return v.parse(commandIdSchema, `provider:${eventId}:${tag}`)
}

function truncateDetail(value: string | undefined, limit = 180) {
  if (value === undefined) return undefined
  if (value.length <= limit) return value

  return `${value.slice(0, limit - 1)}…`
}
