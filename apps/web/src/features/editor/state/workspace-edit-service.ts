import { fileDocumentKey, filesystemPath } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import type { WorkspaceEditPrepareRequest } from '@/lib/file-system-types'
import type {
  WorkspaceEditAnnotation,
  WorkspaceEditOperation,
  WorkspaceTextReplaySegmentInput,
} from '@singapor/lsp-plugin/workspace-edit'
import { prepareWorkspaceTextReplay } from '@singapor/lsp-plugin/workspace-edit'
import {
  fileNameToDocumentUri,
  type ApplyWorkspaceEditRequest,
  type ApplyWorkspaceEditResult,
  type LanguageServerDocumentSyncController,
} from '@singapor/lsp-plugin'
import {
  beginReverseDocumentTransactionSequence,
  commitPreparedDocumentTransactionSequenceSegment,
  completePreparedDocumentTransactionSequence,
  completeReverseDocumentTransactionSequence,
  createEditorTextBuffer,
  documentTextRoundTripStatus,
  pieceTableDocumentText,
  releaseDocumentTransactionReceipt,
  reverseDocumentTransaction,
  reverseNextDocumentTransactionSequenceSegment,
  rotateDocumentSyncSegment,
  sealDocumentTransactionReceipt,
  type DocumentMutationLease,
  type DocumentTextSnapshot,
  type DocumentTransactionReceipt,
  type DocumentTransactionSequenceReverseCursor,
  type EditorTextBuffer,
} from '@singapor/core/document'
import type {
  WorkspaceEditResult,
  WorkspaceEditResultEntry,
  WorkspaceResourcePrecondition,
} from '@workspace/contracts'

import type {
  EditorDocumentStore,
  EditorDocumentStoreApi,
  LiveEditorDocument,
} from '@/features/editor/state/document-state'
import type {
  WorkspaceDocumentRecoveryLeaseTransfer,
  WorkspaceDocumentMutationLeaseSet,
  WorkspaceDocumentPathReservation,
  WorkspaceDocumentPathReservationRequest,
  WorkspaceDocumentProjection,
  WorkspaceDocumentTargetStamp,
} from '@/features/editor/state/workspace-document-service'
import {
  WorkspaceEditOperationEvent,
  type WorkspaceEditOperationCounts,
  type WorkspaceEditOperationEventOptions,
  type WorkspaceEditOperationSettlement,
} from '@/features/editor/state/workspace-edit-operation-event'
import {
  FileSyncService,
  type WorkspaceFileInspection,
  type WorkspaceFileSnapshot,
  type WorkspaceMutationProjectionReceipt,
} from '@/features/editor/state/file-sync-service'
import { normalizeWorkspaceRoot } from '@workspace/client-core/files/path'
import { toClientError } from '@/lib/client-error-taxonomy'
import { createClientError } from '@workspace/client-core/errors'
import { createClientInvariantError } from '@/lib/structured-errors'

type WorkspacePersistenceOperation = WorkspaceEditPrepareRequest['operations'][number]

const MAX_WORKSPACE_EDIT_UNDO_GROUPS = 20

export type WorkspaceEditServicePhase =
  | 'idle'
  | 'preparing'
  | 'awaiting-confirmation'
  | 'committing'
  | 'finalizing'
  | 'applied'
  | 'undoing'
  | 'redoing'
  | 'rolling-back'
  | 'rolled-back'
  | 'cancelled'
  | 'stale'
  | 'failed'
  | 'recovery-required'
  | 'recovering'
  | 'recovered'
  | 'releasing-recovery'
  | 'released'

type WorkspaceEditPreviewTargetKind = 'dirty' | 'open' | 'unopened'

export type WorkspaceEditPreviewRow = {
  readonly afterText?: string
  readonly annotationIds: readonly string[]
  readonly beforeText?: string
  readonly fromPath?: FilesystemPath
  readonly ignored: boolean
  readonly index: number
  readonly kind: WorkspaceEditOperation['kind']
  readonly path: FilesystemPath
  readonly targetKind?: WorkspaceEditPreviewTargetKind
  readonly toPath?: FilesystemPath
}

export type WorkspaceEditPreview = {
  readonly annotations: readonly (WorkspaceEditAnnotation & { readonly id: string })[]
  readonly label: string
  readonly operationCount: number
  readonly operationId: string
  readonly rows: readonly WorkspaceEditPreviewRow[]
  readonly undoCategory: 'editor' | 'workspace'
}

export type WorkspaceEditRecovery = {
  readonly affectedPaths: readonly FilesystemPath[]
  readonly generation: number
  readonly operationId: string
  readonly unrecoveredPaths: readonly FilesystemPath[]
}

export type WorkspaceEditServiceSnapshot = {
  readonly canCancel: boolean
  readonly canRedo: boolean
  readonly canUndo: boolean
  readonly code: string | null
  readonly message: string | null
  readonly phase: WorkspaceEditServicePhase
  readonly preview: WorkspaceEditPreview | null
  readonly recovery: WorkspaceEditRecovery | null
}

export type WorkspaceEditRoot = {
  readonly generation: number
  /** Document-store and ordinary filesystem client namespace. */
  readonly path: FilesystemPath
  /** Slash-prefixed LSP URI namespace. Defaults to `path` for injected callers. */
  readonly uriPath?: FilesystemPath
  /** Server workspace-edit request namespace. Defaults to `path` for injected callers. */
  readonly workspacePath?: FilesystemPath
}

declare const workspaceMutationReservationBrand: unique symbol

export type WorkspaceMutationReservation = {
  readonly [workspaceMutationReservationBrand]: true
}

export type WorkspaceMutationAffectedPaths = readonly FilesystemPath[] | 'all'

export type WorkspaceMutationReporter = (affectedPaths: WorkspaceMutationAffectedPaths) => void

export type WorkspaceEditRootSwitchReservation = WorkspaceMutationReservation

export type WorkspaceEditPathInspection = WorkspaceFileInspection

export type WorkspaceEditOperationEventPort = Pick<
  WorkspaceEditOperationEvent,
  'end' | 'setPrepared' | 'transition'
>

export type WorkspaceEditServiceOptions = {
  readonly documentSyncController?: Pick<
    LanguageServerDocumentSyncController,
    'transitionDocumentUri'
  >
  readonly documentStore: EditorDocumentStoreApi
  readonly fileSync: FileSyncService
  readonly getRoot: () => WorkspaceEditRoot | null
  readonly inspectPath?: (
    path: FilesystemPath,
    signal: AbortSignal,
  ) => Promise<WorkspaceEditPathInspection>
  readonly createOperationId?: () => string
  readonly createOperationEvent?: (
    options: WorkspaceEditOperationEventOptions,
  ) => WorkspaceEditOperationEventPort
  readonly operationEventNow?: () => number
}

export type WorkspaceEditApplicationRequest = Omit<ApplyWorkspaceEditRequest, 'source'> & {
  readonly source: ApplyWorkspaceEditRequest['source'] | 'search-replace'
  readonly sourceFileVersions?: ReadonlyMap<string, WorkspaceFileSnapshot['version']>
}

type WorkspaceEditSettlement = {
  readonly resolve: (result: ApplyWorkspaceEditResult) => void
}

type ResolvedTextOperation = {
  readonly index: number
  readonly kind: 'text'
  readonly operation: Extract<WorkspaceEditOperation, { readonly kind: 'text-document' }>
  readonly path: FilesystemPath
  readonly segmentIndex: number
  readonly target: PreparedTarget
}

type ResolvedResourceOperation = {
  readonly fromPath?: FilesystemPath
  readonly ignored: boolean
  readonly index: number
  readonly kind: 'resource'
  readonly operation: Exclude<WorkspaceEditOperation, { readonly kind: 'text-document' }>
  readonly path: FilesystemPath
  readonly projection: WorkspaceDocumentProjection | null
  readonly target: PreparedTarget | null
  readonly toPath?: FilesystemPath
}

type ResolvedOperation = ResolvedResourceOperation | ResolvedTextOperation

type PreparedTarget = {
  readonly buffer: EditorTextBuffer
  readonly dirtyInitially: boolean
  readonly initialPath: FilesystemPath
  readonly initialSnapshot: DocumentTextSnapshot
  readonly kind: WorkspaceEditPreviewTargetKind
  readonly liveStamp: WorkspaceDocumentTargetStamp | null
  readonly segments: WorkspaceTextReplaySegmentInput[]
  currentPath: FilesystemPath
  prepared: Extract<ReturnType<typeof prepareWorkspaceTextReplay>, { readonly ok: true }> | null
}

type PreparedWorkspaceEdit = {
  readonly affectedPaths: readonly FilesystemPath[]
  readonly immediate: boolean
  readonly operationId: string
  readonly operations: readonly ResolvedOperation[]
  readonly pathRequests: readonly WorkspaceDocumentPathReservationRequest[]
  readonly persistence: readonly WorkspacePersistenceOperation[]
  readonly projectionAfterContents: ReadonlyMap<FilesystemPath, string>
  readonly projectionBeforeContents: ReadonlyMap<FilesystemPath, string>
  readonly preview: WorkspaceEditPreview
  readonly request: WorkspaceEditApplicationRequest
  readonly root: WorkspaceEditRoot
  readonly targets: readonly PreparedTarget[]
}

type LocalLeg =
  | {
      readonly kind: 'projection'
      projection: WorkspaceDocumentProjection
      readonly resolved: ResolvedResourceOperation
    }
  | {
      readonly kind: 'text'
      readonly sequenceSegmentIndex: number
      readonly target: PreparedTarget
    }

type LocalCommit = {
  readonly legs: LocalLeg[]
  projection: WorkspaceMutationProjectionReceipt | null
  readonly receipts: Map<PreparedTarget, DocumentTransactionReceipt>
}

type WorkspaceEditGroup = {
  readonly affectedPaths: readonly FilesystemPath[]
  readonly legs: LocalLeg[]
  readonly operationId: string
  projection: WorkspaceMutationProjectionReceipt | null
  receipts: Map<PreparedTarget, DocumentTransactionReceipt>
  server: WorkspaceEditResult | null
}

type HeldWorkspaceLocks = {
  leases: WorkspaceDocumentMutationLeaseSet | null
  reservation: WorkspaceDocumentPathReservation
}

type PreparedRecoveryConflictTransfer = {
  readonly transfer: WorkspaceDocumentRecoveryLeaseTransfer | null
}

type ActiveWorkspaceEdit = {
  readonly controller: AbortController
  readonly event: WorkspaceEditOperationEventPort
  readonly prepared: PreparedWorkspaceEdit
  readonly settlement: WorkspaceEditSettlement
  commitStarted: boolean
}

const IDLE_SNAPSHOT: WorkspaceEditServiceSnapshot = {
  canCancel: false,
  canRedo: false,
  canUndo: false,
  code: null,
  message: null,
  phase: 'idle',
  preview: null,
  recovery: null,
}

export class WorkspaceEditService {
  private active: ActiveWorkspaceEdit | null = null
  private readonly cleanupPending = new Map<string, WorkspaceEditResult>()
  private readonly createOperationEvent: (
    options: WorkspaceEditOperationEventOptions,
  ) => WorkspaceEditOperationEventPort
  private readonly createOperationId: () => string
  private externalMutationReservation: WorkspaceMutationReservation | null = null
  private externalMutationReservationKind: 'ordinary' | 'root-switch' | null = null
  private internalDocumentMutationDepth = 0
  private readonly inspectPath: NonNullable<WorkspaceEditServiceOptions['inspectPath']>
  private readonly listeners = new Set<() => void>()
  private readonly ownOperationIds = new Set<string>()
  private preparingController: AbortController | null = null
  private preparingEvent: WorkspaceEditOperationEventPort | null = null
  private recoveryGroup: WorkspaceEditGroup | null = null
  private recoveryServer: WorkspaceEditResult | null = null
  private recoveryLocks: HeldWorkspaceLocks | null = null
  private readonly redoStack: WorkspaceEditGroup[] = []
  private readonly releasedExternalMutationReservations =
    new WeakSet<WorkspaceMutationReservation>()
  private snapshot: WorkspaceEditServiceSnapshot = IDLE_SNAPSHOT
  private readonly undoStack: WorkspaceEditGroup[] = []
  private serverEpoch: string | null
  private readonly unsubscribeDocumentContentRevisions: () => void
  private readonly unsubscribeServerEpoch: () => void

  constructor(private readonly options: WorkspaceEditServiceOptions) {
    this.createOperationId = options.createOperationId ?? secureOperationId
    this.createOperationEvent =
      options.createOperationEvent ??
      ((eventOptions) =>
        new WorkspaceEditOperationEvent({
          ...eventOptions,
          ...(options.operationEventNow ? { now: options.operationEventNow } : {}),
        }))
    this.inspectPath = options.inspectPath ?? options.fileSync.inspectWorkspacePath
    this.serverEpoch = options.fileSync.getWorkspaceMutationServerEpoch()
    this.unsubscribeServerEpoch = options.fileSync.subscribeWorkspaceMutationServerEpoch(
      this.handleServerEpoch,
    )
    this.unsubscribeDocumentContentRevisions = options.documentStore.subscribe(
      this.handleDocumentContentRevisions,
    )
  }

  private readonly handleServerEpoch = (serverEpoch: string): void => {
    const previous = this.serverEpoch
    this.serverEpoch = serverEpoch
    if (!previous) {
      if (this.undoStack.length > 0 || this.redoStack.length > 0) this.clearHistory()
      return
    }
    if (previous === serverEpoch) return
    for (const operationId of this.cleanupPending.keys()) this.ownOperationIds.delete(operationId)
    this.cleanupPending.clear()
    this.clearHistory()
  }

  private readonly handleDocumentContentRevisions = (
    current: EditorDocumentStore,
    previous: EditorDocumentStore,
  ): void => {
    if (this.internalDocumentMutationDepth > 0) return
    if (current.documentContentRevisions === previous.documentContentRevisions) return
    const affectedPaths = changedFileDocumentPaths(previous, current)
    if (affectedPaths.length === 0) return
    void this.invalidateHistoryForForward(affectedPaths)
  }

  readonly onApplyWorkspaceEdit = (
    request: ApplyWorkspaceEditRequest,
  ): Promise<ApplyWorkspaceEditResult> => this.applyWorkspaceChange(request)

  readonly applyWorkspaceChange = async (
    request: WorkspaceEditApplicationRequest,
  ): Promise<ApplyWorkspaceEditResult> => {
    void this.flushPendingWorkspaceMutationCleanup()
    const operationId = this.createOperationId()
    const event = this.createOperationEvent({
      operationId,
      source: request.source,
    })
    if (this.externalMutationReservation) {
      const result = failedResult('workspace-edit-busy', 'Another workspace mutation is active')
      event.end(workspaceOperationSettlement(result))
      return result
    }
    if (this.active?.commitStarted) {
      const result = failedResult('workspace-edit-busy', 'Workspace is busy')
      event.end(workspaceOperationSettlement(result))
      return result
    }
    this.cancelPreCommitActive()

    const controller = linkedAbortController(request.signal)
    this.preparingController = controller
    this.preparingEvent = event
    this.publish({ phase: 'preparing' })
    let prepared: PreparedWorkspaceEdit
    try {
      prepared = await prepareWorkspaceEdit(
        this.options,
        this.inspectPath,
        request,
        controller.signal,
        operationId,
      )
    } catch (error) {
      const isCurrent = this.preparingController === controller
      if (isCurrent) {
        this.preparingController = null
        this.preparingEvent = null
      }
      const result = resultForPreparationError(error, controller.signal)
      if (isCurrent) {
        event.end(workspaceOperationSettlement(result))
        this.publishResult(result)
      }
      return result
    }
    if (this.preparingController !== controller) return { status: 'cancelled' }
    this.preparingController = null
    this.preparingEvent = null
    event.setPrepared(workspaceOperationCounts(prepared))

    return new Promise<ApplyWorkspaceEditResult>((resolve) => {
      const active: ActiveWorkspaceEdit = {
        commitStarted: false,
        controller,
        event,
        prepared,
        settlement: { resolve },
      }
      this.active = active
      if (!prepared.immediate) {
        event.transition('preview')
        this.publish({ phase: 'awaiting-confirmation', preview: prepared.preview })
        return
      }
      void this.commitActive(active)
    })
  }

  readonly getSnapshot = (): WorkspaceEditServiceSnapshot => this.snapshot

  readonly canMutateWorkspace = (): boolean => {
    if (this.externalMutationReservation) return false
    if (this.active || this.preparingController) return false
    if (this.snapshot.recovery) return false
    return !isBusyWorkspaceEditPhase(this.snapshot.phase)
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  isOwnEvent(writeId: string): boolean {
    return this.ownOperationIds.has(writeId)
  }

  canSwitchRoot(): boolean {
    if (this.externalMutationReservation) {
      return this.externalMutationReservationKind === 'root-switch'
    }
    if (this.active?.commitStarted || this.snapshot.recovery) return false
    return this.snapshot.phase !== 'undoing' && this.snapshot.phase !== 'redoing'
  }

  acquireWorkspaceMutationReservation(): WorkspaceMutationReservation | null {
    if (this.externalMutationReservation) return null
    if (this.active || this.preparingController || this.snapshot.recovery) return null
    if (isBusyWorkspaceEditPhase(this.snapshot.phase)) return null
    const reservation = Object.freeze({}) as WorkspaceMutationReservation
    this.externalMutationReservation = reservation
    this.externalMutationReservationKind = 'ordinary'
    this.publish({})
    return reservation
  }

  releaseWorkspaceMutationReservation(reservation: WorkspaceMutationReservation): boolean {
    if (this.releasedExternalMutationReservations.has(reservation)) return true
    if (this.externalMutationReservation !== reservation) return false
    this.externalMutationReservation = null
    this.externalMutationReservationKind = null
    this.releasedExternalMutationReservations.add(reservation)
    this.publish({})
    return true
  }

  async runWorkspaceMutation<T>(
    affectedPaths: WorkspaceMutationAffectedPaths,
    operation: (reportAffectedPaths: WorkspaceMutationReporter) => Promise<T>,
  ): Promise<T> {
    void this.flushPendingWorkspaceMutationCleanup()
    const reservation = this.acquireWorkspaceMutationReservation()
    if (!reservation) {
      throw workspaceEditError('workspace-edit-busy', 'Another workspace mutation is active')
    }

    const reportedPaths = new Set<FilesystemPath>()
    let reportedAll = false
    let hasReport = false
    const reportAffectedPaths: WorkspaceMutationReporter = (paths) => {
      if (paths !== 'all' && paths.length === 0) return
      hasReport = true
      if (paths === 'all') {
        reportedAll = true
        reportedPaths.clear()
        return
      }
      if (reportedAll) return
      for (const path of paths) reportedPaths.add(path)
    }

    try {
      let result: T
      try {
        result = await operation(reportAffectedPaths)
      } catch (error) {
        if (hasReport) {
          await this.invalidateHistoryForForward(reportedAll ? 'all' : [...reportedPaths])
        }
        throw error
      }

      let invalidatedPaths = affectedPaths
      if (hasReport) invalidatedPaths = reportedAll ? 'all' : [...reportedPaths]
      await this.invalidateHistoryForForward(invalidatedPaths)
      return result
    } finally {
      this.releaseWorkspaceMutationReservation(reservation)
    }
  }

  acquireRootSwitchReservation(): WorkspaceEditRootSwitchReservation | null {
    if (this.externalMutationReservationKind === 'ordinary') return null
    if (this.active?.commitStarted || this.snapshot.recovery) return null
    if (this.snapshot.phase === 'undoing' || this.snapshot.phase === 'redoing') return null
    const hadPreCommit = Boolean(this.active || this.preparingController)
    this.cancelPreCommitActive()
    if (hadPreCommit) {
      this.publish({ code: null, message: null, phase: 'cancelled', preview: null })
    }
    const previous = this.externalMutationReservation
    if (previous) this.releasedExternalMutationReservations.add(previous)
    const reservation = Object.freeze({}) as WorkspaceEditRootSwitchReservation
    this.externalMutationReservation = reservation
    this.externalMutationReservationKind = 'root-switch'
    this.publish({})
    return reservation
  }

  releaseRootSwitchReservation(reservation: WorkspaceEditRootSwitchReservation): boolean {
    return this.releaseWorkspaceMutationReservation(reservation)
  }

  canUndoWorkspaceEdit(): boolean {
    return this.undoStack.length > 0 && this.historyCommandsAvailable()
  }

  canRedoWorkspaceEdit(): boolean {
    return this.redoStack.length > 0 && this.historyCommandsAvailable()
  }

  resetForRoot(): void {
    if (this.active?.commitStarted) return
    this.cancelPreCommitActive()
    this.clearHistory()
    this.releaseRecoveryLocks()
    this.recoveryGroup = null
    this.serverEpoch = this.options.fileSync.getWorkspaceMutationServerEpoch()
    this.recoveryServer = null
    this.publish({
      code: null,
      message: null,
      phase: 'idle',
      preview: null,
      recovery: null,
    })
  }

  async discoverRecovery(): Promise<void> {
    void this.flushPendingWorkspaceMutationCleanup()
    if (this.externalMutationReservation) return
    const root = this.options.getRoot()
    if (!root) return
    const discovered = await this.options.fileSync.discoverWorkspaceRecovery(
      workspaceEditRequestPath(root),
    )
    const first = discovered.operations[0]
    if (!first) return
    const current = await statusResult(this.options.fileSync, first.operationId)
    if (!current) return
    if (!this.acquireRecoveryLocks(current)) {
      throw workspaceEditError('workspace-edit-busy', 'Recovery paths cannot be locked')
    }
    this.recoveryServer = current
    this.ownOperationIds.add(current.operationId)
    await this.reconcileRecoveryProjection(current)
    this.publish({
      code: 'workspace-edit-recovery-required',
      message: 'A workspace transaction needs recovery.',
      phase: 'recovery-required',
      preview: null,
      recovery: recoveryResult(current, current.affectedPaths, current),
    })
  }

  async retryRecovery(): Promise<boolean> {
    void this.flushPendingWorkspaceMutationCleanup()
    if (this.externalMutationReservation) return false
    const current = await this.currentRecoveryResult()
    if (!current) return false
    this.publish({ phase: 'recovering' })
    try {
      const recovered = await this.advanceRecovery(current)
      if (recovered.state === 'partial') {
        await this.retainPublishedRecovery(recovered)
        return false
      }
      return await this.completeStableRecovery(recovered)
    } catch {
      return this.settleRecoveryFailure(current)
    }
  }

  async discardRecoveryData(unrecoveredPaths: readonly FilesystemPath[]): Promise<boolean> {
    void this.flushPendingWorkspaceMutationCleanup()
    if (this.externalMutationReservation) return false
    const current = await this.currentRecoveryResult()
    if (!current || current.state !== 'partial') return false
    if (!sameStringSet(unrecoveredPaths, current.unrecoveredPaths)) return false
    const root = this.options.getRoot()
    if (!root) return false
    const affectedPaths = current.affectedPaths.flatMap((path) => {
      const documentPath = workspaceDocumentPath(root.path, path)
      return documentPath ? [documentPath] : []
    })
    if (affectedPaths.length !== current.affectedPaths.length) return false
    const transfer = this.prepareRecoveryConflictTransfer(affectedPaths, current.operationId)
    if (!transfer) return false

    this.publish({ phase: 'releasing-recovery' })
    try {
      await this.reconcileRecoveryProjection(current)
      const released = await this.options.fileSync.releaseWorkspaceMutation(current, {
        generation: current.generation,
        unrecoveredPaths,
      })
      if (released.state !== 'released') {
        throw workspaceEditError('workspace-edit-state', 'Recovery journal was not released')
      }
      await this.reconcileRecoveryProjection(current)
      this.commitRecoveryConflictTransfer(transfer)
      this.completeRecoveryDiscard(current)
      return true
    } catch {
      return this.settleDiscardFailure(current, transfer)
    }
  }

  confirmPreview(): void {
    const active = this.active
    if (!active || active.commitStarted) return
    if (this.snapshot.phase !== 'awaiting-confirmation') return
    void this.commitActive(active)
  }

  cancelPreview(): void {
    const active = this.active
    if (!active || active.commitStarted) return
    active.controller.abort()
    this.active = null
    const result: ApplyWorkspaceEditResult = { status: 'cancelled' }
    active.event.end(workspaceOperationSettlement(result))
    this.publishResult(result)
    active.settlement.resolve(result)
  }

  dismissResult(): void {
    if (this.active || this.snapshot.phase === 'recovery-required') return
    this.publish({ code: null, message: null, phase: 'idle', preview: null, recovery: null })
  }

  async undo(): Promise<boolean> {
    void this.flushPendingWorkspaceMutationCleanup()
    const group = this.undoStack.at(-1)
    if (!group || this.active || this.externalMutationReservation) return false
    return this.reverseGroup(group, 'undo')
  }

  async redo(): Promise<boolean> {
    void this.flushPendingWorkspaceMutationCleanup()
    const group = this.redoStack.at(-1)
    if (!group || this.active || this.externalMutationReservation) return false
    return this.reverseGroup(group, 'redo')
  }

  dispose(): void {
    this.cancelPreCommitActive()
    this.clearHistory()
    this.releaseRecoveryLocks()
    this.recoveryGroup = null
    if (this.externalMutationReservation) {
      this.releasedExternalMutationReservations.add(this.externalMutationReservation)
      this.externalMutationReservation = null
      this.externalMutationReservationKind = null
    }
    this.unsubscribeServerEpoch()
    this.unsubscribeDocumentContentRevisions()
    this.listeners.clear()
    void this.flushPendingWorkspaceMutationCleanup()
  }

  async flushPendingWorkspaceMutationCleanup(): Promise<void> {
    for (const result of Array.from(this.cleanupPending.values())) {
      await this.releaseStableWorkspaceMutation(result)
    }
  }

  private clearHistory(): void {
    const groups = [...this.undoStack.splice(0), ...this.redoStack.splice(0)]
    this.publish({})
    void Promise.all(groups.map((group) => this.releaseGroup(group))).then(() =>
      this.flushPendingWorkspaceMutationCleanup(),
    )
  }

  private async currentRecoveryResult(): Promise<WorkspaceEditResult | null> {
    if (this.recoveryServer) return this.recoveryServer
    const operationId = this.snapshot.recovery?.operationId
    if (!operationId) return null
    const current = await statusResult(this.options.fileSync, operationId)
    this.recoveryServer = current
    return current
  }

  private async advanceRecovery(current: WorkspaceEditResult): Promise<WorkspaceEditResult> {
    if (current.state !== 'partial') {
      if (isStableRecoverySettlement(current.state)) return current
      throw workspaceEditError('workspace-edit-state', 'Recovery is not in a recoverable state')
    }
    if (!current.recoveryTarget) {
      throw workspaceEditError('workspace-edit-state', 'Recovery target is missing')
    }
    return this.options.fileSync.recoverWorkspaceMutation(current)
  }

  private async settleRecoveryFailure(current: WorkspaceEditResult): Promise<boolean> {
    let status: WorkspaceEditResult | null = null
    try {
      status = await statusResult(this.options.fileSync, current.operationId)
    } catch {
      if (current.state === 'partial') await this.retainPublishedRecovery(current)
      return false
    }
    if (status?.state === 'partial') {
      await this.retainPublishedRecovery(status)
      return false
    }
    if (status && isStableRecoverySettlement(status.state)) {
      try {
        return await this.completeStableRecovery(status)
      } catch {
        this.publishRecoveryCleanupFailure(status)
        return false
      }
    }
    if (current.state === 'partial') await this.retainPublishedRecovery(current)
    return false
  }

  private async completeStableRecovery(recovered: WorkspaceEditResult): Promise<boolean> {
    if (!isStableRecoverySettlement(recovered.state)) {
      throw workspaceEditError('workspace-edit-state', 'Recovery did not reach a stable state')
    }
    this.recoveryServer = recovered
    if (this.recoveryGroup) this.recoveryGroup.server = recovered
    await this.reconcileRecoveryProjection(recovered)
    if (recovered.state !== 'released') {
      const released = await this.options.fileSync.releaseWorkspaceMutation(recovered)
      if (released.state !== 'released') {
        throw workspaceEditError('workspace-edit-state', 'Recovery journal was not released')
      }
    }

    this.options.documentStore
      .getState()
      .clearWorkspaceDocumentRecoveryConflict(recovered.operationId)
    this.releaseRecoveryHistoryGroup()
    this.releaseRecoveryLocks()
    this.recoveryServer = null
    this.ownOperationIds.delete(recovered.operationId)
    this.publish({
      code: null,
      message: null,
      phase: 'recovered',
      preview: null,
      recovery: null,
    })
    return true
  }

  private publishRecoveryCleanupFailure(result: WorkspaceEditResult): void {
    this.recoveryServer = result
    this.publish({
      code: 'workspace-edit-cleanup-failed',
      message: 'The workspace recovered, but transaction cleanup did not finish.',
      phase: 'failed',
      preview: null,
    })
  }

  private async retainPublishedRecovery(result: WorkspaceEditResult): Promise<void> {
    if (this.recoveryGroup) this.recoveryGroup.server = result
    await this.publishRecoveryResult(result)
  }

  private async publishRecoveryResult(result: WorkspaceEditResult): Promise<void> {
    this.recoveryServer = result
    await this.reconcileRecoveryProjection(result)
    const recovery = recoveryResult(result, result.affectedPaths, result)
    this.publish({
      code: 'workspace-edit-recovery-required',
      message: 'Some workspace paths still need recovery.',
      phase: 'recovery-required',
      preview: null,
      recovery,
    })
  }

  private prepareRecoveryConflictTransfer(
    affectedPaths: readonly FilesystemPath[],
    operationId: string,
  ): PreparedRecoveryConflictTransfer | null {
    const locks = this.recoveryLocks
    if (!locks) return null
    if (!locks.leases) return { transfer: null }
    const prepared = this.options.documentStore
      .getState()
      .prepareWorkspaceDocumentRecoveryConflictTransfer(locks.leases, affectedPaths, operationId)
    if (prepared.status !== 'prepared') return null
    return { transfer: prepared.transfer }
  }

  private commitRecoveryConflictTransfer(prepared: PreparedRecoveryConflictTransfer): void {
    const locks = this.recoveryLocks
    if (!locks) {
      throw createClientInvariantError('Recovery locks disappeared after discard preflight')
    }
    if (prepared.transfer) {
      this.options.documentStore
        .getState()
        .commitWorkspaceDocumentRecoveryConflictTransfer(prepared.transfer)
      locks.leases = null
    }
    this.options.documentStore.getState().releaseWorkspaceDocumentPaths(locks.reservation)
    this.recoveryLocks = null
  }

  private async settleDiscardFailure(
    current: WorkspaceEditResult,
    transfer: PreparedRecoveryConflictTransfer,
  ): Promise<boolean> {
    let status: WorkspaceEditResult | null = null
    try {
      status = await statusResult(this.options.fileSync, current.operationId)
    } catch {
      await this.retainPublishedRecovery(current)
      return false
    }
    if (status?.state === 'released') {
      await this.reconcileRecoveryProjection(current)
      this.commitRecoveryConflictTransfer(transfer)
      this.completeRecoveryDiscard(current)
      return true
    }
    if (status?.state === 'partial') {
      await this.retainPublishedRecovery(status)
      return false
    }
    await this.retainPublishedRecovery(current)
    return false
  }

  private completeRecoveryDiscard(current: WorkspaceEditResult): void {
    this.releaseRecoveryHistoryGroup()
    this.recoveryServer = null
    this.ownOperationIds.delete(current.operationId)
    this.publish({
      code: null,
      message: 'Recovery data was discarded. Affected live buffers remain conflicted.',
      phase: 'released',
      preview: null,
      recovery: recoveryResult(current, current.affectedPaths, current),
    })
  }

  private releaseRecoveryHistoryGroup(): void {
    const group = this.recoveryGroup
    if (!group) return
    this.removeGroupFromHistory(group)
    this.releaseGroupReceipts(group)
    group.server = null
    this.recoveryGroup = null
  }

  private acquireRecoveryLocks(result: WorkspaceEditResult): boolean {
    if (this.recoveryLocks) return this.recoveryServer?.operationId === result.operationId
    const root = this.options.getRoot()
    if (!root) return false
    const paths = recoveryDocumentPaths(root, result.affectedPaths)
    if (paths.length !== result.affectedPaths.length) return false
    const state = this.options.documentStore.getState()
    const requests = paths.map(state.prepareWorkspaceDocumentPathReservation)
    const reserved = state.reserveWorkspaceDocumentPaths(requests, result.operationId)
    if (reserved.status !== 'acquired') return false
    const stamps = paths.flatMap((path) => {
      const stamp = state.prepareWorkspaceDocumentTarget(fileDocumentKey(path))
      return stamp ? [stamp] : []
    })
    if (stamps.length === 0) {
      this.recoveryLocks = { leases: null, reservation: reserved.reservation }
      return true
    }
    const acquired = state.acquireWorkspaceDocumentMutationLeases(stamps, result.operationId)
    if (acquired.status === 'acquired') {
      this.recoveryLocks = {
        leases: acquired.leaseSet,
        reservation: reserved.reservation,
      }
      return true
    }
    state.releaseWorkspaceDocumentPaths(reserved.reservation)
    return false
  }

  private retainRecoveryLocks(
    locks: HeldWorkspaceLocks,
    affectedPaths: readonly FilesystemPath[],
    operationId: string,
  ): void {
    this.releaseRecoveryLocks()
    const state = this.options.documentStore.getState()
    if (locks.leases) {
      locks.leases = state.retainWorkspaceDocumentMutationLeasesForPaths(
        locks.leases,
        affectedPaths,
      )
    }
    const requests = affectedPaths.map(state.prepareWorkspaceDocumentPathReservation)
    state.releaseWorkspaceDocumentPaths(locks.reservation)
    const reserved = state.reserveWorkspaceDocumentPaths(requests, operationId)
    if (reserved.status !== 'acquired') {
      if (locks.leases) state.releaseWorkspaceDocumentMutationLeases(locks.leases)
      throw workspaceEditError('workspace-edit-stale', 'Recovery paths could not remain reserved')
    }
    locks.reservation = reserved.reservation
    this.recoveryLocks = locks
  }

  private releaseRecoveryLocks(): void {
    const locks = this.recoveryLocks
    if (!locks) return
    this.recoveryLocks = null
    releaseWorkspaceLocks(this.options.documentStore, locks)
  }

  private async reconcileRecoveryProjection(result: WorkspaceEditResult): Promise<void> {
    const root = this.options.getRoot()
    if (!root) return
    const paths = recoveryDocumentPaths(root, result.affectedPaths)
    await this.reconcileProjectionSafely(root.path, paths)
  }

  private async reconcileProjectionSafely(
    rootPath: FilesystemPath,
    paths: readonly FilesystemPath[],
  ): Promise<void> {
    try {
      await this.options.fileSync.reconcileWorkspaceMutationProjection(rootPath, paths)
    } catch {
      this.options.fileSync.invalidateWorkspaceMutationProjection(rootPath, paths)
    }
  }

  private async commitActive(active: ActiveWorkspaceEdit): Promise<void> {
    if (this.active !== active) return
    active.commitStarted = true
    active.event.transition('committing')
    this.publish({ phase: 'committing', preview: active.prepared.preview })
    let result: ApplyWorkspaceEditResult
    try {
      result = await this.commitPrepared(active.prepared, active.event)
    } catch (error) {
      result = failureResult(error)
    }
    if (this.active === active) this.active = null
    active.event.end(workspaceOperationSettlement(result))
    this.publishResult(result)
    active.settlement.resolve(result)
  }

  private async commitPrepared(
    prepared: PreparedWorkspaceEdit,
    event: WorkspaceEditOperationEventPort,
  ): Promise<ApplyWorkspaceEditResult> {
    let server: WorkspaceEditResult | null = null
    let locks: HeldWorkspaceLocks | null = null
    let local: LocalCommit | null = null
    try {
      assertPreparedRequestCurrent(this.options, prepared)
      server = await this.prepareServer(prepared)
      assertWorkspaceServerState(server, ['prepared'])
      locks = acquireWorkspaceLocks(this.options.documentStore, prepared)
      assertPreparedRequestCurrent(this.options, prepared)
      server = await commitServer(this.options.fileSync, server)
      assertWorkspaceServerState(server, ['committed'])
      local = this.runInternalDocumentMutation(() =>
        commitLocalWorkspaceEdit(this.options, prepared, locks!, server),
      )
      event.transition('finalizing')
      this.publish({ phase: 'finalizing', preview: prepared.preview })
      server = await finalizeServer(this.options.fileSync, server)
      assertWorkspaceServerState(server, ['finalized'])
      if (
        local.projection &&
        server &&
        !this.options.fileSync.sealWorkspaceMutationProjection(local.projection, server)
      ) {
        throw workspaceEditError('snapshot-drift', 'Workspace query projection became stale')
      }
      sealLocalReceipts(local, locks)
      await this.recordHistory(prepared, local, server)
      return { status: 'applied' }
    } catch (error) {
      event.transition('rolling-back')
      const result = await this.compensateFailure(prepared, server, local, locks, error)
      if (result.status === 'recovery-required' && locks) {
        const affectedPaths = result.affectedPaths
          ? recoveryDocumentPaths(prepared.root, result.affectedPaths)
          : prepared.affectedPaths
        this.retainRecoveryLocks(locks, affectedPaths, prepared.operationId)
        locks = null
      }
      return result
    } finally {
      if (locks) releaseWorkspaceLocks(this.options.documentStore, locks)
    }
  }

  private async prepareServer(
    prepared: PreparedWorkspaceEdit,
  ): Promise<WorkspaceEditResult | null> {
    if (prepared.persistence.length === 0) return null
    const request = await workspaceEditPrepareRequest(prepared)
    this.ownOperationIds.add(request.operationId)
    try {
      return await this.options.fileSync.prepareWorkspaceMutation(
        request,
        this.active!.controller.signal,
      )
    } catch (error) {
      if (!this.active?.controller.signal.aborted) throw error
      await this.options.fileSync.abortWorkspaceMutation(request.operationId, 0)
      throw error
    }
  }

  private async compensateFailure(
    prepared: PreparedWorkspaceEdit,
    server: WorkspaceEditResult | null,
    local: LocalCommit | null,
    locks: HeldWorkspaceLocks | null,
    error: unknown,
  ): Promise<ApplyWorkspaceEditResult> {
    if (!server && !local) return failureResult(error)
    if (server?.state === 'aborted' && !local) {
      this.ownOperationIds.delete(prepared.operationId)
      return { status: 'cancelled' }
    }
    this.publish({ phase: 'rolling-back', preview: prepared.preview })

    let localRestored = true
    if (local && locks) {
      localRestored = this.runInternalDocumentMutation(() =>
        reverseLocalCommit(this.options, local, locks!),
      )
    }
    const settled = await settleFailedServerMutation(this.options.fileSync, server)
    if (server && workspaceMutationMayHaveChangedDisk(server)) {
      await this.reconcileProjectionSafely(prepared.root.path, prepared.affectedPaths)
    }
    if (server?.state === 'prepared' && localRestored && settled?.state === 'aborted') {
      await this.releaseStableWorkspaceMutation(settled)
      return failureResult(error)
    }
    if (localRestored && (!settled || settled.state === 'rolled-back')) {
      if (settled) await this.releaseStableWorkspaceMutation(settled)
      if (!settled) this.ownOperationIds.delete(prepared.operationId)
      return {
        code: 'workspace-edit-rolled-back',
        message: errorMessage(error),
        status: 'rolled-back',
      }
    }

    this.recoveryServer = settled
    const recovery = recoveryResult(settled, prepared.affectedPaths, error)
    this.publish({ phase: 'recovery-required', preview: null, recovery })
    return {
      affectedPaths: recovery.affectedPaths,
      code: 'workspace-edit-recovery-required',
      message: errorMessage(error),
      status: 'recovery-required',
    }
  }

  private async recordHistory(
    prepared: PreparedWorkspaceEdit,
    local: LocalCommit,
    server: WorkspaceEditResult | null,
  ): Promise<void> {
    await this.invalidateHistoryForForward(prepared.affectedPaths)
    if (prepared.preview.undoCategory === 'editor') {
      releaseLocalReceipts(local)
      return
    }
    const group: WorkspaceEditGroup = {
      affectedPaths: prepared.affectedPaths,
      legs: [...local.legs],
      operationId: prepared.operationId,
      projection: local.projection,
      receipts: local.receipts,
      server,
    }
    this.undoStack.push(group)
    if (this.undoStack.length <= MAX_WORKSPACE_EDIT_UNDO_GROUPS) return
    const oldest = this.undoStack.shift()
    if (oldest) await this.releaseGroup(oldest)
  }

  private async invalidateHistoryForForward(
    paths: readonly FilesystemPath[] | 'all',
  ): Promise<void> {
    const discarded = this.redoStack.splice(0)
    const retained: WorkspaceEditGroup[] = []
    const invalidatedPaths = paths === 'all' ? null : new Set(paths)
    for (const group of this.undoStack.splice(0)) {
      if (!invalidatedPaths || stringSetIntersects(group.affectedPaths, invalidatedPaths)) {
        discarded.push(group)
        for (const path of group.affectedPaths) invalidatedPaths?.add(path)
        continue
      }
      retained.push(group)
    }
    this.undoStack.push(...retained)
    this.publish({})
    await Promise.all(discarded.map((group) => this.releaseGroup(group)))
  }

  private async reverseGroup(
    group: WorkspaceEditGroup,
    direction: 'redo' | 'undo',
  ): Promise<boolean> {
    const source = direction === 'undo' ? this.undoStack : this.redoStack
    if (source.at(-1) !== group) return false
    this.publish({ phase: direction === 'undo' ? 'undoing' : 'redoing' })

    let locks: HeldWorkspaceLocks | null = null
    let provisional = group.server
    let localReversed = false
    let projection: WorkspaceMutationProjectionReceipt | null = null
    try {
      if (
        group.projection &&
        !this.options.fileSync.isWorkspaceMutationProjectionCurrent(group.projection)
      ) {
        throw workspaceEditError('workspace-edit-stale', 'Workspace query projection is stale')
      }
      locks = acquireGroupLocks(this.options.documentStore, group)
      if (provisional) {
        provisional =
          direction === 'undo'
            ? await this.options.fileSync.undoWorkspaceMutation(provisional)
            : await this.options.fileSync.redoWorkspaceMutation(provisional)
        assertWorkspaceServerState(provisional, [
          direction === 'undo' ? 'undo-committed' : 'redo-committed',
        ])
        if (source.at(-1) !== group) {
          throw workspaceEditError('workspace-edit-stale', 'Workspace server epoch changed')
        }
      }
      const reversed = this.runInternalDocumentMutation(() =>
        reverseGroupLocal(this.options, group, locks!, direction),
      )
      if (!reversed) throw workspaceEditError('workspace-edit-stale', 'Workspace history is stale')
      group.receipts = reversed
      localReversed = true
      if (provisional && group.projection) {
        projection = this.options.fileSync.reverseWorkspaceMutationProjection(
          group.projection,
          provisional,
          workspaceProjectionEntries(group.projection.rootPath, provisional),
        )
        if (!projection) {
          throw workspaceEditError('workspace-edit-stale', 'Workspace query projection is stale')
        }
      }
      if (provisional) {
        provisional = await this.options.fileSync.finalizeWorkspaceMutation(provisional)
        assertWorkspaceServerState(provisional, [direction === 'undo' ? 'undone' : 'redone'])
        if (
          projection &&
          !this.options.fileSync.sealWorkspaceMutationProjection(projection, provisional)
        ) {
          throw workspaceEditError('workspace-edit-stale', 'Workspace query projection is stale')
        }
      }
      group.server = provisional
      group.projection = projection ?? group.projection
      source.pop()
      const destination = direction === 'undo' ? this.redoStack : this.undoStack
      destination.push(group)
      this.publish({ phase: direction === 'undo' ? 'applied' : 'applied' })
      return true
    } catch {
      if (projection) this.options.fileSync.rollbackWorkspaceMutationProjection(projection)
      if (localReversed && locks) {
        const opposite = direction === 'undo' ? 'redo' : 'undo'
        const restored = this.runInternalDocumentMutation(() =>
          reverseGroupLocal(this.options, group, locks!, opposite),
        )
        if (restored) group.receipts = restored
      }
      if (provisional && isProvisionalWorkspaceState(provisional.state)) {
        try {
          provisional = await this.options.fileSync.rollbackWorkspaceMutation(provisional)
        } catch {
          provisional = await statusResult(this.options.fileSync, provisional.operationId)
        }
        group.server = provisional
      }
      if (provisional?.state === 'partial' && locks) {
        await this.retainHistoryRecovery(group, provisional, locks)
        locks = null
        return false
      }
      if (group.projection) {
        await this.reconcileProjectionSafely(group.projection.rootPath, group.affectedPaths)
      }
      await this.invalidateHistoryDependencyChain(source, group.affectedPaths)
      this.publish({
        code: 'workspace-edit-stale',
        message: 'Workspace history is stale',
        phase: 'stale',
      })
      return false
    } finally {
      if (locks) releaseWorkspaceLocks(this.options.documentStore, locks)
    }
  }

  private async retainHistoryRecovery(
    group: WorkspaceEditGroup,
    result: WorkspaceEditResult,
    locks: HeldWorkspaceLocks,
  ): Promise<void> {
    const root = this.options.getRoot()
    if (!root) throw workspaceEditError('workspace-root-changed', 'Workspace root changed')
    const affectedPaths = recoveryDocumentPaths(root, result.affectedPaths)
    if (affectedPaths.length !== result.affectedPaths.length) {
      throw workspaceEditError('outside-workspace', 'Recovery path is outside the workspace')
    }
    this.retainRecoveryLocks(locks, affectedPaths, result.operationId)
    group.server = result
    this.recoveryGroup = group
    this.recoveryServer = result
    await this.publishRecoveryResult(result)
  }

  private async releaseGroup(group: WorkspaceEditGroup): Promise<void> {
    this.releaseGroupReceipts(group)
    if (group.server && group.server.state !== 'partial' && group.server.state !== 'released') {
      await this.releaseStableWorkspaceMutation(group.server)
      return
    }
    this.ownOperationIds.delete(group.operationId)
  }

  private runInternalDocumentMutation<T>(run: () => T): T {
    this.internalDocumentMutationDepth += 1
    try {
      return run()
    } finally {
      this.internalDocumentMutationDepth -= 1
    }
  }

  private async releaseStableWorkspaceMutation(result: WorkspaceEditResult): Promise<boolean> {
    try {
      const released = await this.options.fileSync.releaseWorkspaceMutation(result)
      if (released.state !== 'released') {
        this.cleanupPending.set(result.operationId, result)
        return false
      }
    } catch {
      this.cleanupPending.set(result.operationId, result)
      return false
    }
    this.cleanupPending.delete(result.operationId)
    this.ownOperationIds.delete(result.operationId)
    return true
  }

  private async invalidateHistoryDependencyChain(
    source: WorkspaceEditGroup[],
    seedPaths: readonly FilesystemPath[],
  ): Promise<void> {
    const invalidatedPaths = new Set(seedPaths)
    const discarded: WorkspaceEditGroup[] = []
    const retained: WorkspaceEditGroup[] = []
    for (let index = source.length - 1; index >= 0; index -= 1) {
      const candidate = source[index]!
      if (!stringSetIntersects(candidate.affectedPaths, invalidatedPaths)) {
        retained.push(candidate)
        continue
      }
      discarded.push(candidate)
      for (const path of candidate.affectedPaths) invalidatedPaths.add(path)
    }
    source.splice(0, source.length, ...retained.reverse())
    this.publish({})
    await Promise.all(discarded.map((candidate) => this.releaseGroup(candidate)))
  }

  private removeGroupFromHistory(group: WorkspaceEditGroup): void {
    const undoIndex = this.undoStack.indexOf(group)
    if (undoIndex >= 0) this.undoStack.splice(undoIndex, 1)
    const redoIndex = this.redoStack.indexOf(group)
    if (redoIndex >= 0) this.redoStack.splice(redoIndex, 1)
  }

  private releaseGroupReceipts(group: WorkspaceEditGroup): void {
    for (const [target, receipt] of group.receipts) {
      releaseDocumentTransactionReceipt({ buffer: target.buffer, sourceView: null }, receipt)
    }
    group.receipts.clear()
  }

  private cancelPreCommitActive(): void {
    this.preparingController?.abort()
    this.preparingController = null
    this.preparingEvent?.end({ outcome: 'cancelled' })
    this.preparingEvent = null
    const active = this.active
    if (!active || active.commitStarted) return
    active.controller.abort()
    this.active = null
    active.event.end({ outcome: 'cancelled' })
    active.settlement.resolve({ status: 'cancelled' })
  }

  private publish(next: Partial<WorkspaceEditServiceSnapshot>): void {
    const phase = next.phase ?? this.snapshot.phase
    const historyAvailable =
      !this.active &&
      !this.preparingController &&
      !this.externalMutationReservation &&
      !isBusyWorkspaceEditPhase(phase)
    this.snapshot = {
      ...this.snapshot,
      ...next,
      canCancel: next.phase === 'awaiting-confirmation',
      canRedo: historyAvailable && this.redoStack.length > 0,
      canUndo: historyAvailable && this.undoStack.length > 0,
    }
    for (const listener of this.listeners) listener()
  }

  private historyCommandsAvailable(): boolean {
    if (this.externalMutationReservation) return false
    if (this.active || this.preparingController) return false
    if (this.snapshot.recovery) return false
    return !isBusyWorkspaceEditPhase(this.snapshot.phase)
  }

  private publishResult(result: ApplyWorkspaceEditResult): void {
    if (result.status === 'applied') {
      this.publish({ code: null, message: null, phase: 'applied', preview: null })
      return
    }
    if (result.status === 'cancelled') {
      this.publish({ code: null, message: null, phase: 'cancelled', preview: null })
      return
    }
    if (result.status === 'failed' && isStaleWorkspaceEditCode(result.code)) {
      this.publish({ code: result.code, message: result.message, phase: 'stale' })
      return
    }
    this.publish({
      code: result.code,
      message: result.message,
      phase: result.status,
      preview: null,
    })
  }
}

type VirtualNode = {
  readonly initialPath: FilesystemPath
  readonly initiallyExists: boolean
  pendingText: boolean
  snapshot: WorkspaceFileSnapshot | null
  target: PreparedTarget | null
}

class WorkspaceEditPreparationBuilder {
  private readonly inspectedPathByCanonicalPath = new Map<FilesystemPath, string>()
  private readonly initialDiskContents = new Map<FilesystemPath, string>()
  private readonly externalGuards = new Map<FilesystemPath, WorkspaceResourcePrecondition>()
  private readonly inspections = new Map<FilesystemPath, WorkspaceEditPathInspection>()
  private readonly nodesByPath = new Map<FilesystemPath, VirtualNode>()
  private readonly operations: ResolvedOperation[] = []
  private readonly rawUriByPath = new Map<FilesystemPath, string>()
  private readonly targets = new Set<PreparedTarget>()

  constructor(
    private readonly options: WorkspaceEditServiceOptions,
    private readonly inspectPath: NonNullable<WorkspaceEditServiceOptions['inspectPath']>,
    private readonly request: WorkspaceEditApplicationRequest,
    private readonly root: WorkspaceEditRoot,
    private readonly signal: AbortSignal,
  ) {}

  async build(operationId: string): Promise<PreparedWorkspaceEdit> {
    for (let index = 0; index < this.request.plan.operations.length; index += 1) {
      this.signal.throwIfAborted()
      await this.resolveOperation(this.request.plan.operations[index]!, index)
    }

    const immediate = this.isImmediateCandidate()
    const operations = immediate
      ? collapseImmediateTextOperations(this.operations)
      : this.operations
    prepareTextTargets(this.targets, operations, this.request)
    const persistence = buildPersistenceOperations(operations, this.externalGuards, this.root.path)
    const projectionAfterContents = projectionContentsAfter(this.initialDiskContents, operations)
    const affectedPaths = affectedWorkspacePaths(operations)
    const preview = workspaceEditPreview(
      operationId,
      this.request,
      operations,
      immediate ? 'editor' : 'workspace',
    )
    const pathRequests = affectedPaths.map((path) =>
      this.options.documentStore.getState().prepareWorkspaceDocumentPathReservation(path),
    )

    return {
      affectedPaths,
      immediate,
      operationId,
      operations,
      pathRequests,
      persistence,
      projectionAfterContents,
      projectionBeforeContents: new Map(this.initialDiskContents),
      preview,
      request: this.request,
      root: this.root,
      targets: Array.from(this.targets),
    }
  }

  private async resolveOperation(operation: WorkspaceEditOperation, index: number): Promise<void> {
    if (operation.kind === 'text-document') {
      await this.resolveTextOperation(operation, index)
      return
    }
    if (operation.kind === 'create') {
      await this.resolveCreateOperation(operation, index)
      return
    }
    if (operation.kind === 'rename') {
      await this.resolveRenameOperation(operation, index)
      return
    }
    await this.resolveDeleteOperation(operation, index)
  }

  private async resolveTextOperation(
    operation: Extract<WorkspaceEditOperation, { readonly kind: 'text-document' }>,
    index: number,
  ): Promise<void> {
    const path = this.resolveUri(operation.uri)
    const node = await this.existingNode(path)
    if (!node) throw workspaceEditError('missing-target', 'Text target does not exist')
    const target = await this.ensureTextTarget(node, path)
    const sourceVersion = this.request.sourceFileVersions?.get(operation.uri)
    if (sourceVersion !== undefined && sourceVersion !== node.snapshot?.version) {
      throw workspaceEditError('snapshot-drift', 'File changed since replacement planning')
    }
    validateDirtyTargetProvenance(this.request, operation, target)

    const segmentIndex = target.segments.length
    target.segments.push({
      operations: [{ operation, operationIndex: index }],
      segmentIndex,
      uri: operation.uri,
    })
    node.pendingText = operation.edits.length > 0
    this.operations.push({ index, kind: 'text', operation, path, segmentIndex, target })
  }

  private async resolveCreateOperation(
    operation: Extract<WorkspaceEditOperation, { readonly kind: 'create' }>,
    index: number,
  ): Promise<void> {
    const path = this.resolveUri(operation.uri)
    const current = await this.nodeAt(path)
    if (current) await this.ensureResourceSnapshot(current, path)
    let ignored = false
    if (current && operation.overwrite) this.assertNotDestructiveLiveTarget(current)
    if (current && !operation.overwrite && operation.ignoreIfExists) ignored = true
    if (current && !operation.overwrite && !operation.ignoreIfExists) {
      throw workspaceEditError('resource-exists', 'Create target already exists')
    }

    let target: PreparedTarget | null = null
    if (!ignored) {
      const node: VirtualNode = {
        initialPath: path,
        initiallyExists: false,
        pendingText: false,
        snapshot: null,
        target: transientTarget(path, ''),
      }
      target = node.target
      if (target) this.targets.add(target)
      this.nodesByPath.set(path, node)
    }
    this.operations.push({
      ignored,
      index,
      kind: 'resource',
      operation,
      path,
      projection: null,
      target,
    })
  }

  private async resolveRenameOperation(
    operation: Extract<WorkspaceEditOperation, { readonly kind: 'rename' }>,
    index: number,
  ): Promise<void> {
    const fromPath = this.resolveUri(operation.oldUri)
    const toPath = this.resolveUri(operation.newUri)
    const source = await this.existingNode(fromPath)
    if (!source) throw workspaceEditError('missing-target', 'Rename source does not exist')
    await this.ensureResourceSnapshot(source, fromPath)

    if (fromPath === toPath) {
      this.operations.push({
        fromPath,
        ignored: true,
        index,
        kind: 'resource',
        operation,
        path: fromPath,
        projection: null,
        target: source.target,
        toPath,
      })
      return
    }

    const destination = await this.nodeAt(toPath)
    if (destination) await this.ensureResourceSnapshot(destination, toPath)
    let ignored = false
    if (destination && operation.overwrite) this.assertNotDestructiveLiveTarget(destination)
    if (destination && !operation.overwrite && operation.ignoreIfExists) ignored = true
    if (destination && !operation.overwrite && !operation.ignoreIfExists) {
      throw workspaceEditError('resource-exists', 'Rename destination already exists')
    }

    if (!ignored) {
      this.nodesByPath.delete(fromPath)
      this.nodesByPath.set(toPath, source)
      if (source.target) source.target.currentPath = toPath
    }
    this.operations.push({
      fromPath,
      ignored,
      index,
      kind: 'resource',
      operation,
      path: fromPath,
      projection: null,
      target: source.target,
      toPath,
    })
  }

  private async resolveDeleteOperation(
    operation: Extract<WorkspaceEditOperation, { readonly kind: 'delete' }>,
    index: number,
  ): Promise<void> {
    const path = this.resolveUri(operation.uri)
    const node = await this.nodeAt(path)
    if (!node && !operation.ignoreIfNotExists) {
      throw workspaceEditError('missing-target', 'Delete target does not exist')
    }
    const ignored = node === null
    if (node) await this.ensureResourceSnapshot(node, path)
    if (node && (node.pendingText || node.target?.dirtyInitially)) {
      throw workspaceEditError('dirty-destructive-target', 'Delete would discard unsaved text')
    }
    if (node) this.nodesByPath.delete(path)
    this.operations.push({
      ignored,
      index,
      kind: 'resource',
      operation,
      path,
      projection: null,
      target: node?.target ?? null,
    })
  }

  private async nodeAt(path: FilesystemPath): Promise<VirtualNode | null> {
    if (this.nodesByPath.has(path)) return this.nodesByPath.get(path) ?? null
    return this.loadExternalNode(path)
  }

  private async existingNode(path: FilesystemPath): Promise<VirtualNode | null> {
    return this.nodeAt(path)
  }

  private async loadExternalNode(path: FilesystemPath): Promise<VirtualNode | null> {
    await this.assertSupportedPath(path)
    const live = this.options.documentStore.getState().getLiveEditorDocument(fileDocumentKey(path))
    if (live) {
      const node = this.liveNode(live)
      this.nodesByPath.set(path, node)
      return node
    }

    const inspected = await this.inspect(path)
    if (!inspected.exists) {
      this.externalGuards.set(path, { kind: 'missing' })
      return null
    }
    if (inspected.type !== 'file') {
      throw workspaceEditError(
        'unsupported-resource-type',
        'Workspace edits support regular files only',
      )
    }
    this.externalGuards.set(path, snapshotPrecondition(inspected))
    const node: VirtualNode = {
      initialPath: path,
      initiallyExists: true,
      pendingText: false,
      snapshot: null,
      target: null,
    }
    this.nodesByPath.set(path, node)
    return node
  }

  private liveNode(document: LiveEditorDocument): VirtualNode {
    if (document.sync.kind !== 'file' || document.target.kind !== 'file') {
      throw workspaceEditError(
        'unsupported-target',
        'Synthetic documents cannot receive workspace edits',
      )
    }
    this.externalGuards.set(document.target.resource.path, {
      kind: 'snapshot',
      mtimeMs: document.sync.mtimeMs,
      version: document.sync.fileVersion,
    })
    const stamp = this.options.documentStore.getState().prepareWorkspaceDocumentTarget(document.key)
    if (!stamp)
      throw workspaceEditError('snapshot-drift', 'Live document changed during preparation')
    const target: PreparedTarget = {
      buffer: document.buffer,
      currentPath: document.target.resource.path,
      dirtyInitially: stamp.dirty,
      initialPath: document.target.resource.path,
      initialSnapshot: document.buffer.getTextSnapshot(),
      kind: stamp.dirty ? 'dirty' : 'open',
      liveStamp: stamp,
      prepared: null,
      segments: [],
    }
    this.targets.add(target)
    return {
      initialPath: document.target.resource.path,
      initiallyExists: true,
      pendingText: false,
      snapshot: null,
      target,
    }
  }

  private async ensureTextTarget(node: VirtualNode, path: FilesystemPath): Promise<PreparedTarget> {
    if (node.target) return node.target
    const snapshot = node.snapshot ?? (await this.readWorkspaceSnapshot(node, path))
    assertSafeRoundTrip(snapshot)
    const target = transientTarget(path, snapshot.text)
    node.target = target
    this.targets.add(target)
    this.externalGuards.set(path, snapshotPrecondition(snapshot))
    return target
  }

  private async ensureResourceSnapshot(node: VirtualNode, path: FilesystemPath): Promise<void> {
    if (!node.initiallyExists || node.snapshot) return
    await this.readWorkspaceSnapshot(node, path)
  }

  private async readWorkspaceSnapshot(
    node: VirtualNode,
    path: FilesystemPath,
  ): Promise<WorkspaceFileSnapshot> {
    const snapshot = await this.options.fileSync.readWorkspaceSnapshot(path, this.signal)
    assertSafeRoundTrip(snapshot)
    node.snapshot = snapshot
    this.initialDiskContents.set(path, snapshot.text)
    this.externalGuards.set(path, snapshotPrecondition(snapshot))
    return snapshot
  }

  private assertNotDestructiveLiveTarget(node: VirtualNode): void {
    if (!node.target?.liveStamp) return
    throw workspaceEditError('open-overwrite-target', 'Cannot overwrite an open document')
  }

  private resolveUri(uri: string): FilesystemPath {
    const path = workspacePathFromFileUri(uri, this.root)
    const existing = this.rawUriByPath.get(path)
    if (existing && existing !== uri) {
      throw workspaceEditError('ambiguous-resource-alias', 'Multiple URIs resolve to one path')
    }
    this.rawUriByPath.set(path, uri)
    return path
  }

  private async assertSupportedPath(path: FilesystemPath): Promise<void> {
    const relative = workspaceRelativePath(this.root.path, path)
    if (!relative || relative === '.') {
      throw workspaceEditError('unsupported-target', 'Workspace root is not a file target')
    }
    const segments = relative.split('/')
    let current = this.root.path
    for (const segment of segments) {
      const next = workspaceDocumentPath(current, segment)
      if (!next) {
        throw workspaceEditError('outside-workspace', 'Workspace target path is invalid')
      }
      current = next
      const inspected = await this.inspect(current)
      if (!inspected.exists) return
      if (inspected.type === 'symlink') {
        throw workspaceEditError('symlink-target', 'Workspace edits do not follow symlinks')
      }
    }
  }

  private async inspect(path: FilesystemPath): Promise<WorkspaceEditPathInspection> {
    const cached = this.inspections.get(path)
    if (cached) return cached
    const inspected = await this.inspectPath(path, this.signal)
    this.assertCanonicalInspection(path, inspected)
    this.inspections.set(path, inspected)
    return inspected
  }

  private assertCanonicalInspection(
    path: FilesystemPath,
    inspected: WorkspaceEditPathInspection,
  ): void {
    if (!inspected.exists) return
    if (inspected.path !== inspected.canonicalPath) {
      throw workspaceEditError(
        'ambiguous-resource-alias',
        'Workspace path spelling is not canonical',
      )
    }
    const existing = this.inspectedPathByCanonicalPath.get(inspected.canonicalPath)
    if (existing && existing !== path) {
      throw workspaceEditError(
        'ambiguous-resource-alias',
        'Multiple workspace paths resolve to one resource',
      )
    }
    this.inspectedPathByCanonicalPath.set(inspected.canonicalPath, path)
  }

  private isImmediateCandidate(): boolean {
    if (this.operations.length === 0) return true
    if (this.operations.some((operation) => operation.kind !== 'text')) return false
    const targets = new Set(this.operations.map((operation) => operation.target))
    if (targets.size !== 1) return false
    const target = this.operations[0]?.target
    if (!target?.liveStamp) return false
    if (
      Array.from(this.request.plan.annotations.values()).some(
        (annotation) => annotation.needsConfirmation,
      )
    ) {
      return false
    }
    const originPath = workspacePathFromFileUri(this.request.originUri, this.root)
    if (originPath !== target.initialPath) return false
    return exactProvenanceForTarget(this.request, this.request.originUri, target)
  }
}

async function prepareWorkspaceEdit(
  options: WorkspaceEditServiceOptions,
  inspectPath: NonNullable<WorkspaceEditServiceOptions['inspectPath']>,
  request: WorkspaceEditApplicationRequest,
  signal: AbortSignal,
  operationId: string,
): Promise<PreparedWorkspaceEdit> {
  const root = options.getRoot()
  if (!root) throw workspaceEditError('workspace-missing', 'No workspace is open')
  const builder = new WorkspaceEditPreparationBuilder(options, inspectPath, request, root, signal)
  return builder.build(operationId)
}

function collapseImmediateTextOperations(
  operations: readonly ResolvedOperation[],
): readonly ResolvedOperation[] {
  return operations.map((operation) => {
    if (operation.kind !== 'text') return operation
    return { ...operation, segmentIndex: 0 }
  })
}

function prepareTextTargets(
  targets: ReadonlySet<PreparedTarget>,
  operations: readonly ResolvedOperation[],
  request: WorkspaceEditApplicationRequest,
): void {
  const segmentsByTarget = collectTextSegments(operations)
  for (const target of targets) {
    const segments = segmentsByTarget.get(target) ?? []
    target.segments.splice(0, target.segments.length, ...segments)
    if (segments.length === 0) continue

    const prepared = prepareWorkspaceTextReplay({
      logicalRevisionScope: request.logicalRevisionScope,
      provenance: request.guard.documents,
      segments,
      target: {
        buffer: target.buffer,
        expectedRevision: target.liveStamp?.bufferRevision ?? target.buffer.getRevision(),
        initialSnapshot: target.initialSnapshot,
      },
    })
    if (!prepared.ok) {
      throw workspaceEditError(prepared.error.code, workspaceReplayFailureMessage(prepared.error))
    }
    target.prepared = prepared
  }
}

function collectTextSegments(
  operations: readonly ResolvedOperation[],
): Map<PreparedTarget, WorkspaceTextReplaySegmentInput[]> {
  const entries = new Map<
    PreparedTarget,
    Map<
      number,
      { operations: WorkspaceTextReplaySegmentInput['operations'][number][]; uri: string }
    >
  >()
  for (const resolved of operations) {
    if (resolved.kind !== 'text') continue
    let targetEntries = entries.get(resolved.target)
    if (!targetEntries) {
      targetEntries = new Map()
      entries.set(resolved.target, targetEntries)
    }
    let segment = targetEntries.get(resolved.segmentIndex)
    if (!segment) {
      segment = { operations: [], uri: resolved.operation.uri }
      targetEntries.set(resolved.segmentIndex, segment)
    }
    segment.operations.push({ operation: resolved.operation, operationIndex: resolved.index })
  }

  const result = new Map<PreparedTarget, WorkspaceTextReplaySegmentInput[]>()
  for (const [target, targetEntries] of entries) {
    const segments = Array.from(targetEntries, ([segmentIndex, segment]) => ({
      operations: segment.operations,
      segmentIndex,
      uri: segment.uri,
    })).sort((left, right) => left.segmentIndex - right.segmentIndex)
    result.set(target, segments)
  }
  return result
}

function workspaceReplayFailureMessage(error: {
  readonly editIndex?: number
  readonly operationIndex?: number
  readonly reason: string
}): string {
  const positions: string[] = []
  if (error.operationIndex !== undefined) positions.push(`operation ${error.operationIndex}`)
  if (error.editIndex !== undefined) positions.push(`edit ${error.editIndex}`)
  if (positions.length === 0) return error.reason
  return `${error.reason} (${positions.join(', ')})`
}

function buildPersistenceOperations(
  operations: readonly ResolvedOperation[],
  initialGuards: ReadonlyMap<FilesystemPath, WorkspaceResourcePrecondition>,
  rootPath: FilesystemPath,
): readonly WorkspacePersistenceOperation[] {
  const guards = new Map(initialGuards)
  const persistence: WorkspacePersistenceOperation[] = []
  for (const resolved of operations) {
    if (resolved.kind === 'text') {
      appendPersistenceWrite(persistence, guards, resolved, rootPath)
      continue
    }
    appendPersistenceResource(persistence, guards, resolved, rootPath)
  }
  return persistence
}

function projectionContentsAfter(
  before: ReadonlyMap<FilesystemPath, string>,
  operations: readonly ResolvedOperation[],
): ReadonlyMap<FilesystemPath, string> {
  const after = new Map(before)
  for (const resolved of operations) {
    if (resolved.kind === 'text') {
      projectTextContent(after, resolved)
      continue
    }
    projectResourceContent(after, resolved)
  }
  return after
}

function projectTextContent(
  contents: Map<FilesystemPath, string>,
  resolved: ResolvedTextOperation,
): void {
  if (resolved.target.kind !== 'unopened') return
  const segment = preparedSegment(resolved)
  if (!segment || segment.logicalRevisionCount === 0) return
  contents.set(resolved.path, pieceTableDocumentText(segment.snapshotAfter))
}

function projectResourceContent(
  contents: Map<FilesystemPath, string>,
  resolved: ResolvedResourceOperation,
): void {
  if (resolved.ignored) return
  if (resolved.operation.kind === 'create') {
    contents.set(resolved.path, '')
    return
  }
  if (resolved.operation.kind === 'delete') {
    contents.delete(resolved.path)
    return
  }
  const from = requiredPath(resolved.fromPath)
  const to = requiredPath(resolved.toPath)
  const content = contents.get(from)
  contents.delete(from)
  if (content !== undefined) contents.set(to, content)
}

function appendPersistenceWrite(
  persistence: WorkspacePersistenceOperation[],
  guards: Map<FilesystemPath, WorkspaceResourcePrecondition>,
  resolved: ResolvedTextOperation,
  rootPath: FilesystemPath,
): void {
  if (resolved.target.kind !== 'unopened') return
  const segment = preparedSegment(resolved)
  if (!segment || segment.logicalRevisionCount === 0) return
  const expected = requiredExistingGuard(guards, resolved.path)
  persistence.push({
    expected,
    index: resolved.index,
    kind: 'write',
    path: requiredRelativePath(rootPath, resolved.path),
    text: pieceTableDocumentText(segment.snapshotAfter),
  })
  guards.set(resolved.path, transactionGuard(resolved.index))
}

function appendPersistenceResource(
  persistence: WorkspacePersistenceOperation[],
  guards: Map<FilesystemPath, WorkspaceResourcePrecondition>,
  resolved: ResolvedResourceOperation,
  rootPath: FilesystemPath,
): void {
  const operation = resolved.operation
  if (operation.kind === 'create') {
    persistence.push({
      destination: requiredGuard(guards, resolved.path),
      ignoreIfExists: operation.ignoreIfExists,
      index: resolved.index,
      kind: 'create',
      overwrite: operation.overwrite,
      path: requiredRelativePath(rootPath, resolved.path),
    })
    guards.set(resolved.path, transactionGuard(resolved.index))
    return
  }
  if (operation.kind === 'rename') {
    const fromPath = requiredPath(resolved.fromPath)
    const toPath = requiredPath(resolved.toPath)
    persistence.push({
      destination: requiredGuard(guards, toPath),
      ignoreIfExists: operation.ignoreIfExists,
      index: resolved.index,
      kind: 'rename',
      newPath: requiredRelativePath(rootPath, toPath),
      oldPath: requiredRelativePath(rootPath, fromPath),
      overwrite: operation.overwrite,
      source: requiredExistingGuard(guards, fromPath),
    })
    guards.set(fromPath, transactionGuard(resolved.index))
    guards.set(toPath, transactionGuard(resolved.index))
    return
  }
  persistence.push({
    expected: requiredGuard(guards, resolved.path),
    ignoreIfNotExists: operation.ignoreIfNotExists,
    index: resolved.index,
    kind: 'delete',
    path: requiredRelativePath(rootPath, resolved.path),
    recursive: operation.recursive,
  })
  guards.set(resolved.path, transactionGuard(resolved.index))
}

function preparedSegment(resolved: ResolvedTextOperation) {
  return resolved.target.prepared?.segments.find(
    (segment) => segment.segmentIndex === resolved.segmentIndex,
  )
}

function requiredGuard(
  guards: ReadonlyMap<FilesystemPath, WorkspaceResourcePrecondition>,
  path: FilesystemPath,
): WorkspaceResourcePrecondition {
  const guard = guards.get(path)
  if (guard) return guard
  throw workspaceEditError('invalid-resource-plan', 'Resource plan has no guarded path state')
}

function requiredExistingGuard(
  guards: ReadonlyMap<FilesystemPath, WorkspaceResourcePrecondition>,
  path: FilesystemPath,
): Exclude<WorkspaceResourcePrecondition, { readonly kind: 'missing' }> {
  const guard = requiredGuard(guards, path)
  if (guard.kind !== 'missing') return guard
  throw workspaceEditError('missing-target', 'Text or rename source does not exist')
}

function transactionGuard(afterOperation: number): WorkspaceResourcePrecondition {
  return { afterOperation, kind: 'transaction' }
}

function requiredRelativePath(rootPath: FilesystemPath, path: FilesystemPath): FilesystemPath {
  const relative = workspaceRelativePath(rootPath, path)
  if (relative && relative !== '.') return relative
  throw workspaceEditError('outside-workspace', 'Workspace edit target is outside the workspace')
}

function workspaceRelativePath(
  rootPath: FilesystemPath,
  path: FilesystemPath,
): FilesystemPath | null {
  const root = normalizeWorkspaceNamespacePath(rootPath)
  const target = normalizeWorkspaceNamespacePath(path)
  if (root === '/') {
    if (!target.startsWith('/')) return null
    return filesystemPath(target === '/' ? '.' : target.slice(1))
  }
  if (!root) {
    if (target.startsWith('/')) return null
    return filesystemPath(target || '.')
  }
  if (target === root) return filesystemPath('.')
  if (!target.startsWith(`${root}/`)) return null
  return filesystemPath(target.slice(root.length + 1))
}

function workspaceDocumentPath(
  rootPath: FilesystemPath,
  relativePath: string,
): FilesystemPath | null {
  if (!relativePath || relativePath.startsWith('/')) return null
  const root = normalizeWorkspaceNamespacePath(rootPath)
  if (relativePath === '.') return root
  if (relativePath.split('/').some((segment) => segment === '.' || segment === '..')) return null
  if (root === '/') return filesystemPath(`/${relativePath}`)
  if (!root) return filesystemPath(relativePath)
  return filesystemPath(`${root}/${relativePath}`)
}

function recoveryDocumentPaths(
  root: WorkspaceEditRoot,
  relativePaths: readonly string[],
): readonly FilesystemPath[] {
  return relativePaths.flatMap((path) => {
    const documentPath = workspaceDocumentPath(root.path, path)
    return documentPath ? [documentPath] : []
  })
}

function normalizeWorkspaceNamespacePath(path: FilesystemPath): FilesystemPath {
  if (path === '/') return path
  return filesystemPath(normalizeWorkspaceRoot(path))
}

function workspaceEditUriPath(root: WorkspaceEditRoot): FilesystemPath {
  return root.uriPath ?? root.path
}

function workspaceEditRequestPath(root: WorkspaceEditRoot): FilesystemPath {
  return root.workspacePath ?? root.path
}

function sameWorkspaceEditRoot(left: WorkspaceEditRoot, right: WorkspaceEditRoot): boolean {
  if (left.generation !== right.generation) return false
  if (left.path !== right.path) return false
  if (workspaceEditUriPath(left) !== workspaceEditUriPath(right)) return false
  return workspaceEditRequestPath(left) === workspaceEditRequestPath(right)
}

function requiredPath(path: FilesystemPath | undefined): FilesystemPath {
  if (path) return path
  throw createClientInvariantError('Resolved workspace resource path is missing')
}

function affectedWorkspacePaths(
  operations: readonly ResolvedOperation[],
): readonly FilesystemPath[] {
  const paths = new Set<FilesystemPath>()
  for (const operation of operations) {
    paths.add(operation.path)
    if (operation.kind === 'text') continue
    if (operation.fromPath) paths.add(operation.fromPath)
    if (operation.toPath) paths.add(operation.toPath)
  }
  return Array.from(paths).sort()
}

function workspaceEditPreview(
  operationId: string,
  request: WorkspaceEditApplicationRequest,
  operations: readonly ResolvedOperation[],
  undoCategory: WorkspaceEditPreview['undoCategory'],
): WorkspaceEditPreview {
  return Object.freeze({
    annotations: Object.freeze(
      Array.from(request.plan.annotations, ([id, annotation]) => ({ id, ...annotation })),
    ),
    label: request.label,
    operationCount: operations.length,
    operationId,
    rows: Object.freeze(operations.map(workspaceEditPreviewRow)),
    undoCategory,
  })
}

function workspaceEditPreviewRow(resolved: ResolvedOperation): WorkspaceEditPreviewRow {
  const annotationIds = operationAnnotationIds(resolved.operation)
  if (resolved.kind === 'text') {
    const segment = preparedSegment(resolved)
    return {
      ...(segment
        ? {
            afterText: pieceTableDocumentText(segment.snapshotAfter),
            beforeText: pieceTableDocumentText(segment.snapshotBefore),
          }
        : {}),
      annotationIds,
      ignored: segment?.logicalRevisionCount === 0,
      index: resolved.index,
      kind: resolved.operation.kind,
      path: resolved.path,
      targetKind: resolved.target.kind,
    }
  }
  return {
    annotationIds,
    ...(resolved.fromPath ? { fromPath: resolved.fromPath } : {}),
    ignored: resolved.ignored,
    index: resolved.index,
    kind: resolved.operation.kind,
    path: resolved.path,
    ...(resolved.toPath ? { toPath: resolved.toPath } : {}),
  }
}

function operationAnnotationIds(operation: WorkspaceEditOperation): readonly string[] {
  const ids = new Set<string>()
  if (operation.annotationId) ids.add(operation.annotationId)
  if (operation.kind === 'text-document') {
    for (const edit of operation.edits) {
      if (edit.annotationId) ids.add(edit.annotationId)
    }
  }
  return Array.from(ids)
}

function transientTarget(path: FilesystemPath, text: string): PreparedTarget {
  const buffer = createEditorTextBuffer(text)
  buffer.markClean()
  return {
    buffer,
    currentPath: path,
    dirtyInitially: false,
    initialPath: path,
    initialSnapshot: buffer.getTextSnapshot(),
    kind: 'unopened',
    liveStamp: null,
    prepared: null,
    segments: [],
  }
}

function validateDirtyTargetProvenance(
  request: WorkspaceEditApplicationRequest,
  operation: Extract<WorkspaceEditOperation, { readonly kind: 'text-document' }>,
  target: PreparedTarget,
): void {
  if (!target.dirtyInitially && operation.version === null) return
  const provenance = currentExactProvenance(request, operation.uri, target)
  if (!provenance) {
    throw workspaceEditError('version-mismatch', 'No current lane provenance matches live text')
  }
  if (operation.version === null || operation.version === provenance.version) return
  throw workspaceEditError('version-mismatch', 'Workspace edit version does not match live text')
}

function exactProvenanceForTarget(
  request: WorkspaceEditApplicationRequest,
  uri: string,
  target: PreparedTarget,
): boolean {
  return currentExactProvenance(request, uri, target) !== null
}

function currentExactProvenance(
  request: WorkspaceEditApplicationRequest,
  uri: string,
  target: PreparedTarget,
) {
  if (!request.guard.isCurrent(uri)) return null
  return (
    request.guard.documents.find(
      (entry) => entry.uri === uri && entry.textSnapshot === target.initialSnapshot,
    ) ?? null
  )
}

function snapshotPrecondition(snapshot: {
  readonly mtimeMs: number
  readonly version: string
}): WorkspaceResourcePrecondition {
  return { kind: 'snapshot', mtimeMs: snapshot.mtimeMs, version: snapshot.version }
}

function assertSafeRoundTrip(snapshot: WorkspaceFileSnapshot): void {
  const status = documentTextRoundTripStatus(snapshot.text)
  if (status.ok) return
  throw workspaceEditError(
    'unsafe-text-round-trip',
    `Text cannot round-trip safely: ${status.issues.join(', ')}`,
  )
}

function workspacePathFromFileUri(uri: string, root: WorkspaceEditRoot): FilesystemPath {
  if (!uri.startsWith('file:///')) {
    throw workspaceEditError('unsupported-uri', 'Workspace edits require a local file URI')
  }
  if (uri.includes('?') || uri.includes('#')) {
    throw workspaceEditError('unsupported-uri', 'Workspace file URIs cannot include query or hash')
  }
  const rawPath = uri.slice('file://'.length)
  if (/%2f|%5c/i.test(rawPath)) {
    throw workspaceEditError('unsupported-uri', 'Encoded path separators are not supported')
  }

  const decodedSegments = decodeUriPathSegments(rawPath)
  if (decodedSegments.some((segment) => segment === '.' || segment === '..')) {
    throw workspaceEditError('outside-workspace', 'Workspace file URI contains a dot segment')
  }
  if (decodedSegments.slice(1).some((segment) => segment.length === 0)) {
    throw workspaceEditError('unsupported-uri', 'Workspace file URI is not canonical')
  }
  const decodedPath = decodedSegments.join('/')
  if (!decodedPath.startsWith('/') || decodedPath.includes('\\') || decodedPath.includes('\0')) {
    throw workspaceEditError('unsupported-uri', 'Workspace file URI has an invalid path')
  }
  const path = filesystemPath(decodedPath)
  const relative = workspaceRelativePath(workspaceEditUriPath(root), path)
  if (!relative) {
    throw workspaceEditError('outside-workspace', 'Workspace edit target is outside the workspace')
  }
  const documentPath = workspaceDocumentPath(root.path, relative)
  if (documentPath) return documentPath
  throw workspaceEditError('outside-workspace', 'Workspace edit target is outside the workspace')
}

function decodeUriPathSegments(rawPath: string): string[] {
  try {
    return rawPath.split('/').map((segment) => decodeURIComponent(segment))
  } catch (cause) {
    throw workspaceEditError('unsupported-uri', 'Workspace file URI has malformed escaping', cause)
  }
}

function secureOperationId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  throw createClientInvariantError('Secure workspace operation identifiers are unavailable')
}

function linkedAbortController(signal: AbortSignal): AbortController {
  const controller = new AbortController()
  if (signal.aborted) {
    controller.abort(signal.reason)
    return controller
  }
  signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  return controller
}

function workspaceEditError(code: string, message: string, cause?: unknown) {
  return createClientError({
    cause,
    code,
    fix: 'Request the workspace edit again after resolving the reported conflict.',
    message,
    status: 409,
    why: 'The workspace edit could not be applied as one guarded transaction.',
  })
}

function assertPreparedRequestCurrent(
  options: WorkspaceEditServiceOptions,
  prepared: PreparedWorkspaceEdit,
): void {
  const root = options.getRoot()
  if (!root || !sameWorkspaceEditRoot(root, prepared.root)) {
    throw workspaceEditError('workspace-root-changed', 'Workspace changed after edit preparation')
  }

  const state = options.documentStore.getState()
  for (const target of prepared.targets) {
    if (!target.liveStamp) continue
    if (!state.isWorkspaceDocumentTargetCurrent(target.liveStamp)) {
      throw workspaceEditError('snapshot-drift', 'A live document changed after preparation')
    }
  }
  for (const request of prepared.pathRequests) {
    const current = state.prepareWorkspaceDocumentPathReservation(request.canonicalPath)
    if (samePathReservationRequest(current, request)) continue
    throw workspaceEditError('snapshot-drift', 'Workspace document ownership changed')
  }
  assertWorkspaceEditProvenanceCurrent(prepared)
}

function samePathReservationRequest(
  left: WorkspaceDocumentPathReservationRequest,
  right: WorkspaceDocumentPathReservationRequest,
): boolean {
  return (
    left.canonicalPath === right.canonicalPath &&
    left.expectedDocumentKey === right.expectedDocumentKey &&
    left.expectedPathOwnershipRevision === right.expectedPathOwnershipRevision
  )
}

function assertWorkspaceEditProvenanceCurrent(prepared: PreparedWorkspaceEdit): void {
  for (const resolved of prepared.operations) {
    if (resolved.kind !== 'text' || !resolved.target.liveStamp) continue
    const requiresExact =
      prepared.immediate || resolved.target.dirtyInitially || resolved.operation.version !== null
    if (!requiresExact) continue
    if (exactProvenanceForTarget(prepared.request, resolved.operation.uri, resolved.target))
      continue
    throw workspaceEditError('version-mismatch', 'Originating language snapshot changed')
  }
}

function acquireWorkspaceLocks(
  documentStore: EditorDocumentStoreApi,
  prepared: PreparedWorkspaceEdit,
): HeldWorkspaceLocks {
  const state = documentStore.getState()
  const reserved = state.reserveWorkspaceDocumentPaths(prepared.pathRequests, prepared.operationId)
  if (reserved.status !== 'acquired') {
    throw workspaceEditError(
      `workspace-path-${reserved.status}`,
      'Workspace paths cannot be locked',
    )
  }

  const stamps = prepared.targets.flatMap((target) => (target.liveStamp ? [target.liveStamp] : []))
  if (stamps.length === 0) return { leases: null, reservation: reserved.reservation }
  const acquired = state.acquireWorkspaceDocumentMutationLeases(stamps, prepared.operationId)
  if (acquired.status === 'acquired') {
    return { leases: acquired.leaseSet, reservation: reserved.reservation }
  }
  state.releaseWorkspaceDocumentPaths(reserved.reservation)
  throw workspaceEditError(
    `workspace-buffer-${acquired.status}`,
    'Workspace buffers cannot be locked',
  )
}

function releaseWorkspaceLocks(
  documentStore: EditorDocumentStoreApi,
  locks: HeldWorkspaceLocks,
): void {
  const state = documentStore.getState()
  if (locks.leases) state.releaseWorkspaceDocumentMutationLeases(locks.leases)
  state.releaseWorkspaceDocumentPaths(locks.reservation)
}

function commitLocalWorkspaceEdit(
  options: WorkspaceEditServiceOptions,
  prepared: PreparedWorkspaceEdit,
  locks: HeldWorkspaceLocks,
  server: WorkspaceEditResult | null,
): LocalCommit {
  const local: LocalCommit = { legs: [], projection: null, receipts: new Map() }
  try {
    options.documentStore.getState().runWorkspaceDocumentBatch(() => {
      for (const resolved of prepared.operations) {
        if (resolved.kind === 'text') {
          commitLocalTextLeg(prepared, locks, local, resolved)
          continue
        }
        commitLocalResourceLeg(options, locks, local, resolved)
      }
      completeLocalTextSequences(locks, local, prepared.targets)
      if (server) {
        local.projection = options.fileSync.projectWorkspaceMutation(
          server,
          workspaceProjectionRequest(prepared, server),
        )
      }
    })
    return local
  } catch (error) {
    reverseLocalCommit(options, local, locks)
    throw error
  }
}

function commitLocalTextLeg(
  prepared: PreparedWorkspaceEdit,
  locks: HeldWorkspaceLocks,
  local: LocalCommit,
  resolved: ResolvedTextOperation,
): void {
  const replay = resolved.target.prepared
  const segment = preparedSegment(resolved)
  if (!replay?.sequence || segment?.sequenceSegmentIndex === null || !segment) return
  const target = documentCommitTarget(resolved.target, locks)
  const result = commitPreparedDocumentTransactionSequenceSegment(
    target,
    replay.sequence,
    segment.sequenceSegmentIndex,
    {
      history: prepared.immediate
        ? { kind: 'record' }
        : { groupId: prepared.operationId, kind: 'external-barrier' },
    },
  )
  if (result.status !== 'committed' && result.status !== 'logical-only') {
    throw workspaceEditError('snapshot-drift', 'Prepared Editor transaction became stale')
  }
  if (result.receipt) local.receipts.set(resolved.target, result.receipt)
  local.legs.push({
    kind: 'text',
    sequenceSegmentIndex: segment.sequenceSegmentIndex,
    target: resolved.target,
  })
}

function completeLocalTextSequences(
  locks: HeldWorkspaceLocks,
  local: LocalCommit,
  targets: readonly PreparedTarget[],
): void {
  for (const target of targets) {
    const sequence = target.prepared?.sequence
    if (!sequence) continue
    const completed = completePreparedDocumentTransactionSequence(
      documentCommitTarget(target, locks),
      sequence,
    )
    if (completed.status !== 'completed') {
      throw workspaceEditError('snapshot-drift', 'Editor transaction sequence did not complete')
    }
    if (completed.receipt) local.receipts.set(target, completed.receipt)
  }
}

function commitLocalResourceLeg(
  options: WorkspaceEditServiceOptions,
  locks: HeldWorkspaceLocks,
  local: LocalCommit,
  resolved: ResolvedResourceOperation,
): void {
  if (resolved.ignored || !resolved.target?.liveStamp) return
  const projection = prepareLocalProjection(options.documentStore, locks.reservation, resolved)
  if (!projection) {
    throw workspaceEditError('snapshot-drift', 'Live resource projection became stale')
  }
  if (!options.documentStore.getState().commitWorkspaceDocumentProjection(projection)) {
    throw workspaceEditError('snapshot-drift', 'Live resource projection could not commit')
  }
  local.legs.push({ kind: 'projection', projection, resolved })
  if (resolved.operation.kind !== 'rename' || !resolved.toPath || !resolved.fromPath) return
  resolved.target.currentPath = resolved.toPath
  transitionDocumentUri(options, locks, resolved.target, resolved.fromPath, resolved.toPath)
}

function prepareLocalProjection(
  documentStore: EditorDocumentStoreApi,
  reservation: WorkspaceDocumentPathReservation,
  resolved: ResolvedResourceOperation,
): WorkspaceDocumentProjection | null {
  const state = documentStore.getState()
  if (resolved.operation.kind === 'rename') {
    return state.prepareWorkspaceDocumentRename(
      requiredPath(resolved.fromPath),
      requiredPath(resolved.toPath),
      reservation,
    )
  }
  if (resolved.operation.kind === 'delete') {
    return state.prepareWorkspaceDocumentDelete(resolved.path, reservation)
  }
  return null
}

function documentCommitTarget(target: PreparedTarget, locks: HeldWorkspaceLocks) {
  const mutationLease = mutationLeaseForBuffer(locks.leases, target.buffer)
  return {
    buffer: target.buffer,
    ...(mutationLease ? { mutationLease } : {}),
    sourceView: null,
  }
}

function mutationLeaseForBuffer(
  leases: WorkspaceDocumentMutationLeaseSet | null,
  buffer: EditorTextBuffer,
): DocumentMutationLease | null {
  return leases?.entries.find((entry) => entry.buffer === buffer)?.lease ?? null
}

function transitionDocumentUri(
  options: WorkspaceEditServiceOptions,
  locks: HeldWorkspaceLocks,
  target: PreparedTarget,
  fromPath: FilesystemPath,
  toPath: FilesystemPath,
): void {
  const lease = mutationLeaseForBuffer(locks.leases, target.buffer)
  if (!lease) {
    throw workspaceEditError(
      'snapshot-drift',
      'Live document URI transition lost its mutation lease',
    )
  }
  const expectedPoint = target.buffer.getDocumentSyncPoint()
  const rotated = rotateDocumentSyncSegment(target.buffer, expectedPoint, lease)
  if (rotated.status !== 'rotated') {
    throw workspaceEditError('snapshot-drift', 'Live document URI transition became stale')
  }
  options.documentSyncController?.transitionDocumentUri({
    fromUri: fileNameToDocumentUri(fromPath),
    syncPoint: rotated.syncPoint,
    textSnapshot: target.buffer.getTextSnapshot(),
    toUri: fileNameToDocumentUri(toPath),
  })
}

function tryTransitionDocumentUri(
  options: WorkspaceEditServiceOptions,
  locks: HeldWorkspaceLocks,
  target: PreparedTarget,
  fromPath: FilesystemPath,
  toPath: FilesystemPath,
): boolean {
  try {
    transitionDocumentUri(options, locks, target, fromPath, toPath)
    return true
  } catch {
    return false
  }
}

function reverseLocalCommit(
  options: WorkspaceEditServiceOptions,
  local: LocalCommit,
  locks: HeldWorkspaceLocks,
): boolean {
  let restored = true
  if (local.projection && !options.fileSync.rollbackWorkspaceMutationProjection(local.projection)) {
    restored = false
  }
  options.documentStore.getState().runWorkspaceDocumentBatch(() => {
    const cursors = beginLocalReverseCursors(local, locks)
    for (const leg of [...local.legs].reverse()) {
      const reversed = reverseLocalLeg(options, locks, local, cursors, leg)
      if (!reversed) restored = false
    }
    if (!completeLocalReverseCursors(local, locks, cursors)) restored = false
  })
  return restored
}

function beginLocalReverseCursors(
  local: LocalCommit,
  locks: HeldWorkspaceLocks,
): Map<PreparedTarget, DocumentTransactionSequenceReverseCursor> {
  const cursors = new Map<PreparedTarget, DocumentTransactionSequenceReverseCursor>()
  for (const [target, receipt] of local.receipts) {
    if (receipt.segmentCount <= 1) continue
    const started = beginReverseDocumentTransactionSequence(
      documentCommitTarget(target, locks),
      receipt,
    )
    if (started.status === 'started') cursors.set(target, started.cursor)
  }
  return cursors
}

function reverseLocalLeg(
  options: WorkspaceEditServiceOptions,
  locks: HeldWorkspaceLocks,
  local: LocalCommit,
  cursors: Map<PreparedTarget, DocumentTransactionSequenceReverseCursor>,
  leg: LocalLeg,
): boolean {
  if (leg.kind === 'projection') return rollbackLocalProjection(options, locks, leg)
  const receipt = local.receipts.get(leg.target)
  if (!receipt) return true
  const target = documentCommitTarget(leg.target, locks)
  if (receipt.segmentCount === 1) {
    const reversed = reverseDocumentTransaction(target, receipt)
    if (reversed.status !== 'reversed') return false
    local.receipts.set(leg.target, reversed.receipt)
    return true
  }
  const cursor = cursors.get(leg.target)
  if (!cursor) return false
  const reversed = reverseNextDocumentTransactionSequenceSegment(
    target,
    cursor,
    leg.sequenceSegmentIndex,
  )
  if (reversed.status !== 'reversed') return false
  cursors.set(leg.target, reversed.cursor)
  return true
}

function rollbackLocalProjection(
  options: WorkspaceEditServiceOptions,
  locks: HeldWorkspaceLocks,
  leg: Extract<LocalLeg, { readonly kind: 'projection' }>,
): boolean {
  const rolledBack = options.documentStore
    .getState()
    .rollbackWorkspaceDocumentProjection(leg.projection)
  if (!rolledBack) return false
  const target = leg.resolved.target
  if (target && leg.resolved.operation.kind === 'rename' && leg.resolved.fromPath) {
    const to = requiredPath(leg.resolved.toPath)
    if (!tryTransitionDocumentUri(options, locks, target, to, leg.resolved.fromPath)) return false
    target.currentPath = leg.resolved.fromPath
  }
  return true
}

function completeLocalReverseCursors(
  local: LocalCommit,
  locks: HeldWorkspaceLocks,
  cursors: ReadonlyMap<PreparedTarget, DocumentTransactionSequenceReverseCursor>,
): boolean {
  let completedAll = true
  for (const [target, cursor] of cursors) {
    const completed = completeReverseDocumentTransactionSequence(
      documentCommitTarget(target, locks),
      cursor,
    )
    if (completed.status !== 'completed') {
      completedAll = false
      continue
    }
    local.receipts.set(target, completed.receipt)
  }
  return completedAll
}

function sealLocalReceipts(local: LocalCommit, locks: HeldWorkspaceLocks): void {
  for (const [target, receipt] of local.receipts) {
    if (receipt.history.kind !== 'external-barrier') continue
    const sealed = sealDocumentTransactionReceipt(documentCommitTarget(target, locks), receipt)
    local.receipts.set(target, sealed.receipt)
  }
}

function releaseLocalReceipts(local: LocalCommit): void {
  for (const [target, receipt] of local.receipts) {
    releaseDocumentTransactionReceipt({ buffer: target.buffer, sourceView: null }, receipt)
  }
  local.receipts.clear()
}

async function workspaceEditPrepareRequest(
  prepared: PreparedWorkspaceEdit,
): Promise<WorkspaceEditPrepareRequest> {
  const body = {
    operationId: prepared.operationId,
    operations: prepared.persistence,
    origin: 'workspace-edit' as const,
    workspace: workspaceEditRequestPath(prepared.root),
  }
  return { ...body, bodyDigest: await workspaceEditBodyDigest(body) }
}

async function workspaceEditBodyDigest(body: {
  readonly operationId: string
  readonly operations: readonly WorkspacePersistenceOperation[]
  readonly origin: 'workspace-edit'
  readonly workspace: string
}): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw createClientInvariantError('Secure workspace edit digest support is unavailable')
  }
  const bytes = new TextEncoder().encode(JSON.stringify(body))
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
  return `sha256:${Array.from(digest, hexByte).join('')}`
}

function hexByte(value: number): string {
  return value.toString(16).padStart(2, '0')
}

async function commitServer(
  fileSync: FileSyncService,
  server: WorkspaceEditResult | null,
): Promise<WorkspaceEditResult | null> {
  if (!server) return null
  return fileSync.commitWorkspaceMutation(server)
}

function workspaceProjectionRequest(prepared: PreparedWorkspaceEdit, server: WorkspaceEditResult) {
  return {
    afterContents: prepared.projectionAfterContents,
    beforeContents: prepared.projectionBeforeContents,
    entries: workspaceProjectionEntries(prepared.root.path, server),
    renames: prepared.operations.flatMap((resolved) => {
      if (resolved.kind !== 'resource') return []
      if (resolved.ignored || resolved.operation.kind !== 'rename') return []
      return [{ from: requiredPath(resolved.fromPath), to: requiredPath(resolved.toPath) }]
    }),
    rootPath: prepared.root.path,
  }
}

function workspaceProjectionEntries(
  rootPath: FilesystemPath,
  result: WorkspaceEditResult,
): readonly WorkspaceEditResultEntry[] {
  return result.entries.map((entry) => {
    const path = workspaceDocumentPath(rootPath, entry.path)
    if (!path) {
      throw workspaceEditError('outside-workspace', 'Workspace result path is outside the root')
    }
    return { ...entry, path }
  })
}

async function finalizeServer(
  fileSync: FileSyncService,
  server: WorkspaceEditResult | null,
): Promise<WorkspaceEditResult | null> {
  if (!server) return null
  return fileSync.finalizeWorkspaceMutation(server)
}

function assertWorkspaceServerState(
  server: WorkspaceEditResult | null,
  expected: readonly WorkspaceEditResult['state'][],
): void {
  if (!server || expected.includes(server.state)) return
  if (server.state === 'partial') {
    throw workspaceEditError('workspace-edit-partial', 'Filesystem transaction needs recovery')
  }
  throw workspaceEditError(
    'workspace-edit-state',
    `Filesystem transaction settled as ${server.state}`,
  )
}

async function statusResult(
  fileSync: FileSyncService,
  operationId: string,
): Promise<WorkspaceEditResult | null> {
  const status = await fileSync.statusWorkspaceMutation(operationId)
  return status.found ? status.result : null
}

async function settleFailedServerMutation(
  fileSync: FileSyncService,
  server: WorkspaceEditResult | null,
): Promise<WorkspaceEditResult | null> {
  if (!server) return null
  if (isTerminalFailureState(server.state)) return server
  try {
    if (server.state === 'prepared' || server.state === 'preparing') {
      return fileSync.abortWorkspaceMutation(server.operationId, server.generation)
    }
    if (isProvisionalWorkspaceState(server.state)) {
      return fileSync.rollbackWorkspaceMutation(server)
    }
    return server
  } catch {
    return statusResult(fileSync, server.operationId)
  }
}

function isTerminalFailureState(state: WorkspaceEditResult['state']): boolean {
  return state === 'aborted' || state === 'partial' || state === 'rolled-back'
}

function recoveryResult(
  server: WorkspaceEditResult | null,
  fallbackPaths: readonly string[],
  error: unknown,
): WorkspaceEditRecovery {
  const affectedPaths = server?.affectedPaths.length ? server.affectedPaths : fallbackPaths
  const unrecoveredPaths = server?.unrecoveredPaths.length ? server.unrecoveredPaths : affectedPaths
  return {
    affectedPaths: affectedPaths.map(filesystemPath),
    generation: server?.generation ?? 0,
    operationId: server?.operationId ?? workspaceErrorOperationId(error),
    unrecoveredPaths: unrecoveredPaths.map(filesystemPath),
  }
}

function workspaceErrorOperationId(error: unknown): string {
  if (!error || typeof error !== 'object' || !('operationId' in error)) return 'unknown'
  return typeof error.operationId === 'string' ? error.operationId : 'unknown'
}

function resultForPreparationError(error: unknown, signal: AbortSignal): ApplyWorkspaceEditResult {
  if (signal.aborted || isAbortFailure(error)) return { status: 'cancelled' }
  return failureResult(error)
}

function failureResult(error: unknown): ApplyWorkspaceEditResult {
  return failedResult(errorCode(error), errorMessage(error))
}

function failedResult(code: string, message: string): ApplyWorkspaceEditResult {
  return { code, message, status: 'failed' }
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'workspace-edit-failed'
  return typeof error.code === 'string' ? error.code : 'workspace-edit-failed'
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return toClientError(error).message
}

function isAbortFailure(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === 'AbortError'
  if (!(error instanceof Error)) return false
  return error.name === 'AbortError'
}

function acquireGroupLocks(
  documentStore: EditorDocumentStoreApi,
  group: WorkspaceEditGroup,
): HeldWorkspaceLocks {
  const state = documentStore.getState()
  const requests = group.affectedPaths.map((path) =>
    state.prepareWorkspaceDocumentPathReservation(path),
  )
  const ownerId = `${group.operationId}:history`
  const reserved = state.reserveWorkspaceDocumentPaths(requests, ownerId)
  if (reserved.status !== 'acquired') {
    throw workspaceEditError('workspace-edit-stale', 'Workspace history paths changed')
  }

  try {
    const stamps = groupLiveTargetStamps(state, group)
    if (stamps.length === 0) return { leases: null, reservation: reserved.reservation }
    const acquired = state.acquireWorkspaceDocumentMutationLeases(stamps, ownerId)
    if (acquired.status !== 'acquired') {
      throw workspaceEditError('workspace-edit-stale', 'Workspace history buffers changed')
    }
    return { leases: acquired.leaseSet, reservation: reserved.reservation }
  } catch (error) {
    state.releaseWorkspaceDocumentPaths(reserved.reservation)
    throw error
  }
}

function groupLiveTargetStamps(
  state: ReturnType<EditorDocumentStoreApi['getState']>,
  group: WorkspaceEditGroup,
): WorkspaceDocumentTargetStamp[] {
  const stamps: WorkspaceDocumentTargetStamp[] = []
  const targets = new Set(group.receipts.keys())
  for (const leg of group.legs) {
    if (leg.kind !== 'projection' || !leg.resolved.target) continue
    targets.add(leg.resolved.target)
  }
  for (const target of targets) {
    if (!target.liveStamp) continue
    const stamp = state.prepareWorkspaceDocumentTarget(fileDocumentKey(target.currentPath))
    if (!stamp || stamp.buffer !== target.buffer) {
      throw workspaceEditError('workspace-edit-stale', 'Workspace history document moved')
    }
    const receipt = group.receipts.get(target)
    if (!receipt) {
      stamps.push(stamp)
      continue
    }
    if (
      receipt.snapshotAfter !== target.buffer.getSnapshot() ||
      receipt.revisionAfter !== target.buffer.getRevision()
    ) {
      throw workspaceEditError('workspace-edit-stale', 'Workspace history text changed')
    }
    stamps.push(stamp)
  }
  return stamps
}

function reverseGroupLocal(
  options: WorkspaceEditServiceOptions,
  group: WorkspaceEditGroup,
  locks: HeldWorkspaceLocks,
  direction: 'redo' | 'undo',
): Map<PreparedTarget, DocumentTransactionReceipt> | null {
  const receipts = new Map(group.receipts)
  let succeeded = true
  options.documentStore.getState().runWorkspaceDocumentBatch(() => {
    const cursors = beginGroupReverseCursors(group, locks)
    const legs = direction === 'undo' ? [...group.legs].reverse() : group.legs
    for (const leg of legs) {
      if (!reverseGroupLeg(options, group, locks, receipts, cursors, leg, direction)) {
        succeeded = false
        break
      }
    }
    if (succeeded && !completeGroupReverseCursors(locks, receipts, cursors)) succeeded = false
  })
  return succeeded ? receipts : null
}

function beginGroupReverseCursors(
  group: WorkspaceEditGroup,
  locks: HeldWorkspaceLocks,
): Map<PreparedTarget, DocumentTransactionSequenceReverseCursor> {
  const cursors = new Map<PreparedTarget, DocumentTransactionSequenceReverseCursor>()
  for (const [target, receipt] of group.receipts) {
    if (receipt.segmentCount <= 1) continue
    const started = beginReverseDocumentTransactionSequence(
      documentCommitTarget(target, locks),
      receipt,
    )
    if (started.status !== 'started') {
      throw workspaceEditError('workspace-edit-stale', 'Workspace history receipt is stale')
    }
    cursors.set(target, started.cursor)
  }
  return cursors
}

function reverseGroupLeg(
  options: WorkspaceEditServiceOptions,
  group: WorkspaceEditGroup,
  locks: HeldWorkspaceLocks,
  receipts: Map<PreparedTarget, DocumentTransactionReceipt>,
  cursors: Map<PreparedTarget, DocumentTransactionSequenceReverseCursor>,
  leg: LocalLeg,
  direction: 'redo' | 'undo',
): boolean {
  if (leg.kind === 'projection') {
    return reverseGroupProjection(options, locks, leg, direction)
  }
  const receipt = group.receipts.get(leg.target)
  if (!receipt) return true
  const target = documentCommitTarget(leg.target, locks)
  if (receipt.segmentCount === 1) {
    const reversed = reverseDocumentTransaction(target, receipt)
    if (reversed.status !== 'reversed') return false
    receipts.set(leg.target, reversed.receipt)
    return true
  }
  const cursor = cursors.get(leg.target)
  if (!cursor) return false
  const segmentIndex = groupReceiptSegmentIndex(receipt, leg.sequenceSegmentIndex, direction)
  const reversed = reverseNextDocumentTransactionSequenceSegment(target, cursor, segmentIndex)
  if (reversed.status !== 'reversed') return false
  cursors.set(leg.target, reversed.cursor)
  return true
}

function groupReceiptSegmentIndex(
  receipt: DocumentTransactionReceipt,
  originalIndex: number,
  direction: 'redo' | 'undo',
): number {
  if (direction === 'undo') return originalIndex
  return receipt.segmentCount - 1 - originalIndex
}

function reverseGroupProjection(
  options: WorkspaceEditServiceOptions,
  locks: HeldWorkspaceLocks,
  leg: Extract<LocalLeg, { readonly kind: 'projection' }>,
  direction: 'redo' | 'undo',
): boolean {
  if (leg.resolved.operation.kind === 'rename') {
    return reverseGroupRenameProjection(options, locks, leg, direction)
  }
  if (leg.resolved.operation.kind !== 'delete') return true
  if (direction === 'undo') {
    const projection = { ...leg.projection, reservation: locks.reservation }
    return options.documentStore.getState().rollbackWorkspaceDocumentProjection(projection)
  }
  const projection = options.documentStore
    .getState()
    .prepareWorkspaceDocumentDelete(leg.resolved.path, locks.reservation)
  if (!projection) return false
  if (!options.documentStore.getState().commitWorkspaceDocumentProjection(projection)) return false
  leg.projection = projection
  return true
}

function reverseGroupRenameProjection(
  options: WorkspaceEditServiceOptions,
  locks: HeldWorkspaceLocks,
  leg: Extract<LocalLeg, { readonly kind: 'projection' }>,
  direction: 'redo' | 'undo',
): boolean {
  const originalFrom = requiredPath(leg.resolved.fromPath)
  const originalTo = requiredPath(leg.resolved.toPath)
  const from = direction === 'undo' ? originalTo : originalFrom
  const to = direction === 'undo' ? originalFrom : originalTo
  const projection = options.documentStore
    .getState()
    .prepareWorkspaceDocumentRename(from, to, locks.reservation)
  if (!projection) return false
  if (!options.documentStore.getState().commitWorkspaceDocumentProjection(projection)) return false
  if (leg.resolved.target) {
    if (!tryTransitionDocumentUri(options, locks, leg.resolved.target, from, to)) return false
    leg.resolved.target.currentPath = to
  }
  leg.projection = projection
  return true
}

function completeGroupReverseCursors(
  locks: HeldWorkspaceLocks,
  receipts: Map<PreparedTarget, DocumentTransactionReceipt>,
  cursors: ReadonlyMap<PreparedTarget, DocumentTransactionSequenceReverseCursor>,
): boolean {
  for (const [target, cursor] of cursors) {
    const completed = completeReverseDocumentTransactionSequence(
      documentCommitTarget(target, locks),
      cursor,
    )
    if (completed.status !== 'completed') return false
    receipts.set(target, completed.receipt)
  }
  return true
}

function isProvisionalWorkspaceState(state: WorkspaceEditResult['state']): boolean {
  return state === 'committed' || state === 'redo-committed' || state === 'undo-committed'
}

function isStableRecoverySettlement(state: WorkspaceEditResult['state']): boolean {
  return (
    state === 'finalized' ||
    state === 'redone' ||
    state === 'released' ||
    state === 'rolled-back' ||
    state === 'undone'
  )
}

function workspaceMutationMayHaveChangedDisk(result: WorkspaceEditResult): boolean {
  return result.state !== 'preparing' && result.state !== 'prepared' && result.state !== 'aborted'
}

function workspaceOperationCounts(prepared: PreparedWorkspaceEdit): WorkspaceEditOperationCounts {
  let dirtyTargetCount = 0
  let openTargetCount = 0
  let unopenedTargetCount = 0
  for (const target of prepared.targets) {
    if (target.kind === 'dirty') dirtyTargetCount += 1
    if (target.kind === 'open') openTargetCount += 1
    if (target.kind === 'unopened') unopenedTargetCount += 1
  }
  return {
    affectedPathCount: new Set(prepared.affectedPaths).size,
    dirtyTargetCount,
    openTargetCount,
    operationCount: prepared.operations.length,
    unopenedTargetCount,
  }
}

function workspaceOperationSettlement(
  result: ApplyWorkspaceEditResult,
): WorkspaceEditOperationSettlement {
  if (result.status === 'failed') return { outcome: result.code }
  if (result.status === 'recovery-required') {
    return {
      outcome: result.status,
      recoveryPaths: result.affectedPaths,
      rollbackOutcome: 'partial',
    }
  }
  if (result.status === 'rolled-back') {
    return { outcome: result.status, rollbackOutcome: 'rolled-back' }
  }
  return { outcome: result.status }
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const expected = new Set(right)
  return left.every((value) => expected.has(value))
}

function stringSetIntersects(left: readonly string[], right: ReadonlySet<string>): boolean {
  return left.some((value) => right.has(value))
}

function changedFileDocumentPaths(
  previous: EditorDocumentStore,
  current: EditorDocumentStore,
): FilesystemPath[] {
  const paths = new Set<FilesystemPath>()
  const documents = [
    ...Object.values(previous.liveDocumentsByKey),
    ...Object.values(current.liveDocumentsByKey),
  ]
  for (const document of documents) {
    if (document.target.kind !== 'file') continue
    if (
      previous.documentContentRevisions[document.key] ===
      current.documentContentRevisions[document.key]
    )
      continue
    paths.add(document.target.resource.path)
  }
  return Array.from(paths)
}

function isStaleWorkspaceEditCode(code: string): boolean {
  return (
    code === 'snapshot-drift' ||
    code === 'version-mismatch' ||
    code === 'workspace-buffer-stale' ||
    code === 'workspace-path-stale' ||
    code === 'workspace-root-changed' ||
    code === 'workspace-edit-stale'
  )
}

function isBusyWorkspaceEditPhase(phase: WorkspaceEditServicePhase): boolean {
  return (
    phase === 'preparing' ||
    phase === 'awaiting-confirmation' ||
    phase === 'committing' ||
    phase === 'finalizing' ||
    phase === 'undoing' ||
    phase === 'redoing' ||
    phase === 'rolling-back' ||
    phase === 'recovery-required' ||
    phase === 'recovering' ||
    phase === 'releasing-recovery'
  )
}
