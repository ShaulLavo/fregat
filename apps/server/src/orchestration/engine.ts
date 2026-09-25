import { commandUploadClaim } from './command-attachments'
import { withAttachmentLanes } from '../attachments/lanes'
import { createAttachmentOwnership, type AttachmentOwnership } from '../attachments/ownership'
import { sessionTitleMessages } from './title-messages'
import { SessionTitleReactor } from './title-reactor'
import type { ModelSelection } from '@workspace/contracts'
import { validateAttachmentUpload } from '../attachments/uploads'
import { createInternalError } from '../observability/structured-errors'
import { errorMessage } from '@workspace/contracts'
import { elapsedMs } from '@workspace/utils/timing'
import { terminalHistoryMessages } from './utils/terminal-history'
import { TerminalHandoffs, type TerminalHandoff } from './terminal-handoffs'
import type { AgentTerminalResolver, AgentTerminalProcess } from '../terminal/agent-launch'
import { sessionIdentityErrors } from '../provider/structured-errors'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { WorktreeExecutionGate } from './worktree-execution-gate'
import { WorktreeLifecycleReactor } from './worktree-lifecycle-reactor'
import { requireReadyWorktree } from './worktree-decider'
import { PullRequestSyncReactor, type BranchPullRequestLookup } from './pull-request-sync-reactor'
import { SessionSettlementReactor } from './session-settlement-reactor'
import { WorktreeCleanupReactor } from './worktree-cleanup-reactor'
import type { AutoSettleRules } from './utils/auto-settlement'
import { WorktreeCommandPreparation } from './worktree-command-preparation'
import { TerminalLeaseController } from './terminal-lease-controller'
import { GitWorktreeService } from '../git/worktrees'
import type { TerminalService } from '../terminal/service'
import { worktreeRuntimeErrors } from './worktree-runtime-errors'
import {
  type ProviderInstanceId,
  type SessionId,
  type WorktreeId,
  type ChatAttachment,
  type ChatAttachmentUpload,
  clientOrchestrationCommandSchema,
  orchestrationCommandSchema,
  type OrchestrationCommand,
  type OrchestrationDispatchResult,
  type OrchestrationEvent,
  type OrchestrationSessionDetailPageInput,
  commandIdSchema,
  eventIdSchema,
  errorStringField,
  type ClientOrchestrationCommand,
  type OrchestrationCommandReceipt,
  type WorktreeSubmoduleMode,
  parsePullRequestReference,
} from '@workspace/contracts'
import * as v from 'valibot'

import {
  defaultAttachmentsDir,
  writeAttachmentFromDataUrl,
  attachmentFilePath,
} from '../attachments/store'
import { migratePlatformDatabase as migrateOrchestrationDatabase } from '../db/migrations'
import { orchestrationErrors } from '../observability'
import { requireActionableSourcePlan } from './command-invariants'

import { CheckpointReactor } from './checkpoint-reactor'
import { isDurableCommandRejection, OrchestrationCommandReceipts } from './command-receipts'
import { decideOrchestrationCommand } from './decider'
import { OrchestrationEventStore, type OrchestrationDatabase } from './event-store'
import { OrchestrationProjectionPipeline } from './projection-pipeline'
import { bootstrapOrchestration } from './bootstrap'
import { createEmptyReadModel } from './read-model'
import { prepareProjectRegistration, type RegistrationBoundary } from './registration'
import { registrationResult } from './registration-decider'
import { commandFingerprint } from './utils/command-intent'
import { internalCommandKey } from './utils/repository-ids'
import { verifyReceiptIntent } from './command-receipts'
import { sessionDomainErrors } from './structured-errors'

import { ProviderCommandReactor } from './provider-command-reactor'
import { ProviderRuntimeIngestion, type ProviderRuntimeSource } from './provider-runtime-ingestion'
import { SessionDeletionReactor } from './session-deletion-reactor'
import { SessionDiscoveryReconciler } from './session-discovery'
import { sessionImportErrors } from './import-errors'
import { importedHistoryMessages, historyRevision } from './utils/import-history'
import type { ProviderHistoryMessage } from '../provider/types'
import { resolveSessionOwner } from './session-owner'
import {
  createDefaultProviderAdapterRegistry,
  type ProviderAdapterRegistry,
} from '../provider/provider-adapter-registry'
import { ProviderService } from '../provider/provider-service'
import { ProviderSessionDirectory } from '../provider/provider-session-directory'
import type { GitService } from '../git/service'
import {
  orchestrationCommandSummary,
  orchestrationEventBatchSummary,
  recordChatPipelineInfo,
  recordChatPipelineWarning,
  type CommandAttachmentIngest,
} from './orchestration-logging'
import type { OrchestrationReadModel, OrchestrationProjectedSession } from './read-model'
import { ReactorScheduler } from './reactor-scheduler'
import { OrchestrationSnapshotQuery } from './snapshot-query'
import {
  OrchestrationDomainEventBus,
  OrchestrationStreams,
  type OrchestrationDomainEventReactor,
  type OrchestrationStreamOptions,
} from './streams'

export type OrchestrationEngineOptions = {
  responseStreamingMode?: (
    projectId: string,
  ) =>
    | import('./response-delivery').ResponseStreamingMode
    | Promise<import('./response-delivery').ResponseStreamingMode>
  titleModel?: (projectId: string) => Promise<ModelSelection>
  worktreeSubmodules?: (projectId: string) => WorktreeSubmoduleMode
  /** Automatic settlement rules for a project; absent, nothing settles on its own. */
  autoSettleRules?: (projectId: string) => AutoSettleRules
  /** The project's setting: remove a worktree once its last session is deleted. */
  worktreeCleanupOnDelete?: (projectId: string) => boolean
  /** Reads each dedicated worktree's pull request; absent, nothing is synced. */
  pullRequestLookup?: BranchPullRequestLookup

  keepImportedSessionsUpdated?: () => boolean
  providerService?: ProviderService
  terminalService?: TerminalService
  registration?: RegistrationBoundary
  attachmentsDir?: string
  providerRuntime?:
    | boolean
    | {
        adapterRegistry?: ProviderAdapterRegistry
        checkpointGit?: GitService
        providerService?: ProviderService
      }
}

type OrchestrationCommandSummary = ReturnType<typeof orchestrationCommandSummary>

export class OrchestrationEngine {
  readonly worktreeExecutionGate = new WorktreeExecutionGate()
  private worktreeReactor: WorktreeLifecycleReactor | null = null
  private worktreePreparation: WorktreeCommandPreparation | null = null
  private readonly terminalLeases: TerminalLeaseController
  private readonly terminalHandoffs: TerminalHandoffs
  private readonly terminalHistoryRecoveries = new Map<SessionId, Promise<void>>()
  private unsubscribeGitMutations: (() => void) | null = null
  private reactorsStarted = false
  private queue = Promise.resolve()
  private readonly attachmentOwnership: AttachmentOwnership
  private readonly attachmentsDir: string
  private checkpointReactor: CheckpointReactor | null = null
  private deletionReactor: SessionDeletionReactor | null = null
  private discovery: SessionDiscoveryReconciler | null = null
  private pullRequestSync: PullRequestSyncReactor | null = null
  private settlement: SessionSettlementReactor | null = null
  private worktreeCleanup: WorktreeCleanupReactor | null = null
  private titleReactor: SessionTitleReactor | null = null
  private readonly keepImportedSessionsUpdated: () => boolean
  private providerService: ProviderService | null = null
  private readonly registration: RegistrationBoundary | undefined
  private readonly preparationLanes = new Map<string, Promise<OrchestrationDispatchResult>>()
  readonly ready: Promise<void>
  private readonly database: OrchestrationDatabase
  private readonly domainEvents = new OrchestrationDomainEventBus()
  private readonly receipts: OrchestrationCommandReceipts
  private readonly eventStore: OrchestrationEventStore
  private readonly projectionPipeline: OrchestrationProjectionPipeline
  private providerCommandReactor: ProviderCommandReactor | null = null
  private readonly reactors = new ReactorScheduler()
  private readonly snapshotQuery: OrchestrationSnapshotQuery
  private readonly streams: OrchestrationStreams
  private readModel: OrchestrationReadModel = createEmptyReadModel()

  constructor(database: OrchestrationDatabase, options: OrchestrationEngineOptions = {}) {
    this.keepImportedSessionsUpdated = options.keepImportedSessionsUpdated ?? (() => false)
    this.attachmentsDir = options.attachmentsDir ?? defaultAttachmentsDir()
    this.database = database
    this.attachmentOwnership = createAttachmentOwnership(database)
    this.registration = options.registration
    this.providerService = options.providerService ?? null
    this.terminalHandoffs = new TerminalHandoffs(database)
    this.terminalLeases = new TerminalLeaseController({
      gate: this.worktreeExecutionGate,
      dispatch: (command) => this.enqueue(command),
      getReadModel: () => this.readModel,
    })
    this.eventStore = new OrchestrationEventStore(database)
    this.receipts = new OrchestrationCommandReceipts(database)
    this.projectionPipeline = new OrchestrationProjectionPipeline(database, this.eventStore)
    this.snapshotQuery = new OrchestrationSnapshotQuery(
      database,
      (sessionId) => this.providerService?.backgroundLiveness(sessionId) ?? null,
    )
    this.streams = new OrchestrationStreams(this.snapshotQuery, { database })
    this.ready = bootstrapOrchestration({
      migrate: () => {
        migrateOrchestrationDatabase(database)
      },
      catchUp: () => {
        this.projectionPipeline.catchUp()
      },
      load: () => {
        this.readModel = this.snapshotQuery.fullReadModel()
        this.providerCommandReactor = this.createProviderCommandReactor(options)
        this.createWorktreeLifecycle(options)
        this.createPullRequestSync(options)
        this.createSettlement(options)
        this.createWorktreeCleanup(options)
        this.createDeletionReactor()
        this.createDiscoveryReconciler()
      },
      recover: () => this.recover(),
      startReactors: () => {
        this.reactorsStarted = true
        if (this.worktreeReactor) this.domainEvents.subscribe(this.worktreeReactor)
        if (this.deletionReactor) this.domainEvents.subscribe(this.deletionReactor)
        for (const reactor of [this.pullRequestSync, this.settlement, this.worktreeCleanup]) {
          if (!reactor) continue
          this.domainEvents.subscribe(reactor)
          reactor.start()
        }
        this.subscribeProviderCommandReactor()
        this.scheduleQueuedStarts()
        this.discovery?.start()
      },
    })
  }

  // Reactors observe only committed domain events.
  subscribeDomainEvents(reactor: OrchestrationDomainEventReactor) {
    return this.domainEvents.subscribe(reactor)
  }

  // Both HTTP and WebSocket ingress persist attachments before dispatching metadata.
  async dispatchClientCommand(command: unknown) {
    const parsed = v.parse(clientOrchestrationCommandSchema, command)
    await this.ready
    const existingLane = this.preparationLanes.get(parsed.commandId)
    const fingerprint = commandFingerprint(parsed)
    if (existingLane) {
      await existingLane.catch(noop)
      return this.prepareAndDispatch(parsed, fingerprint)
    }
    const task = this.prepareAndDispatch(parsed, fingerprint)
    this.preparationLanes.set(parsed.commandId, task)
    try {
      return await task
    } finally {
      this.preparationLanes.delete(parsed.commandId)
    }
  }

  private async prepareAndDispatch(command: ClientOrchestrationCommand, fingerprint: string) {
    const existing = this.receipts.find(command.commandId)
    if (existing) return this.dispatchFromReceipt(existing, command.type, fingerprint)
    try {
      if (this.worktreePreparation) {
        return await this.worktreePreparation.withLane(command, () =>
          this.acceptPrepared(command, fingerprint),
        )
      }
      return await this.acceptPrepared(command, fingerprint)
    } catch (error) {
      this.receipts.recordPreparationRejected(command, error, fingerprint)
      throw error
    }
  }

  private async acceptPrepared(command: ClientOrchestrationCommand, fingerprint: string) {
    const existing = this.receipts.find(command.commandId)
    if (existing) return this.dispatchFromReceipt(existing, command.type, fingerprint)
    this.requireSourceProposedPlan(command)
    const prepared = await this.prepare(command, fingerprint)
    const ingested = await ingestCommandAttachments(
      prepared,
      this.attachmentsDir,
      this.attachmentOwnership,
    )
    const result = await this.enqueue(ingested.command, ingested.attachmentIngest, fingerprint)
    return result
  }

  private async prepare(
    command: ClientOrchestrationCommand,
    fingerprint: string,
  ): Promise<OrchestrationCommand> {
    if (command.type !== 'project.create') {
      if (this.worktreePreparation) return this.worktreePreparation.prepare(command, fingerprint)
      return v.parse(orchestrationCommandSchema, command)
    }
    if (!this.registration) {
      throw orchestrationErrors.WORKSPACE_ROOT_NOT_DIRECTORY({
        workspaceRoot: command.workspaceRoot,
      })
    }
    const prepared = await prepareProjectRegistration(
      command,
      this.registration,
      this.readModel,
      fingerprint,
    )
    await this.requireNoLiveProviderForRevival(prepared.projectId, prepared.worktreeId)
    return prepared
  }

  async dispatch(command: OrchestrationCommand, attachmentIngest?: CommandAttachmentIngest) {
    await this.ready
    return this.enqueue(command, attachmentIngest)
  }

  async dispatchProviderCommand(command: OrchestrationCommand, source: ProviderRuntimeSource) {
    await this.ready
    return this.enqueueProviderCommand(command, source)
  }

  private schedule<T>(operation: () => T | Promise<T>) {
    const task = this.queue.then(operation)
    this.queue = task.then(noop, noop)
    return task
  }

  private enqueue(
    command: OrchestrationCommand,
    attachmentIngest?: CommandAttachmentIngest,
    fingerprint = commandFingerprint(command),
  ) {
    const intent =
      'intentFingerprint' in command ? (command.intentFingerprint ?? fingerprint) : fingerprint
    const claim = commandUploadClaim(command)
    if (!claim?.attachments.length)
      return this.schedule(() => this.dispatchNow(command, attachmentIngest, intent))
    return withAttachmentLanes(
      this.attachmentsDir,
      claim.attachments.map((attachment) => attachment.id),
      async () => {
        for (const attachment of claim.attachments)
          await validateAttachmentUpload(
            this.attachmentsDir,
            attachment,
            claim.sessionId,
            this.attachmentOwnership,
          )
        return this.schedule(() => this.dispatchNow(command, attachmentIngest, intent))
      },
    )
  }

  private enqueueProviderCommand(command: OrchestrationCommand, source: ProviderRuntimeSource) {
    return this.schedule(() => {
      if (!this.isCurrentProviderSource(command, source)) return
      return this.dispatchNow(command, undefined, commandFingerprint(command))
    })
  }

  private isCurrentProviderSource(command: OrchestrationCommand, source: ProviderRuntimeSource) {
    const session = this.readModel.sessions.get(source.sessionId)
    if (!session || session.deletedAt) return false
    const turn = session.latestTurn
    const expectedEpoch = turn?.runtimeEpoch ?? session.runtime?.runtimeEpoch
    if (expectedEpoch && expectedEpoch !== source.runtimeEpoch) return false
    if (command.type !== 'session.runtime.set') return true
    if (turn?.providerStartState === 'queued') return false
    const activeTurnId = command.runtime.activeTurnId
    return !activeTurnId || !turn || activeTurnId === turn.turnId
  }

  async shellSnapshot() {
    await this.ready
    return this.snapshotQuery.shellSnapshot()
  }

  async sessionImportSources() {
    await this.ready
    return { sources: this.providerService?.importSources() ?? [] }
  }

  async importSessions(providerInstanceId: ProviderInstanceId) {
    await this.ready
    const sources = this.providerService?.importSources() ?? []
    if (
      !this.discovery ||
      !sources.some((source) => source.providerInstanceId === providerInstanceId)
    ) {
      throw sessionImportErrors.UNAVAILABLE({
        internal: {
          providerInstanceId,
          hasDiscovery: Boolean(this.discovery),
          sourceIds: sources.map((source) => source.providerInstanceId),
        },
      })
    }
    return this.discovery.scan(providerInstanceId)
  }

  canImportSessionHistory(sessionId: SessionId) {
    return !this.eventStore.hasPlatformTurn(sessionId)
  }

  needsSessionHistory(sessionId: SessionId, sourceUpdatedAt: string) {
    return this.eventStore.historyImportState(sessionId).sourceUpdatedAt !== sourceUpdatedAt
  }

  async importSessionHistory(
    sessionId: SessionId,
    history: readonly ProviderHistoryMessage[],
    sourceUpdatedAt: string,
  ) {
    const session = this.readModel.sessions.get(sessionId)
    if (!session || this.eventStore.hasPlatformTurn(sessionId)) return false
    const messages = importedHistoryMessages(sessionId, session.createdAt, history)
    const revision = historyRevision(JSON.stringify({ messages, sourceUpdatedAt }))
    const previous = this.eventStore.historyImportState(sessionId)
    if (previous.revision === revision) return false
    await this.enqueue({
      type: 'session.history.import',
      commandId: v.parse(
        commandIdSchema,
        internalCommandKey('session.history.import', sessionId, revision, previous.sequence),
      ),
      sessionId,
      revision,
      messages,
      sourceUpdatedAt,
    })
    return true
  }
  async sessionDetailSnapshot(sessionId: string) {
    await this.ready
    return this.snapshotQuery.sessionDetailSnapshot(sessionId)
  }
  async sessionDetailPage(input: OrchestrationSessionDetailPageInput) {
    await this.ready
    return this.snapshotQuery.sessionDetailPage(input)
  }
  async replay(input: Parameters<OrchestrationEventStore['readAfter']>[0]) {
    await this.ready
    return { events: this.eventStore.readAfter(input) }
  }
  async *shellStream(options?: OrchestrationStreamOptions) {
    await this.ready
    yield* this.streams.shell(options)
  }
  async *sessionDetailStream(sessionId: string, options?: OrchestrationStreamOptions) {
    await this.ready
    yield* this.streams.sessionDetail(sessionId, options)
  }
  async readModelSnapshot() {
    await this.ready
    return this.readModel
  }
  async providerRuntimeIdle() {
    await this.ready
    return this.reactors.idle()
  }
  async close() {
    await this.ready
    await this.titleReactor?.close()
    await this.discovery?.close()
    await this.pullRequestSync?.close()
    await this.settlement?.close()
    await this.worktreeCleanup?.close()
    this.unsubscribeGitMutations?.()
    await this.worktreeReactor?.closeSetups()
    await this.worktreeReactor?.drain()
    await this.queue
  }

  private dispatchFromReceipt(
    receipt: OrchestrationCommandReceipt,
    type: string,
    fingerprint: string,
  ) {
    verifyReceiptIntent(receipt, type, fingerprint)
    if (receipt.status === 'rejected') throw previouslyRejectedCommandError(receipt)
    return { deduped: true, sequence: receipt.resultSequence, result: receipt.result }
  }

  private dispatchNow(
    command: OrchestrationCommand,
    attachmentIngest: CommandAttachmentIngest | undefined,
    fingerprint: string,
  ): OrchestrationDispatchResult {
    const startedAt = performance.now()
    const summary = orchestrationCommandSummary(command, attachmentIngest)
    recordChatPipelineInfo('chat.pipeline.command.start', summary)

    const existing = this.receipts.find(command.commandId)
    if (existing) return this.dispatchFromReceipt(existing, command.type, fingerprint)

    const committed = this.commitNewCommand(command, summary, fingerprint)
    recordChatPipelineInfo('chat.pipeline.command.complete', {
      ...summary,
      ...orchestrationEventBatchSummary(committed.events),
      durationMs: elapsedMs(startedAt),
      reactorCount: committed.published.reactorCount,
      reactorFailures: committed.published.failures,
      sequence: committed.sequence,
      result: committed.receipt.result,
    })

    return {
      deduped: false,
      sequence: committed.sequence,
      result: committed.receipt.result,
    }
  }

  private requireCommandRuntimeOwnership(command: OrchestrationCommand) {
    switch (command.type) {
      case 'session.terminal-history.append':
        if (!this.providerService)
          throw sessionIdentityErrors.TERMINAL_SESSION_INVALID({
            internal: { at: 'terminal-history-append', reason: 'no-provider-service' },
          })
        this.providerService.requireTerminalOwnership(command.sessionId)
        return
      case 'session.turn.start':
      case 'session.checkpoint.revert':
      case 'session.delete':
        this.providerService?.requireSdkOwnership(command.sessionId)
        return
      case 'project.delete':
        this.requireProjectRuntimeOwnership(command.projectId)
    }
  }

  private requireProjectRuntimeOwnership(projectId: string) {
    for (const session of this.readModel.sessions.values()) {
      const worktree = this.readModel.worktrees.get(session.worktreeId)
      if (worktree?.projectId !== projectId) continue
      this.providerService?.requireSdkOwnership(session.id)
    }
  }

  private commitNewCommand(
    command: OrchestrationCommand,
    summary: OrchestrationCommandSummary,
    fingerprint: string,
  ) {
    try {
      if (
        command.type === 'session.history.import' &&
        this.eventStore.hasPlatformTurn(command.sessionId)
      ) {
        throw sessionImportErrors.CONTINUED({ internal: { sessionId: command.sessionId } })
      }
      this.requireCommandRuntimeOwnership(command)
      if (command.type === 'session.auto-settle') this.requireAutoSettleCurrent(command)
      if (command.type === 'session.turn.steer')
        this.providerService?.requireSteeringAvailable(command.sessionId)
      this.requireSourceProposedPlan(command)
      const pendingEvents = decideOrchestrationCommand(command, this.readModel)
      recordChatPipelineInfo('chat.pipeline.command.decided', {
        ...summary,
        eventCount: pendingEvents.length,
        eventTypes: pendingEvents.map((event) => event.type),
      })
      const committed = this.commitCommand(command, pendingEvents, fingerprint)
      this.readModel = this.snapshotQuery.refreshReadModel(this.readModel, committed.events)

      return { ...committed, published: this.publishCommitted(committed.events) }
    } catch (error) {
      this.recordDispatchFailure(command, summary, error, fingerprint)
      throw error
    }
  }

  // Checked on the dispatch queue, so nothing can land between this read and the decision.
  private requireAutoSettleCurrent(
    command: Extract<OrchestrationCommand, { type: 'session.auto-settle' }>,
  ) {
    const changed = this.eventStore.hasSessionEventAfter(
      command.sessionId,
      command.snapshotSequence,
    )
    const liveness = this.providerService?.backgroundLiveness(command.sessionId) ?? null
    if (!changed && liveness === null) return
    throw sessionDomainErrors.AUTO_SETTLE_STALE({
      sessionId: command.sessionId,
      internal: { changedAfter: command.snapshotSequence, changed, liveness },
    })
  }

  private requireSourceProposedPlan(command: OrchestrationCommand | ClientOrchestrationCommand) {
    if (command.type !== 'session.turn.start' || !command.sourceProposedPlan) return
    const target = command.bootstrap?.createSession?.worktreeTarget
    const targetWorktreeId = target?.kind === 'new' ? target.baseWorktreeId : target?.worktreeId
    requireActionableSourcePlan(
      this.readModel,
      command.sourceProposedPlan,
      targetWorktreeId ?? this.readModel.sessions.get(command.sessionId)?.worktreeId,
      this.snapshotQuery.latestProposedPlan(command.sourceProposedPlan.sessionId),
    )
  }

  // Reconcile durable events before classifying a failed dispatch for its receipt.
  private recordDispatchFailure(
    command: OrchestrationCommand,
    summary: OrchestrationCommandSummary,
    error: unknown,
    fingerprint: string,
  ) {
    const reconciled = this.reconcileReadModel()
    const durable = isDurableCommandRejection(error)
    if (durable) this.receipts.recordRejected(command, error, fingerprint)

    recordChatPipelineWarning('chat.pipeline.command.rejected', {
      ...summary,
      ...reconciled,
      error,
      receiptRecorded: durable,
      retryable: !durable,
    })
  }

  // A commit can succeed before cache refresh fails; rebuild from durable projections.
  private reconcileReadModel() {
    try {
      this.projectionPipeline.catchUp()
      const events: OrchestrationEvent[] = []
      let sequence = this.readModel.sequence
      for (;;) {
        const page = this.eventStore.readAfter({ afterSequence: sequence })
        if (!page.length) break
        events.push(...page)
        const last = page.at(-1)
        if (last) sequence = last.sequence
      }
      if (events.length === 0) return { reconciledEventCount: 0 }

      this.readModel = this.snapshotQuery.refreshReadModel(this.readModel, events)
      const published = this.publishCommitted(events)

      return {
        reconciledEventCount: events.length,
        reconciledSequence: this.readModel.sequence,
        reconcileReactorFailures: published.failures,
      }
    } catch (error) {
      // Reconcile is best-effort: the dispatch failure it is annotating is the
      // error the caller has to see, so this one rides along as a field.
      return { reconcileError: errorMessage(error), reconciledEventCount: 0 }
    }
  }

  private publishCommitted(events: OrchestrationEvent[]) {
    this.streams.publish(events)

    return this.domainEvents.publish(events)
  }

  private commitCommand(
    command: OrchestrationCommand,
    pendingEvents: Parameters<OrchestrationEventStore['append']>[0],
    fingerprint: string,
  ) {
    return this.database.transaction((transaction) => {
      const database = transaction as unknown as OrchestrationDatabase
      const eventStore = new OrchestrationEventStore(database)
      const projectionPipeline = new OrchestrationProjectionPipeline(database, eventStore)
      const receipts = new OrchestrationCommandReceipts(database)
      const ownership = createAttachmentOwnership(database)
      const claim = commandUploadClaim(command)
      for (const attachment of claim?.attachments ?? [])
        ownership.claim(attachment, claim!.sessionId)
      const events = eventStore.append(pendingEvents)
      projectionPipeline.applyEvents(events)
      const result =
        command.type === 'project.create' || command.type === 'project.revive'
          ? registrationResult(command, this.readModel)
          : null
      const receipt = receipts.recordAccepted(
        command,
        eventStore.currentSequence(),
        result,
        fingerprint,
      )

      return {
        events,
        receipt,
        sequence: events.at(-1)?.sequence ?? eventStore.currentSequence(),
      }
    })
  }

  // Provider side effects consume the same committed event bus as other reactors.
  private subscribeProviderCommandReactor() {
    const reactor = this.providerCommandReactor
    if (!reactor) return

    this.domainEvents.subscribe({
      handleEvents: (events) => reactor.handleEvents(events),
      name: 'provider-command-reactor',
    })
  }

  private createDeletionReactor() {
    const reactor = new SessionDeletionReactor({
      attachmentsDir: this.attachmentsDir,
      database: this.database,
      providerService: this.providerService,
      getReadModel: () => this.readModel,
      dispatch: (command) => this.enqueue(command),
    })
    this.deletionReactor = reactor
    this.reactors.register({
      name: reactor.name,
      drain: () => reactor.drain(),
      isIdle: () => reactor.isIdle(),
    })
  }

  private createDiscoveryReconciler() {
    if (!this.providerService || !this.registration) return
    this.discovery = new SessionDiscoveryReconciler({
      providerService: this.providerService,
      registration: this.registration,
      dispatch: (command) => this.enqueue(command),
      getReadModel: () => this.readModel,
      keepUpdated: this.keepImportedSessionsUpdated,
      canImportHistory: (sessionId) => !this.eventStore.hasPlatformTurn(sessionId),
      needsHistory: (sessionId, sourceUpdatedAt) =>
        this.needsSessionHistory(sessionId, sourceUpdatedAt),
      importHistory: (sessionId, history, sourceUpdatedAt) =>
        this.importSessionHistory(sessionId, history, sourceUpdatedAt),
    })
  }

  private async recover() {
    await this.titleReactor?.recover()
    await this.recoverTerminalHistory()
    for (const session of this.readModel.sessions.values()) {
      if (session.deletedAt) continue
      await this.recoverRewind(session)
      await this.recoverRuntime(session)
    }
    await this.deletionReactor?.recover()
    await this.terminalLeases.recover()
    await this.worktreeReactor?.recover()
  }

  private async recoverRewind(session: OrchestrationProjectedSession) {
    const rewindCommandId = session.pendingRewindCommandId
    if (!rewindCommandId) return
    const createdAt = new Date().toISOString()
    await this.enqueue({
      type: 'session.activity.append',
      sessionId: session.id,
      commandId: v.parse(
        commandIdSchema,
        internalCommandKey('rewind-recovery', session.id, rewindCommandId),
      ),
      createdAt,
      activity: {
        id: v.parse(
          eventIdSchema,
          internalCommandKey('rewind-recovery-activity', session.id, rewindCommandId),
        ),
        sessionId: session.id,
        createdAt,
        turnId: null,
        tone: 'error',
        kind: 'checkpoint.revert.failed',
        summary: 'Rewind interrupted by server restart',
        payload: {
          commandId: rewindCommandId,
          detail:
            'The server restarted during rewind. Check conversation history and files before retrying; rewind was not replayed.',
        },
      },
    })
  }

  private async recoverRuntime(session: OrchestrationProjectedSession) {
    const turn = session.latestTurn
    const ambiguous =
      turn?.providerStartState === 'claimed' || turn?.providerStartState === 'adopted'
    const active =
      session.runtime && ['starting', 'running', 'waiting'].includes(session.runtime.status)
    if (!ambiguous && !active) return
    const runtimeEpoch = ambiguous ? turn.runtimeEpoch : session.runtime?.runtimeEpoch
    const observedSequence = ambiguous ? turn.providerStartSequence : session.runtimeSequence
    if (!runtimeEpoch || observedSequence === null) return

    let message =
      'The server restarted while this provider operation was in progress. The prompt was not resent.'
    try {
      if (await this.providerService?.hasRuntime({ sessionId: session.id })) {
        await this.providerService?.stopRuntime({ sessionId: session.id })
      }
    } catch (error) {
      message += ` Provider cleanup needs a retry: ${errorMessage(error)}`
    }
    await this.enqueue({
      type: 'session.runtime.recover',
      sessionId: session.id,
      ...(ambiguous ? { turnId: turn.turnId } : {}),
      observedSequence,
      runtimeEpoch,
      message,
      createdAt: new Date().toISOString(),
      commandId: v.parse(
        commandIdSchema,
        internalCommandKey('runtime-recovery', session.id, observedSequence, runtimeEpoch),
      ),
    })
  }

  private scheduleQueuedStarts() {
    if (!this.reactorsStarted || !this.providerCommandReactor) return
    for (const session of this.readModel.sessions.values()) {
      const turn = session.latestTurn
      if (session.deletedAt || turn?.providerStartState !== 'queued') continue
      const event = this.originalTurnStart(session.id, turn.turnId)
      if (event) this.providerCommandReactor.handleEvents([event])
    }
  }

  private originalTurnStart(sessionId: SessionId, turnId: string) {
    let afterSequence = 0
    for (;;) {
      const events = this.eventStore.readAfter({ afterSequence, limit: 500, sessionId })
      const found = events.find(
        (event) =>
          event.type === 'session.turn-start-requested' &&
          event.payload.sessionId === sessionId &&
          event.payload.turnId === turnId,
      )
      if (found) return found
      if (events.length < 500) return null
      const last = events.at(-1)
      if (!last) return null
      afterSequence = last.sequence
    }
  }

  private createPullRequestSync(options: OrchestrationEngineOptions) {
    if (!this.registration || !options.pullRequestLookup) return
    const git = this.registration.git
    this.pullRequestSync = new PullRequestSyncReactor({
      lookup: options.pullRequestLookup,
      headName: async (worktree) =>
        (await git.upstreamBranch(worktree.canonicalPath, worktree.branch ?? ''))?.branch ??
        worktree.branch ??
        '',
      dispatch: (command) => this.enqueue(command),
      getReadModel: () => this.readModel,
    })
  }

  private createSettlement(options: OrchestrationEngineOptions) {
    const rules = options.autoSettleRules
    if (!rules) return
    this.settlement = new SessionSettlementReactor({
      getReadModel: () => this.readModel,
      dispatch: (command) => this.enqueue(command),
      rules,
      backgroundLive: (sessionId) => this.providerService?.backgroundLiveness(sessionId) != null,
    })
  }

  private createWorktreeCleanup(options: OrchestrationEngineOptions) {
    if (!this.registration) return
    const git = this.registration.git
    const onDelete = options.worktreeCleanupOnDelete
    this.worktreeCleanup = new WorktreeCleanupReactor({
      getReadModel: () => this.readModel,
      dispatch: (command) => this.enqueue(command),
      cleanupOnDelete: (projectId) => onDelete?.(projectId) ?? false,
      deletionRemovesWorktree: (sequence) => this.eventStore.deletionRemovesWorktree(sequence),
      obstacle: (worktree) =>
        git.removalObstacle({ path: worktree.canonicalPath, branch: worktree.branch }),
    })
  }

  /** Runs a worktree cleanup sweep now, as after a settings change, and waits for it. */
  async cleanupWorktrees() {
    await this.ready
    this.worktreeCleanup?.schedule()
    await this.worktreeCleanup?.drain()
  }

  /** Runs a settlement sweep now, as after a settings change, and waits for it. */
  async settleSessions() {
    await this.ready
    this.settlement?.schedule()
    await this.settlement?.drain()
  }

  /** Test seam: settle an in-flight pull request sweep, then run one more. */
  async syncPullRequests() {
    await this.ready
    this.pullRequestSync?.schedule()
    await this.pullRequestSync?.drain()
  }

  private createWorktreeLifecycle(options: OrchestrationEngineOptions) {
    this.providerService?.setWorktreeExecution({
      acquire: ({ sessionId, cwd }) => {
        const session = this.readModel.sessions.get(sessionId)
        const worktree = session
          ? this.readModel.worktrees.get(session.worktreeId)
          : [...this.readModel.worktrees.values()].find(
              (row) => row.canonicalPath === cwd && !row.retiredAt,
            )
        if (!worktree) return null
        if (worktree.lifecycle.state !== 'ready')
          throw worktreeRuntimeErrors.UNAVAILABLE({
            internal: {
              at: 'acquire-shared',
              worktreeId: worktree.id,
              lifecycleState: worktree.lifecycle.state,
            },
          })
        return {
          worktreeId: worktree.id,
          ...this.worktreeExecutionGate.acquireShared(worktree.id, 'provider'),
        }
      },
    })
    if (!this.registration) return
    const git = new GitWorktreeService(this.registration.git)
    const reactor = new WorktreeLifecycleReactor({
      git,
      paths: this.registration.paths,
      gate: this.worktreeExecutionGate,
      provider: () => this.providerService,
      terminal: options.terminalService,
      submodules: options.worktreeSubmodules ?? (() => 'recursive'),
      dispatch: (command) => this.enqueue(command),
      getReadModel: () => this.readModel,
    })
    this.worktreeReactor = reactor
    this.unsubscribeGitMutations = this.registration.git.subscribeMutations(
      async (checkoutPath) => {
        const worktree = this.liveWorktreeAtCanonical(checkoutPath)
        if (worktree) await reactor.refresh(worktree.id)
      },
    )
    this.worktreePreparation = new WorktreeCommandPreparation({
      git,
      paths: this.registration.paths,
      gate: this.worktreeExecutionGate,
      reactor,
      getReadModel: () => this.readModel,
    })
    this.reactors.register({
      name: reactor.name,
      drain: () => reactor.drain(),
      isIdle: () => reactor.isIdle(),
    })
    this.domainEvents.subscribe({
      name: 'worktree-turn-release',
      handleEvents: (events) => {
        if (events.some((event) => event.type === 'session.worktree-released'))
          this.scheduleQueuedStarts()
      },
    })
  }

  beginAgentTerminal: AgentTerminalResolver = async (input) => {
    await this.ready
    const { sessionId, worktreeId } = input
    const session = this.readModel.sessions.get(sessionId)
    if (!session || session.deletedAt || session.worktreeId !== worktreeId || !this.providerService)
      throw sessionIdentityErrors.TERMINAL_SESSION_INVALID({
        internal: {
          at: 'terminal-handoff',
          sessionId,
          worktreeId,
          sessionFound: Boolean(session),
          deleted: Boolean(session?.deletedAt),
          sessionWorktreeId: session?.worktreeId ?? null,
          hasProviderService: Boolean(this.providerService),
        },
      })
    const status = session.runtime?.status
    if (
      session.latestTurn?.state === 'running' ||
      status === 'running' ||
      status === 'starting' ||
      status === 'waiting'
    )
      throw sessionIdentityErrors.TERMINAL_SESSION_INVALID({
        internal: {
          at: 'terminal-handoff-busy',
          sessionId,
          runtimeStatus: status ?? null,
          latestTurnState: session.latestTurn?.state ?? null,
        },
      })
    const provider = this.providerService
    const pending = this.terminalHandoffs.get(sessionId)
    if (pending) await this.retryTerminalHistory(pending, provider)
    const launch = await provider.reserveTerminalRuntime({
      sessionId,
      providerInstanceId: session.modelSelection.providerInstanceId,
    })
    return this.prepareTerminalHistory({ session, provider, launch, lease: input })
  }

  private async prepareTerminalHistory({
    session,
    provider,
    launch,
    lease,
  }: {
    session: OrchestrationProjectedSession
    provider: ProviderService
    launch: AgentTerminalProcess
    lease: Parameters<AgentTerminalResolver>[0]
  }) {
    const worktree = this.readModel.worktrees.get(session.worktreeId)
    if (!worktree) {
      launch.release()
      throw sessionIdentityErrors.TERMINAL_SESSION_INVALID({
        internal: {
          at: 'terminal-launch',
          sessionId: session.id,
          worktreeId: session.worktreeId,
          reason: 'worktree-absent',
        },
      })
    }
    const startedAt = new Date().toISOString()
    const input = {
      sessionId: session.id,
      providerInstanceId: session.modelSelection.providerInstanceId,
      cwd: worktree.canonicalPath,
    }
    try {
      const before = await provider.readSessionHistory(input)
      const handoff: TerminalHandoff = {
        ...input,
        worktreeId: session.worktreeId,
        terminalLeaseId: lease.terminalLeaseId,
        runtimeEpoch: lease.runtimeEpoch,
        startedAt,
        baseline: before.map((message) => message.sourceId),
        phase: 'active',
      }
      this.terminalHandoffs.begin(handoff)
      return {
        ...launch,
        reconcile: () => {
          this.terminalHandoffs.exited(session.id)
          return this.appendTerminalHistory(provider, handoff)
        },
        release: () => {
          this.terminalHandoffs.complete(session.id)
          launch.release()
        },
      }
    } catch (error) {
      launch.release()
      throw error
    }
  }

  private async appendTerminalHistory(provider: ProviderService, handoff: TerminalHandoff) {
    provider.markTerminalHistoryPending(handoff.sessionId)
    try {
      const after = await provider.readSessionHistory(handoff)
      const messages = terminalHistoryMessages(
        handoff.sessionId,
        handoff.startedAt,
        handoff.baseline,
        after,
      )
      if (!messages.length) return
      await this.enqueue({
        type: 'session.terminal-history.append',
        sessionId: handoff.sessionId,
        messages,
        commandId: v.parse(
          commandIdSchema,
          internalCommandKey(
            'session.terminal-history.append',
            handoff.sessionId,
            historyRevision(JSON.stringify(messages)),
          ),
        ),
      })
      recordChatPipelineInfo('chat.pipeline.terminal_history.summary', {
        sessionId: handoff.sessionId,
        messageCount: messages.length,
        outcome: 'synchronized',
      })
    } catch (error) {
      await this.recordTerminalHistoryFailure(handoff.sessionId, handoff.startedAt, error).catch(
        (failure: unknown) => {
          recordChatPipelineWarning('chat.pipeline.terminal_history.failure_record_failed', {
            sessionId: handoff.sessionId,
            error: failure,
          })
        },
      )
      throw error
    }
  }

  private async recordTerminalHistoryFailure(
    sessionId: SessionId,
    startedAt: string,
    error: unknown,
  ) {
    const message = errorStringField(error, 'message') ?? 'The provider history could not be read.'
    const unknownOwnership =
      errorStringField(error, 'code') === 'provider.TERMINAL_OWNERSHIP_UNKNOWN'
    const key = internalCommandKey(
      'terminal-history-failed',
      sessionId,
      startedAt,
      historyRevision(message),
    )
    recordChatPipelineWarning('chat.pipeline.terminal_history.summary', {
      sessionId,
      outcome: 'failed',
      error,
    })
    await this.enqueue({
      type: 'session.activity.append',
      commandId: v.parse(commandIdSchema, key),
      sessionId,
      createdAt: startedAt,
      activity: {
        id: v.parse(eventIdSchema, key),
        sessionId,
        createdAt: startedAt,
        turnId: null,
        tone: 'error',
        kind: unknownOwnership ? 'terminal.ownership.unknown' : 'terminal.history.failed',
        summary: unknownOwnership
          ? 'Previous terminal process ownership is unconfirmed'
          : 'Terminal history could not be synchronized',
        payload: {
          message,
          fix:
            errorStringField(error, 'fix') ??
            'Reconnect the session terminal to retry synchronization.',
        },
      },
    })
  }

  async beginTerminalLease(worktreeId: WorktreeId) {
    await this.ready
    return this.terminalLeases.begin(worktreeId)
  }

  private async recoverTerminalHistory() {
    const provider = this.providerService
    if (!provider) return
    const pending = this.terminalHandoffs.pending()
    for (const handoff of pending)
      provider.restoreTerminalOwnership(
        handoff.sessionId,
        handoff.phase === 'history' ? 'history' : 'unknown',
      )
    for (const handoff of pending) {
      await this.retryTerminalHistory(handoff, provider).catch((error: unknown) =>
        this.recordTerminalHistoryFailure(handoff.sessionId, handoff.startedAt, error),
      )
    }
  }

  private retryTerminalHistory(handoff: TerminalHandoff, provider: ProviderService) {
    const existing = this.terminalHistoryRecoveries.get(handoff.sessionId)
    if (existing) return existing
    const recovery = this.finishTerminalHistoryRecovery(handoff, provider).finally(() => {
      this.terminalHistoryRecoveries.delete(handoff.sessionId)
    })
    this.terminalHistoryRecoveries.set(handoff.sessionId, recovery)
    return recovery
  }

  private async finishTerminalHistoryRecovery(handoff: TerminalHandoff, provider: ProviderService) {
    if (handoff.phase === 'active')
      throw sessionIdentityErrors.TERMINAL_OWNERSHIP_UNKNOWN({
        internal: { at: 'history-recovery', sessionId: handoff.sessionId, phase: handoff.phase },
      })
    await this.terminalLeases.endRecovered(handoff.terminalLeaseId)
    await this.appendTerminalHistory(provider, handoff)
    this.terminalHandoffs.complete(handoff.sessionId)
    provider.releaseTerminalOwnership(handoff.sessionId)
  }

  async refreshWorktreeMetadata(checkoutPath: string) {
    const worktree = await this.liveWorktreeAt(checkoutPath)
    if (worktree) await this.worktreeReactor?.refresh(worktree.id)
  }

  /**
   * A session in its own worktree at a pull request's head. The head is fetched to `pr/<n>`, the
   * worktree starts from it, and for a pull request from this repository the worktree then
   * tracks its branch, so pushes, the header and the pull request sync follow the request.
   */
  async startPullRequestSession(input: {
    worktreeId: WorktreeId
    reference: string
    modelSelection: ModelSelection
  }) {
    await this.ready
    const number = parsePullRequestReference(input.reference)
    if (number === null)
      throw sessionDomainErrors.PULL_REQUEST_REFERENCE_INVALID({
        internal: { referenceLength: input.reference.length },
      })
    if (!this.registration)
      throw worktreeRuntimeErrors.UNAVAILABLE({ internal: { at: 'pull-request-session' } })
    const git = this.registration.git
    const base = requireReadyWorktree(this.readModel, input.worktreeId)
    const { detail, remoteName } = await git.resolvePullRequest(base.path, number)
    const branch = `pr/${number}`
    await git.fetchPullRequestHead({
      path: base.path,
      remote: remoteName,
      ref: detail.headFetchRef,
      branch,
    })
    const sessionId = crypto.randomUUID()
    const worktreeId = crypto.randomUUID()
    await this.dispatchClientCommand({
      type: 'session.create',
      commandId: `pull-request-${crypto.randomUUID()}`,
      sessionId,
      title: `#${number} ${detail.title}`.slice(0, 200),
      worktreeTarget: { kind: 'new', worktreeId, baseWorktreeId: base.id, baseBranch: branch },
      modelSelection: input.modelSelection,
    })
    const worktree = await this.readyWorktree(worktreeId, number)
    if (!detail.crossRepository)
      await git.trackRemoteBranch({
        path: worktree.path,
        remote: remoteName,
        branch: detail.headRefName,
      })
    await this.worktreeReactor?.refresh(worktree.id)
    this.pullRequestSync?.schedule()
    return { sessionId, worktreeId, pullRequest: detail }
  }

  private async readyWorktree(worktreeId: string, number: number) {
    // Long enough for a foreground setup script; a failure ends the wait at once.
    for (let attempt = 0; attempt < 6_000; attempt += 1) {
      const worktree = this.readModel.worktrees.get(worktreeId)
      if (worktree?.lifecycle.state === 'ready') return worktree
      if (worktree?.lifecycle.state === 'creation-failed')
        throw sessionDomainErrors.PULL_REQUEST_WORKTREE_FAILED({
          number,
          internal: { worktreeId, errorCode: worktree.lifecycle.errorCode },
        })
      await Bun.sleep(100)
    }
    throw sessionDomainErrors.PULL_REQUEST_WORKTREE_FAILED({
      number,
      internal: { worktreeId, reason: 'timeout' },
    })
  }

  /** Registers a checkout the server made itself, such as a finished clone, as a project. */
  async registerCheckout(absolutePath: string) {
    const receipt = await this.dispatchClientCommand({
      type: 'project.create',
      commandId: `register-${crypto.randomUUID()}`,
      title: path.basename(absolutePath),
      workspaceRoot: absolutePath,
      defaultModelSelection: null,
    })
    return receipt.result?.projectId ?? null
  }

  async worktreeProjectId(checkoutPath: string) {
    return (await this.liveWorktreeAt(checkoutPath))?.projectId ?? null
  }

  /** The project of a checkout git reported by its absolute root. */
  async checkoutProjectId(rootAbsolutePath: string) {
    await this.ready
    return this.liveWorktreeAtCanonical(await realpath(rootAbsolutePath))?.projectId ?? null
  }

  async worktreeBaseCommit(checkoutPath: string) {
    const worktree = await this.liveWorktreeAt(checkoutPath)
    return worktree?.ownership === 'platform' ? worktree.baseCommit : null
  }

  private async liveWorktreeAt(checkoutPath: string) {
    await this.ready
    if (!this.registration) return null
    return this.liveWorktreeAtCanonical(
      await realpath(this.registration.paths.resolve(checkoutPath).absolutePath),
    )
  }

  private liveWorktreeAtCanonical(canonicalPath: string) {
    return (
      [...this.readModel.worktrees.values()].find(
        (row) => row.canonicalPath === canonicalPath && !row.retiredAt,
      ) ?? null
    )
  }

  async worktreeCleanupPreview(worktreeId: WorktreeId) {
    await this.ready
    if (!this.worktreePreparation)
      throw worktreeRuntimeErrors.UNAVAILABLE({
        internal: { at: 'cleanup-preview', worktreeId, reason: 'no-preparation' },
      })
    return this.worktreePreparation.cleanupPreview(worktreeId)
  }

  async worktreeMissingPreview(worktreeId: WorktreeId) {
    await this.ready
    if (!this.worktreePreparation)
      throw worktreeRuntimeErrors.UNAVAILABLE({
        internal: { at: 'missing-preview', worktreeId, reason: 'no-preparation' },
      })
    return this.worktreePreparation.missingPreview(worktreeId)
  }

  private async requireNoLiveProviderForRevival(projectId: string, worktreeId: string) {
    const project = this.readModel.projects.get(projectId)
    const worktree = this.readModel.worktrees.get(worktreeId)
    if (!project?.deletedAt && !worktree?.retiredAt) return
    for (const session of this.readModel.sessions.values()) {
      if (!project?.deletedAt && session.worktreeId !== worktreeId) continue
      if (this.readModel.worktrees.get(session.worktreeId)?.projectId !== projectId) continue
      if (!(await this.providerService?.hasRuntime({ sessionId: session.id }))) continue
      throw sessionDomainErrors.REGISTRATION_BUSY({
        projectId,
        internal: { worktreeId, liveSessionId: session.id },
      })
    }
  }

  private async turnPrerequisitesSettled(sessionId: Parameters<typeof resolveSessionOwner>[1]) {
    const { worktree } = resolveSessionOwner(this.readModel, sessionId)
    if (worktree.lifecycle.state !== 'ready')
      throw worktreeRuntimeErrors.UNAVAILABLE({
        internal: {
          at: 'turn-prerequisites',
          worktreeId: worktree.id,
          lifecycleState: worktree.lifecycle.state,
        },
      })
    await this.worktreeReactor?.refresh(worktree.id)
    if (this.readModel.worktrees.get(worktree.id)?.lifecycle.state !== 'ready') return
    await this.checkpointReactor?.drain()
  }

  // Deployments without Git have no checkpoint work to schedule.
  private subscribeCheckpointReactor(
    git: GitService | undefined,
    _providerService: ProviderService,
  ) {
    if (!git) return

    const checkpointReactor = new CheckpointReactor({
      dispatch: (command) => this.dispatch(command),
      getReadModel: () => this.readModel,
      git,
    })
    this.checkpointReactor = checkpointReactor
    this.domainEvents.subscribe(checkpointReactor)
    this.reactors.register({
      drain: () => checkpointReactor.drain(),
      isIdle: () => checkpointReactor.isIdle(),
      name: checkpointReactor.name,
    })
  }

  private createProviderCommandReactor(options: OrchestrationEngineOptions) {
    if (!options.providerRuntime) return null

    const providerRuntimeOptions =
      typeof options.providerRuntime === 'object' ? options.providerRuntime : null
    const adapterRegistry =
      providerRuntimeOptions?.adapterRegistry ?? createDefaultProviderAdapterRegistry()
    const providerService = providerRuntimeOptions?.providerService
      ? providerRuntimeOptions.providerService
      : new ProviderService({
          adapterRegistry,
          sessionDirectory: new ProviderSessionDirectory(this.database),
        })
    const ingestion = new ProviderRuntimeIngestion(
      (command, source) => this.enqueueProviderCommand(command, source),
      {
        getReadModel: () => this.readModel,
        responseStreamingMode: options.responseStreamingMode,
        onLiveness: (sessionId) => providerService.markRuntimeSeen(sessionId),
      },
    )

    this.providerService = providerService
    if (options.titleModel) {
      const titleReactor = new SessionTitleReactor({
        attachmentsDir: this.attachmentsDir,
        messages: (sessionId) => sessionTitleMessages(this.database, sessionId),
        service: providerService,
        model: () => this.readModel,
        selection: options.titleModel,
        dispatch: (command) => this.enqueue(command),
      })
      this.titleReactor = titleReactor
      this.domainEvents.subscribe(titleReactor)
      this.reactors.register({
        name: 'session-title-reactor',
        drain: () => titleReactor.drain(),
        isIdle: () => titleReactor.isIdle(),
      })
    }
    this.subscribeCheckpointReactor(providerRuntimeOptions?.checkpointGit, providerService)

    const providerCommandReactor = new ProviderCommandReactor({
      attachmentsDir: this.attachmentsDir,
      beforeTurnStart: (sessionId) => this.turnPrerequisitesSettled(sessionId),
      checkpointGit: providerRuntimeOptions?.checkpointGit ?? null,
      dispatch: (command) => this.dispatch(command),
      getReadModel: () => this.readModel,
      ingestion,
      providerService,
    })
    this.reactors.register({
      drain: () => providerCommandReactor.drain(),
      isIdle: () => providerCommandReactor.isIdle(),
      name: 'provider-command-reactor',
    })

    return providerCommandReactor
  }
}

/**
 * Write-through between parse and dispatch. Attachment bytes hit the blob store
 * exactly once here; everything downstream sees metadata only.
 */
async function ingestCommandAttachments(
  command: OrchestrationCommand,
  attachmentsDir: string,
  ownership: AttachmentOwnership,
): Promise<{ attachmentIngest?: CommandAttachmentIngest; command: OrchestrationCommand }> {
  if (command.type === 'session.user-input.respond' && command.attachmentsByQuestionId) {
    const kept: Record<string, ChatAttachment[]> = {}
    for (const [questionId, attachments] of Object.entries(command.attachmentsByQuestionId)) {
      kept[questionId] = (
        await persistTurnAttachments(attachments, attachmentsDir, command.sessionId, ownership)
      ).attachments
    }
    return { command: { ...command, attachmentsByQuestionId: kept } }
  }
  if (command.type !== 'session.turn.start' && command.type !== 'session.turn.steer')
    return { command }
  if (command.message.attachments.length === 0) return { command }

  const ingested = await persistTurnAttachments(
    command.message.attachments,
    attachmentsDir,
    command.sessionId,
    ownership,
  )

  return {
    attachmentIngest: ingested.attachmentIngest,
    command: {
      ...command,
      message: { ...command.message, attachments: ingested.attachments },
    },
  }
}

async function persistTurnAttachments(
  attachments: readonly ChatAttachmentUpload[],
  attachmentsDir: string,
  sessionId: string,
  ownership: AttachmentOwnership,
) {
  const kept: ChatAttachment[] = []
  const ids = new Set<string>()
  let bytesPersisted = 0
  for (const attachment of attachments) {
    if (ids.has(attachment.id))
      throw createInternalError('The same attachment cannot be sent twice.')
    ids.add(attachment.id)
    if (attachment.id.startsWith('upload-')) {
      kept.push(await validateAttachmentUpload(attachmentsDir, attachment, sessionId, ownership))
      continue
    }
    if (attachment.type === 'file') throw createInternalError('Upload this file before sending it.')
    if (attachment.dataUrl) {
      const written = await writeAttachmentFromDataUrl({ attachment, attachmentsDir })
      bytesPersisted += written.bytesWritten
      kept.push({ ...attachmentMetadata(attachment), sizeBytes: written.bytesWritten })
      continue
    }
    const filePath = attachmentFilePath({ attachment, attachmentsDir })
    if (!filePath || !(await Bun.file(filePath).exists()))
      throw createInternalError('Attachment is unavailable. Attach it again.')
    kept.push(attachmentMetadata(attachment))
  }
  return {
    attachmentIngest: { bytesPersisted, dropReasons: [], dropped: 0, persisted: kept.length },
    attachments: kept,
  }
}

function attachmentMetadata(attachment: ChatAttachmentUpload): ChatAttachment {
  return {
    type: attachment.type,
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
  }
}

function noop() {}

function previouslyRejectedCommandError(
  receipt: NonNullable<ReturnType<OrchestrationCommandReceipts['find']>>,
) {
  return orchestrationErrors.COMMAND_PREVIOUSLY_REJECTED({
    commandId: receipt.commandId,
    internal: { storedError: receipt.error },
    message: receipt.error ?? undefined,
  })
}
