import { appendUserInputAttachmentPaths } from '../provider/user-input-attachments'
import { defaultAttachmentsDir } from '../attachments/store'
import { assertRewindIsolation } from './rewind-isolation'
import { maxCheckpointTurnCount } from './checkpoint-turn-count'
import { runtimeEventId } from '../provider/adapters/utils/runtime-ids'
import { errorMessage as providerErrorMessage, errorStringField } from '@workspace/contracts'
import { resolveSessionOwner } from './session-owner'
import { internalCommandKey } from './utils/repository-ids'
import { createInternalError } from '../observability/structured-errors'
import { sessionIdentityErrors } from '../provider/structured-errors'

import type {
  InteractionMode,
  ModelSelection,
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationMessage,
  OrchestrationProject,
  OrchestrationSession,
  RuntimeMode,
  SessionId,
  TurnId,
} from '@workspace/contracts'
import * as v from 'valibot'
import {
  commandIdSchema,
  DEFAULT_CODEX_PROVIDER_SETTINGS,
  DEFAULT_RUNTIME_MODE,
} from '@workspace/contracts'
import type { SessionRuntimeStatus } from '@workspace/contracts'
import type { ProviderService } from '../provider/provider-service'
import type { ProviderRuntimeStartPayload } from '../provider/session-payload'
import type { ProviderRuntimeEvent } from '../provider/types'
import type { GitService } from '../git/service'
import { checkpointRefForSessionTurn } from './checkpoint-refs'
import { BoundedTtlCache } from './provider-runtime-buffers'
import type { OrchestrationReadModel } from './read-model'
import { ProviderRuntimeIngestion } from './provider-runtime-ingestion'
import {
  orchestrationEventBatchSummary,
  orchestrationEventSummary,
  providerRuntimeEventSummary,
  recordChatPipelineInfo,
  recordChatPipelineWarning,
} from './orchestration-logging'
import { SerialWorker } from './serial-worker'

type ProviderIntentEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | 'session.turn-start-requested'
      | 'session.turn-steer-requested'
      | 'session.turn-interrupt-requested'
      | 'session.runtime-stop-requested'
      | 'session.settled'
      | 'session.checkpoint-revert-requested'
      | 'session.approval-response-requested'
      | 'session.user-input-response-requested'
  }
>

const HANDLED_TURN_START_KEY_MAX = 10_000
const HANDLED_TURN_START_KEY_TTL_MS = 30 * 60 * 1000
const MAX_DRAIN_PASSES = 1_000

export class ProviderCommandReactor {
  /**
   * Settled before a turn reaches the provider. The checkpoint reactor hangs
   * the pre-turn baseline capture here: a photograph of the worktree taken
   * after the agent's first write is worse than no photograph at all, because
   * turn one then diffs against its own output.
   */
  private readonly beforeTurnStart: ((sessionId: SessionId) => Promise<void>) | null
  private readonly attachmentsDir: string
  private readonly checkpointGit: GitService | null
  private readonly dispatch: ((command: OrchestrationCommand) => Promise<unknown> | unknown) | null
  private readonly getReadModel: () => OrchestrationReadModel
  private readonly handledTurnStarts: BoundedTtlCache<string, true>
  private readonly ingestion: ProviderRuntimeIngestion
  private readonly pendingProviderActions = new Set<Promise<void>>()
  private readonly providerService: ProviderService
  private readonly worker: SerialWorker<ProviderIntentEvent>

  constructor({
    attachmentsDir,
    beforeTurnStart,
    checkpointGit,
    dispatch,
    getReadModel,
    ingestion,
    now,
    providerService,
    turnStartKeyTtlMs,
  }: {
    attachmentsDir?: string
    beforeTurnStart?: (sessionId: SessionId) => Promise<void>
    checkpointGit?: GitService | null
    dispatch?: (command: OrchestrationCommand) => Promise<unknown> | unknown
    getReadModel: () => OrchestrationReadModel
    ingestion: ProviderRuntimeIngestion
    now?: () => number
    providerService: ProviderService
    turnStartKeyTtlMs?: number
  }) {
    this.attachmentsDir = attachmentsDir ?? defaultAttachmentsDir()
    this.beforeTurnStart = beforeTurnStart ?? null
    this.checkpointGit = checkpointGit ?? null
    this.dispatch = dispatch ?? null
    this.getReadModel = getReadModel
    this.handledTurnStarts = new BoundedTtlCache({
      capacity: HANDLED_TURN_START_KEY_MAX,
      now,
      ttlMs: turnStartKeyTtlMs ?? HANDLED_TURN_START_KEY_TTL_MS,
    })
    this.ingestion = ingestion
    this.providerService = providerService
    this.worker = new SerialWorker((event) => this.handleEventSafely(event))
    this.providerService.subscribeRuntimeEvents((event) => this.ingestProviderRuntimeEvent(event))
  }

  handleEvents(events: OrchestrationEvent[]) {
    recordChatPipelineInfo('chat.pipeline.provider_reactor.events_received', {
      ...orchestrationEventBatchSummary(events),
    })
    for (const event of events) {
      if (!isProviderIntentEvent(event)) continue

      recordChatPipelineInfo('chat.pipeline.provider_reactor.intent_enqueued', {
        ...orchestrationEventSummary(event),
      })
      void this.worker.enqueue(event)
    }
  }

  /**
   * Loops because each source feeds the next: an intent sends a turn, the turn
   * publishes runtime events, ingestion turns those into commands, and a
   * command can produce another intent. Idle is when all four are idle at the
   * same moment, not when each has been drained once.
   */
  async drain() {
    for (let pass = 0; pass < MAX_DRAIN_PASSES; pass += 1) {
      await this.worker.drain()
      await this.drainProviderActions()
      await this.providerService.drainRuntimeEvents()
      await this.ingestion.drain()
      if (this.isIdle()) return
    }

    throw createInternalError(
      `Provider runtime did not settle within ${MAX_DRAIN_PASSES} drain passes.`,
    )
  }

  isIdle() {
    return (
      this.worker.isIdle() &&
      this.pendingProviderActions.size === 0 &&
      this.providerService.runtimeEventsIdle() &&
      this.ingestion.isIdle()
    )
  }

  private async drainProviderActions() {
    if (this.pendingProviderActions.size === 0) return

    await Promise.all(Array.from(this.pendingProviderActions))
  }

  private async handleEventSafely(event: ProviderIntentEvent) {
    try {
      await this.handleEvent(event)
    } catch (error) {
      recordChatPipelineWarning('chat.pipeline.provider_reactor.intent_failed', {
        ...orchestrationEventSummary(event),
        error,
      })
    }
  }

  private async handleEvent(event: ProviderIntentEvent) {
    recordChatPipelineInfo('chat.pipeline.provider_reactor.intent_start', {
      ...orchestrationEventSummary(event),
    })
    switch (event.type) {
      case 'session.turn-start-requested':
        await this.startTurn(event)
        return
      case 'session.turn-steer-requested':
        this.trackProviderAction(this.steerTurn(event))
        return
      case 'session.turn-interrupt-requested':
        await this.interruptTurn(event)
        return
      case 'session.settled':
        await this.releaseSettledRuntime(event)
        return
      case 'session.runtime-stop-requested':
        await this.stopRuntime(event)
        return
      case 'session.checkpoint-revert-requested':
        await this.revertCheckpoint(event)
        return
      case 'session.approval-response-requested':
        await this.respondApproval(event)
        return
      case 'session.user-input-response-requested':
        await this.respondUserInput(event)
        return
    }
  }

  private async startTurn(
    event: Extract<ProviderIntentEvent, { type: 'session.turn-start-requested' }>,
  ) {
    if (this.hasHandledTurnStart(event)) {
      recordChatPipelineInfo('chat.pipeline.provider_reactor.turn_start.deduped', {
        ...orchestrationEventSummary(event),
      })
      return
    }

    const context = await this.turnContext(event)
    if (!context) {
      recordChatPipelineWarning('chat.pipeline.provider_reactor.turn_start.missing_context', {
        ...orchestrationEventSummary(event),
      })
      return
    }

    try {
      recordChatPipelineInfo('chat.pipeline.provider_reactor.turn_start.context', {
        interactionMode: context.interactionMode,
        messageId: context.message.id,
        model: context.modelSelection.model,
        providerInstanceId: context.modelSelection.providerInstanceId,
        runtimeMode: context.runtimeMode,
        textLength: context.message.text.length,
        sessionId: context.session.id,
        turnId: event.payload.turnId,
      })
      if (context.message.role !== 'user') {
        throw createInternalError(`Provider turn ${event.payload.turnId} requires a user message.`)
      }

      await this.beforeTurnStart?.(context.session.id)
      const worktree = this.getReadModel().worktrees.get(context.worktree.id)
      if (worktree?.lifecycle.state !== 'ready') return
      if (!(await this.claimTurn(event, context))) return
      this.handledTurnStarts.set(turnStartKeyForEvent(event), true)
      if (!this.ownsStart(event, context, 'claimed')) return
      await this.ensureSessionForTurn(context)
      if (!this.ownsStart(event, context, 'claimed')) {
        await this.releaseAbandonedStart(context)
        return
      }
      await this.adoptTurn(event, context)
      if (!this.ownsStart(event, context, 'adopted')) {
        await this.releaseAbandonedStart(context)
        return
      }
      this.trackProviderAction(this.sendTurn(event, context))
    } catch (error) {
      if (
        !this.ownsStart(event, context, 'claimed') &&
        !this.ownsStart(event, context, 'adopted')
      ) {
        await this.releaseAbandonedStart(context)
        throw error
      }
      await this.handleTurnFailure(event, context, error)
    }
  }

  private ownsStart(
    event: Extract<ProviderIntentEvent, { type: 'session.turn-start-requested' }>,
    context: ProviderTurnContext,
    state: 'claimed' | 'adopted',
  ) {
    const current = this.getReadModel().sessions.get(context.session.id)
    const turn = current?.latestTurn
    return (
      !current?.deletedAt &&
      turn?.turnId === event.payload.turnId &&
      turn.runtimeEpoch === context.runtimeEpoch &&
      turn.providerStartState === state
    )
  }

  private async releaseAbandonedStart(context: ProviderTurnContext) {
    const binding = this.providerService.bindingForSession(context.session.id)
    if (binding?.runtimeEpoch !== context.runtimeEpoch) return
    await this.providerService.stopRuntime({ sessionId: context.session.id })
  }

  private async claimTurn(
    event: Extract<ProviderIntentEvent, { type: 'session.turn-start-requested' }>,
    context: ProviderTurnContext,
  ) {
    const turn = this.getReadModel().sessions.get(context.session.id)?.latestTurn
    if (!turn || turn.turnId !== event.payload.turnId || turn.providerStartState !== 'queued')
      return false
    if (!this.dispatch) return false
    const observation = await this.providerService
      .reusableRuntimeEpoch({
        providerInstanceId: context.modelSelection.providerInstanceId,
        runtimeMode: context.runtimeMode,
        runtimePayload: runtimePayloadFromSessionContext(context),
        resumeExisting: context.session.origin === 'discovered',
        sessionId: context.session.id,
      })
      .then((epoch) => ({ epoch }))
      .catch((error: unknown) => ({ epoch: null, error }))
    const previousStatus = context.session.runtime?.status
    const mustRelease = previousStatus === 'interrupted' || previousStatus === 'error'
    context.runtimeEpoch = mustRelease
      ? crypto.randomUUID()
      : (observation.epoch ?? crypto.randomUUID())
    await this.dispatch({
      type: 'session.provider-start.claim',
      sessionId: context.session.id,
      turnId: turn.turnId,
      generation: turn.providerStartGeneration + 1,
      observedSequence: turn.providerStartSequence,
      runtimeEpoch: context.runtimeEpoch,
      createdAt: new Date().toISOString(),
      commandId: v.parse(
        commandIdSchema,
        internalCommandKey(
          'provider-start-claim',
          context.session.id,
          turn.turnId,
          turn.providerStartSequence,
        ),
      ),
    })
    if ('error' in observation) throw observation.error
    if (mustRelease) await this.providerService.stopRuntime({ sessionId: context.session.id })
    return true
  }

  private async adoptTurn(
    event: Extract<ProviderIntentEvent, { type: 'session.turn-start-requested' }>,
    context: ProviderTurnContext,
  ) {
    const turn = this.getReadModel().sessions.get(context.session.id)?.latestTurn
    if (!turn || turn.turnId !== event.payload.turnId || !this.dispatch) return
    await this.dispatch({
      type: 'session.provider-start.adopt',
      sessionId: context.session.id,
      turnId: turn.turnId,
      generation: turn.providerStartGeneration,
      observedSequence: turn.providerStartSequence,
      runtimeEpoch: context.runtimeEpoch,
      createdAt: new Date().toISOString(),
      commandId: v.parse(
        commandIdSchema,
        internalCommandKey(
          'provider-start-adopt',
          context.session.id,
          turn.turnId,
          turn.providerStartSequence,
          context.runtimeEpoch,
        ),
      ),
    })
  }

  private runtimeEpochFor(sessionId: SessionId) {
    const session = this.getReadModel().sessions.get(sessionId)
    return (
      session?.latestTurn?.runtimeEpoch ??
      session?.runtime?.runtimeEpoch ??
      `unclaimed:${sessionId}`
    )
  }

  private ensureSessionForTurn(context: ProviderTurnContext) {
    return this.providerService.ensureRuntime({
      fork: context.session.forkedFrom,
      providerInstanceId: context.modelSelection.providerInstanceId,
      runtimeMode: context.runtimeMode,
      runtimePayload: runtimePayloadFromSessionContext(context),
      runtimeEpoch: context.runtimeEpoch,
      resumeExisting: context.session.origin === 'discovered',
      sessionId: context.session.id,
    })
  }

  private async sendTurn(
    event: Extract<ProviderIntentEvent, { type: 'session.turn-start-requested' }>,
    context: ProviderTurnContext,
  ) {
    try {
      await this.providerService.sendTurn({
        attachments: context.message.attachments,
        cwd: context.worktree.canonicalPath,
        interactionMode: context.interactionMode,
        messageText: context.message.text,
        ...(event.payload.kind ? { kind: event.payload.kind } : {}),
        modelSelection: context.modelSelection,
        providerInstanceId: context.modelSelection.providerInstanceId,
        runtimeMode: context.runtimeMode,
        sessionId: context.session.id,
        runtimeEpoch: context.runtimeEpoch,
        resumeExisting: context.session.origin === 'discovered',
        turnId: event.payload.turnId,
      })
      recordChatPipelineInfo('chat.pipeline.provider_reactor.turn_start.sent', {
        sessionId: context.session.id,
        turnId: event.payload.turnId,
      })
    } catch (error) {
      await this.handleTurnFailure(event, context, error)
    }
  }

  private async steerTurn(
    event: Extract<ProviderIntentEvent, { type: 'session.turn-steer-requested' }>,
  ) {
    const session = this.getReadModel().sessions.get(event.payload.sessionId)
    const message = session?.messages.find((entry) => entry.id === event.payload.messageId)
    const runtimeEpoch = this.runtimeEpochFor(event.payload.sessionId)
    try {
      if (!message) throw createInternalError('The correction message is unavailable.')
      await this.providerService.steerTurn({
        sessionId: event.payload.sessionId,
        turnId: event.payload.turnId,
        messageText: message.text,
        attachments: message.attachments,
      })
    } catch (error) {
      await this.appendProviderFailureActivity({
        runtimeEpoch,
        detail: providerErrorMessage(error),
        event,
        kind: 'provider.turn.steer.failed',
        summary: 'Correction was not delivered',
      })
    }
  }

  private async interruptTurn(
    event: Extract<ProviderIntentEvent, { type: 'session.turn-interrupt-requested' }>,
  ) {
    const runtimeEpoch = this.runtimeEpochFor(event.payload.sessionId)
    recordChatPipelineInfo('chat.pipeline.provider_reactor.interrupt.start', {
      ...orchestrationEventSummary(event),
    })
    try {
      const binding = await this.providerService.interruptTurn({
        sessionId: event.payload.sessionId,
        turnId: event.payload.turnId,
      })
      if (!binding) {
        await this.appendProviderFailureActivity({
          runtimeEpoch,
          detail: noActiveSessionDetail(),
          event,
          kind: 'provider.turn.interrupt.failed',
          summary: 'Provider turn interrupt failed',
        })
        return
      }

      const currentTurn = this.getReadModel().sessions.get(event.payload.sessionId)?.latestTurn
      if (currentTurn?.turnId !== event.payload.turnId) return
      await this.ingestSession({
        providerInstanceId: binding.providerInstanceId,
        providerBindingHandle: binding.providerBindingHandle,
        runtimeMode: binding.runtimeMode,
        runtimeEpoch,
        status: 'interrupted',
        sessionId: event.payload.sessionId,
        turnId: event.payload.turnId ?? null,
      })
    } catch (error) {
      await this.appendProviderFailureActivity({
        runtimeEpoch,
        detail: providerErrorMessage(error),
        event,
        kind: 'provider.turn.interrupt.failed',
        summary: 'Provider turn interrupt failed',
      })
    }
  }

  private async releaseSettledRuntime(
    event: Extract<ProviderIntentEvent, { type: 'session.settled' }>,
  ) {
    const session = this.getReadModel().sessions.get(event.payload.sessionId)
    if (!this.dispatch || !session?.runtime || session.settledOverride !== 'settled') return
    if (session.runtime.status === 'stopped') return
    await this.dispatch({
      type: 'session.runtime.stop',
      commandId: v.parse(commandIdSchema, internalCommandKey('settled-release', event.eventId)),
      sessionId: event.payload.sessionId,
      onlyIfSettled: true,
    })
  }

  private async stopRuntime(
    event: Extract<ProviderIntentEvent, { type: 'session.runtime-stop-requested' }>,
  ) {
    if (
      event.payload.onlyIfSettled &&
      this.getReadModel().sessions.get(event.payload.sessionId)?.settledOverride !== 'settled'
    ) {
      recordChatPipelineInfo('chat.pipeline.provider_reactor.stop.skipped', {
        ...orchestrationEventSummary(event),
        reason: 'session-active',
      })
      return
    }
    const runtimeEpoch = this.runtimeEpochFor(event.payload.sessionId)
    recordChatPipelineInfo('chat.pipeline.provider_reactor.stop.start', {
      ...orchestrationEventSummary(event),
    })
    try {
      const binding = await this.providerService.stopRuntime({ sessionId: event.payload.sessionId })
      if (!binding) {
        recordChatPipelineWarning('chat.pipeline.provider_reactor.stop.missing_binding', {
          ...orchestrationEventSummary(event),
        })
        return
      }
    } catch (error) {
      await this.appendProviderFailureActivity({
        runtimeEpoch,
        detail: providerErrorMessage(error),
        event,
        kind: 'provider.runtime.stop.failed',
        summary: 'Provider session stop failed',
      })
    }
  }

  private async revertCheckpoint(
    event: Extract<ProviderIntentEvent, { type: 'session.checkpoint-revert-requested' }>,
  ) {
    const runtimeEpoch = this.runtimeEpochFor(event.payload.sessionId)
    recordChatPipelineInfo('chat.pipeline.provider_reactor.checkpoint_revert.start', {
      ...orchestrationEventSummary(event),
      turnCount: event.payload.turnCount,
    })
    try {
      const context = this.checkpointRevertContext(event)
      if (!context) {
        await this.appendProviderFailureActivity({
          runtimeEpoch,
          detail:
            'Checkpoint revert cannot run without a session, project, Git service, and command dispatcher.',
          event,
          kind: 'checkpoint.revert.failed',
          summary: 'Checkpoint revert failed',
        })
        return
      }

      if (!event.commandId)
        throw createInternalError('Checkpoint revert is missing its command identity.')
      const rollbackTurns = context.currentTurnCount - event.payload.turnCount
      const commitRollback = await this.providerService.prepareConversationRollback({
        numTurns: rollbackTurns,
        sessionId: event.payload.sessionId,
      })
      if (event.payload.restoreFiles) {
        await assertRewindIsolation({
          sessionId: event.payload.sessionId,
          model: this.getReadModel(),
          git: context.git,
          activeRuntimes: await this.providerService.listActiveRuntimes(),
        })
        const restored = await context.git.restoreRef({
          fallbackToHead: event.payload.turnCount === 0,
          path: context.workspacePath,
          ref: context.targetRef,
        })
        if (!restored)
          throw createInternalError(
            `Checkpoint ref is unavailable for turn ${event.payload.turnCount}.`,
          )
      }

      await commitRollback()

      // The projection prune comes first: `session.reverted` is what tells every
      // client which checkpoints still exist, and a ref deleted ahead of it
      // leaves the UI offering a diff whose ref is already gone.
      await Promise.resolve(
        context.dispatch({
          commandId: v.parse(commandIdSchema, `checkpoint-revert-complete:${event.eventId}`),
          createdAt: new Date().toISOString(),
          sessionId: event.payload.sessionId,
          turnCount: event.payload.turnCount,
          type: 'session.revert.complete',
          revertCommandId: event.commandId,
        }),
      )
      await context.git.deleteRefs({
        path: context.workspacePath,
        refs: context.staleRefs,
      })
      recordChatPipelineInfo('chat.pipeline.provider_reactor.checkpoint_revert.complete', {
        deletedRefCount: context.staleRefs.length,
        rollbackTurns,
        sessionId: event.payload.sessionId,
        turnCount: event.payload.turnCount,
        // A revert must read as an edit, not as a commit someone prepared. This
        // is the observable for that: anything staged here is the bug.
        ...(event.payload.restoreFiles
          ? await revertedIndexSummary(context.git, context.workspacePath)
          : {}),
      })
    } catch (error) {
      recordChatPipelineWarning('chat.pipeline.provider_reactor.checkpoint_revert.failed', {
        sessionId: event.payload.sessionId,
        commandId: event.commandId,
        restoreFiles: event.payload.restoreFiles,
        turnCount: event.payload.turnCount,
        error,
      })
      await this.appendProviderFailureActivity({
        runtimeEpoch,
        detail: providerErrorMessage(error),
        event,
        kind: 'checkpoint.revert.failed',
        summary: 'Checkpoint revert failed',
      })
    }
  }

  private async respondApproval(
    event: Extract<ProviderIntentEvent, { type: 'session.approval-response-requested' }>,
  ) {
    const runtimeEpoch = this.runtimeEpochFor(event.payload.sessionId)
    try {
      const handled = await this.providerService.respondApproval({
        decision: event.payload.decision,
        requestId: event.payload.requestId,
        sessionId: event.payload.sessionId,
      })
      if (!handled) {
        await this.appendStaleApproval(event, runtimeEpoch)
        return
      }
      recordChatPipelineInfo('chat.pipeline.provider_reactor.approval.decided', {
        outcome: 'decided',
        requestId: event.payload.requestId,
        sessionId: event.payload.sessionId,
      })
    } catch (error) {
      if (errorStringField(error, 'code') === sessionIdentityErrors.REQUEST_GONE.code) {
        await this.appendStaleApproval(event, runtimeEpoch)
        return
      }
      await this.appendProviderFailureActivity({
        runtimeEpoch,
        ...respondFailure(error),
        event,
        kind: 'provider.approval.respond.failed',
        requestId: event.payload.requestId,
        summary: 'Provider approval response failed',
      })
    }
  }

  /** The agent stopped waiting before the answer arrived: a receipt, never an error. */
  private async appendStaleApproval(
    event: Extract<ProviderIntentEvent, { type: 'session.approval-response-requested' }>,
    runtimeEpoch: string,
  ) {
    recordChatPipelineInfo('chat.pipeline.provider_reactor.approval.stale', {
      outcome: 'stale',
      requestId: event.payload.requestId,
      sessionId: event.payload.sessionId,
    })
    await this.ingestion.ingest({
      createdAt: providerFailureCreatedAt(event),
      detail: STALE_APPROVAL_DETAIL,
      eventId: runtimeEventId('approval-stale'),
      runtimeEpoch,
      kind: 'approval.resolved',
      payload: {
        commandId: event.commandId,
        decision: event.payload.decision,
        detail: STALE_APPROVAL_DETAIL,
        requestId: event.payload.requestId,
        resolution: 'stale',
      },
      summary: 'Answer not used',
      sessionId: event.payload.sessionId,
      tone: 'info',
      turnId: turnIdForProviderFailure(event),
      type: 'activity.append',
    })
  }

  private async respondUserInput(
    event: Extract<ProviderIntentEvent, { type: 'session.user-input-response-requested' }>,
  ) {
    const runtimeEpoch = this.runtimeEpochFor(event.payload.sessionId)
    try {
      const handled = await this.providerService.respondUserInput({
        answers: await appendUserInputAttachmentPaths(
          event.payload.answers,
          event.payload.attachmentsByQuestionId,
          this.attachmentsDir,
        ),
        requestId: event.payload.requestId,
        sessionId: event.payload.sessionId,
      })
      if (handled) return

      await this.appendProviderFailureActivity({
        runtimeEpoch,
        ...noActiveSessionFailure(),
        event,
        kind: 'provider.user-input.respond.failed',
        requestId: event.payload.requestId,
        summary: 'Provider user input response failed',
      })
    } catch (error) {
      await this.appendProviderFailureActivity({
        runtimeEpoch,
        ...respondFailure(error),
        event,
        kind: 'provider.user-input.respond.failed',
        requestId: event.payload.requestId,
        summary: 'Provider user input response failed',
      })
    }
  }

  private async appendProviderFailureActivity(input: {
    code?: string
    detail: string
    event: ProviderIntentEvent
    kind:
      | 'checkpoint.revert.failed'
      | 'provider.approval.respond.failed'
      | 'provider.runtime.stop.failed'
      | 'provider.turn.interrupt.failed'
      | 'provider.turn.start.failed'
      | 'provider.turn.steer.failed'
      | 'provider.user-input.respond.failed'
    requestId?: string
    runtimeEpoch: string
    summary: string
  }) {
    await this.ingestion.ingest({
      createdAt: providerFailureCreatedAt(input.event),
      detail: input.detail,
      eventId: runtimeEventId(input.kind),
      runtimeEpoch: input.runtimeEpoch,
      kind: input.kind,
      payload: {
        ...providerFailurePayload(input),
        commandId: input.event.commandId,
      },
      summary: input.summary,
      sessionId: input.event.payload.sessionId,
      tone: 'error',
      turnId: turnIdForProviderFailure(input.event),
      type: 'activity.append',
    })
  }

  private async turnContext(
    event: Extract<ProviderIntentEvent, { type: 'session.turn-start-requested' }>,
  ) {
    const model = this.getReadModel()
    const session = model.sessions.get(event.payload.sessionId)
    if (!session) return null

    const { project, worktree } = resolveSessionOwner(model, session.id)
    if (
      worktree.lifecycle.state !== 'ready' ||
      session.latestTurn?.providerStartState === 'blocked-on-worktree'
    )
      return null

    const message = session.messages.find((candidate) => candidate.id === event.payload.messageId)
    if (!message) return null

    const modelSelection = event.payload.modelSelection ?? session.modelSelection

    return {
      interactionMode: event.payload.interactionMode ?? session.interactionMode,
      message,
      runtimeEpoch: session.latestTurn?.runtimeEpoch ?? crypto.randomUUID(),
      modelSelection,
      project,
      worktree,
      runtimeMode: event.payload.runtimeMode ?? session.runtimeMode ?? DEFAULT_RUNTIME_MODE,
      session,
    }
  }

  private async handleTurnFailure(
    event: Extract<ProviderIntentEvent, { type: 'session.turn-start-requested' }>,
    context: ProviderTurnContext,
    error: unknown,
  ) {
    const { session, modelSelection, runtimeMode, runtimeEpoch } = context
    const sessionId = session.id
    // Shutdown rejects every in-flight turn. Recording that as an error would stop
    // boot recovery from marking the turn interrupted by the restart.
    if (this.providerService.isShuttingDown()) {
      recordChatPipelineInfo('chat.pipeline.provider_reactor.turn_failure.left_for_recovery', {
        sessionId,
        turnId: event.payload.turnId,
      })
      return
    }
    if (!this.ownsStart(event, context, 'claimed') && !this.ownsStart(event, context, 'adopted')) {
      recordChatPipelineInfo('chat.pipeline.provider_reactor.turn_failure.discarded', {
        sessionId,
        turnId: event.payload.turnId,
        runtimeEpoch,
        reason: 'turn-ownership-ended',
      })
      return
    }
    const detail = providerErrorMessage(error)
    await this.appendProviderFailureActivity({
      detail,
      event,
      runtimeEpoch,
      kind: 'provider.turn.start.failed',
      summary: 'Provider turn start failed',
    })
    await this.ingestSession({
      lastError: detail,
      runtimeEpoch,
      providerInstanceId: modelSelection.providerInstanceId,
      providerBindingHandle:
        this.providerService.bindingForSession(sessionId)?.providerBindingHandle ?? null,
      runtimeMode,
      status: 'error',
      sessionId,
      turnId: event.payload.turnId,
    })
  }

  private async ingestSession(input: {
    lastError?: string | null
    providerInstanceId: ModelSelection['providerInstanceId']
    providerBindingHandle: string | null
    runtimeMode?: RuntimeMode
    runtimeEpoch: string
    status: SessionRuntimeStatus
    sessionId: SessionId
    turnId: TurnId | null
  }) {
    recordChatPipelineInfo('chat.pipeline.provider_reactor.ingest_session', {
      providerInstanceId: input.providerInstanceId,
      providerBindingHandle: input.providerBindingHandle,
      runtimeEpoch: input.runtimeEpoch,
      runtimeMode: input.runtimeMode,
      sessionStatus: input.status,
      sessionId: input.sessionId,
      turnId: input.turnId,
    })
    await this.ingestion.ingest({
      createdAt: new Date().toISOString(),
      eventId: runtimeEventId('provider-session'),
      lastError: input.lastError,
      providerInstanceId: input.providerInstanceId,
      providerName: providerDisplayName(input.providerInstanceId),
      providerBindingHandle: input.providerBindingHandle,
      runtimeEpoch: input.runtimeEpoch,
      runtimeMode: input.runtimeMode,
      status: input.status,
      sessionId: input.sessionId,
      turnId: input.turnId,
      type: 'runtime.set',
    })
  }

  private async ingestProviderRuntimeEvent(event: ProviderRuntimeEvent) {
    recordChatPipelineInfo('chat.pipeline.provider_reactor.runtime_event', {
      ...providerRuntimeEventSummary(event),
    })
    await this.ingestion.ingest(event)
  }

  private hasHandledTurnStart(
    event: Extract<ProviderIntentEvent, { type: 'session.turn-start-requested' }>,
  ) {
    const key = turnStartKeyForEvent(event)
    const handled = this.handledTurnStarts.has(key)

    return handled
  }

  private checkpointRevertContext(
    event: Extract<ProviderIntentEvent, { type: 'session.checkpoint-revert-requested' }>,
  ) {
    const git = this.checkpointGit
    const dispatch = this.dispatch
    if (!git || !dispatch) return null

    const model = this.getReadModel()
    const session = model.sessions.get(event.payload.sessionId)
    if (!session) return null

    const { worktree } = resolveSessionOwner(model, session.id)

    const checkpoints = Object.values(session.checkpointByTurnId).toSorted(
      (left, right) => left.checkpointTurnCount - right.checkpointTurnCount,
    )
    const currentTurnCount = maxCheckpointTurnCount(checkpoints)
    if (event.payload.turnCount > currentTurnCount) {
      throw createInternalError(
        `Checkpoint ${event.payload.turnCount} is newer than current checkpoint ${currentTurnCount}.`,
      )
    }

    const targetRef = checkpointRefForTurnCount(
      event.payload.sessionId,
      event.payload.turnCount,
      checkpoints,
    )
    const staleRefs = checkpoints
      .filter((checkpoint) => checkpoint.checkpointTurnCount > event.payload.turnCount)
      .map((checkpoint) => checkpoint.checkpointRef)

    return {
      currentTurnCount,
      dispatch,
      git,
      staleRefs,
      targetRef,
      workspacePath: worktree.canonicalPath,
    }
  }

  private trackProviderAction(task: Promise<void>) {
    let tracked: Promise<void>
    tracked = task
      .catch((error) => {
        recordChatPipelineWarning('chat.pipeline.provider_reactor.provider_action_failed', {
          error,
        })
      })
      .finally(() => {
        this.pendingProviderActions.delete(tracked)
        recordChatPipelineInfo('chat.pipeline.provider_reactor.task_settled', {
          pendingCount: this.pendingProviderActions.size,
        })
      })
    this.pendingProviderActions.add(tracked)
    recordChatPipelineInfo('chat.pipeline.provider_reactor.task_tracked', {
      pendingCount: this.pendingProviderActions.size,
    })
  }
}

/**
 * Never rejects: the revert already happened, so a failed status read costs a
 * log field and nothing else.
 */
async function revertedIndexSummary(git: GitService, workspacePath: string) {
  try {
    const status = await git.status(workspacePath)
    const staged = status.files.filter((file) => file.index !== 'unmodified')

    return { changedFileCount: status.files.length, stagedFileCount: staged.length }
  } catch (error) {
    return { statusError: providerErrorMessage(error) }
  }
}

function isProviderIntentEvent(event: OrchestrationEvent): event is ProviderIntentEvent {
  switch (event.type) {
    case 'session.turn-start-requested':
    case 'session.turn-steer-requested':
    case 'session.turn-interrupt-requested':
    case 'session.runtime-stop-requested':
    case 'session.settled':
    case 'session.checkpoint-revert-requested':
    case 'session.approval-response-requested':
    case 'session.user-input-response-requested':
      return true
    default:
      return false
  }
}

function providerFailurePayload(input: { code?: string; detail: string; requestId?: string }) {
  return {
    detail: input.detail,
    ...(input.code ? { code: input.code } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
  }
}

function providerFailureCreatedAt(event: ProviderIntentEvent) {
  if ('createdAt' in event.payload) return event.payload.createdAt

  return event.occurredAt
}

function turnIdForProviderFailure(event: ProviderIntentEvent) {
  if ('turnId' in event.payload) return event.payload.turnId ?? null

  return null
}

function runtimePayloadFromSessionContext(
  context: ProviderSessionContext,
): ProviderRuntimeStartPayload {
  return {
    ...(context.session.agent ? { agent: context.session.agent } : {}),
    cwd: context.worktree.canonicalPath,
    interactionMode: context.interactionMode,
    modelSelection: context.modelSelection,
    runtimeMode: context.runtimeMode,
  }
}

function checkpointRefForTurnCount(
  sessionId: SessionId,
  turnCount: number,
  checkpoints: Array<{
    checkpointRef: string
    checkpointTurnCount: number
    status: 'ready' | 'missing' | 'error'
  }>,
) {
  if (turnCount === 0) return checkpointRefForSessionTurn(sessionId, 0)

  const checkpoint = checkpoints.find((candidate) => candidate.checkpointTurnCount === turnCount)
  if (!checkpoint || checkpoint.status !== 'ready') {
    throw createInternalError(`Checkpoint ref is unavailable for turn ${turnCount}.`)
  }

  return checkpoint.checkpointRef
}

function turnStartKeyForEvent(
  event: Extract<ProviderIntentEvent, { type: 'session.turn-start-requested' }>,
) {
  if (event.commandId !== null) return `command:${event.commandId}`

  return `event:${event.eventId}`
}

/** The activity carries the code, so `pending-requests` can tell a dead request from a transient failure. */
const STALE_APPROVAL_DETAIL =
  'Your answer arrived after the agent stopped waiting. It was not used.'

function noActiveSessionFailure() {
  return {
    code: sessionIdentityErrors.REQUEST_GONE.code,
    detail: `${noActiveSessionDetail()} ${sessionIdentityErrors.REQUEST_GONE.fix}`,
  }
}

function noActiveSessionDetail() {
  return 'No active provider session is bound to this session.'
}

function respondFailure(error: unknown) {
  const code = errorStringField(error, 'code')
  if (code !== sessionIdentityErrors.REQUEST_GONE.code)
    return { detail: providerErrorMessage(error) }

  const gone = sessionIdentityErrors.REQUEST_GONE
  return { code, detail: `${gone.message}. ${gone.fix}` }
}

function providerDisplayName(providerInstanceId: ModelSelection['providerInstanceId']) {
  if (providerInstanceId === DEFAULT_CODEX_PROVIDER_SETTINGS.providerInstanceId) {
    return DEFAULT_CODEX_PROVIDER_SETTINGS.displayLabel
  }

  return providerInstanceId
}

type ProviderSessionContext = {
  interactionMode: InteractionMode
  modelSelection: ModelSelection
  project: OrchestrationProject
  worktree: ReturnType<typeof resolveSessionOwner>['worktree']
  runtimeMode: RuntimeMode
  session: OrchestrationSession
}

type ProviderTurnContext = ProviderSessionContext & {
  message: OrchestrationMessage
  runtimeEpoch: string
}
