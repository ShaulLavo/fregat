import { isPdfFile } from '@/lib/pdf-viewer/format'
import { isRecord } from '@workspace/utils/objects'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type { DocumentKey, FilesystemPath, TabId } from '@/lib/documents/utils/types'
import type { QueryClient } from '@tanstack/react-query'
import { type EditorTextBuffer, type PieceTableSnapshot } from '@singapore-editor/core/document'
import { type EditorInitialPaintEvent } from '@singapore-editor/core/extensions'
import {
  type EditorPreparedDocument,
  type EditorDocumentAnalysis,
  type EditorPreparedTagValue,
  type EditorScrollPosition,
} from '@singapore-editor/core/editor'

import type { FileSnapshot } from '@/lib/file-snapshot'
import {
  ensureFileSnapshotQuery,
  FILE_SNAPSHOT_STALE_MS,
  fileSnapshotPathFromQueryKey,
  fileSnapshotQueryOptions,
  fileSnapshotReads,
} from '@/lib/file-snapshot-query-cache'
import {
  hasPrefetchRoom,
  prefetchSurfaceEnabled,
  SPECULATIVE_PREFETCH_LIMIT,
} from '@/lib/intent-prefetch/state/scheduler'
import { createWideEventScope } from '@/lib/wide-event-scope'
import type { WideEventScope } from '@workspace/observability/scope'
import { createClientInvariantError } from '@/lib/structured-errors'
import { toClientError } from '@/lib/client-error-taxonomy'

const MAX_PREPARED_OPENS = 8
const MAX_PREPARED_BYTES = 32 * 1024 * 1024
const PREPARED_OPEN_TTL_MS = 30_000
const MAX_PREPARED_FILE_BYTES = 1024 * 1024
const PROMOTION_PAINT_TIMEOUT_MS = 10_000

export type FileOpenIntentLiveDocument = {
  readonly analysis: EditorDocumentAnalysis
  readonly buffer: EditorTextBuffer
  readonly key: DocumentKey
  readonly localRevision: number
}

export type FileOpenIntentPreparationSourceInput =
  | { readonly kind: 'live-document'; readonly documentKey: DocumentKey }
  | { readonly kind: 'captured-file-snapshot'; readonly file: FileSnapshot }

export type FileOpenIntentPreparationSource = {
  readonly document: FileOpenIntentLiveDocument
  release(): void
}

export type FileOpenIntentInterest = { release(): void }

/** One holder's share of a preparation; the preparation is disposed when its last holder releases. */
export type FileOpenIntentPreparedLease = {
  readonly buffer: EditorTextBuffer
  readonly document: EditorPreparedDocument
  readonly documentKey: DocumentKey
  readonly fileVersion: string | null
  readonly localRevision: number
  readonly path: FilesystemPath
  readonly snapshot: PieceTableSnapshot
  release(): void
}

type FileOpenIntentJoin = {
  readonly documentKey: DocumentKey
  /** The preparation this request joined, or null when the document has none to join. */
  readonly prepared: FileOpenIntentPreparedLease | null
}

const inertInterest: FileOpenIntentInterest = { release: () => undefined }

type FileOpenIntentPreparationFamily = 'highlighter' | 'structural'

export type FileOpenIntentStructuralRange = {
  readonly endIndex: number
  readonly startIndex: number
}

export type FileOpenIntentSource =
  | 'file-tree'
  | 'tab'
  | 'definition'
  | 'quick-open'
  | 'search'
  | 'problems'
  | 'references'
  | 'chat-link'

/** What raised the guess: a pointer path or hover, keyboard focus, a list's active row, a tab switch. */
export type FileOpenIntentTrigger = 'trajectory' | 'hover' | 'focus' | 'active-row' | 'adjacent-tab'

export type FileOpenIntent = {
  readonly knownSize?: number
  readonly path: FilesystemPath
  /** The root the guess was made in; omitted, the editor's current root. */
  readonly rootPath?: FilesystemPath
  readonly source: FileOpenIntentSource
  readonly tabId?: TabId
  readonly trigger?: FileOpenIntentTrigger
}

type FileOpenIntentEnvironmentIdentity = {
  readonly configurationTag: readonly EditorPreparedTagValue[]
  readonly highlighterProvider: object | null
  readonly structuralProvider: object | null
}

export type FileOpenIntentPreparationStage = {
  readonly configurationTag: readonly EditorPreparedTagValue[]
  readonly family: FileOpenIntentPreparationFamily
  readonly provider: object
  readonly range?: 'full' | { readonly endIndex: number; readonly startIndex: number }
  start(): Promise<unknown> | null
}

export type FileOpenIntentPreparationConfiguration = {
  readonly documentConfigurationTag: readonly EditorPreparedTagValue[]
  readonly stages: readonly FileOpenIntentPreparationStage[]
}

type FileOpenIntentPreparation = FileOpenIntentPreparationConfiguration & {
  readonly buffer: EditorTextBuffer
  readonly preparedDocument: EditorPreparedDocument
}

export type FileOpenIntentPreparer = {
  readonly environment: FileOpenIntentEnvironmentIdentity
  prepare(
    buffer: EditorTextBuffer,
    documentKey: DocumentKey,
    path: FilesystemPath,
    abortSignal: AbortSignal,
    structuralRange: FileOpenIntentStructuralRange,
    analysis: EditorDocumentAnalysis,
  ): FileOpenIntentPreparation
  reconfigure(
    preparedDocument: EditorPreparedDocument,
    buffer: EditorTextBuffer,
    documentKey: DocumentKey,
    path: FilesystemPath,
    abortSignal: AbortSignal,
    structuralRange: FileOpenIntentStructuralRange,
  ): FileOpenIntentPreparationConfiguration
}

export type FileOpenIntentEventFactory = (base: {
  readonly action: string
  readonly area: string
  readonly [key: string]: unknown
}) => WideEventScope

export type FileOpenIntentRuntime = {
  now(): number
  schedule<T>(task: () => T | Promise<T>): Promise<T>
  scheduleTimer(task: () => void, delayMs: number): () => void
}

type FileOpenIntentBenchmarkResult = {
  readonly evictions: number
  readonly nonTargetIntents: number
  readonly joinedHighlighterRuntimeSessionIds: readonly string[]
  readonly joinedStructuralRuntimeSessionIds: readonly string[]
  readonly preparedJoins: number
  readonly promotedBytes: number
  readonly highlighterRuntimeSessionIds: readonly string[]
  readonly structuralRuntimeSessionIds: readonly string[]
  readonly targetIntents: number
  readonly wastedIntents: number
}

export type FileOpenIntentService = {
  getPreparationIdentity(): object
  /**
   * Joins a live document and any preparation already working on it, raising that work's
   * priority. Null when the path has no live document yet.
   */
  join(path: FilesystemPath): FileOpenIntentJoin | null
  subscribePreparationIdentity(listener: () => void): () => void
  prepare(intent: FileOpenIntent): FileOpenIntentInterest
  recordInitialPaint(path: FilesystemPath, paint: EditorInitialPaintEvent): void
}

export type FileOpenIntentActivation = Pick<FileOpenIntentService, 'join'>

export type FileOpenIntentBenchmarkSample = {
  readonly id: string
  readonly target: {
    readonly path: FilesystemPath
    readonly rootPath: FilesystemPath
  }
  quarantine(): void
  quiesce(): Promise<FileOpenIntentBenchmarkResult>
  release(): void
}

export type FileOpenIntentServiceOwner = {
  readonly activation: FileOpenIntentActivation
  readonly service: FileOpenIntentService
  beginBenchmarkSample(input: {
    readonly path: FilesystemPath
    readonly rootPath: FilesystemPath
  }): FileOpenIntentBenchmarkSample
  connect(): void
  disposeNow(): void
  scheduleDisconnect(): void
  setEnvironment(preparer: FileOpenIntentPreparer): void
  setRelatedPrefetch(
    prefetchRelated: (rootPath: FilesystemPath, path: FilesystemPath) => Promise<unknown> | void,
  ): void
  setRoot(rootPath: FilesystemPath | null): void
}

export type FileOpenIntentServiceOwnerDependencies = {
  readonly acquireFilePreparation: (
    input: FileOpenIntentPreparationSourceInput,
  ) => FileOpenIntentPreparationSource | null
  readonly createEvent?: FileOpenIntentEventFactory
  /** The `prefetch.files` switch; read per intent. */
  readonly isEnabled?: () => boolean
  readonly getLiveDocument: (path: FilesystemPath) => FileOpenIntentLiveDocument | null
  readonly getRetainedScrollPosition: (path: FilesystemPath) => EditorScrollPosition | null
  readonly isActive: (path: FilesystemPath) => boolean
  readonly mountedEditors: {
    has(path: FilesystemPath): boolean
    subscribe(listener: (path: FilesystemPath, mounted: boolean) => void): () => void
  }
  readonly preparer: FileOpenIntentPreparer
  readonly prefetchRelated: (
    rootPath: FilesystemPath,
    path: FilesystemPath,
  ) => Promise<unknown> | void
  readonly queryClient: QueryClient
  readonly runtime?: FileOpenIntentRuntime
  readonly subscribeLiveDocuments: (listener: () => void) => () => void
}

type FileOpenIntentBenchmarkScope = {
  evictions: number
  nonTargetIntents: number
  readonly joinedHighlighterRuntimeSessionIds: Set<string>
  readonly joinedStructuralRuntimeSessionIds: Set<string>
  readonly path: FilesystemPath
  preparedJoins: number
  promotedBytes: number
  readonly highlighterRuntimeSessionIds: Set<string>
  readonly sampleId: string
  targetIntents: number
  readonly structuralRuntimeSessionIds: Set<string>
  wastedIntents: number
  quarantined: boolean
}

type PreparedStageRecord = {
  readonly stage: FileOpenIntentPreparationStage
  progress: 'queued' | 'started' | 'settled'
}

type PreparedSource = {
  readonly buffer: EditorTextBuffer
  readonly documentKey: DocumentKey
  readonly localRevision: number
  readonly path: FilesystemPath
  readonly snapshot: PieceTableSnapshot
  release(): void
} & ({ readonly fileVersion: string; readonly kind: 'clean' } | { readonly kind: 'live' })

type PreparedOpenRecord = {
  readonly abortController: AbortController
  readonly documentKey: DocumentKey
  documentConfigurationTag: readonly EditorPreparedTagValue[]
  readonly estimatedBytes: number
  readonly holders: PreparedDocumentHolders
  lastActivityAt: number
  readonly preparedDocument: EditorPreparedDocument
  readonly releaseHold: () => void
  readonly source: PreparedSource
  stages: Map<FileOpenIntentPreparationFamily, PreparedStageRecord>
  structuralRange: FileOpenIntentStructuralRange
}

/** Counts the record and the views sharing one prepared document; the last release disposes it. */
class PreparedDocumentHolders {
  private count = 0

  constructor(readonly document: EditorPreparedDocument) {}

  /** True while a view holds the document beside the record that prepares it. */
  get joined(): boolean {
    return this.count > 1
  }

  acquire(onRelease?: () => void): () => void {
    this.count += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.count -= 1
      if (this.count === 0) this.document.dispose()
      onRelease?.()
    }
  }
}

type FileOpenIntentPromotion =
  | { readonly phase: 'preparing' }
  | {
      readonly at: number
      readonly cancelPaintTimeout: () => void
      readonly documentKey: DocumentKey
      readonly phase: 'awaiting-text'
    }
  | {
      readonly at: number
      readonly cancelPaintTimeout: () => void
      readonly documentGeneration: number
      readonly documentKey: DocumentKey
      readonly phase: 'awaiting-highlight'
      readonly textVersion: number
    }

type FileOpenIntentOperation = {
  /** Whether every stage had settled when a press joined the record. */
  joinOutcome: 'hit' | 'partial'
  readonly detectedAt: number
  readonly event: WideEventScope
  hasTab: boolean
  knownSize: number | null
  readonly path: FilesystemPath
  pendingEnd: Record<string, unknown> | null
  postActivationBaseline: PostActivationWorkSnapshot | null
  promotion: FileOpenIntentPromotion
  relatedSettled: boolean
  readonly rootPath: FilesystemPath
}

type FileSnapshotIdentity = Pick<FileSnapshot, 'path' | 'version'>

type PostActivationWorkCounters = {
  readonly bufferBuilds: number
  readonly fileReads: number
  readonly highlighterSessionCreations: number
  readonly lineIndexScans: number
  readonly structuralSessionCreations: number
  readonly workerOpenRequests: number
  readonly workerParseRequests: number
  readonly workerQueryRequests: number
  readonly workerRefreshRequests: number
}

type PostActivationWorkSnapshot = PostActivationWorkCounters & {
  readonly diagnosticsObserved: boolean
}

export function createFileOpenIntentServiceOwner(
  dependencies: FileOpenIntentServiceOwnerDependencies,
): FileOpenIntentServiceOwner {
  return new FileOpenIntentOwner(dependencies)
}

class FileOpenIntentOwner implements FileOpenIntentServiceOwner {
  readonly activation: FileOpenIntentActivation
  readonly service: FileOpenIntentService
  private readonly state: FileOpenIntentServiceState
  private connected = false
  private connectionGeneration = 0
  private disposed = false
  private preparationIdentity: object = {}
  private readonly identityListeners = new Set<() => void>()
  private nextBenchmarkSampleId = 0
  private unsubscribeLiveDocuments: (() => void) | null = null
  private unsubscribeMountedEditors: (() => void) | null = null
  private unsubscribeQueries: (() => void) | null = null

  constructor(private readonly dependencies: FileOpenIntentServiceOwnerDependencies) {
    this.state = new FileOpenIntentServiceState(
      dependencies.queryClient,
      dependencies.preparer,
      dependencies.getLiveDocument,
      dependencies.getRetainedScrollPosition,
      dependencies.isActive,
      (path) => dependencies.mountedEditors.has(path),
      dependencies.prefetchRelated,
      dependencies.acquireFilePreparation,
      dependencies.runtime,
      dependencies.createEvent,
      dependencies.isEnabled,
    )
    this.service = {
      getPreparationIdentity: () => this.preparationIdentity,
      subscribePreparationIdentity: (listener) => {
        this.identityListeners.add(listener)
        return () => this.identityListeners.delete(listener)
      },
      join: (path) => this.state.join(path, this.canConsume()),
      prepare: (intent) => {
        if (!this.canConsume()) return inertInterest
        return this.state.prepare(intent)
      },
      recordInitialPaint: (path, paint) => {
        if (!this.canConsume()) return
        this.state.recordInitialPaint(path, paint)
      },
    }
    this.activation = { join: this.service.join }
  }

  connect(): void {
    this.assertUsable('connect')
    this.connectionGeneration += 1
    if (this.connected) return

    this.connected = true
    this.state.connect()
    this.unsubscribeLiveDocuments = this.dependencies.subscribeLiveDocuments(() =>
      this.state.reconcileLiveAuthority(),
    )
    this.unsubscribeMountedEditors = this.dependencies.mountedEditors.subscribe((path, mounted) => {
      if (mounted) this.state.invalidatePath(path)
    })
    this.unsubscribeQueries = this.dependencies.queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' && event.type !== 'removed') return

      const path = fileSnapshotPathFromQueryKey(event.query.queryKey)
      if (!path) return
      if (event.type === 'removed') {
        this.state.reconcileFileSnapshot(path, null, true)
        return
      }

      this.state.reconcileFileSnapshot(path, fileResultIdentity(event.query.state.data), false)
    })
    this.rotatePreparationIdentity()
  }

  scheduleDisconnect(): void {
    this.assertUsable('scheduleDisconnect')
    if (!this.connected) return

    const generation = ++this.connectionGeneration
    queueMicrotask(() => {
      if (generation !== this.connectionGeneration || !this.connected) return
      this.disconnect('owner-disconnected')
    })
  }

  disposeNow(): void {
    if (this.disposed) return

    this.disposed = true
    this.connectionGeneration += 1
    this.disconnect('owner-disposed')
  }

  setRoot(rootPath: FilesystemPath | null): void {
    this.assertUsable('setRoot')
    if (this.state.setRoot(rootPath)) this.rotatePreparationIdentity()
  }

  setEnvironment(preparer: FileOpenIntentPreparer): void {
    this.assertUsable('setEnvironment')
    if (this.state.setEnvironment(preparer)) this.rotatePreparationIdentity()
  }

  setRelatedPrefetch(
    prefetchRelated: (rootPath: FilesystemPath, path: FilesystemPath) => Promise<unknown> | void,
  ): void {
    this.assertUsable('setRelatedPrefetch')
    this.state.setRelatedPrefetch(prefetchRelated)
  }

  beginBenchmarkSample(input: {
    readonly path: FilesystemPath
    readonly rootPath: FilesystemPath
  }): FileOpenIntentBenchmarkSample {
    this.assertUsable('beginBenchmarkSample')
    const sampleId = `file-open-intent:${++this.nextBenchmarkSampleId}`
    this.state.beginBenchmarkSample(sampleId, input)
    return createBenchmarkSample(this.state, sampleId, input)
  }

  private rotatePreparationIdentity(): void {
    this.preparationIdentity = {}
    for (const listener of this.identityListeners) listener()
  }

  private canConsume(): boolean {
    return this.connected && !this.disposed
  }

  private disconnect(reason: string): void {
    this.connected = false
    this.unsubscribeLiveDocuments?.()
    this.unsubscribeLiveDocuments = null
    this.unsubscribeMountedEditors?.()
    this.unsubscribeMountedEditors = null
    this.unsubscribeQueries?.()
    this.unsubscribeQueries = null
    this.state.disconnectNow(reason)
    this.rotatePreparationIdentity()
  }

  private assertUsable(operation: string): void {
    if (!this.disposed) return
    throw createClientInvariantError(`Cannot ${operation} a disposed file-open intent owner`)
  }
}

function createBenchmarkSample(
  state: FileOpenIntentServiceState,
  sampleId: string,
  target: { readonly path: FilesystemPath; readonly rootPath: FilesystemPath },
): FileOpenIntentBenchmarkSample {
  let phase: 'active' | 'failed' | 'quarantined' | 'quiescing' | 'quiesced' | 'released' = 'active'
  let quiescence: Promise<FileOpenIntentBenchmarkResult> | null = null
  return {
    id: sampleId,
    target,
    quarantine: () => {
      if (phase !== 'active') {
        throw createClientInvariantError('Editor-open benchmark sample already quarantined')
      }

      state.quarantineBenchmarkSample(sampleId)
      phase = 'quarantined'
    },
    quiesce: () => {
      if (phase === 'released') {
        throw createClientInvariantError('Editor-open benchmark sample already released')
      }
      if (quiescence) return quiescence
      if (phase !== 'quarantined') {
        throw createClientInvariantError('Editor-open benchmark sample must quarantine first')
      }

      phase = 'quiescing'
      quiescence = state.finishBenchmarkSample(sampleId).then(
        (result) => {
          phase = 'quiesced'
          return result
        },
        (error: unknown) => {
          phase = 'failed'
          throw error
        },
      )
      return quiescence
    },
    release: () => {
      if (phase !== 'quiesced') {
        throw createClientInvariantError('Editor-open benchmark sample is not quiescent')
      }

      state.releaseBenchmarkSample(sampleId)
      phase = 'released'
    },
  }
}

class FileOpenIntentServiceState {
  private readonly callerInterests = new Map<FilesystemPath, Map<object, number>>()
  private readonly records = new Map<FilesystemPath, PreparedOpenRecord>()
  private readonly queuedPaths: FilesystemPath[] = []
  private readonly queuedPathSet = new Set<FilesystemPath>()
  private activeAbortController: AbortController | null = null
  private activeOperation: Promise<void> | null = null
  private activePath: FilesystemPath | null = null
  private running = false
  private rootPath: FilesystemPath | null = null
  private environment: FileOpenIntentEnvironmentIdentity
  private environmentGeneration = 0
  private lifecycleGeneration = 0
  private connected = false
  private cancelExpiryTimer: (() => void) | null = null
  private benchmarkScope: FileOpenIntentBenchmarkScope | null = null
  private readonly relatedOperations = new Set<Promise<void>>()
  private readonly intentOperations = new Map<FilesystemPath, FileOpenIntentOperation>()
  private readonly promotedIntentOperations = new Map<FilesystemPath, FileOpenIntentOperation>()
  private readonly warmingPaths = new Set<FilesystemPath>()

  constructor(
    private readonly queryClient: QueryClient,
    private preparer: FileOpenIntentPreparer,
    private readonly getLiveDocument: (path: FilesystemPath) => FileOpenIntentLiveDocument | null,
    private readonly getRetainedScrollPosition: (
      path: FilesystemPath,
    ) => EditorScrollPosition | null,
    private readonly isActive: (path: FilesystemPath) => boolean,
    private readonly isMounted: (path: FilesystemPath) => boolean,
    private prefetchRelated: (
      rootPath: FilesystemPath,
      path: FilesystemPath,
    ) => Promise<unknown> | void,
    private readonly acquireFilePreparation: (
      input: FileOpenIntentPreparationSourceInput,
    ) => FileOpenIntentPreparationSource | null,
    private readonly runtime: FileOpenIntentRuntime = defaultFileOpenIntentRuntime,
    private readonly createEvent: FileOpenIntentEventFactory = createWideEventScope,
    private readonly isEnabled: () => boolean = () => prefetchSurfaceEnabled('files'),
  ) {
    this.environment = preparer.environment
  }

  setRoot(rootPath: FilesystemPath | null): boolean {
    const canonicalRoot = rootPath ? canonicalPath(rootPath) : null
    if (canonicalRoot === this.rootPath) return false

    this.rootPath = canonicalRoot
    this.clear('root-changed')
    return true
  }

  connect(): void {
    this.connected = true
  }

  disconnectNow(reason: string): void {
    this.connected = false
    this.clear(reason)
  }

  setEnvironment(preparer: FileOpenIntentPreparer): boolean {
    if (sameEnvironment(preparer.environment, this.environment)) return false

    this.preparer = preparer
    this.environment = preparer.environment
    this.environmentGeneration += 1
    for (const [path, record] of this.records) {
      if (this.records.get(path) !== record) continue
      this.reconcileRecord(path, record, preparer, record.structuralRange)
    }
    this.runNext()
    return true
  }

  setRelatedPrefetch(
    prefetchRelated: (rootPath: FilesystemPath, path: FilesystemPath) => Promise<unknown> | void,
  ): void {
    this.prefetchRelated = prefetchRelated
  }

  beginBenchmarkSample(
    sampleId: string,
    input: { readonly path: FilesystemPath; readonly rootPath: FilesystemPath },
  ): void {
    if (!this.connected) {
      throw createClientInvariantError('Editor-open benchmark sample requires a connected owner')
    }
    if (canonicalPath(input.rootPath) !== this.rootPath) {
      throw createClientInvariantError('Editor-open benchmark target root is not current')
    }
    if (!this.pathBelongsToRoot(canonicalPath(input.path))) {
      throw createClientInvariantError('Editor-open benchmark target is outside the current root')
    }
    if (this.benchmarkScope) {
      throw createClientInvariantError('An editor-open benchmark sample is already active')
    }
    if (
      this.running ||
      this.activeOperation ||
      this.queuedPaths.length > 0 ||
      this.records.size > 0 ||
      this.relatedOperations.size > 0 ||
      this.intentOperations.size > 0 ||
      this.promotedIntentOperations.size > 0
    ) {
      throw createClientInvariantError(
        'Editor-open benchmark sample started before intent work settled',
      )
    }

    this.benchmarkScope = {
      evictions: 0,
      joinedHighlighterRuntimeSessionIds: new Set(),
      joinedStructuralRuntimeSessionIds: new Set(),
      nonTargetIntents: 0,
      path: canonicalPath(input.path),
      preparedJoins: 0,
      promotedBytes: 0,
      highlighterRuntimeSessionIds: new Set(),
      quarantined: false,
      sampleId,
      targetIntents: 0,
      structuralRuntimeSessionIds: new Set(),
      wastedIntents: 0,
    }
  }

  quarantineBenchmarkSample(sampleId: string): void {
    const scope = this.requireBenchmarkScope(sampleId)
    if (scope.quarantined) return

    scope.quarantined = true
    const unjoined = Array.from(this.records.values()).filter((record) => !record.holders.joined)
    scope.wastedIntents = unjoined.length + this.queuedPaths.length + (this.running ? 1 : 0)
    this.clear()
  }

  async finishBenchmarkSample(sampleId: string): Promise<FileOpenIntentBenchmarkResult> {
    const scope = this.requireBenchmarkScope(sampleId)
    if (!scope.quarantined) {
      throw createClientInvariantError('Editor-open benchmark sample must quarantine before finish')
    }

    await this.awaitIdle()
    if (
      this.queuedPaths.length > 0 ||
      this.running ||
      this.activeOperation ||
      this.records.size > 0 ||
      this.relatedOperations.size > 0 ||
      this.intentOperations.size > 0 ||
      this.promotedIntentOperations.size > 0
    ) {
      throw createClientInvariantError('Editor-open benchmark intent work did not quiesce')
    }

    return {
      evictions: scope.evictions,
      joinedHighlighterRuntimeSessionIds: [...scope.joinedHighlighterRuntimeSessionIds],
      joinedStructuralRuntimeSessionIds: [...scope.joinedStructuralRuntimeSessionIds],
      nonTargetIntents: scope.nonTargetIntents,
      preparedJoins: scope.preparedJoins,
      promotedBytes: scope.promotedBytes,
      highlighterRuntimeSessionIds: [...scope.highlighterRuntimeSessionIds],
      structuralRuntimeSessionIds: [...scope.structuralRuntimeSessionIds],
      targetIntents: scope.targetIntents,
      wastedIntents: scope.wastedIntents,
    }
  }

  releaseBenchmarkSample(sampleId: string): void {
    const scope = this.requireBenchmarkScope(sampleId)
    if (
      !scope.quarantined ||
      this.running ||
      this.activeOperation ||
      this.queuedPaths.length > 0 ||
      this.records.size > 0 ||
      this.relatedOperations.size > 0 ||
      this.intentOperations.size > 0 ||
      this.promotedIntentOperations.size > 0
    ) {
      throw createClientInvariantError('Editor-open benchmark sample released before quiescence')
    }

    this.benchmarkScope = null
  }

  prepare(intent: FileOpenIntent): FileOpenIntentInterest {
    const canonicalRoot = intent.rootPath ? canonicalPath(intent.rootPath) : this.rootPath
    if (!canonicalRoot) return inertInterest
    const canonical = canonicalPath(intent.path)
    if (this.benchmarkScope?.quarantined) return inertInterest
    if (!this.isEnabled()) return inertInterest
    if (canonicalRoot !== this.rootPath) return inertInterest
    if (!this.pathBelongsToRoot(canonical)) return inertInterest
    if (isPdfFile(canonical)) return inertInterest
    if (intent.knownSize !== undefined && intent.knownSize > MAX_PREPARED_FILE_BYTES) {
      this.finishImmediateIntent(intent, canonicalRoot, canonical, 'rejected', {
        reason: 'size-gated',
      })
      return inertInterest
    }

    const existingOperation = this.intentOperations.get(canonical)
    if (existingOperation) {
      this.noteDuplicateIntent(existingOperation, intent)
      this.noteBenchmarkIntent(canonical)
    }
    // A cursor or tab switch raises these on its own; a line per move says nothing.
    const quiet = existingOperation !== undefined || isAutomaticTrigger(intent.trigger)
    if (this.isActive(canonical)) {
      if (!quiet) this.finishImmediateIntent(intent, canonicalRoot, canonical, 'already-active')
      return inertInterest
    }
    if (this.isMounted(canonical)) {
      if (!quiet) this.finishImmediateIntent(intent, canonicalRoot, canonical, 'already-mounted')
      return inertInterest
    }

    this.pruneExpired()
    const interest = this.acquireCallerInterest(canonical)
    if (this.recordIsCurrent(canonical)) return interest
    if (this.activePath === canonical && !this.activeAbortController?.signal.aborted)
      return interest
    if (this.queuedPathSet.has(canonical)) {
      this.raiseQueuedPriority(canonical)
      return interest
    }

    this.queuedPathSet.add(canonical)
    this.queuedPaths.push(canonical)
    this.intentOperations.set(
      canonical,
      this.createIntentOperation(intent, canonicalRoot, canonical),
    )
    this.noteBenchmarkIntent(canonical)
    this.dropOverflowingQueue()
    this.warmSnapshot(canonical)
    this.runNext()
    return interest
  }

  private acquireCallerInterest(path: FilesystemPath): FileOpenIntentInterest {
    const token = {}
    const interests = this.callerInterests.get(path) ?? new Map<object, number>()
    interests.set(token, this.runtime.now() + PREPARED_OPEN_TTL_MS)
    this.callerInterests.set(path, interests)
    this.scheduleExpiry()
    return { release: () => this.releaseCallerInterest(path, token) }
  }

  private releaseCallerInterest(path: FilesystemPath, token: object): void {
    const interests = this.callerInterests.get(path)
    if (!interests?.delete(token)) return
    if (interests.size > 0) return
    this.callerInterests.delete(path)
    if (!this.promotedIntentOperations.has(path) && !this.records.get(path)?.holders.joined)
      this.invalidatePath(path)
    this.scheduleExpiry()
  }

  // A held arrow key raises a guess per row; only the newest keep their place in the queue.
  private dropOverflowingQueue(): void {
    while (this.queuedPaths.length > SPECULATIVE_PREFETCH_LIMIT) {
      const index = this.queuedPaths.findIndex((path) => !this.records.get(path)?.holders.joined)
      if (index < 0) return
      const [dropped] = this.queuedPaths.splice(index, 1)
      if (!dropped) return
      this.queuedPathSet.delete(dropped)
      this.callerInterests.delete(dropped)
      this.finishIntent(dropped, 'skipped-budget')
    }
  }

  /**
   * Starts a queued path's read now, while stages stay one path at a time: up to four reads
   * share the snapshot key family with clicks, and a guess past that waits for its turn.
   */
  private warmSnapshot(path: FilesystemPath): void {
    if (!this.running || this.getLiveDocument(path)) return
    const { queryKey } = fileSnapshotQueryOptions(path)
    if (freshFileQueryState(this.queryClient.getQueryState(queryKey), this.runtime.now())) return
    if (!hasPrefetchRoom('files', this.queryClient, fileSnapshotReads)) return

    this.warmingPaths.add(path)
    void ensureFileSnapshotQuery(this.queryClient, path)
      .catch(() => undefined)
      .finally(() => this.warmingPaths.delete(path))
  }

  join(path: FilesystemPath, joinPreparation: boolean): FileOpenIntentJoin | null {
    const canonical = canonicalPath(path)
    const liveDocument = this.getLiveDocument(canonical)
    if (!liveDocument) return null

    const record = joinPreparation ? this.joinableRecord(canonical) : null
    if (!record) return { documentKey: liveDocument.key, prepared: null }

    const lease = this.preparedLease(canonical, record)
    this.promoteRecord(canonical, record)
    return { documentKey: record.documentKey, prepared: lease }
  }

  private joinableRecord(path: FilesystemPath): PreparedOpenRecord | null {
    if (this.benchmarkScope?.quarantined) return null
    if (!this.pathBelongsToRoot(path)) return null

    this.pruneExpired()
    const record = this.records.get(path)
    if (!record) return null
    if (this.sourceIsCurrent(record.source)) return record

    this.disposeRecord(path, record)
    this.finishIntent(path, 'stale', { reason: 'join-validation' })
    this.scheduleExpiry()
    return null
  }

  private preparedLease(
    path: FilesystemPath,
    record: PreparedOpenRecord,
  ): FileOpenIntentPreparedLease {
    const { source } = record
    return {
      buffer: source.buffer,
      document: record.preparedDocument,
      documentKey: source.documentKey,
      fileVersion: source.kind === 'clean' ? source.fileVersion : null,
      localRevision: source.localRevision,
      path: source.path,
      snapshot: source.snapshot,
      release: record.holders.acquire(() => this.touchRecord(path, record)),
    }
  }

  /** A joining request outranks speculation: its queued stages run next. */
  private promoteRecord(path: FilesystemPath, record: PreparedOpenRecord): void {
    this.touchRecord(path, record)
    if (queuedStages(record).length > 0 && this.activePath !== path) {
      this.enqueuePath(path)
      this.runNext()
    }
    if (!this.intentOperations.has(path)) return

    this.noteBenchmarkJoin(path, record.estimatedBytes, record.preparedDocument)
    const stages = preparationStageProgress(record)
    const settled = Object.values(stages).every(
      (progress) => progress !== 'queued' && progress !== 'started',
    )
    this.promoteIntent(path, record.documentKey, settled ? 'hit' : 'partial', {
      promotion: { kind: record.source.kind, stages },
    })
  }

  recordInitialPaint(path: FilesystemPath, paint: EditorInitialPaintEvent): void {
    const canonical = canonicalPath(path)
    const operation = this.promotedIntentOperations.get(canonical)
    if (!operation) return

    const promotion = operation.promotion
    if (promotion.phase === 'preparing') return
    if (paint.phase === 'text') {
      if (promotion.phase !== 'awaiting-text') return
      if (paint.documentId !== promotion.documentKey) return

      operation.event.set({
        postActivation: {
          ...postActivationWorkSince(operation.postActivationBaseline, canonical),
          textPaintMs: this.runtime.now() - promotion.at,
        },
      })
      operation.promotion = {
        at: promotion.at,
        cancelPaintTimeout: promotion.cancelPaintTimeout,
        documentGeneration: paint.documentGeneration,
        documentKey: promotion.documentKey,
        phase: 'awaiting-highlight',
        textVersion: paint.textVersion,
      }
      return
    }
    if (promotion.phase !== 'awaiting-highlight') return
    if (paint.documentId !== promotion.documentKey) return
    if (paint.documentGeneration !== promotion.documentGeneration) return
    if (paint.textVersion !== promotion.textVersion) return

    operation.event.set({
      postActivation: {
        ...postActivationWorkSince(operation.postActivationBaseline, canonical),
        highlightPaintMs: this.runtime.now() - promotion.at,
      },
    })
    this.finishPromotion(canonical, paint.status)
  }

  invalidatePath(path: FilesystemPath): void {
    const canonical = canonicalPath(path)
    const queued = this.removeQueuedPath(canonical)
    if (this.activePath === canonical) this.abortActivePreparation()
    const record = this.records.get(canonical)
    if (!record) {
      if (queued || this.activePath === canonical)
        this.finishIntent(canonical, 'invalidated', { reason: 'document-changed' })
      return
    }

    this.disposeRecord(canonical, record)
    this.finishIntent(canonical, 'invalidated', { reason: 'document-changed' })
    this.scheduleExpiry()
  }

  reconcileLiveAuthority(): void {
    for (const [path, record] of this.records) {
      if (this.liveAuthorityMatches(record.source)) continue

      this.disposeRecord(path, record)
      this.finishIntent(path, 'invalidated', { reason: 'document-changed' })
    }
    this.scheduleExpiry()
  }

  reconcileFileSnapshot(
    path: FilesystemPath,
    file: FileSnapshotIdentity | null,
    removed: boolean,
  ): void {
    const canonical = canonicalPath(path)
    const record = this.records.get(canonical)
    if (!record || record.source.kind !== 'clean') return
    if (!removed && file && cleanFileIdentityMatches(record.source, file)) return

    this.disposeRecord(canonical, record)
    this.finishIntent(canonical, 'invalidated', {
      reason: removed || !file ? 'query-removed' : 'query-version-changed',
    })
    this.scheduleExpiry()
  }

  clear(reason = 'service-cleared'): void {
    this.lifecycleGeneration += 1
    this.callerInterests.clear()
    this.abortActivePreparation()
    this.activeAbortController = null
    this.queuedPaths.length = 0
    this.queuedPathSet.clear()
    this.cancelExpiryTimer?.()
    this.cancelExpiryTimer = null
    for (const [path, record] of this.records) this.disposeRecord(path, record)
    this.warmingPaths.clear()
    for (const path of this.intentOperations.keys()) {
      this.finishIntent(path, 'aborted', { reason })
    }
    for (const path of this.promotedIntentOperations.keys()) {
      this.finishPromotion(path, 'abandoned', { reason })
    }
  }

  // Work a view joined belongs to that view now; only its own release ends it.
  private abortActivePreparation(): void {
    const record = this.activePath ? this.records.get(this.activePath) : undefined
    if (record?.holders.joined) return
    this.activeAbortController?.abort()
  }

  private runNext(): void {
    if (this.running) return

    const path = this.queuedPaths.pop()
    if (!path) return

    this.queuedPathSet.delete(path)
    this.running = true
    this.activePath = path
    const lifecycleGeneration = this.lifecycleGeneration
    const existingRecord = this.records.get(path)
    const abortController = existingRecord?.abortController ?? new AbortController()
    this.activeAbortController = abortController
    const intentOperation = this.intentOperations.get(path)
    const operation = this.runtime
      .schedule(() =>
        existingRecord
          ? this.runExistingPreparation(path, existingRecord, lifecycleGeneration)
          : this.preparePath(path, lifecycleGeneration, abortController, intentOperation),
      )
      .finally(() => {
        if (this.activeAbortController === abortController) this.activeAbortController = null
        if (this.activePath === path) this.activePath = null
        this.running = false
        if (this.activeOperation === operation) this.activeOperation = null
        this.runNext()
      })
    this.activeOperation = operation
  }

  private async runExistingPreparation(
    path: FilesystemPath,
    record: PreparedOpenRecord,
    lifecycleGeneration: number,
  ): Promise<void> {
    try {
      await this.runPreparationStages(path, record, lifecycleGeneration)
      this.markPrepared(path, 'ready')
    } catch (error) {
      this.intentOperations.get(path)?.event.error(error)
      if (this.records.get(path) === record) this.disposeRecord(path, record)
      this.finishIntent(path, 'failed', { reason: 'preparation-error' })
    }
  }

  private async preparePath(
    path: FilesystemPath,
    lifecycleGeneration: number,
    abortController: AbortController,
    operation: FileOpenIntentOperation | undefined,
  ): Promise<void> {
    const abortSignal = abortController.signal
    if (!operation || this.intentOperations.get(path) !== operation) return

    const event = operation.event
    try {
      if (abortSignal.aborted || !this.generationIsCurrent(lifecycleGeneration)) {
        this.finishIntent(path, 'aborted', { reason: 'generation-changed' })
        return
      }
      if (this.isActive(path) || this.isMounted(path)) {
        this.finishIntent(path, 'already-active')
        return
      }

      this.startRelatedPrefetch(path, operation)
      const liveDocument = this.getLiveDocument(path)
      if (liveDocument) {
        event.set({ sourceState: 'live' })
        const record = this.storeLivePreparation(
          liveDocument,
          path,
          lifecycleGeneration,
          abortController,
        )
        if (record) await this.runPreparationStages(path, record, lifecycleGeneration)
        if (record) {
          this.markPrepared(path, 'ready-live')
          return
        }

        this.finishIntent(path, abortSignal.aborted ? 'aborted' : 'superseded')
        return
      }

      const queryStartedAt = this.runtime.now()
      const queryState = this.queryClient.getQueryState<FileSnapshot>(
        fileSnapshotQueryOptions(path).queryKey,
      )
      event.set({
        query: {
          cacheHit: freshFileQueryState(queryState, queryStartedAt),
          joined: queryState?.fetchStatus === 'fetching',
        },
      })
      const file = await awaitPreparationInterest(
        ensureFileSnapshotQuery(this.queryClient, path),
        abortSignal,
      )
      if (!file) return
      if (this.intentOperations.get(path) !== operation) return
      event.set({
        fileSize: file.size,
        query: {
          durationMs: this.runtime.now() - queryStartedAt,
          status: 'success',
        },
        sourceState: 'clean',
      })
      const rejection = this.cleanPreparationRejection(path, file, lifecycleGeneration, abortSignal)
      if (rejection) {
        this.finishIntent(path, 'rejected', { reason: rejection })
        return
      }
      const supersedingLiveDocument = this.getLiveDocument(path)
      if (supersedingLiveDocument) {
        event.set({ sourceState: 'live' })
        const record = this.storeLivePreparation(
          supersedingLiveDocument,
          path,
          lifecycleGeneration,
          abortController,
        )
        if (record) {
          await this.runPreparationStages(path, record, lifecycleGeneration)
        }
        if (record) {
          this.markPrepared(path, 'ready-live')
          return
        }

        this.finishIntent(path, 'superseded', { reason: 'live-document-changed' })
        return
      }

      const bufferStartedAt = this.runtime.now()
      const source = this.acquireFilePreparation({ kind: 'captured-file-snapshot', file })
      event.set({ stages: { buffer: { durationMs: this.runtime.now() - bufferStartedAt } } })
      if (!source) {
        this.finishIntent(path, 'superseded', { reason: 'source-unavailable' })
        return
      }
      const record = this.storeSourcePreparation(
        source,
        path,
        lifecycleGeneration,
        abortController,
        file,
      )
      if (!record) {
        this.finishIntent(path, 'superseded', { reason: 'source-changed' })
        return
      }
      await this.runPreparationStages(path, record, lifecycleGeneration)
      this.markPrepared(path, 'ready-clean')
    } catch (error) {
      if (this.intentOperations.get(path) !== operation) return
      const record = this.records.get(path)
      if (record) this.disposeRecord(path, record)
      const snapshotError = this.queryClient.getQueryState(
        fileSnapshotQueryOptions(path).queryKey,
      )?.error
      const category = toClientError(error).category
      if (snapshotError === error && (category === 'not_found' || category === 'too_large')) {
        this.finishIntent(path, 'rejected', {
          reason: category === 'not_found' ? 'file-missing' : 'file-too-large',
        })
        return
      }
      event.error(error)
      this.finishIntent(path, abortSignal.aborted ? 'aborted' : 'failed', {
        reason: abortSignal.aborted ? 'aborted' : 'preparation-error',
      })
    }
  }

  private storeLivePreparation(
    document: FileOpenIntentLiveDocument,
    path: FilesystemPath,
    lifecycleGeneration: number,
    abortController: AbortController,
  ): PreparedOpenRecord | null {
    const source = this.acquireFilePreparation({ kind: 'live-document', documentKey: document.key })
    if (!source) return null
    return this.storeSourcePreparation(source, path, lifecycleGeneration, abortController)
  }

  private storeSourcePreparation(
    source: FileOpenIntentPreparationSource,
    path: FilesystemPath,
    lifecycleGeneration: number,
    abortController: AbortController,
    file?: FileSnapshot,
  ): PreparedOpenRecord | null {
    try {
      const record = this.createSourcePreparation(
        source,
        path,
        lifecycleGeneration,
        abortController,
        file,
      )
      if (!record) source.release()
      return record
    } catch (error) {
      source.release()
      throw error
    }
  }

  private createSourcePreparation(
    source: FileOpenIntentPreparationSource,
    path: FilesystemPath,
    lifecycleGeneration: number,
    abortController: AbortController,
    file?: FileSnapshot,
  ): PreparedOpenRecord | null {
    const { document } = source
    const abortSignal = abortController.signal
    if (abortSignal.aborted || !this.generationIsCurrent(lifecycleGeneration)) return null
    if (this.isActive(path) || this.isMounted(path)) return null
    if (!file && document.buffer.getSnapshot().length * 2 > MAX_PREPARED_FILE_BYTES) return null
    const snapshot = document.buffer.getSnapshot()
    const structuralRange = this.structuralRange(path, document.buffer)
    const startedAt = this.runtime.now()
    const prepared = this.preparer.prepare(
      document.buffer,
      document.key,
      path,
      abortSignal,
      structuralRange,
      document.analysis,
    )
    this.intentOperations.get(path)?.event.set({
      stages: { line: { durationMs: this.runtime.now() - startedAt, scope: 'document-data' } },
    })
    this.noteBenchmarkRuntimeSessionIds(prepared.preparedDocument)
    const base = {
      buffer: document.buffer,
      documentKey: document.key,
      localRevision: document.localRevision,
      path,
      release: source.release,
      snapshot,
    }
    const preparedSource: PreparedSource =
      file && !document.buffer.isDirty()
        ? { ...base, fileVersion: file.version, kind: 'clean' }
        : { ...base, kind: 'live' }
    if (
      abortSignal.aborted ||
      !this.generationIsCurrent(lifecycleGeneration) ||
      !this.sourceIsCurrent(preparedSource)
    ) {
      prepared.preparedDocument.dispose()
      return null
    }
    return this.store(path, preparedSource, prepared, structuralRange, abortController)
  }

  // Highlighter and structural stages run on different workers, so they run side by side.
  private async runPreparationStages(
    path: FilesystemPath,
    record: PreparedOpenRecord,
    lifecycleGeneration: number,
  ): Promise<void> {
    while (this.recordCanRun(path, record, lifecycleGeneration)) {
      const queued = queuedStages(record)
      if (queued.length === 0) return

      await Promise.all(
        queued.map((stageRecord) =>
          this.runPreparationStage(path, record, stageRecord, lifecycleGeneration),
        ),
      )
    }
  }

  private async runPreparationStage(
    path: FilesystemPath,
    record: PreparedOpenRecord,
    stageRecord: PreparedStageRecord,
    lifecycleGeneration: number,
  ): Promise<void> {
    stageRecord.progress = 'started'
    this.touchRecord(path, record)
    const startedAt = this.runtime.now()
    this.intentOperations.get(path)?.event.set({
      preparation: {
        providerConfiguration: {
          [stageRecord.stage.family]: {
            configurationTag: stageRecord.stage.configurationTag,
            generation: this.environmentGeneration,
          },
        },
        ranges: { [stageRecord.stage.family]: stageRecord.stage.range ?? null },
      },
    })
    await this.runtime.schedule(async () => {
      if (!this.recordCanRun(path, record, lifecycleGeneration)) return

      const outcome = stageRecord.stage.start()
      this.noteBenchmarkRuntimeSessionIds(record.preparedDocument)
      await awaitPreparationInterest(Promise.resolve(outcome), record.abortController.signal)
    })
    if (!this.recordCanRun(path, record, lifecycleGeneration)) return
    if (record.stages.get(stageRecord.stage.family) !== stageRecord) return

    stageRecord.progress = 'settled'
    const durationMs = this.runtime.now() - startedAt
    const event = this.intentOperations.get(path)?.event
    event?.increment('workerMs', durationMs)
    event?.set({
      preparation: { estimatedBytes: record.estimatedBytes },
      stages: { [stageRecord.stage.family]: { durationMs, status: 'ready' } },
    })
    this.touchRecord(path, record)
    this.pruneBounds()
  }

  private markPrepared(path: FilesystemPath, status: string): void {
    const operation = this.intentOperations.get(path)
    operation?.event.set({
      preparation: { status },
      prepareMs: this.runtime.now() - operation.detectedAt,
    })
  }

  private recordCanRun(
    path: FilesystemPath,
    record: PreparedOpenRecord,
    lifecycleGeneration: number,
  ): boolean {
    if (record.abortController.signal.aborted) return false
    if (!this.generationIsCurrent(lifecycleGeneration)) return false
    return this.records.get(path) === record
  }

  private store(
    path: FilesystemPath,
    source: PreparedSource,
    preparation: FileOpenIntentPreparation,
    structuralRange: FileOpenIntentStructuralRange,
    abortController: AbortController,
  ): PreparedOpenRecord {
    const previous = this.records.get(path)
    if (previous) this.disposeRecord(path, previous)
    const preparedDocument = preparation.preparedDocument
    const holders = new PreparedDocumentHolders(preparedDocument)
    const record: PreparedOpenRecord = {
      abortController,
      documentConfigurationTag: preparation.documentConfigurationTag,
      documentKey: source.documentKey,
      get estimatedBytes() {
        return preparedDocument.estimatedBytes
      },
      holders,
      lastActivityAt: this.runtime.now(),
      preparedDocument,
      releaseHold: holders.acquire(),
      source,
      stages: stageRecords(preparation.stages),
      structuralRange,
    }
    this.records.set(path, record)
    const structural = record.stages.get('structural')
    this.intentOperations.get(path)?.event.set({
      preparation: {
        documentConfigurationTag: preparation.documentConfigurationTag,
        estimatedBytes: record.estimatedBytes,
        ...(structural
          ? { ranges: { structural: structural.stage.range ?? structuralRange } }
          : {}),
      },
    })
    this.noteBenchmarkRuntimeSessionIds(record.preparedDocument)
    this.pruneBounds()
    this.scheduleExpiry()
    return record
  }

  private recordIsCurrent(path: FilesystemPath): boolean {
    const record = this.records.get(path)
    if (!record) return false
    if (this.sourceIsCurrent(record.source)) {
      this.touchRecord(path, record)
      return true
    }

    this.disposeRecord(path, record)
    this.finishIntent(path, 'stale', { reason: 'source-state-changed' })
    this.scheduleExpiry()
    return false
  }

  private reconcileRecord(
    path: FilesystemPath,
    record: PreparedOpenRecord,
    preparer: FileOpenIntentPreparer,
    structuralRange: FileOpenIntentStructuralRange,
  ): void {
    const configuration = preparer.reconfigure(
      record.preparedDocument,
      record.source.buffer,
      record.documentKey,
      path,
      record.abortController.signal,
      structuralRange,
    )
    if (!sameTag(record.documentConfigurationTag, configuration.documentConfigurationTag)) {
      this.rebuildRecord(path, record)
      return
    }

    const nextStages = stageRecords(configuration.stages)
    for (const family of preparationFamilies) {
      const current = record.stages.get(family)
      const next = nextStages.get(family)
      if (sameStage(current?.stage, next?.stage)) continue
      if (!current || current.progress === 'queued') continue

      this.rebuildRecord(path, record)
      return
    }

    for (const family of preparationFamilies) {
      const current = record.stages.get(family)
      const next = nextStages.get(family)
      if (sameStage(current?.stage, next?.stage) && current) {
        nextStages.set(family, current)
      }
    }
    record.documentConfigurationTag = configuration.documentConfigurationTag
    record.stages = nextStages
    record.structuralRange = structuralRange
    const structural = nextStages.get('structural')
    if (structural) {
      this.intentOperations.get(path)?.event.set({
        preparation: { ranges: { structural: structural.stage.range ?? structuralRange } },
      })
    }
    if (queuedStages(record).length === 0) return
    if (this.activePath === path) return

    this.enqueuePath(path)
  }

  private structuralRange(
    path: FilesystemPath,
    buffer: EditorTextBuffer,
  ): FileOpenIntentStructuralRange {
    return defaultStructuralRange(buffer.getSnapshot().length, this.getRetainedScrollPosition(path))
  }

  private liveAuthorityMatches(source: PreparedSource): boolean {
    const liveDocument = this.getLiveDocument(source.path)
    if (!liveDocument) return false
    if (liveDocument.buffer !== source.buffer) return false
    if (liveDocument.key !== source.documentKey) return false
    if (liveDocument.localRevision !== source.localRevision) return false
    return liveDocument.buffer.getSnapshot() === source.snapshot
  }

  private rebuildRecord(path: FilesystemPath, record: PreparedOpenRecord): void {
    this.intentOperations.get(path)?.event.increment('preparation.rebuildCount')
    this.disposeRecord(path, record)
    if (!this.pathBelongsToRoot(path)) return
    if (this.isActive(path) || this.isMounted(path)) return

    this.enqueuePath(path)
  }

  private enqueuePath(path: FilesystemPath): void {
    if (this.queuedPathSet.has(path)) {
      this.raiseQueuedPriority(path)
      return
    }

    this.queuedPathSet.add(path)
    this.queuedPaths.push(path)
  }

  private touchRecord(path: FilesystemPath, record: PreparedOpenRecord): void {
    if (this.records.get(path) !== record) return

    record.lastActivityAt = this.runtime.now()
    this.records.delete(path)
    this.records.set(path, record)
    this.scheduleExpiry()
  }

  private disposeRecord(path: FilesystemPath, record: PreparedOpenRecord): void {
    if (this.records.get(path) === record) this.records.delete(path)
    this.noteBenchmarkRuntimeSessionIds(record.preparedDocument)
    if (!record.holders.joined) record.abortController.abort()
    record.releaseHold()
    record.source.release()
  }

  private sourceIsCurrent(source: PreparedSource): boolean {
    if (!this.pathBelongsToRoot(source.path)) return false
    if (source.buffer.getSnapshot() !== source.snapshot) return false
    if (!this.liveAuthorityMatches(source)) return false
    if (source.kind === 'live') return true
    if (source.buffer.isDirty()) return false
    return this.cleanFileMatchesCachedQuery({ path: source.path, version: source.fileVersion })
  }

  private pathBelongsToRoot(path: FilesystemPath): boolean {
    const rootPath = this.rootPath
    if (!rootPath) return false
    if (rootPath === '/') return path.startsWith('/')
    if (path === rootPath) return true

    return path.startsWith(`${rootPath}/`)
  }

  private pruneExpired(): void {
    const now = this.runtime.now()
    for (const [path, interests] of this.callerInterests)
      this.expireCallerInterests(path, interests, now)
    const oldestAllowed = this.runtime.now() - PREPARED_OPEN_TTL_MS
    for (const [path, record] of this.records) {
      if (record.lastActivityAt > oldestAllowed) continue
      if (record.holders.joined) continue

      this.disposeRecord(path, record)
      this.finishIntent(path, 'evicted', { reason: 'idle-ttl' })
      this.noteBenchmarkEviction()
    }
    this.scheduleExpiry()
  }

  private expireCallerInterests(
    path: FilesystemPath,
    interests: ReadonlyMap<object, number>,
    now: number,
  ): void {
    for (const [token, deadline] of interests) {
      if (deadline <= now) this.releaseCallerInterest(path, token)
    }
  }

  private scheduleExpiry(): void {
    this.cancelExpiryTimer?.()
    this.cancelExpiryTimer = null
    let expiresAt: number | null = null
    for (const record of this.records.values()) {
      if (record.holders.joined) continue
      const candidate = record.lastActivityAt + PREPARED_OPEN_TTL_MS
      if (expiresAt === null || candidate < expiresAt) expiresAt = candidate
    }
    for (const interests of this.callerInterests.values()) {
      for (const deadline of interests.values()) {
        if (expiresAt === null || deadline < expiresAt) expiresAt = deadline
      }
    }
    if (expiresAt === null) return

    const delayMs = Math.max(0, expiresAt - this.runtime.now())
    this.cancelExpiryTimer = this.runtime.scheduleTimer(() => {
      this.cancelExpiryTimer = null
      this.pruneExpired()
    }, delayMs)
  }

  // Joined records count toward the budget but are never its victims: a view is waiting on them.
  private pruneBounds(): void {
    let totalBytes = 0
    for (const record of this.records.values()) totalBytes += record.estimatedBytes
    while (this.records.size > MAX_PREPARED_OPENS || totalBytes > MAX_PREPARED_BYTES) {
      const oldest = Array.from(this.records).find(([, record]) => !record.holders.joined)
      if (!oldest) return

      const evictedBytes = oldest[1].estimatedBytes
      this.disposeRecord(oldest[0], oldest[1])
      this.finishIntent(oldest[0], 'evicted', { reason: 'memory-budget' })
      this.noteBenchmarkEviction()
      totalBytes -= evictedBytes
    }
  }

  private cleanPreparationRejection(
    path: FilesystemPath,
    file: FileSnapshot,
    lifecycleGeneration: number,
    abortSignal: AbortSignal,
  ): string | null {
    if (abortSignal.aborted || !this.generationIsCurrent(lifecycleGeneration)) return 'aborted'
    if (file.path !== path) return 'path-mismatch'
    if (file.seemsBinary) return 'binary-file'
    if (file.size > MAX_PREPARED_FILE_BYTES) return 'size-gated'
    if (!this.pathBelongsToRoot(path)) return 'root-mismatch'
    if (this.isActive(path) || this.isMounted(path)) return 'already-active'
    return null
  }

  /**
   * Age is not checked: an old record still paints, and the opened tab's own snapshot query
   * refetches once stale and replaces a clean document whose version moved.
   */
  private cleanFileMatchesCachedQuery(file: FileSnapshotIdentity): boolean {
    const queryKey = fileSnapshotQueryOptions(file.path).queryKey
    const state = this.queryClient.getQueryState<FileSnapshot>(queryKey)
    if (state?.status !== 'success' || !state.data) return false

    return state.data.path === file.path && state.data.version === file.version
  }

  private generationIsCurrent(generation: number): boolean {
    return generation === this.lifecycleGeneration
  }

  private raiseQueuedPriority(path: FilesystemPath): void {
    this.removeQueuedPath(path)
    this.queuedPathSet.add(path)
    this.queuedPaths.push(path)
  }

  private removeQueuedPath(path: FilesystemPath): boolean {
    if (!this.queuedPathSet.delete(path)) return false

    const index = this.queuedPaths.indexOf(path)
    if (index >= 0) this.queuedPaths.splice(index, 1)
    return true
  }

  private async awaitIdle(): Promise<void> {
    while (
      this.running ||
      this.activeOperation ||
      this.queuedPaths.length > 0 ||
      this.relatedOperations.size > 0
    ) {
      const operation = this.activeOperation
      if (operation) {
        await operation
        continue
      }
      const related = [...this.relatedOperations]
      if (related.length > 0) {
        await Promise.allSettled(related)
        continue
      }
      await Promise.resolve()
    }
  }

  private createIntentOperation(
    intent: FileOpenIntent,
    rootPath: FilesystemPath,
    path: FilesystemPath,
  ): FileOpenIntentOperation {
    const detectedAt = this.runtime.now()
    const hasTab = intent.tabId !== undefined
    return {
      joinOutcome: 'hit',
      detectedAt,
      event: this.createEvent({
        action: 'prefetch.intent',
        area: 'editor',
        surface: 'files',
        dedupeCount: 0,
        preparationEnvironment: {
          configurationTag: this.environment.configurationTag,
          generation: this.environmentGeneration,
          providers: {
            highlighter: this.environment.highlighterProvider !== null,
            structural: this.environment.structuralProvider !== null,
          },
        },
        hasTab,
        inFlight: this.queryClient.isFetching(fileSnapshotReads),
        knownSize: intent.knownSize ?? null,
        path,
        pathClassification: path === rootPath ? 'root' : 'descendant',
        rootGeneration: this.lifecycleGeneration,
        rootPath,
        intentSource: intent.source,
        intentSources: [intent.source],
        trigger: intent.trigger ?? null,
      }),
      hasTab,
      knownSize: intent.knownSize ?? null,
      path,
      pendingEnd: null,
      postActivationBaseline: null,
      promotion: { phase: 'preparing' },
      relatedSettled: true,
      rootPath,
    }
  }

  private noteDuplicateIntent(operation: FileOpenIntentOperation, intent: FileOpenIntent): void {
    operation.event.increment('dedupeCount')
    operation.event.set({ intentSources: [intent.source] })
    if (intent.tabId !== undefined && !operation.hasTab) {
      operation.hasTab = true
      operation.event.set({ hasTab: true })
    }
    if (intent.knownSize === undefined || operation.knownSize === intent.knownSize) return

    operation.knownSize = intent.knownSize
    operation.event.set({ knownSize: intent.knownSize })
  }

  private finishImmediateIntent(
    intent: FileOpenIntent,
    rootPath: FilesystemPath,
    path: FilesystemPath,
    outcome: string,
    context: Record<string, unknown> = {},
  ): void {
    const operation = this.createIntentOperation(intent, rootPath, path)
    this.finishOperation(operation, { ...context, leadMs: 0, outcome })
    this.noteBenchmarkIntent(path)
  }

  private promoteIntent(
    path: FilesystemPath,
    documentKey: DocumentKey,
    joinOutcome: 'hit' | 'partial',
    context: Record<string, unknown>,
  ): void {
    const operation = this.intentOperations.get(path)
    if (!operation) return

    this.intentOperations.delete(path)
    operation.joinOutcome = joinOutcome
    const previous = this.promotedIntentOperations.get(path)
    if (previous) this.finishPromotion(path, 'superseded')
    operation.postActivationBaseline = postActivationWorkSnapshot(path)
    const promotionAt = this.runtime.now()
    operation.event.set({
      ...context,
      leadMs: promotionAt - operation.detectedAt,
      outcome: joinOutcome,
    })
    const cancelPaintTimeout = this.runtime.scheduleTimer(
      () => this.finishPromotion(path, 'timeout', { reason: 'initial-paint-timeout' }),
      PROMOTION_PAINT_TIMEOUT_MS,
    )
    operation.promotion = {
      at: promotionAt,
      cancelPaintTimeout,
      documentKey,
      phase: 'awaiting-text',
    }
    this.promotedIntentOperations.set(path, operation)
  }

  private finishPromotion(
    path: FilesystemPath,
    paintOutcome: string,
    context: Record<string, unknown> = {},
  ): void {
    const operation = this.promotedIntentOperations.get(path)
    if (!operation) return

    const promotion = operation.promotion
    if (promotion.phase === 'preparing') return

    this.promotedIntentOperations.delete(path)
    promotion.cancelPaintTimeout()
    const counters = postActivationWorkSince(operation.postActivationBaseline, path)
    const outcome = paintOutcome === 'abandoned' ? 'aborted' : operation.joinOutcome
    operation.event.set({
      postActivation: counters,
      promotion: { paintOutcome },
    })
    this.finishOperation(operation, { ...context, outcome })
  }

  private finishIntent(
    path: FilesystemPath,
    outcome: string,
    context: Record<string, unknown> = {},
  ): void {
    const operation = this.intentOperations.get(path)
    if (!operation) return

    this.intentOperations.delete(path)
    this.finishOperation(operation, {
      ...context,
      leadMs: this.runtime.now() - operation.detectedAt,
      outcome,
    })
  }

  private finishOperation(
    operation: FileOpenIntentOperation,
    context: Record<string, unknown>,
  ): void {
    if (!operation.relatedSettled) {
      operation.pendingEnd = context
      return
    }

    operation.event.end(context)
  }

  private startRelatedPrefetch(
    path: FilesystemPath,
    intentOperation: FileOpenIntentOperation,
  ): void {
    const rootPath = this.rootPath
    if (!rootPath) return

    const startedAt = this.runtime.now()
    let result: Promise<unknown> | void
    try {
      result = this.prefetchRelated(rootPath, path)
    } catch {
      intentOperation.event.set({ stages: { lsp: { status: 'failed' } } })
      return
    }
    if (!result) {
      intentOperation.event.set({
        stages: { lsp: { durationMs: this.runtime.now() - startedAt, status: 'skipped' } },
      })
      return
    }

    intentOperation.relatedSettled = false
    const relatedOperation = result.then(
      () => {
        intentOperation.event.set({
          stages: { lsp: { durationMs: this.runtime.now() - startedAt, status: 'ready' } },
        })
      },
      () => {
        intentOperation.event.set({
          stages: { lsp: { durationMs: this.runtime.now() - startedAt, status: 'failed' } },
        })
      },
    )
    this.relatedOperations.add(relatedOperation)
    void relatedOperation.finally(() => {
      this.relatedOperations.delete(relatedOperation)
      this.settleRelatedIntent(intentOperation)
    })
  }

  private settleRelatedIntent(operation: FileOpenIntentOperation): void {
    operation.relatedSettled = true
    const context = operation.pendingEnd
    if (!context) return

    operation.pendingEnd = null
    operation.event.end(context)
  }

  private noteBenchmarkIntent(path: FilesystemPath): void {
    const scope = this.benchmarkScope
    if (!scope) return
    if (path === scope.path) {
      scope.targetIntents += 1
      globalThis.performance?.mark('editor.file_open_intent.detected', {
        detail: { path },
      })
      return
    }
    scope.nonTargetIntents += 1
  }

  private noteBenchmarkJoin(
    path: FilesystemPath,
    estimatedBytes: number,
    preparedDocument: EditorPreparedDocument,
  ): void {
    const scope = this.benchmarkScope
    if (!scope) return

    this.noteBenchmarkRuntimeSessionIds(preparedDocument)
    if (path !== scope.path) return

    scope.preparedJoins += 1
    scope.promotedBytes += estimatedBytes
    const runtimeSessionIds = preparedDocument.runtimeSessionIds()
    for (const id of runtimeSessionIds.highlighter) scope.joinedHighlighterRuntimeSessionIds.add(id)
    for (const id of runtimeSessionIds.structural) scope.joinedStructuralRuntimeSessionIds.add(id)
  }

  private noteBenchmarkRuntimeSessionIds(preparedDocument: EditorPreparedDocument | null): void {
    const scope = this.benchmarkScope
    if (!scope || !preparedDocument) return

    const runtimeSessionIds = preparedDocument.runtimeSessionIds()
    for (const id of runtimeSessionIds.highlighter) scope.highlighterRuntimeSessionIds.add(id)
    for (const id of runtimeSessionIds.structural) scope.structuralRuntimeSessionIds.add(id)
  }

  private noteBenchmarkEviction(): void {
    if (this.benchmarkScope) this.benchmarkScope.evictions += 1
  }

  private requireBenchmarkScope(sampleId: string): FileOpenIntentBenchmarkScope {
    const scope = this.benchmarkScope
    if (!scope || scope.sampleId !== sampleId) {
      throw createClientInvariantError('Unknown editor-open benchmark sample')
    }
    return scope
  }
}

const preparationFamilies: readonly FileOpenIntentPreparationFamily[] = [
  'highlighter',
  'structural',
]

function awaitPreparationInterest<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const release = () => {
      signal.removeEventListener('abort', release)
      resolve(null)
    }
    operation.then(
      (value) => {
        signal.removeEventListener('abort', release)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', release)
        reject(error)
      },
    )
    if (signal.aborted) {
      release()
      return
    }
    signal.addEventListener('abort', release, { once: true })
  })
}

function stageRecords(
  stages: readonly FileOpenIntentPreparationStage[],
): Map<FileOpenIntentPreparationFamily, PreparedStageRecord> {
  const records = new Map<FileOpenIntentPreparationFamily, PreparedStageRecord>()
  for (const stage of stages) {
    if (records.has(stage.family)) {
      throw createClientInvariantError(`Duplicate prepared ${stage.family} stage`)
    }
    records.set(stage.family, { progress: 'queued', stage })
  }
  return records
}

function queuedStages(record: PreparedOpenRecord): PreparedStageRecord[] {
  return preparationFamilies.flatMap((family) => {
    const stage = record.stages.get(family)
    return stage?.progress === 'queued' ? [stage] : []
  })
}

function sameStage(
  left: FileOpenIntentPreparationStage | undefined,
  right: FileOpenIntentPreparationStage | undefined,
): boolean {
  if (!left || !right) return left === right
  if (left.family !== right.family) return false
  if (left.provider !== right.provider) return false
  if (!sameStageRange(left.range, right.range)) return false
  return sameTag(left.configurationTag, right.configurationTag)
}

function sameStageRange(
  left: FileOpenIntentPreparationStage['range'],
  right: FileOpenIntentPreparationStage['range'],
): boolean {
  if (left === 'full' || right === 'full') return left === right
  if (!left || !right) return left === right
  return sameStructuralRange(left, right)
}

function sameStructuralRange(
  left: FileOpenIntentStructuralRange,
  right: FileOpenIntentStructuralRange,
): boolean {
  return left.startIndex === right.startIndex && left.endIndex === right.endIndex
}

function sameTag(
  left: readonly EditorPreparedTagValue[],
  right: readonly EditorPreparedTagValue[],
): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => Object.is(value, right[index]))
}

function sameEnvironment(
  left: FileOpenIntentEnvironmentIdentity,
  right: FileOpenIntentEnvironmentIdentity,
): boolean {
  if (left.highlighterProvider !== right.highlighterProvider) return false
  if (left.structuralProvider !== right.structuralProvider) return false
  return sameTag(left.configurationTag, right.configurationTag)
}

function preparationStageProgress(record: PreparedOpenRecord) {
  return Object.fromEntries(
    preparationFamilies.map((family) => [family, record.stages.get(family)?.progress ?? 'absent']),
  )
}

function freshFileQueryState(
  state:
    | {
        readonly data?: FileSnapshot
        readonly dataUpdatedAt: number
        readonly status: string
      }
    | undefined,
  now: number,
): boolean {
  if (state?.status !== 'success' || !state.data) return false
  return now - state.dataUpdatedAt <= FILE_SNAPSHOT_STALE_MS
}

function postActivationWorkSince(
  baseline: PostActivationWorkSnapshot | null,
  path: FilesystemPath,
): PostActivationWorkSnapshot {
  const current = postActivationWorkSnapshot(path)
  if (!baseline) return current

  return {
    bufferBuilds: counterDelta(current.bufferBuilds, baseline.bufferBuilds),
    diagnosticsObserved: current.diagnosticsObserved && baseline.diagnosticsObserved,
    fileReads: counterDelta(current.fileReads, baseline.fileReads),
    highlighterSessionCreations: counterDelta(
      current.highlighterSessionCreations,
      baseline.highlighterSessionCreations,
    ),
    lineIndexScans: counterDelta(current.lineIndexScans, baseline.lineIndexScans),
    structuralSessionCreations: counterDelta(
      current.structuralSessionCreations,
      baseline.structuralSessionCreations,
    ),
    workerOpenRequests: counterDelta(current.workerOpenRequests, baseline.workerOpenRequests),
    workerParseRequests: counterDelta(current.workerParseRequests, baseline.workerParseRequests),
    workerQueryRequests: counterDelta(current.workerQueryRequests, baseline.workerQueryRequests),
    workerRefreshRequests: counterDelta(
      current.workerRefreshRequests,
      baseline.workerRefreshRequests,
    ),
  }
}

function postActivationWorkSnapshot(path: FilesystemPath): PostActivationWorkSnapshot {
  const diagnostics = editorTraceDiagnostics()
  return {
    bufferBuilds: pathPerformanceMarkCount('editor.file_open.buffer_built', path),
    diagnosticsObserved: diagnostics.observed,
    fileReads: pathPerformanceMarkCount('editor.file_open.file_read', path),
    highlighterSessionCreations: diagnosticCount(
      diagnostics.entries,
      'editor.syntax.session_created',
      'highlighter',
    ),
    lineIndexScans: diagnosticCount(diagnostics.entries, 'editor.line_starts.scan'),
    structuralSessionCreations: diagnosticCount(
      diagnostics.entries,
      'editor.syntax.session_created',
      'structural',
    ),
    workerOpenRequests: workerPerformanceMarkCount('open'),
    workerParseRequests: workerPerformanceMarkCount('parse'),
    workerQueryRequests: workerPerformanceMarkCount('queryRange'),
    workerRefreshRequests: workerPerformanceMarkCount('edit'),
  }
}

function counterDelta(current: number, baseline: number): number {
  return Math.max(0, current - baseline)
}

function pathPerformanceMarkCount(name: string, path: FilesystemPath): number {
  return performanceMarks(name).filter((entry) => entry.detail?.path === path).length
}

function workerPerformanceMarkCount(type: string): number {
  return performanceMarks('editor.worker.request').filter(
    (entry) =>
      entry.detail?.type === type &&
      entry.detail.type !== 'idleFence' &&
      entry.detail.type !== 'runtimeBarrier',
  ).length
}

function performanceMarks(name: string): readonly PerformanceMark[] {
  const entries = globalThis.performance?.getEntriesByName(name, 'mark') ?? []
  return entries.filter((entry): entry is PerformanceMark => entry.entryType === 'mark')
}

type TraceDiagnosticEntry = {
  readonly detail?: Readonly<Record<string, unknown>>
  readonly name: string
}

function editorTraceDiagnostics(): {
  readonly entries: readonly TraceDiagnosticEntry[]
  readonly observed: boolean
} {
  const trace = (
    globalThis as typeof globalThis & {
      readonly __editorPerfTrace?: { readonly report?: () => unknown }
    }
  ).__editorPerfTrace
  if (!trace?.report) return { entries: [], observed: false }

  try {
    return { entries: traceDiagnosticEntries(trace.report()), observed: true }
  } catch {
    return { entries: [], observed: false }
  }
}

function traceDiagnosticEntries(report: unknown): readonly TraceDiagnosticEntry[] {
  if (!isRecord(report) || !Array.isArray(report.traceEvents)) return []

  const entries: TraceDiagnosticEntry[] = []
  for (const event of report.traceEvents) {
    if (!isRecord(event) || event.kind !== 'diagnostic') continue
    if (!isRecord(event.diagnostic) || typeof event.diagnostic.name !== 'string') continue

    entries.push({
      detail: isRecord(event.diagnostic.detail) ? event.diagnostic.detail : undefined,
      name: event.diagnostic.name,
    })
  }
  return entries
}

function diagnosticCount(
  entries: readonly TraceDiagnosticEntry[],
  name: string,
  family?: string,
): number {
  return entries.filter(
    (entry) => entry.name === name && (!family || entry.detail?.family === family),
  ).length
}

function defaultStructuralRange(
  snapshotLength: number,
  scrollPosition: EditorScrollPosition | null,
): FileOpenIntentStructuralRange {
  const estimatedRow = Math.floor((scrollPosition?.top ?? 0) / 20)
  const estimatedOffset = estimatedRow * 96
  const startIndex = Math.min(snapshotLength, Math.max(0, estimatedOffset - 16 * 1024))
  return {
    endIndex: Math.min(snapshotLength, startIndex + 64 * 1024),
    startIndex,
  }
}

function cleanFileIdentityMatches(
  source: Extract<PreparedSource, { readonly kind: 'clean' }>,
  file: FileSnapshotIdentity,
): boolean {
  return source.path === file.path && source.fileVersion === file.version
}

function fileResultIdentity(value: unknown): FileSnapshotIdentity | null {
  if (!isRecord(value)) return null
  if (typeof value.path !== 'string') return null
  if (typeof value.version !== 'string') return null
  return { path: filesystemPath(value.path), version: value.version }
}

function canonicalPath(path: FilesystemPath): FilesystemPath {
  const absolute = path.startsWith('/')
  const segments: string[] = []
  for (const segment of path.replaceAll('\\', '/').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return filesystemPath(`${absolute ? '/' : ''}${segments.join('/')}` || (absolute ? '/' : '.'))
}

function isAutomaticTrigger(trigger: FileOpenIntentTrigger | undefined): boolean {
  return trigger === 'active-row' || trigger === 'adjacent-tab' || trigger === 'focus'
}

const defaultFileOpenIntentRuntime: FileOpenIntentRuntime = {
  now: () => Date.now(),
  schedule: <T>(task: () => T | Promise<T>): Promise<T> => {
    const taskScheduler = (
      globalThis as typeof globalThis & {
        readonly scheduler?: {
          postTask<TValue>(
            callback: () => TValue | Promise<TValue>,
            options: { readonly priority: 'background' },
          ): Promise<TValue>
        }
      }
    ).scheduler
    if (taskScheduler) return taskScheduler.postTask(task, { priority: 'background' })

    return new Promise<T>((resolve, reject) => {
      setTimeout(() => {
        Promise.resolve().then(task).then(resolve, reject)
      }, 0)
    })
  },
  scheduleTimer: (task, delayMs) => {
    const timer = setTimeout(task, delayMs)
    return () => clearTimeout(timer)
  },
}
