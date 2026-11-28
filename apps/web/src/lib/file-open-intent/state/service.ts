import type { DocumentKey, FilesystemPath, TabId } from '@/lib/documents/utils/types'
import type { QueryClient } from '@tanstack/react-query'
import type { EditorTextBuffer, PieceTableSnapshot } from '@singapore-editor/core/document'
import type { EditorInitialPaintEvent } from '@singapore-editor/core/extensions'
import type {
  EditorPreparedDocument,
  EditorDocumentAnalysis,
  EditorPreparedTagValue,
  EditorScrollPosition,
} from '@singapore-editor/core/editor'
import type { FileSnapshot } from '@/lib/file-snapshot'
import { fileSnapshotPathFromQueryKey } from '@/lib/file-snapshot-cache-policy'
import type { WideEventScope } from '@workspace/observability/scope'
import { createClientInvariantError } from '@/lib/structured-errors'
import { FileOpenIntentServiceState, inertInterest } from './operations'
import { fileResultIdentity } from './preparation-identity'

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

export type FileOpenIntentJoin = {
  readonly documentKey: DocumentKey
  /** The preparation this request joined, or null when the document has none to join. */
  readonly prepared: FileOpenIntentPreparedLease | null
}

export type FileOpenIntentPreparationFamily = 'highlighter' | 'structural'

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

export type FileOpenIntentEnvironmentIdentity = {
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

export type FileOpenIntentPreparation = FileOpenIntentPreparationConfiguration & {
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

export type FileOpenIntentBenchmarkResult = {
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
