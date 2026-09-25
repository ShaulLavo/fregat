import type { ProviderUsagePurpose } from '@workspace/contracts'
import { BackgroundTaskRegistry } from './background-liveness'
import { elapsedMs } from '@workspace/utils/timing'
import path from 'node:path'
import { tmpdir } from 'node:os'
import type { AgentTerminalProcess } from '../terminal/agent-launch'
import { mkdtemp, rm } from 'node:fs/promises'
import { createInternalError } from '../observability/structured-errors'
import { sessionIdentityErrors } from './structured-errors'

import type {
  ModelSelection,
  ProviderInstanceId,
  ProviderSnapshot,
  RuntimeMode,
  SessionId,
  WorktreeId,
} from '@workspace/contracts'
import {
  DEFAULT_INTERACTION_MODE,
  jsonEqual,
  DEFAULT_RUNTIME_MODE,
  sessionIdSchema,
  turnIdSchema,
} from '@workspace/contracts'
import * as v from 'valibot'
import { providerContinuationKey } from './driver'
import type { ProviderRuntimeStartPayload } from './session-payload'
import type {
  ProviderAdapterRegistry,
  ProviderInstanceRoutingInfo,
} from './provider-adapter-registry'
import { createDefaultProviderAdapterRegistry } from './provider-adapter-registry'
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBindingWithMetadata,
} from './provider-session-directory'
import { ProviderSessionReaper } from './provider-session-reaper'
import { SerialWorker } from '../orchestration/serial-worker'
import {
  providerBindingSummary,
  providerRuntimeEventSummary,
  providerTurnControlSummary,
  providerTurnSummary,
  recordChatPipelineInfo,
  recordChatPipelineWarning,
} from '../orchestration/orchestration-logging'
import type {
  ProviderApprovalResponseInput,
  ProviderRuntimeEvent,
  ProviderRuntimeStartInput,
  ProviderTurnControlInput,
  ProviderTurnInput,
  ProviderTurnSteerInput,
  ProviderUserInputResponseInput,
  ProviderSessionDiscoveryInput,
  ProviderSessionHistoryInput,
} from './types'
import {
  ProviderTextGenerationTask,
  type ProviderTextGenerationInput,
  type ProviderTextGenerationResult,
} from './text-generation'

export type ProviderServiceOptions = {
  adapterRegistry?: ProviderAdapterRegistry
  /** Overridden in tests that need the deadline to be reachable within one. */
  idleSessionDeadlineMs?: number
  sessionDirectory?: ProviderSessionDirectory
}

export type ProviderEnsureRuntimeInput = {
  providerInstanceId: ProviderInstanceId
  runtimeMode: RuntimeMode
  runtimePayload: ProviderRuntimeStartPayload
  runtimeEpoch: string
  resumeExisting?: boolean
  sessionId: SessionId
}

export type ProviderEnsureRuntimeResult = {
  binding: ProviderRuntimeBindingWithMetadata
  reused: boolean
}

export type ProviderWorktreeExecution = {
  acquire: (input: {
    sessionId: SessionId
    cwd: string | undefined
  }) => { worktreeId: WorktreeId; release: () => void } | null
}

export type ProviderRuntimeEventListener = (event: ProviderRuntimeEvent) => Promise<void> | void

type ProviderUsageTotalsEvent = Extract<ProviderRuntimeEvent, { type: 'usage.totals' }>

export type ProviderUsageListener = (
  event: ProviderUsageTotalsEvent,
  purpose: ProviderUsagePurpose,
) => void

/** The adapter a stream belongs to, kept beside its teardown so a replacement can be spotted. */
type AdapterSubscription = {
  adapter: ReturnType<ProviderAdapterRegistry['getByInstance']>
  unsubscribe: () => void
}

type ProviderRuntimeEventTask = {
  adapter: ReturnType<ProviderAdapterRegistry['getByInstance']>
  event: ProviderRuntimeEvent
  providerInstanceId: ProviderInstanceId
}

type PendingProviderLaunch = {
  adapter: ReturnType<ProviderAdapterRegistry['getByInstance']>
  completion: Promise<void>
  providerInstanceId: ProviderInstanceId
}

export class ProviderService {
  private readonly adapterSubscriptions = new Map<ProviderInstanceId, AdapterSubscription>()
  private readonly adapterRegistry: ProviderAdapterRegistry
  private readonly externalSessions = new Map<SessionId, 'terminal' | 'history' | 'unknown'>()
  private readonly pendingLaunches = new Map<SessionId, PendingProviderLaunch>()
  private readonly backgroundTasks = new BackgroundTaskRegistry()
  private readonly reaperTimer: ReturnType<typeof setInterval>
  private readonly reaper: ProviderSessionReaper
  private readonly runtimeEventListeners = new Set<ProviderRuntimeEventListener>()
  private readonly runtimeEvents = new SerialWorker<ProviderRuntimeEventTask>((task) =>
    this.handleRuntimeEvent(task),
  )
  private readonly sessionDirectory: ProviderSessionDirectory
  /** Ended text-generation sessions whose late events are dropped, by what they were for. */
  private readonly suppressedTextGenerationSessions = new Map<SessionId, ProviderUsagePurpose>()
  private readonly usageListeners = new Set<ProviderUsageListener>()
  private readonly textGenerationTasks = new Map<SessionId, ProviderTextGenerationTask>()
  private worktreeExecution: ProviderWorktreeExecution | null = null
  private readonly worktreeLeases = new Map<
    SessionId,
    {
      worktreeId: WorktreeId
      release: () => void
      adapter: ReturnType<ProviderAdapterRegistry['getByInstance']>
    }
  >()
  private shuttingDown = false
  private unsubscribeRegistry: (() => void) | null = null

  constructor(options: ProviderServiceOptions = {}) {
    this.adapterRegistry = options.adapterRegistry ?? createDefaultProviderAdapterRegistry()
    this.sessionDirectory = options.sessionDirectory ?? new ProviderSessionDirectory()
    this.reaper = new ProviderSessionReaper({
      deadlineMs: options.idleSessionDeadlineMs,
      directory: this.sessionDirectory,
      isLaunching: (sessionId) => this.pendingLaunches.has(sessionId),
      hasBackgroundWork: (sessionId) => this.backgroundTasks.get(sessionId) !== null,
      stopRuntime: (input) => this.stopRuntime(input),
    })
    this.reaperTimer = setInterval(
      () => {
        void this.reaper.sweep().catch((error) =>
          recordChatPipelineWarning('chat.pipeline.provider_session_reaper.sweep_failed', {
            error,
          }),
        )
      },
      5 * 60 * 1000,
    )
    this.reaperTimer.unref()
    this.startAdapterEventStreams()
  }

  /**
   * Liveness, called for every runtime event the ingestion pipeline accepts.
   * The reaper's deadline is only safe to act on because this is fed.
   */
  backgroundLiveness(sessionId: string) {
    return this.backgroundTasks.get(sessionId)
  }

  markRuntimeSeen(sessionId: SessionId) {
    this.sessionDirectory.markSeen(sessionId)
  }

  /**
   * Releases the whole provider runtime: stops consuming adapter streams and
   * disposes every live instance, which is what kills the CLI children. Without
   * this the app exits and leaves `codex app-server` processes behind.
   */
  async shutdown() {
    this.shuttingDown = true
    clearInterval(this.reaperTimer)
    await this.reaper.waitForIdle()
    this.unsubscribeRegistry?.()
    this.unsubscribeRegistry = null
    this.runtimeEventListeners.clear()
    for (const { unsubscribe } of this.adapterSubscriptions.values()) {
      unsubscribe()
    }
    this.adapterSubscriptions.clear()
    const pendingLaunches = await Promise.allSettled(
      [...this.pendingLaunches.values()].map((launch) =>
        boundedProviderOperation(launch.adapter, launch.completion),
      ),
    )
    await this.adapterRegistry.dispose()
    recordChatPipelineInfo('chat.pipeline.provider_service.shutdown.complete', {
      pendingLaunchCount: pendingLaunches.length,
      timedOutLaunchCount: pendingLaunches.filter((result) => result.status === 'rejected').length,
    })
  }

  setWorktreeExecution(boundary: ProviderWorktreeExecution) {
    this.worktreeExecution = boundary
  }

  hasWorktreeLease(worktreeId: WorktreeId) {
    return [...this.worktreeLeases.values()].some((lease) => lease.worktreeId === worktreeId)
  }

  private retainWorktree(
    sessionId: SessionId,
    cwd: string | undefined,
    adapter: ReturnType<ProviderAdapterRegistry['getByInstance']>,
  ) {
    if (this.worktreeLeases.has(sessionId)) return
    const lease = this.worktreeExecution?.acquire({ sessionId, cwd })
    if (lease) this.worktreeLeases.set(sessionId, { ...lease, adapter })
  }

  private releaseWorktree(sessionId: SessionId) {
    this.worktreeLeases.get(sessionId)?.release()
    this.worktreeLeases.delete(sessionId)
  }

  async ensureRuntime(input: ProviderEnsureRuntimeInput): Promise<ProviderEnsureRuntimeResult> {
    this.requireSdkOwnership(input.sessionId)
    return this.trackLaunch(input, () => this.ensureRuntimeOperation(input))
  }

  private async ensureRuntimeOperation(
    input: ProviderEnsureRuntimeInput,
  ): Promise<ProviderEnsureRuntimeResult> {
    const adapter = this.adapterRegistry.getByInstance(input.providerInstanceId)
    this.retainWorktree(input.sessionId, input.runtimePayload.cwd, adapter)
    recordChatPipelineInfo('chat.pipeline.provider_service.ensure_session.start', {
      model: input.runtimePayload.modelSelection?.model,
      providerInstanceId: input.providerInstanceId,
      runtimeMode: input.runtimeMode,
      sessionId: input.sessionId,
    })
    // Reclaim before allocating, and never the session being ensured: its own
    // binding can easily be the oldest one here.
    await this.reaper.sweep({ exceptSessionId: input.sessionId })
    const existing = this.sessionDirectory.getBinding(input.sessionId)
    if (existing && existing.providerInstanceId !== input.providerInstanceId)
      throw sessionIdentityErrors.SESSION_PROVIDER_CONFLICT({
        internal: {
          sessionId: input.sessionId,
          boundTo: existing.providerInstanceId,
          requested: input.providerInstanceId,
          boundEpoch: existing.runtimeEpoch,
          requestedEpoch: input.runtimeEpoch,
        },
      })
    const reusableBinding =
      existing?.runtimeEpoch === input.runtimeEpoch &&
      canReuseProviderBinding(existing, input, adapter)
        ? existing
        : null
    const activeReusableBinding = reusableBinding
      ? await activeProviderBinding(adapter, reusableBinding)
      : null
    if (activeReusableBinding) {
      this.requireRunning()
      const binding = this.sessionDirectory.upsert({
        ...bindingForUpsert(activeReusableBinding),
        runtimePayload: input.runtimePayload,
      })
      recordChatPipelineInfo('chat.pipeline.provider_service.ensure_session.complete', {
        ...providerBindingSummary(binding),
        reused: true,
      })

      return { binding, reused: true }
    }

    await this.stopReplacedBinding(existing, input.providerInstanceId)
    // A parameter change (model, runtime mode, cwd) restarts the session but
    // must not restart the *conversation*: the cursor of the account we are
    // still talking to travels into the new session.
    const continuation = continuableBinding(existing, adapter, input.providerInstanceId, {
      modelChanged: bindingModelChanged(existing, input.runtimePayload.modelSelection),
    })
    this.requireSdkOwnership(input.sessionId)
    this.recordLaunch(input, adapter)
    const session = await adapter.startRuntime(
      providerRuntimeStartInput(input, input.runtimePayload, continuation),
    )
    this.requireRunning()
    const binding = this.sessionDirectory.upsert({
      adapterKey: adapter.adapterKey,
      providerDriverKind: adapter.driverKind,
      providerInstanceId: input.providerInstanceId,
      providerBindingHandle: session.providerBindingHandle,
      providerResumeCursor:
        session.providerResumeCursor ?? continuation?.providerResumeCursor ?? null,
      runtimeMode: input.runtimeMode,
      runtimePayload: input.runtimePayload,
      runtimeEpoch: input.runtimeEpoch,
      providerConversationMarker: session.providerConversationMarker ?? null,
      sessionId: input.sessionId,
    })

    recordChatPipelineInfo('chat.pipeline.provider_service.ensure_session.complete', {
      ...providerBindingSummary(binding),
      reused: false,
    })

    return { binding, reused: false }
  }

  async sendTurn(input: ProviderTurnInput) {
    this.requireSdkOwnership(input.sessionId)
    this.requireRunning()
    const startedAt = performance.now()
    recordChatPipelineInfo(
      'chat.pipeline.provider_service.send_turn.start',
      providerTurnSummary(input),
    )
    const adapter = this.adapterRegistry.getByInstance(input.providerInstanceId)
    this.retainWorktree(input.sessionId, input.cwd, adapter)
    // The adapter may have to (re)open a session for this turn — after a server
    // restart, or because the model changed. It can only continue the existing
    // conversation if the cursor rides along with the turn.
    const turn = this.turnWithResumeCursor(input, adapter)

    try {
      await adapter.sendTurn(turn)
      recordChatPipelineInfo('chat.pipeline.provider_service.send_turn.complete', {
        ...providerTurnSummary(input),
        durationMs: elapsedMs(startedAt),
      })
    } catch (error) {
      recordChatPipelineWarning('chat.pipeline.provider_service.send_turn.failed', {
        ...providerTurnSummary(input),
        durationMs: elapsedMs(startedAt),
        error,
      })
      throw error
    }
  }

  requireSteeringAvailable(sessionId: SessionId) {
    this.requireSdkOwnership(sessionId)
    this.requireRunning()
    const routed = this.routeSession(sessionId)
    if (!routed?.adapter.steerTurn)
      throw sessionIdentityErrors.STEERING_UNAVAILABLE({
        internal: { sessionId, routed: Boolean(routed), at: 'require-steering' },
      })
    return routed
  }

  async steerTurn(input: ProviderTurnSteerInput) {
    const routed = this.requireSteeringAvailable(input.sessionId)
    const steer = routed.adapter.steerTurn
    if (!steer)
      throw sessionIdentityErrors.STEERING_UNAVAILABLE({
        internal: { sessionId: input.sessionId, at: 'steer-turn' },
      })
    await steer.call(routed.adapter, input)
  }

  /** Runs one provider turn on the shared adapters without creating a chat projection. */
  async generateText(input: ProviderTextGenerationInput): Promise<ProviderTextGenerationResult> {
    const startedAt = performance.now()
    const providerInstanceId = input.modelSelection.providerInstanceId
    const adapterLease = this.adapterRegistry.acquireInstanceLease(providerInstanceId)
    const adapter = adapterLease.adapter
    const ids = textGenerationIds()
    let isolatedCwd: string | null = null
    let startPromise: Promise<unknown> | null = null
    let turnStarted = false
    let interruptPromise: Promise<void> | null = null
    let stopPromise: Promise<boolean> | null = null
    const stopRuntime = () => {
      if (!startPromise) return Promise.resolve(true)
      if (stopPromise) return stopPromise

      stopPromise = this.stopTextGenerationSession(adapter, ids.sessionId, startPromise)
      return stopPromise
    }
    const interrupt = () => {
      if (interruptPromise) return interruptPromise

      interruptPromise = Promise.all([
        this.interruptTextGenerationTurn(adapter, ids, turnStarted),
        stopRuntime(),
      ]).then(noop)
      return interruptPromise
    }
    const task = new ProviderTextGenerationTask({
      interrupt,
      providerInstanceId,
      purpose: input.purpose,
      ...ids,
    })
    const abort = () => void task.interrupt()
    this.textGenerationTasks.set(ids.sessionId, task)
    input.signal?.addEventListener('abort', abort, { once: true })
    recordChatPipelineInfo('chat.pipeline.provider_service.text_generation.start', {
      model: input.modelSelection.model,
      promptLength: input.messageText.length,
      providerInstanceId,
      sessionId: ids.sessionId,
      turnId: ids.turnId,
    })

    try {
      throwIfTextGenerationAborted(input.signal)
      isolatedCwd = await mkdtemp(path.join(tmpdir(), 'platform-provider-text-'))
      startPromise = adapter.startRuntime({
        cwd: isolatedCwd,
        ephemeral: true,
        interactionMode: DEFAULT_INTERACTION_MODE,
        modelSelection: input.modelSelection,
        providerInstanceId,
        runtimeMode: 'approval-required',
        sessionId: ids.sessionId,
        runtimeEpoch: ids.runtimeEpoch,
      })
      await startPromise
      throwIfTextGenerationAborted(input.signal)
      turnStarted = true
      await adapter.sendTurn({
        attachments: input.attachments ?? [],
        attachmentsDir: input.attachmentsDir,
        cwd: isolatedCwd,
        ephemeral: true,
        interactionMode: DEFAULT_INTERACTION_MODE,
        messageText: input.messageText,
        modelSelection: input.modelSelection,
        providerInstanceId,
        runtimeMode: 'approval-required',
        sessionId: ids.sessionId,
        runtimeEpoch: ids.runtimeEpoch,
        turnId: ids.turnId,
      })
      await this.drainRuntimeEvents()
      throwIfTextGenerationAborted(input.signal)
      const result = textGenerationResult(task)
      recordChatPipelineInfo('chat.pipeline.provider_service.text_generation.complete', {
        durationMs: elapsedMs(startedAt),
        model: input.modelSelection.model,
        outputLength: result.text.length,
        providerInstanceId,
        sessionId: ids.sessionId,
        turnId: ids.turnId,
      })
      return result
    } catch (error) {
      const failure = input.signal?.aborted
        ? createInternalError('Provider text generation was cancelled.', error)
        : error
      recordChatPipelineWarning('chat.pipeline.provider_service.text_generation.failed', {
        aborted: input.signal?.aborted ?? false,
        durationMs: elapsedMs(startedAt),
        error: failure,
        model: input.modelSelection.model,
        providerInstanceId,
        sessionId: ids.sessionId,
        turnId: ids.turnId,
      })
      throw failure
    } finally {
      input.signal?.removeEventListener('abort', abort)
      const stopped = await stopRuntime()
      if (stopped && isolatedCwd) {
        await rm(isolatedCwd, { recursive: true, force: true }).catch((error: unknown) => {
          recordChatPipelineWarning(
            'chat.pipeline.provider_service.text_generation.cleanup_failed',
            { sessionId: ids.sessionId, error },
          )
        })
      }
      await this.drainRuntimeEvents()
      this.suppressCompletedTextGeneration(ids.sessionId, input.purpose)
      this.textGenerationTasks.delete(ids.sessionId)
      adapterLease.release()
    }
  }

  async interruptTurn(input: ProviderTurnControlInput) {
    recordChatPipelineInfo('chat.pipeline.provider_service.interrupt.start', {
      ...providerTurnControlSummary(input),
    })
    const routed = this.routeSession(input.sessionId)
    if (!routed) {
      recordChatPipelineWarning('chat.pipeline.provider_service.interrupt.missing_binding', {
        ...providerTurnControlSummary(input),
      })
      return null
    }

    await routed.adapter.interruptTurn(input)
    this.sessionDirectory.markSeen(input.sessionId)
    const binding = routed.binding
    recordChatPipelineInfo('chat.pipeline.provider_service.interrupt.complete', {
      ...providerBindingSummary(binding),
      ...providerTurnControlSummary(input),
    })

    return binding
  }

  async stopRuntime(input: { sessionId: SessionId; idleBefore?: string }) {
    recordChatPipelineInfo('chat.pipeline.provider_service.stop.start', input)
    await this.awaitPendingLaunch(input.sessionId)
    if (
      input.idleBefore &&
      (this.backgroundTasks.get(input.sessionId) !== null ||
        !this.sessionDirectory
          .listIdleSince(input.idleBefore, 'ready')
          .some((binding) => binding.sessionId === input.sessionId))
    )
      return null
    const routed = this.routeSession(input.sessionId)
    if (!routed) {
      recordChatPipelineWarning('chat.pipeline.provider_service.stop.missing_binding', input)
      const retained = this.worktreeLeases.get(input.sessionId)
      if (retained) await this.stopAndRelease(retained.adapter, input.sessionId)
      return null
    }

    await this.stopAndRelease(routed.adapter, input.sessionId)
    this.sessionDirectory.markSeen(input.sessionId)
    const binding = routed.binding
    recordChatPipelineInfo('chat.pipeline.provider_service.stop.complete', {
      ...providerBindingSummary(binding),
    })

    return binding
  }

  async respondApproval(input: ProviderApprovalResponseInput) {
    recordChatPipelineInfo('chat.pipeline.provider_service.approval.start', {
      requestId: input.requestId,
      sessionId: input.sessionId,
    })
    const routed = this.routeSession(input.sessionId)
    if (!routed) {
      recordChatPipelineWarning('chat.pipeline.provider_service.approval.missing_binding', {
        requestId: input.requestId,
        sessionId: input.sessionId,
      })
      return false
    }

    await routed.adapter.respondApproval(input)
    recordChatPipelineInfo('chat.pipeline.provider_service.approval.complete', {
      requestId: input.requestId,
      sessionId: input.sessionId,
    })
    return true
  }

  async respondUserInput(input: ProviderUserInputResponseInput) {
    recordChatPipelineInfo('chat.pipeline.provider_service.user_input.start', {
      requestId: input.requestId,
      sessionId: input.sessionId,
    })
    const routed = this.routeSession(input.sessionId)
    if (!routed) {
      recordChatPipelineWarning('chat.pipeline.provider_service.user_input.missing_binding', {
        requestId: input.requestId,
        sessionId: input.sessionId,
      })
      return false
    }

    await routed.adapter.respondUserInput(input)
    recordChatPipelineInfo('chat.pipeline.provider_service.user_input.complete', {
      requestId: input.requestId,
      sessionId: input.sessionId,
    })
    return true
  }

  async listActiveRuntimes() {
    const bindings = this.sessionDirectory.listBindings()
    const active = await Promise.all(
      bindings.map(async (binding) => {
        const adapter = this.adapterRegistry.adapter(binding.providerInstanceId)
        if (
          !adapter ||
          !(await boundedProviderOperation(
            adapter,
            adapter.hasRuntime({ sessionId: binding.sessionId }),
          ))
        )
          return null
        return binding
      }),
    )
    return active.filter((binding) => binding !== null)
  }

  async hasActiveRuntimeForInstance(providerInstanceId: ProviderInstanceId) {
    if (
      [...this.pendingLaunches.values()].some(
        (launch) => launch.providerInstanceId === providerInstanceId,
      )
    )
      return true
    const active = await this.listActiveRuntimes()
    return active.some((binding) => binding.providerInstanceId === providerInstanceId)
  }

  discoveryInstances() {
    return this.adapterRegistry
      .listInstances()
      .filter((id) => Boolean(this.adapterRegistry.adapter(id)?.discoverSessions))
  }

  importSources() {
    return this.adapterRegistry.importSources()
  }

  readSessionHistory(
    input: ProviderSessionHistoryInput & { providerInstanceId: ProviderInstanceId },
  ) {
    const adapter = this.adapterRegistry.getByInstance(input.providerInstanceId)
    if (!adapter.readSessionHistory)
      throw sessionIdentityErrors.HISTORY_UNSUPPORTED({
        internal: { providerInstanceId: input.providerInstanceId },
      })
    return boundedProviderOperation(adapter, adapter.readSessionHistory(input))
  }

  discoverSessions(
    input: ProviderSessionDiscoveryInput & { providerInstanceId: ProviderInstanceId },
  ) {
    const adapter = this.adapterRegistry.getByInstance(input.providerInstanceId)
    return adapter.discoverSessions?.(input) ?? Promise.resolve([])
  }

  async hasRuntime(input: { sessionId: SessionId }) {
    await this.awaitPendingLaunch(input.sessionId)
    const routed = this.routeSession(input.sessionId)
    const adapter = routed?.adapter ?? this.worktreeLeases.get(input.sessionId)?.adapter
    if (!adapter) return false
    return boundedProviderOperation(adapter, adapter.hasRuntime(input))
  }

  async reusableRuntimeEpoch(
    input: Omit<ProviderEnsureRuntimeInput, 'runtimeEpoch'>,
  ): Promise<string | null> {
    await this.awaitPendingLaunch(input.sessionId)
    const adapter = this.adapterRegistry.getByInstance(input.providerInstanceId)
    const binding = this.sessionDirectory.getBinding(input.sessionId)
    if (!binding || !canReuseProviderBinding(binding, input, adapter)) return null
    const active = await activeProviderBinding(adapter, binding)
    return active?.runtimeEpoch ?? null
  }

  getCapabilities(providerInstanceId: ProviderInstanceId): Promise<ProviderSnapshot['traits']> {
    return this.adapterRegistry.snapshot(providerInstanceId).then((snapshot) => snapshot.traits)
  }

  getInstanceRoutingInfo(
    providerInstanceId: ProviderInstanceId,
  ): Promise<ProviderInstanceRoutingInfo> {
    return this.adapterRegistry.getInstanceRoutingInfo(providerInstanceId)
  }

  private async assertConversationRollbackSupported(sessionId: SessionId) {
    this.requireSdkOwnership(sessionId)
    const routed = this.routeSession(sessionId)
    if (!routed)
      throw sessionIdentityErrors.ROLLBACK_RUNTIME_UNAVAILABLE({
        internal: { sessionId, reason: 'unrouted' },
      })
    if (!routed.adapter.capabilities.conversationRollback)
      throw sessionIdentityErrors.ROLLBACK_UNSUPPORTED({
        internal: { sessionId, providerInstanceId: routed.binding.providerInstanceId },
      })
    if (!(await boundedProviderOperation(routed.adapter, routed.adapter.hasRuntime({ sessionId }))))
      throw sessionIdentityErrors.ROLLBACK_RUNTIME_UNAVAILABLE({
        internal: {
          sessionId,
          reason: 'no-runtime',
          providerInstanceId: routed.binding.providerInstanceId,
        },
      })
    return routed
  }

  async prepareConversationRollback(input: { numTurns: number; sessionId: SessionId }) {
    const routed = await this.assertConversationRollbackSupported(input.sessionId)
    if (input.numTurns === 0) return async () => {}
    return routed.adapter.prepareRollbackSession(input)
  }

  /**
   * Usage from every turn this service runs, chat or not. Text generation never reaches
   * the runtime listeners, so its cost would go unrecorded without this channel.
   */
  subscribeUsage(listener: ProviderUsageListener) {
    this.usageListeners.add(listener)

    return () => this.usageListeners.delete(listener)
  }

  subscribeRuntimeEvents(listener: ProviderRuntimeEventListener) {
    this.runtimeEventListeners.add(listener)

    return () => this.runtimeEventListeners.delete(listener)
  }

  /** Every adapter event that has been published has been handed to the listeners. */
  drainRuntimeEvents() {
    return this.runtimeEvents.drain()
  }

  runtimeEventsIdle() {
    return this.runtimeEvents.isIdle()
  }

  requireSdkOwnership(sessionId: SessionId) {
    if (this.externalSessions.get(sessionId) === 'unknown')
      throw sessionIdentityErrors.TERMINAL_OWNERSHIP_UNKNOWN({ internal: { sessionId } })
    if (this.externalSessions.get(sessionId) === 'history')
      throw sessionIdentityErrors.TERMINAL_HISTORY_PENDING({ internal: { sessionId } })
    if (this.externalSessions.has(sessionId))
      throw sessionIdentityErrors.SESSION_IN_TERMINAL({
        internal: { sessionId, ownership: this.externalSessions.get(sessionId) ?? null },
      })
  }

  restoreTerminalOwnership(sessionId: SessionId, state: 'history' | 'unknown') {
    this.externalSessions.set(sessionId, state)
  }

  releaseTerminalOwnership(sessionId: SessionId) {
    this.externalSessions.delete(sessionId)
  }

  markTerminalHistoryPending(sessionId: SessionId) {
    this.requireTerminalOwnership(sessionId)
    this.externalSessions.set(sessionId, 'history')
  }

  requireTerminalOwnership(sessionId: SessionId) {
    if (!this.externalSessions.has(sessionId))
      throw sessionIdentityErrors.TERMINAL_SESSION_INVALID({
        internal: { sessionId, trackedTerminalSessions: this.externalSessions.size },
      })
  }

  async reserveTerminalRuntime(input: {
    sessionId: SessionId
    providerInstanceId: ProviderInstanceId
  }): Promise<AgentTerminalProcess> {
    this.requireRunning()
    this.requireSdkOwnership(input.sessionId)
    const launch = this.adapterRegistry.acquireTerminalLaunch(
      input.providerInstanceId,
      input.sessionId,
    )
    this.externalSessions.set(input.sessionId, 'terminal')
    let released = false
    const release = () => {
      if (released) return
      released = true
      this.externalSessions.delete(input.sessionId)
      launch.release()
    }
    try {
      const command = await launch.resolveCommand()
      await this.stopRuntime({ sessionId: input.sessionId })
      this.requireRunning()
      return { command, env: launch.env, release }
    } catch (error) {
      release()
      throw error
    }
  }

  bindingForSession(sessionId: SessionId) {
    return this.sessionDirectory.getBinding(sessionId)
  }

  private turnWithResumeCursor(
    input: ProviderTurnInput,
    adapter: ReturnType<ProviderAdapterRegistry['getByInstance']>,
  ): ProviderTurnInput {
    if (input.providerResumeCursor !== undefined && input.providerResumeCursor !== null)
      return input

    const binding = this.sessionDirectory.getBinding(input.sessionId)
    const continuation = continuableBinding(binding, adapter, input.providerInstanceId)
    if (!continuation) return input

    return { ...input, providerResumeCursor: continuation.providerResumeCursor }
  }

  private routeSession(sessionId: SessionId) {
    const binding = this.sessionDirectory.getBinding(sessionId)
    if (!binding) return null

    const adapter = this.adapterRegistry.getByInstance(binding.providerInstanceId)

    return { adapter, binding }
  }

  private trackLaunch<T>(
    input: ProviderEnsureRuntimeInput,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.requireRunning()
    const adapter = this.adapterRegistry.getByInstance(input.providerInstanceId)
    const previous = this.pendingLaunches.get(input.sessionId)
    const result = Promise.resolve(previous?.completion).then(async () => {
      this.requireRunning()
      this.requireSdkOwnership(input.sessionId)
      try {
        return await operation()
      } finally {
        await this.stopShutdownLaunch(adapter, input.sessionId)
      }
    })
    const launch = {
      adapter,
      providerInstanceId: input.providerInstanceId,
      completion: result.then(noop, noop),
    }
    // Publish ownership before the reaper or adapter gets its first asynchronous turn.
    this.pendingLaunches.set(input.sessionId, launch)
    return result.finally(() => {
      if (this.pendingLaunches.get(input.sessionId) === launch)
        this.pendingLaunches.delete(input.sessionId)
    })
  }

  private async awaitPendingLaunch(sessionId: SessionId) {
    const launch = this.pendingLaunches.get(sessionId)
    if (!launch) return
    await boundedProviderOperation(launch.adapter, launch.completion)
  }

  private requireRunning() {
    if (this.shuttingDown)
      throw sessionIdentityErrors.SERVICE_CLOSED({ internal: { at: 'require-running' } })
  }

  private async stopShutdownLaunch(
    adapter: ReturnType<ProviderAdapterRegistry['getByInstance']>,
    sessionId: SessionId,
  ) {
    if (!this.shuttingDown) return
    await boundedProviderOperation(adapter, adapter.stopRuntime({ sessionId })).catch((error) => {
      recordChatPipelineWarning('chat.pipeline.provider_service.shutdown.late_launch', {
        error,
        providerInstanceId: adapter.adapterKey,
        sessionId,
      })
    })
  }

  private recordLaunch(
    input: ProviderEnsureRuntimeInput,
    adapter: ReturnType<ProviderAdapterRegistry['getByInstance']>,
  ) {
    const existing = this.sessionDirectory.getBinding(input.sessionId)
    if (existing && existing.providerInstanceId !== input.providerInstanceId) {
      throw sessionIdentityErrors.SESSION_PROVIDER_CONFLICT({
        internal: {
          at: 'shutdown-launch',
          sessionId: input.sessionId,
          boundTo: existing.providerInstanceId,
          requested: input.providerInstanceId,
        },
      })
    }

    this.sessionDirectory.upsert({
      adapterKey: adapter.adapterKey,
      providerDriverKind: adapter.driverKind,
      providerInstanceId: input.providerInstanceId,
      runtimeEpoch: input.runtimeEpoch,
      runtimeMode: input.runtimeMode,
      runtimePayload: input.runtimePayload,
      sessionId: input.sessionId,
    })
  }

  private async stopAndRelease(
    adapter: ReturnType<ProviderAdapterRegistry['getByInstance']>,
    sessionId: SessionId,
  ) {
    await boundedProviderOperation(adapter, adapter.stopRuntime({ sessionId }))
    if (await boundedProviderOperation(adapter, adapter.hasRuntime({ sessionId }))) {
      throw createInternalError('The provider still owns its runtime after stopping.')
    }
    this.backgroundTasks.clear(sessionId)
    this.releaseWorktree(sessionId)
  }

  private async stopTextGenerationSession(
    adapter: ReturnType<ProviderAdapterRegistry['getByInstance']>,
    sessionId: SessionId,
    start: Promise<unknown>,
  ): Promise<boolean> {
    try {
      await boundedProviderOperation(adapter, start.then(noop, noop))
      await this.stopAndRelease(adapter, sessionId)
      return true
    } catch (error) {
      recordChatPipelineWarning('chat.pipeline.provider_service.text_generation.stop_failed', {
        error,
        providerInstanceId: adapter.adapterKey,
        sessionId,
      })
      return false
    }
  }

  private async interruptTextGenerationTurn(
    adapter: ReturnType<ProviderAdapterRegistry['getByInstance']>,
    ids: ReturnType<typeof textGenerationIds>,
    turnStarted: boolean,
  ) {
    if (!turnStarted) return

    await adapter.interruptTurn({ sessionId: ids.sessionId, turnId: ids.turnId }).catch((error) => {
      recordChatPipelineWarning('chat.pipeline.provider_service.text_generation.interrupt_failed', {
        error,
        providerInstanceId: adapter.adapterKey,
        sessionId: ids.sessionId,
        turnId: ids.turnId,
      })
    })
  }

  private suppressCompletedTextGeneration(sessionId: SessionId, purpose: ProviderUsagePurpose) {
    this.suppressedTextGenerationSessions.set(sessionId, purpose)
    if (this.suppressedTextGenerationSessions.size <= 1_024) return

    const oldest = this.suppressedTextGenerationSessions.keys().next().value
    if (oldest) this.suppressedTextGenerationSessions.delete(oldest)
  }

  private publishUsage(event: ProviderRuntimeEvent, purpose: ProviderUsagePurpose) {
    if (event.type !== 'usage.totals') return

    for (const listener of this.usageListeners) listener(event, purpose)
  }

  private startAdapterEventStreams() {
    for (const providerInstanceId of this.adapterRegistry.listInstances()) {
      this.startAdapterEventStream(providerInstanceId)
    }
    this.unsubscribeRegistry = this.adapterRegistry.subscribeChanges((change) => {
      this.forgetRemovedStreams(change.providerInstanceIds)
      for (const providerInstanceId of change.providerInstanceIds) {
        this.startAdapterEventStream(providerInstanceId)
      }
    })
  }

  /**
   * A reconciled-away instance may come back under the same id with a different
   * account, and its replacement needs its own stream — so the id stops counting
   * as streamed the moment it leaves the registry.
   */
  private forgetRemovedStreams(liveProviderInstanceIds: readonly ProviderInstanceId[]) {
    const live = new Set(liveProviderInstanceIds)
    for (const [providerInstanceId, subscription] of this.adapterSubscriptions) {
      if (live.has(providerInstanceId)) continue

      subscription.unsubscribe()
      this.adapterSubscriptions.delete(providerInstanceId)
    }
  }

  /**
   * Keyed by adapter as well as by id. A reconfigured *idle* instance is replaced in place — the
   * registry disposes the old adapter and builds a new one under the same id, which never leaves
   * the live set — so an id alone cannot tell a live stream from one pointed at a disposed adapter.
   */
  private startAdapterEventStream(providerInstanceId: ProviderInstanceId) {
    const adapter = this.adapterRegistry.adapter(providerInstanceId)
    if (!adapter) return

    const existing = this.adapterSubscriptions.get(providerInstanceId)
    if (existing?.adapter === adapter) return

    existing?.unsubscribe()
    this.adapterSubscriptions.set(providerInstanceId, {
      adapter,
      unsubscribe: adapter.subscribeEvents((event) => {
        void this.runtimeEvents.enqueue({ adapter, event, providerInstanceId }).catch((error) => {
          recordChatPipelineWarning('chat.pipeline.provider_service.runtime_stream.failed', {
            adapterKey: adapter.adapterKey,
            error,
            providerInstanceId,
          })
        })
      }),
    })
  }

  /**
   * Both conditions are checked on arrival rather than raced against a pending
   * read: an extra microtask between an adapter event and the binding write is
   * enough to let a later write (a session stop) be overwritten by an earlier
   * event.
   */
  private async handleRuntimeEvent(task: ProviderRuntimeEventTask) {
    if (this.shuttingDown) return
    // The adapter too, not just the id: an event queued by an adapter the registry has since
    // replaced belongs to a stream nothing is listening to any more.
    if (this.adapterSubscriptions.get(task.providerInstanceId)?.adapter !== task.adapter) return

    const textGeneration = this.textGenerationTasks.get(task.event.sessionId)
    if (textGeneration) {
      this.publishUsage(task.event, textGeneration.purpose)
      if (textGeneration.accept(task.event)) await textGeneration.interrupt()
      return
    }
    const suppressed = this.suppressedTextGenerationSessions.get(task.event.sessionId)
    if (suppressed) {
      // An interrupted generation can report its totals after the task is gone.
      this.publishUsage(task.event, suppressed)
      return
    }

    const binding = this.sessionDirectory.getBinding(task.event.sessionId)
    if (binding && binding.runtimeEpoch !== task.event.runtimeEpoch) return

    this.backgroundTasks.accept(task.event)
    this.recordRuntimeEvent(task.event, task.adapter)
    this.publishUsage(task.event, 'turn')
    await this.emitRuntimeEvent(task.event)
  }

  private async stopReplacedBinding(
    binding: ProviderRuntimeBindingWithMetadata | null,
    nextProviderInstanceId: ProviderInstanceId,
  ) {
    if (!binding) return
    if (binding.providerInstanceId === nextProviderInstanceId) return

    const adapter = this.adapterRegistry.adapter(binding.providerInstanceId)
    if (!adapter) return

    await adapter.stopRuntime({ sessionId: binding.sessionId }).catch((error) => {
      recordChatPipelineWarning('chat.pipeline.provider_service.stop_replaced.failed', {
        error,
        providerInstanceId: binding.providerInstanceId,
        sessionId: binding.sessionId,
      })
    })
  }

  private recordRuntimeEvent(
    event: ProviderRuntimeEvent,
    streamAdapter?: ReturnType<ProviderAdapterRegistry['getByInstance']>,
  ) {
    recordChatPipelineInfo('chat.pipeline.provider_service.runtime_event', {
      ...providerRuntimeEventSummary(event),
    })
    const update = bindingUpdateFromRuntimeEvent(event)
    if (!update) return

    const adapter = streamAdapter ?? this.adapterRegistry.adapter(update.providerInstanceId)
    if (!adapter) return

    this.sessionDirectory.upsert({
      adapterKey: adapter.adapterKey,
      providerDriverKind: adapter.driverKind,
      ...update,
    })
  }

  private async emitRuntimeEvent(event: ProviderRuntimeEvent) {
    recordChatPipelineInfo('chat.pipeline.provider_service.runtime_event.emit', {
      listenerCount: this.runtimeEventListeners.size,
      ...providerRuntimeEventSummary(event),
    })
    for (const listener of this.runtimeEventListeners) {
      await Promise.resolve(listener(event)).catch(noop)
    }
  }
}

function bindingForUpsert(binding: ProviderRuntimeBindingWithMetadata) {
  return {
    adapterKey: binding.adapterKey,
    providerDriverKind: binding.providerDriverKind,
    providerInstanceId: binding.providerInstanceId,
    providerBindingHandle: binding.providerBindingHandle,
    providerConversationMarker: binding.providerConversationMarker,
    runtimeEpoch: binding.runtimeEpoch,
    runtimeMode: binding.runtimeMode,
    sessionId: binding.sessionId,
  }
}

async function activeProviderBinding(
  adapter: ReturnType<ProviderAdapterRegistry['getByInstance']>,
  binding: ProviderRuntimeBindingWithMetadata,
) {
  if (await boundedProviderOperation(adapter, adapter.hasRuntime({ sessionId: binding.sessionId })))
    return binding

  return null
}

/**
 * The binding whose resume cursor the next session may adopt. A cursor is
 * minted by one account inside one driver, so it only travels within the same
 * continuation identity — repointing a session at another provider or another
 * account correctly starts a fresh conversation.
 */
function continuableBinding(
  binding: ProviderRuntimeBindingWithMetadata | null,
  adapter: ReturnType<ProviderAdapterRegistry['getByInstance']>,
  providerInstanceId: ProviderInstanceId,
  options: { modelChanged: boolean } = { modelChanged: false },
) {
  if (!binding) return null

  const bindingKey = providerContinuationKey({
    driverKind: binding.providerDriverKind,
    providerInstanceId: binding.providerInstanceId,
  })
  const nextKey = providerContinuationKey({ driverKind: adapter.driverKind, providerInstanceId })
  if (bindingKey !== nextKey) return null
  // The one read site `sessionModelSwitch` ever needed: a driver that cannot
  // change model inside a conversation must not be handed a cursor that would
  // ask it to. Drivers that can keep the history.
  if (options.modelChanged && adapter.capabilities.sessionModelSwitch === 'unsupported') return null

  return binding
}

function bindingModelChanged(
  binding: ProviderRuntimeBindingWithMetadata | null,
  modelSelection: ModelSelection | undefined,
) {
  if (!binding) return false

  return !modelSelectionsEqual(binding.runtimePayload?.modelSelection, modelSelection)
}

function providerRuntimeStartInput(
  input: ProviderEnsureRuntimeInput,
  payload: ProviderRuntimeStartPayload,
  reusableBinding?: ProviderRuntimeBindingWithMetadata | null,
): ProviderRuntimeStartInput {
  return {
    cwd: payload.cwd,
    interactionMode: payload.interactionMode,
    modelSelection: payload.modelSelection,
    providerInstanceId: input.providerInstanceId,
    providerResumeCursor: reusableBinding?.providerResumeCursor ?? null,
    runtimeMode: input.runtimeMode,
    sessionId: input.sessionId,
    runtimeEpoch: input.runtimeEpoch,
    resumeExisting: input.resumeExisting || Boolean(reusableBinding?.providerBindingHandle),
  }
}

function bindingUpdateFromRuntimeEvent(event: ProviderRuntimeEvent) {
  if (!('providerInstanceId' in event) || !event.providerInstanceId) return null
  if (!('providerBindingHandle' in event)) return null

  return {
    providerInstanceId: event.providerInstanceId,
    providerBindingHandle: event.providerBindingHandle,
    providerConversationMarker:
      event.type === 'conversation.started' ? event.payload.providerConversationMarker : undefined,
    providerResumeCursor: event.type === 'runtime.started' ? event.payload.resume : undefined,
    runtimeMode: event.runtimeMode ?? DEFAULT_RUNTIME_MODE,
    runtimeEpoch: event.runtimeEpoch,
    sessionId: event.sessionId,
  }
}

function canReuseProviderBinding(
  binding: ProviderRuntimeBindingWithMetadata | null,
  input: Omit<ProviderEnsureRuntimeInput, 'runtimeEpoch'>,
  adapter: ReturnType<ProviderAdapterRegistry['getByInstance']>,
) {
  if (!binding) return false
  if (binding.adapterKey !== adapter.adapterKey) return false
  if (binding.providerDriverKind !== adapter.driverKind) return false
  if (binding.providerInstanceId !== input.providerInstanceId) return false
  if (binding.runtimeMode !== input.runtimeMode) return false

  const payload = binding.runtimePayload
  if (payload?.cwd !== input.runtimePayload.cwd) return false
  if (payload?.interactionMode !== input.runtimePayload.interactionMode) return false
  if (payload?.runtimeMode && payload.runtimeMode !== input.runtimeMode) return false

  return modelSelectionsEqual(payload?.modelSelection, input.runtimePayload.modelSelection)
}

function modelSelectionsEqual(left: ModelSelection | undefined, right: ModelSelection | undefined) {
  if (!left) return false
  if (!right) return false
  if (left.providerInstanceId !== right.providerInstanceId) return false
  if (left.model !== right.model) return false

  return jsonEqual(left.options ?? null, right.options ?? null)
}

function noop() {}

async function boundedProviderOperation<T>(
  adapter: { operationTimeoutMs: number },
  operation: Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          sessionIdentityErrors.OPERATION_TIMED_OUT({
            internal: { timeoutMs: adapter.operationTimeoutMs },
          }),
        ),
      adapter.operationTimeoutMs,
    )
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    clearTimeout(timer)
  }
}

function textGenerationIds() {
  const id = crypto.randomUUID()
  return {
    sessionId: v.parse(sessionIdSchema, id),
    runtimeEpoch: crypto.randomUUID(),
    turnId: v.parse(turnIdSchema, `text-generation:${id}`),
  }
}

function throwIfTextGenerationAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw createInternalError('Provider text generation was cancelled.')
}

function textGenerationResult(task: ProviderTextGenerationTask): ProviderTextGenerationResult {
  const outcome = task.outcome()
  if (outcome.interactionRequired) {
    throw createInternalError(
      `Provider ${task.providerInstanceId} requested interaction while generating text.`,
    )
  }
  if (outcome.errorMessage) {
    throw createInternalError(
      `Provider ${task.providerInstanceId} failed while generating text: ${outcome.errorMessage}`,
    )
  }
  if (outcome.state !== 'completed') {
    throw createInternalError(
      `Provider ${task.providerInstanceId} ended text generation as ${outcome.state ?? 'unknown'}.`,
    )
  }

  return { text: outcome.text }
}
