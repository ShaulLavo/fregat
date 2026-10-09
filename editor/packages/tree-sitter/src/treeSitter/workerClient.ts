import type { TreeSitterLanguageDescriptor } from './registry'
import type {
  DocumentSourceConnection,
  DocumentSourceEndpoint,
  DocumentWorkerReadReference,
} from '@singapore-editor/core/internal/document-worker'
import {
  decodeDocumentWorkerReply,
  waitForDocumentWork,
} from '@singapore-editor/core/internal/document-worker'
import type {
  TreeSitterEditRequest,
  TreeSitterLanguageId,
  TreeSitterParseAckResult,
  TreeSitterParseRequest,
  TreeSitterParseResult,
  TreeSitterRangeRequest,
  TreeSitterRangeResult,
  TreeSitterSelectionRequest,
  TreeSitterMergeUnitRequest,
  TreeSitterMergeUnitResult,
  TreeSitterSelectionResult,
  TreeSitterSyntaxRange,
  TreeSitterWorkerRequest,
  TreeSitterWorkerRequestPayload,
  TreeSitterWorkerResponse,
  TreeSitterWorkerResult,
  TreeSitterWorkerRetentionSnapshot,
} from './types'

type PendingRequest = {
  readonly cleanup: () => void
  readonly runtimeSessionId: string | null
  readonly cancellationFlag: Int32Array | null
  readonly payload: TreeSitterWorkerRequestPayload
  readonly resolve: (result: TreeSitterWorkerResult) => void
  readonly reject: (error: Error) => void
}

type TreeSitterParseDocumentRequest = Omit<
  TreeSitterParseRequest,
  'generation' | 'cancellationBuffer'
>
type TreeSitterEditDocumentRequest = Omit<
  TreeSitterEditRequest,
  'generation' | 'cancellationBuffer'
>
type TreeSitterRangeDocumentRequest = Omit<
  TreeSitterRangeRequest,
  'generation' | 'cancellationBuffer'
>

export type TreeSitterParsePayload = {
  readonly documentId: string
  readonly runtimeSessionId: string
  readonly snapshotVersion: number
  readonly languageId: TreeSitterLanguageId
  readonly includeHighlights?: boolean
  readonly includeCaptures?: boolean
  readonly resultMode?: 'full'
  readonly source: DocumentWorkerReadReference
}
export type TreeSitterParseOnlyPayload = Omit<TreeSitterParsePayload, 'resultMode'> & {
  readonly resultMode: 'parseOnly' | 'bootstrap'
}
export type TreeSitterBackendParsePayload = TreeSitterParsePayload | TreeSitterParseOnlyPayload

export type TreeSitterEditPayload = {
  readonly documentId: string
  readonly runtimeSessionId: string
  readonly previousSnapshotVersion: number
  readonly snapshotVersion: number
  readonly languageId: TreeSitterLanguageId
  readonly includeHighlights: boolean
  readonly includeCaptures?: boolean
  readonly resultMode?: 'full'
  readonly source: DocumentWorkerReadReference
  readonly edits: readonly TreeSitterEditRequest['edits'][number][]
  readonly inputEdits: readonly TreeSitterEditRequest['inputEdits'][number][]
}
export type TreeSitterEditOnlyPayload = Omit<TreeSitterEditPayload, 'resultMode'> & {
  readonly resultMode: 'parseOnly'
}
export type TreeSitterBackendEditPayload = TreeSitterEditPayload | TreeSitterEditOnlyPayload
export type TreeSitterRangePayload = {
  readonly documentId: string
  readonly runtimeSessionId: string
  readonly snapshotVersion: number
  readonly languageId: TreeSitterLanguageId
  readonly includeHighlights?: boolean
  readonly includeCaptures?: boolean
  readonly range: TreeSitterSyntaxRange
}
export type TreeSitterMergeUnitPayload = Omit<TreeSitterMergeUnitRequest, 'type'>

export type TreeSitterSelectionPayload = Omit<TreeSitterSelectionRequest, 'type'>

export type TreeSitterWorkerLifecycleState =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'disposing'
  | 'disposed'
  | 'crashed'

export type TreeSitterWorkerCacheSnapshot = {
  readonly registeredLanguages: number
}

export type TreeSitterWorkerOwnerSnapshot = {
  readonly lifecycle: TreeSitterWorkerLifecycleState
  readonly pendingRequests: number
  readonly workerGeneration: number
  readonly cache: TreeSitterWorkerCacheSnapshot
  readonly lastError: string | null
}

export type TreeSitterBackend = {
  readonly generation: number | null
  readonly sourceEndpoint: DocumentSourceEndpoint
  registerLanguages(languages: readonly TreeSitterLanguageDescriptor[]): Promise<void>
  /** Starts the worker, then registers and compiles `languages` ahead of their first document. */
  warmLanguages?(languages: readonly TreeSitterLanguageDescriptor[]): Promise<void>
  parse(
    payload: TreeSitterBackendParsePayload,
    signal?: AbortSignal,
  ): Promise<TreeSitterParseResult | TreeSitterParseAckResult | undefined>
  edit(
    payload: TreeSitterBackendEditPayload,
    signal?: AbortSignal,
  ): Promise<TreeSitterParseResult | TreeSitterParseAckResult | undefined>
  queryRange?(
    payload: TreeSitterRangePayload,
    signal?: AbortSignal,
  ): Promise<TreeSitterRangeResult | undefined>
  mergeUnit?(payload: TreeSitterMergeUnitPayload): Promise<TreeSitterMergeUnitResult | undefined>
  select(payload: TreeSitterSelectionPayload): Promise<TreeSitterSelectionResult | undefined>
  disposeDocument(runtimeSessionId: string): void
  awaitRuntimeSessionIdle?(runtimeSessionId: string): Promise<void>
  awaitIdleFence?(): Promise<void>
  inspectRetention?(): Promise<TreeSitterWorkerRetentionSnapshot | null>
  dispose?(): Promise<void>
}

const supportsWorkers = (): boolean => typeof Worker !== 'undefined'
const supportsSharedCancellation = (): boolean => typeof SharedArrayBuffer !== 'undefined'

export const canUseTreeSitterWorker = (): boolean => supportsWorkers()

export class TreeSitterWorkerClient implements TreeSitterBackend {
  public constructor(private readonly options: { readonly workerFactory?: () => Worker } = {}) {}
  private worker: Worker | null = null
  private disposeTask: Promise<void> | null = null
  private nextRequestId = 1
  private nextGeneration = 1
  private workerGeneration = 0
  private lifecycle: TreeSitterWorkerLifecycleState = 'idle'
  private lastError: Error | null = null
  private initPromise: Promise<void> | null = null
  private readonly pendingRequests = new Map<number, PendingRequest>()
  private readonly clientTasks = new Set<Promise<unknown>>()
  private readonly runtimeTasks = new Map<string, Set<Promise<unknown>>>()
  private connection: DocumentSourceConnection | null = null
  private nextRegistration = 0
  public readonly sourceEndpoint: DocumentSourceEndpoint = {
    connect: () => this.connectSource(),
  }
  private readonly registeredLanguages = new Map<
    TreeSitterLanguageId,
    TreeSitterLanguageDescriptor
  >()
  private readonly warmedLanguages = new Set<TreeSitterLanguageId>()

  public get generation(): number | null {
    return this.worker ? this.workerGeneration : null
  }

  public inspect(): TreeSitterWorkerOwnerSnapshot {
    return {
      lifecycle: this.lifecycle,
      pendingRequests: this.pendingRequests.size,
      workerGeneration: this.workerGeneration,
      cache: {
        registeredLanguages: this.registeredLanguages.size,
      },
      lastError: this.lastError?.message ?? null,
    }
  }

  public registerLanguages(languages: readonly TreeSitterLanguageDescriptor[]): Promise<void> {
    return this.trackClientTask(this.finishRegisterLanguages(languages))
  }

  private async finishRegisterLanguages(
    languages: readonly TreeSitterLanguageDescriptor[],
  ): Promise<void> {
    const nextLanguages = this.unregisteredLanguages(languages)
    if (nextLanguages.length === 0) return

    const handle = await this.ensureWorkerReady()
    if (!handle) return

    await this.postRequest({ type: 'registerLanguages', languages: nextLanguages })
    if (this.worker !== handle) return

    for (const language of nextLanguages) {
      this.registeredLanguages.set(language.id, language)
      // A changed registration drops the worker's compiled runtime for that id.
      this.warmedLanguages.delete(language.id)
    }
  }

  public warmLanguages(languages: readonly TreeSitterLanguageDescriptor[]): Promise<void> {
    return this.trackClientTask(this.finishWarmLanguages(languages))
  }

  private async finishWarmLanguages(
    languages: readonly TreeSitterLanguageDescriptor[],
  ): Promise<void> {
    const handle = await this.ensureWorkerReady()
    if (!handle) return

    await this.finishRegisterLanguages(languages)
    if (this.worker !== handle) return

    const languageIds = [...new Set(languages.map((language) => language.id))].filter(
      (languageId) => !this.warmedLanguages.has(languageId),
    )
    if (languageIds.length === 0) return

    for (const languageId of languageIds) this.warmedLanguages.add(languageId)
    await this.postRequest({ type: 'warmLanguages', languageIds })
  }

  public parse(
    payload: TreeSitterParseOnlyPayload,
    signal?: AbortSignal,
  ): Promise<TreeSitterParseResult | TreeSitterParseAckResult | undefined>
  public parse(
    payload: TreeSitterParsePayload,
    signal?: AbortSignal,
  ): Promise<TreeSitterParseResult | undefined>
  public parse(
    payload: TreeSitterBackendParsePayload,
    signal?: AbortSignal,
  ): Promise<TreeSitterParseResult | TreeSitterParseAckResult | undefined>
  public parse(
    payload: TreeSitterBackendParsePayload,
    signal?: AbortSignal,
  ): Promise<TreeSitterParseResult | TreeSitterParseAckResult | undefined> {
    return this.trackRuntimeTask(payload.runtimeSessionId, this.finishParse(payload, signal))
  }

  private async finishParse(
    payload: TreeSitterBackendParsePayload,
    signal?: AbortSignal,
  ): Promise<TreeSitterParseResult | TreeSitterParseAckResult | undefined> {
    const handle = await waitForDocumentWork(this.ensureWorkerReady(), signal)
    if (!handle || this.worker !== handle) return undefined
    const request: TreeSitterParseDocumentRequest = {
      type: 'parse',
      documentId: payload.documentId,
      runtimeSessionId: payload.runtimeSessionId,
      snapshotVersion: payload.snapshotVersion,
      languageId: payload.languageId,
      includeHighlights: payload.includeHighlights ?? true,
      includeCaptures: payload.includeCaptures,
      resultMode: payload.resultMode,
      source: payload.source,
    }
    const result = await this.postDocumentRequest(request, signal)
    if (isTreeSitterParseResult(result)) return result
    if (isTreeSitterParseAckResult(result)) return result
    return undefined
  }

  public edit(
    payload: TreeSitterEditOnlyPayload,
    signal?: AbortSignal,
  ): Promise<TreeSitterParseResult | TreeSitterParseAckResult | undefined>
  public edit(
    payload: TreeSitterEditPayload,
    signal?: AbortSignal,
  ): Promise<TreeSitterParseResult | undefined>
  public edit(
    payload: TreeSitterBackendEditPayload,
    signal?: AbortSignal,
  ): Promise<TreeSitterParseResult | TreeSitterParseAckResult | undefined>
  public edit(
    payload: TreeSitterBackendEditPayload,
    signal?: AbortSignal,
  ): Promise<TreeSitterParseResult | TreeSitterParseAckResult | undefined> {
    return this.trackRuntimeTask(payload.runtimeSessionId, this.finishEdit(payload, signal))
  }

  private async finishEdit(
    payload: TreeSitterBackendEditPayload,
    signal?: AbortSignal,
  ): Promise<TreeSitterParseResult | TreeSitterParseAckResult | undefined> {
    const handle = await waitForDocumentWork(this.ensureWorkerReady(), signal)
    if (!handle || this.worker !== handle) return undefined
    const result = await this.postDocumentRequest(
      {
        type: 'edit',
        documentId: payload.documentId,
        runtimeSessionId: payload.runtimeSessionId,
        previousSnapshotVersion: payload.previousSnapshotVersion,
        snapshotVersion: payload.snapshotVersion,
        languageId: payload.languageId,
        includeHighlights: payload.includeHighlights,
        includeCaptures: payload.includeCaptures,
        resultMode: payload.resultMode,
        source: payload.source,
        edits: payload.edits,
        inputEdits: payload.inputEdits,
      },
      signal,
    )
    if (isTreeSitterParseResult(result)) return result
    if (isTreeSitterParseAckResult(result)) return result
    return undefined
  }

  public queryRange(
    payload: TreeSitterRangePayload,
    signal?: AbortSignal,
  ): Promise<TreeSitterRangeResult | undefined> {
    return this.trackRuntimeTask(payload.runtimeSessionId, this.finishQueryRange(payload, signal))
  }

  private async finishQueryRange(
    payload: TreeSitterRangePayload,
    signal?: AbortSignal,
  ): Promise<TreeSitterRangeResult | undefined> {
    const handle = await waitForDocumentWork(this.ensureWorkerReady(), signal)
    if (!handle) return undefined
    const result = await this.postRangeRequest(
      {
        type: 'queryRange',
        documentId: payload.documentId,
        runtimeSessionId: payload.runtimeSessionId,
        snapshotVersion: payload.snapshotVersion,
        languageId: payload.languageId,
        includeHighlights: payload.includeHighlights ?? true,
        includeCaptures: payload.includeCaptures,
        range: payload.range,
      },
      signal,
    )
    return isTreeSitterRangeResult(result) ? result : undefined
  }

  public mergeUnit(
    payload: TreeSitterMergeUnitPayload,
  ): Promise<TreeSitterMergeUnitResult | undefined> {
    return this.trackRuntimeTask(payload.runtimeSessionId, this.finishMergeUnit(payload))
  }

  private async finishMergeUnit(
    payload: TreeSitterMergeUnitPayload,
  ): Promise<TreeSitterMergeUnitResult | undefined> {
    const handle = await this.ensureWorkerReady()
    if (!handle) return undefined
    const result = await this.postRequest({ type: 'mergeUnit', ...payload })
    return result && 'unit' in result ? result : undefined
  }

  public select(
    payload: TreeSitterSelectionPayload,
  ): Promise<TreeSitterSelectionResult | undefined> {
    return this.trackRuntimeTask(payload.runtimeSessionId, this.finishSelect(payload))
  }

  private async finishSelect(
    payload: TreeSitterSelectionPayload,
  ): Promise<TreeSitterSelectionResult | undefined> {
    const handle = await this.ensureWorkerReady()
    if (!handle) return undefined
    const result = await this.postRequest({ type: 'selection', ...payload })
    return isTreeSitterSelectionResult(result) ? result : undefined
  }

  public disposeDocument(runtimeSessionId: string): void {
    this.cancelRuntimeRequests(runtimeSessionId)
    const precedingTasks = [...(this.runtimeTasks.get(runtimeSessionId) ?? [])]
    const disposal = Promise.allSettled(precedingTasks).then(async () => {
      if (!this.worker) return

      await this.postRequest({ type: 'disposeDocument', runtimeSessionId }, false)
    })
    void this.trackRuntimeTask(runtimeSessionId, disposal).catch(() => undefined)
  }

  public async awaitRuntimeSessionIdle(runtimeSessionId: string): Promise<void> {
    await this.awaitRuntimeTasks(runtimeSessionId)
    if (!this.worker) return Promise.resolve()

    await this.postRequest({ type: 'runtimeBarrier', runtimeSessionId }, false)
  }

  public async awaitIdleFence(): Promise<void> {
    await this.awaitClientTasks()
    if (!this.worker) return Promise.resolve()

    await this.postRequest({ type: 'idleFence' }, false)
  }

  /** Null means no live worker, including an unstarted, unsupported or disposed owner. */
  public async inspectRetention(): Promise<TreeSitterWorkerRetentionSnapshot | null> {
    await this.awaitClientTasks()
    if (!this.worker) return null

    const result = await this.postRequest({ type: 'idleFence', includeRetention: true }, false)
    return result && 'retention' in result ? result.retention : null
  }

  public dispose(): Promise<void> {
    if (this.disposeTask) return this.disposeTask

    this.lifecycle = 'disposing'
    this.disposeTask = this.finishDispose()
    return this.disposeTask
  }

  private async finishDispose(): Promise<void> {
    const handle = this.worker
    this.worker = null
    try {
      if (handle) {
        handle.onmessage = null
        handle.onerror = null
        // A busy worker cannot acknowledge disposal; termination releases its message loop.
        handle.terminate()
      }
    } finally {
      this.clearRetainedState('disposed')
      this.rejectPendingRequests(new Error('Tree-sitter worker disposed'))
    }
  }

  private getWorker(): Worker | null {
    if (this.lifecycle === 'disposing' || this.lifecycle === 'disposed') return null
    if (!this.options.workerFactory && !supportsWorkers()) return null
    if (this.worker) return this.worker

    const handle =
      this.options.workerFactory?.() ??
      new Worker(new URL('./treeSitter.worker.ts', import.meta.url), {
        type: 'module',
      })
    handle.onmessage = (event) => this.handleWorkerMessage(event)
    handle.onerror = (event) => this.handleWorkerError(handle, event)
    this.worker = handle
    this.workerGeneration += 1
    this.lifecycle = 'initializing'
    this.lastError = null
    return handle
  }

  private async ensureWorkerReady(): Promise<Worker | null> {
    const handle = this.getWorker()
    if (!handle) return null

    if (!this.initPromise) {
      this.initPromise = this.postRequest({ type: 'init' }).then(() => {
        if (this.worker === handle) this.lifecycle = 'ready'
      })
    }

    await this.initPromise
    if (this.lifecycle === 'disposing' || this.lifecycle === 'disposed') return null
    if (this.worker !== handle) return null
    return handle
  }

  private postRequest(
    payload: TreeSitterWorkerRequestPayload,
    createIfMissing = true,
    signal?: AbortSignal,
  ): Promise<TreeSitterWorkerResult> {
    const handle = createIfMissing ? this.getWorker() : this.worker
    if (!handle) return Promise.resolve(undefined)

    if (signal?.aborted)
      return Promise.reject(new DOMException('Document source was released', 'AbortError'))
    const id = this.nextRequestId
    this.nextRequestId += 1
    const request: TreeSitterWorkerRequest = { id, payload }
    markEditorWorkerRequest('tree-sitter', payload.type, runtimeSessionIdForPayload(payload))

    return new Promise((resolve, reject) => {
      const abort = () => {
        const pending = this.pendingRequests.get(id)
        if (pending?.cancellationFlag) Atomics.store(pending.cancellationFlag, 0, 1)
        this.pendingRequests.delete(id)
        reject(new DOMException('Document source was released', 'AbortError'))
      }
      this.pendingRequests.set(id, {
        cleanup: () => signal?.removeEventListener('abort', abort),
        runtimeSessionId: runtimeSessionIdForPayload(payload),
        cancellationFlag: cancellationFlagForPayload(payload),
        payload,
        resolve,
        reject,
      })
      signal?.addEventListener('abort', abort, { once: true })
      try {
        handle.postMessage(request)
      } catch (error) {
        signal?.removeEventListener('abort', abort)
        this.pendingRequests.delete(id)
        reject(workerRequestError(error))
      }
    })
  }

  private postDocumentRequest(
    payload: TreeSitterParseDocumentRequest | TreeSitterEditDocumentRequest,
    signal?: AbortSignal,
  ): Promise<TreeSitterWorkerResult> {
    return this.postRequest(
      this.withCancellation(this.cancelPreviousDocumentRequests(payload.runtimeSessionId), payload),
      false,
      signal,
    )
  }

  private postRangeRequest(
    payload: TreeSitterRangeDocumentRequest,
    signal?: AbortSignal,
  ): Promise<TreeSitterWorkerResult> {
    return this.postRequest(
      this.withCancellation(this.cancelPreviousRangeRequests(payload.runtimeSessionId), payload),
      false,
      signal,
    )
  }

  private cancelPreviousDocumentRequests(runtimeSessionId: string): Int32Array | null {
    const cancellationFlag = this.createCancellationFlag()
    for (const pending of this.pendingRequests.values()) {
      if (pending.runtimeSessionId !== runtimeSessionId) continue
      if (pending.cancellationFlag) Atomics.store(pending.cancellationFlag, 0, 1)
    }

    return cancellationFlag
  }

  private cancelPreviousRangeRequests(runtimeSessionId: string): Int32Array | null {
    const cancellationFlag = this.createCancellationFlag()
    for (const pending of this.pendingRequests.values()) {
      if (pending.runtimeSessionId !== runtimeSessionId) continue
      if (pending.payload.type !== 'queryRange') continue
      if (pending.cancellationFlag) Atomics.store(pending.cancellationFlag, 0, 1)
    }

    return cancellationFlag
  }

  private cancelRuntimeRequests(runtimeSessionId: string): void {
    for (const pending of this.pendingRequests.values()) {
      if (pending.runtimeSessionId !== runtimeSessionId) continue
      if (pending.cancellationFlag) Atomics.store(pending.cancellationFlag, 0, 1)
    }
  }

  private createCancellationFlag(): Int32Array | null {
    if (!supportsSharedCancellation()) return null
    return new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
  }

  private withCancellation<
    TPayload extends
      | TreeSitterParseDocumentRequest
      | TreeSitterEditDocumentRequest
      | TreeSitterRangeDocumentRequest,
  >(
    cancellationFlag: Int32Array | null,
    payload: TPayload,
  ): TPayload & { readonly generation: number; readonly cancellationBuffer?: SharedArrayBuffer } {
    const generation = this.nextGeneration
    this.nextGeneration += 1
    if (!cancellationFlag) return { ...payload, generation }
    return {
      ...payload,
      generation,
      cancellationBuffer: cancellationFlag.buffer as SharedArrayBuffer,
    }
  }

  private handleWorkerMessage(event: MessageEvent<TreeSitterWorkerResponse>): void {
    const response = event.data
    const pending = this.pendingRequests.get(response.id)
    if (!pending) return

    pending.cleanup()
    this.pendingRequests.delete(response.id)
    if (response.ok) {
      pending.resolve(response.result)
      return
    }

    pending.reject(new Error(response.error))
  }

  private handleWorkerError(failedWorker: Worker, event: ErrorEvent): void {
    if (failedWorker !== this.worker) return

    const error = new Error(event.message || 'Tree-sitter worker failed')
    failedWorker.terminate()
    this.worker = null
    this.lifecycle = 'crashed'
    this.lastError = error
    this.rejectPendingRequests(error)
    this.clearRetainedState('crashed')
  }

  private rejectPendingRequests(error: Error): void {
    for (const request of this.pendingRequests.values()) {
      request.cleanup()
      request.reject(error)
    }
    this.pendingRequests.clear()
  }

  private shouldRegisterLanguageWithWorker(language: TreeSitterLanguageDescriptor): boolean {
    return !sameLanguageRegistration(this.registeredLanguages.get(language.id), language)
  }

  private unregisteredLanguages(
    languages: readonly TreeSitterLanguageDescriptor[],
  ): readonly TreeSitterLanguageDescriptor[] {
    const nextLanguages: TreeSitterLanguageDescriptor[] = []
    const nextById = new Map<TreeSitterLanguageId, TreeSitterLanguageDescriptor>()

    for (const language of languages) {
      if (!this.shouldRegisterLanguageWithWorker(language)) continue
      if (sameLanguageRegistration(nextById.get(language.id), language)) continue

      nextById.set(language.id, language)
      nextLanguages.push(language)
    }

    return nextLanguages
  }

  private async connectSource(): Promise<DocumentSourceConnection | null> {
    const worker = await this.ensureWorkerReady()
    if (!worker) return null
    if (this.connection) return this.connection
    const generation = this.workerGeneration
    this.connection = {
      generation,
      nextRegistration: () => ++this.nextRegistration,
      send: async (command, signal) => {
        if (this.worker !== worker)
          return { kind: 'rejected', identity: command.identity, reason: 'generation' }
        const result = await this.trackClientTask(
          this.postRequest({ type: 'source', command }, false, signal),
        )
        return decodeDocumentWorkerReply(command, result)
      },
      release: (identity) => {
        if (this.worker !== worker) return
        worker.postMessage({
          id: this.nextRequestId++,
          payload: { type: 'source', command: { kind: 'release', identity } },
        })
      },
    }
    return this.connection
  }

  private trackClientTask<T>(task: Promise<T>): Promise<T> {
    this.clientTasks.add(task)
    void task.finally(() => this.clientTasks.delete(task)).catch(() => undefined)
    return task
  }

  private trackRuntimeTask<T>(runtimeSessionId: string, task: Promise<T>): Promise<T> {
    const tasks = this.runtimeTasks.get(runtimeSessionId) ?? new Set<Promise<unknown>>()
    tasks.add(task)
    this.runtimeTasks.set(runtimeSessionId, tasks)
    this.trackClientTask(task)
    void task
      .finally(() => {
        tasks.delete(task)
        if (tasks.size === 0) this.runtimeTasks.delete(runtimeSessionId)
      })
      .catch(() => undefined)
    return task
  }

  private async awaitClientTasks(): Promise<void> {
    while (this.clientTasks.size > 0) {
      await Promise.allSettled(this.clientTasks)
    }
  }

  private async awaitRuntimeTasks(runtimeSessionId: string): Promise<void> {
    while (this.runtimeTasks.has(runtimeSessionId)) {
      const tasks = this.runtimeTasks.get(runtimeSessionId)
      if (!tasks) return

      await Promise.allSettled(tasks)
    }
  }

  private clearRetainedState(lifecycle: TreeSitterWorkerLifecycleState): void {
    this.lifecycle = lifecycle
    this.initPromise = null
    this.registeredLanguages.clear()
    this.warmedLanguages.clear()
    this.connection = null
    this.nextRegistration = 0
  }
}

const backendBinding = Symbol('tree-sitter.backend')

export class TreeSitterWorkerOwner {
  readonly #backend: TreeSitterWorkerClient
  constructor(options: { readonly workerFactory?: () => Worker } = {}) {
    this.#backend = new TreeSitterWorkerClient(options)
  }
  [backendBinding](): TreeSitterBackend {
    return this.#backend
  }
  mergeUnit(payload: TreeSitterMergeUnitPayload): Promise<TreeSitterMergeUnitResult | undefined> {
    return this.#backend.mergeUnit(payload)
  }
  inspect(): TreeSitterWorkerOwnerSnapshot {
    return this.#backend.inspect()
  }
  awaitRuntimeSessionIdle(runtimeSessionId: string): Promise<void> {
    return this.#backend.awaitRuntimeSessionIdle(runtimeSessionId)
  }
  awaitIdleFence(): Promise<void> {
    return this.#backend.awaitIdleFence()
  }
  inspectRetention(): Promise<TreeSitterWorkerRetentionSnapshot | null> {
    return this.#backend.inspectRetention()
  }
  dispose(): Promise<void> {
    return this.#backend.dispose()
  }
}

export function createTreeSitterWorkerOwner(
  options: { readonly workerFactory?: () => Worker } = {},
): TreeSitterWorkerOwner {
  return new TreeSitterWorkerOwner(options)
}

export function treeSitterBackendForOwner(owner: TreeSitterWorkerOwner): TreeSitterBackend {
  return owner[backendBinding]()
}

// `wasmUrl` can be the grammar as a multi-megabyte data URL: it is compared by value, never
// serialised, and each descriptor's signature is computed once.
const languageSignatures = new WeakMap<TreeSitterLanguageDescriptor, string>()

function sameLanguageRegistration(
  registered: TreeSitterLanguageDescriptor | undefined,
  language: TreeSitterLanguageDescriptor,
): boolean {
  if (!registered) return false
  if (registered === language) return true
  if (registered.wasmUrl !== language.wasmUrl) return false
  return languageDescriptorSignature(registered) === languageDescriptorSignature(language)
}

function languageDescriptorSignature(language: TreeSitterLanguageDescriptor): string {
  const cached = languageSignatures.get(language)
  if (cached !== undefined) return cached

  const signature = JSON.stringify({
    aliases: sortedItems(language.aliases),
    extensions: sortedItems(language.extensions),
    foldQuerySource: language.foldQuerySource,
    highlightQuerySource: language.highlightQuerySource,
    id: language.id,
    injectionQuerySource: language.injectionQuerySource,
    mergeUnitQuerySource: language.mergeUnitQuerySource,
  })
  languageSignatures.set(language, signature)
  return signature
}

function sortedItems(items: readonly string[]): readonly string[] {
  return items.toSorted()
}

const runtimeSessionIdForPayload = (payload: TreeSitterWorkerRequestPayload): string | null => {
  if ('runtimeSessionId' in payload) return payload.runtimeSessionId
  return null
}

const cancellationFlagForPayload = (payload: TreeSitterWorkerRequestPayload): Int32Array | null => {
  if (!('cancellationBuffer' in payload)) return null
  if (!payload.cancellationBuffer) return null
  return new Int32Array(payload.cancellationBuffer)
}

const workerRequestError = (error: unknown): Error => {
  if (error instanceof Error) return error
  return new Error(String(error))
}

function markEditorWorkerRequest(
  family: string,
  type: string,
  runtimeSessionId: string | null,
): void {
  const traceGlobal = globalThis as typeof globalThis & { readonly __editorPerfTrace?: unknown }
  if (!traceGlobal.__editorPerfTrace) return

  globalThis.performance?.mark('editor.worker.request', {
    detail: { family, runtimeSessionId, type },
  })
}

const isTreeSitterParseResult = (result: TreeSitterWorkerResult): result is TreeSitterParseResult =>
  Boolean(result && 'captures' in result && 'folds' in result)

const isTreeSitterParseAckResult = (
  result: TreeSitterWorkerResult,
): result is TreeSitterParseAckResult =>
  Boolean(
    result && 'status' in result && (result.status === 'parsed' || result.status === 'cancelled'),
  )

const isTreeSitterRangeResult = (result: TreeSitterWorkerResult): result is TreeSitterRangeResult =>
  Boolean(result && 'range' in result && 'captures' in result && 'folds' in result)

const isTreeSitterSelectionResult = (
  result: TreeSitterWorkerResult,
): result is TreeSitterSelectionResult =>
  Boolean(result && 'status' in result && 'ranges' in result)
