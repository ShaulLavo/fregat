import { EditorEventSource } from './emitter'
import type {
  EditorTextBuffer,
} from '../documentSession'
import type { DocumentTextSnapshot } from '../documentTextSnapshot'
import type {
  EditorHighlighterProvider,
  EditorHighlighterRuntime,
  EditorHighlighterSession,
  EditorHighlightResult,
} from '../syntax/highlighter'
import type { EditorTokenInput } from '../syntax/tokenStore'
import {
  createEmptySyntaxResult,
  type EditorSyntaxProvider,
  type EditorSyntaxSession,
  type EditorSyntaxRuntime,
  type EditorSyntaxSessionOptions,
  type EditorSyntaxResult,
  type EditorSyntaxRange,
} from '../syntax/session'
import { DocumentDelivery, type DocumentRead, type DocumentContributionScope } from './documentDelivery'
import { EditorWorkScheduler } from './workScheduler'
import type { DocumentSyncPoint } from './editChain'
import { bindDocumentOperation, retainDocumentOperation, type DocumentOperation, type DocumentOperationHost, type DocumentOperationOptions, type DocumentContributionLease, type ContributionEntry } from './contributionOperation'
import type { EditorStructuralOperation, EditorHighlighterOperation } from '../document/operations'

type EditorAnalysisConfigurationTag = readonly (string | number | boolean | null)[]
export type EditorAnalysisDisplayDemand =
  | { readonly kind: 'unmanaged' }
  | { readonly kind: 'unknown' }
  | {
      readonly kind: 'frame' | 'preparation'
      readonly snapshot: DocumentTextSnapshot
      readonly ranges: readonly EditorSyntaxRange[]
    }
export type EditorAnalysisRangeInterest = { readonly signal?: AbortSignal }
type AnalysisDisplayInspection = {
  readonly unmanagedLeases: number
  readonly unknownLeases: number
  readonly frames: number
  readonly preparationLeases: number
  readonly preparationRanges: readonly EditorSyntaxRange[]
  readonly ranges: readonly EditorSyntaxRange[]
  readonly queryWaiters: number
  readonly queryRanges: readonly EditorSyntaxRange[]
}
type AnalysisRetentionEntry = {
  readonly family: 'structural' | 'highlighter'
  readonly runtimeSessionId: string
  readonly leaseCount: number
  readonly lastLeaseReleasedAt: number | null
  readonly revision: number
  readonly status: EditorAnalysisRead<unknown>['kind']
  readonly resultCount: number
  readonly tokenCount: number
  readonly cachedRangeCount: number
  readonly pendingRangeCount: number
  readonly syntaxRecordBackingBytes: number
  readonly displayDemand: AnalysisDisplayInspection
}
type AnalysisRetentionInspection = {
  readonly entries: readonly AnalysisRetentionEntry[]
  readonly syntaxRecordBackingBytes: number
  readonly unmeasuredBytes: readonly (
    | 'token-store-backing'
    | 'javascript-objects'
    | 'provider-sessions'
    | 'worker-heaps'
    | 'wasm'
  )[]
}
type AnalysisReclamationOptions = {
  readonly reason: 'inactive-budget' | 'speculative-abandoned'
  readonly runtimeSessionIds?: readonly string[]
}
type AnalysisReclamation = {
  readonly reason: AnalysisReclamationOptions['reason']
  readonly runtimeSessionIds: readonly string[]
  readonly cachedRangeCount: number
  readonly pendingRangeCount: number
}
type RetentionResult = {
  readonly tokens: EditorTokenInput
  readonly records?: EditorSyntaxResult['records']
}
export type EditorAnalysisRead<T> =
  | { readonly kind: 'pending'; readonly revision: number }
  | {
      readonly kind: 'ready'
      readonly revision: number
      readonly snapshot: DocumentTextSnapshot
      readonly result: T
    }
  | { readonly kind: 'failed'; readonly revision: number; readonly error: unknown }

export type EditorRetainedSyntaxSession = Omit<EditorSyntaxSession, 'queryRange'> & {
  readonly runtimeSessionId: string
  setDisplayDemand(demand: EditorAnalysisDisplayDemand): void
  queryRange(
    range: EditorSyntaxRange,
    interest?: EditorAnalysisRangeInterest,
  ): Promise<EditorSyntaxResult>
  read(range?: EditorSyntaxRange): EditorAnalysisRead<EditorSyntaxResult>
}
export type EditorRetainedHighlighterSession = EditorHighlighterSession & {
  readonly runtimeSessionId: string
  read(): EditorAnalysisRead<EditorHighlightResult>
}
export type EditorAnalysisStructuralRequest = Omit<
  EditorSyntaxSessionOptions,
  'documentId' | 'runtimeSessionId' | 'source' | 'initialRead'
> & {
  readonly provider: EditorSyntaxProvider
  readonly configurationTag?: EditorAnalysisConfigurationTag
  readonly signal?: AbortSignal
}
export type EditorAnalysisHighlighterRequest = {
  readonly provider: EditorHighlighterProvider
  readonly languageId: string | null
  readonly configurationTag?: EditorAnalysisConfigurationTag
  readonly signal?: AbortSignal
}

export type EditorStructuralContributionRequest = Omit<EditorAnalysisStructuralRequest, 'provider'> & {
  readonly structural: EditorStructuralOperation
  readonly range?: EditorSyntaxRange
}
export type EditorHighlighterContributionRequest = Omit<EditorAnalysisHighlighterRequest, 'provider'> & {
  readonly highlighter: EditorHighlighterOperation
}
export type EditorDocumentContributions = {
  retain<Input, Result, Entry extends ContributionEntry<Result>>(operation: DocumentOperation<Input, Result, Entry>, input: Input, options?: DocumentOperationOptions): DocumentContributionLease<Result> | null
  request<Input, Result, Entry extends ContributionEntry<Result>>(operation: DocumentOperation<Input, Result, Entry>, input: Input, options?: DocumentOperationOptions): Promise<Result | null>
}

export type EditorDocumentAnalysis = {
  readonly buffer: EditorTextBuffer
  readonly documentId: string
  readonly contributions: EditorDocumentContributions
  borrowStructural(request: EditorAnalysisStructuralRequest): EditorRetainedSyntaxSession | null
  borrowHighlighter(
    request: EditorAnalysisHighlighterRequest,
  ): EditorRetainedHighlighterSession | null
  inspectRetention(): AnalysisRetentionInspection
  reclaimInactive(options: AnalysisReclamationOptions): AnalysisReclamation
  dispose(): void
}

type AnalysisSession<T> = {
  analyze(read: DocumentRead): Promise<T>
  dispose(): void
}

export class AnalysisEntry<T> {
  readonly runtimeSessionId: string
  private readonly cancellation = new AbortController()
  private interests = 0
  private lastRelease: number | null = null
  private queuedPoint: DocumentSyncPoint | null = null
  private requests = 0
  private generation = 0
  private pendingInterest = new AbortController()
  private running = false
  private pending: {
    readonly read: DocumentRead
    readonly revision: number
    readonly generation: number
    readonly snapshot: DocumentTextSnapshot
    readonly settle: () => void
  } | null = null
  private completion: Promise<void> = Promise.resolve()
  private state: EditorAnalysisRead<T>

  constructor(
    readonly buffer: EditorTextBuffer,
    readonly session: AnalysisSession<T>,
    readonly delivery: DocumentDelivery,
    readonly sourceScope: DocumentContributionScope,
    readonly scheduler: EditorWorkScheduler,
    runtimeSessionId: string,
    private readonly scheduling: 'requested' | 'ordered' = 'requested',
  ) {
    this.runtimeSessionId = runtimeSessionId
    this.state = { kind: 'pending', revision: buffer.getRevision() }
    const read = delivery.current()
    if (read) this.enqueue(read)
  }

  get signal(): AbortSignal {
    return this.cancellation.signal
  }

  get leaseCount(): number {
    return this.interests
  }

  get lastLeaseReleasedAt(): number | null {
    return this.lastRelease
  }

  get cachedRangeCount(): number {
    return 0
  }

  get pendingRangeCount(): number {
    return 0
  }

  inspectDisplayDemand(): AnalysisDisplayInspection {
    return {
      unmanagedLeases: this.leaseCount,
      unknownLeases: 0,
      frames: 0,
      preparationLeases: 0,
      preparationRanges: [],
      ranges: [],
      queryWaiters: 0,
      queryRanges: [],
    }
  }

  retainedResults(): readonly T[] {
    return this.state.kind === 'ready' ? [this.state.result] : []
  }

  lease(signal?: AbortSignal) {
    const lease = leaseCancellation(this.signal, signal)
    if (lease.signal.aborted) return lease
    this.interests++
    lease.signal.addEventListener(
      'abort',
      () => {
        this.interests--
        this.lastRelease = Date.now()
      },
      { once: true },
    )
    return lease
  }

  read(): EditorAnalysisRead<T> {
    const revision = this.buffer.getRevision()
    if (this.cancellation.signal.aborted) return { kind: 'failed', revision, error: cancelled() }
    return this.queuedPoint === this.buffer.getDocumentSyncPoint() ? this.state : { kind: 'pending', revision }
  }

  changed(read: DocumentRead): void {
    if (read.revision.point === this.queuedPoint) return
    this.enqueue(read)
  }

  synchronize(): void {
    const read = this.delivery.current()
    if (!read || read.revision.point === this.queuedPoint) return
    this.changed(read)
  }

  refresh(): void {
    const read = this.delivery.current()
    if (read) this.enqueue(read)
  }

  async current(): Promise<T> {
    const point = this.buffer.getDocumentSyncPoint()
    const expectedGeneration = this.queuedPoint === point ? this.generation : null
    // Publication finishes before demand captures the corresponding analysis generation.
    await Promise.resolve()
    this.assertCurrent(point, expectedGeneration ?? this.generation)
    this.synchronize()
    const generation = this.generation
    this.requests++
    this.schedulePending()
    try {
      await interruptible(this.completion, this.pendingInterest.signal)
      this.assertCurrent(point, generation)
      const state = this.read()
      if (state.kind === 'ready') return state.result
      if (state.kind === 'failed') throw state.error
      throw cancelled()
    } finally {
      this.requests--
    }
  }

  async query(run: () => Promise<T>): Promise<T> {
    await this.current()
    const point = this.buffer.getDocumentSyncPoint()
    const generation = this.generation
    const interest = this.pendingInterest.signal
    this.assertCurrent(point, generation)
    const result = run()
    const value = await interruptible(interruptible(result, this.cancellation.signal), interest)
    this.assertCurrent(point, generation)
    return value
  }

  dispose(): void {
    if (this.cancellation.signal.aborted) return
    this.cancellation.abort()
    this.pendingInterest.abort()
    this.scheduler.cancel(this.runtimeSessionId, 'scope-released')
    this.pending?.settle()
    this.pending = null
    this.state = { kind: 'failed', revision: this.buffer.getRevision(), error: cancelled() }
    this.session.dispose()
    this.sourceScope.dispose()
  }

  private enqueue(read: DocumentRead): void {
    this.pendingInterest.abort()
    this.pendingInterest = new AbortController()
    const revision = read.revision.point.revision
    this.queuedPoint = read.revision.point
    const generation = ++this.generation
    this.state = { kind: 'pending', revision }
    this.pending?.settle()
    let settle = () => {}
    this.completion = new Promise<void>((resolve) => { settle = resolve })
    const snapshot = this.delivery.snapshot(read)
    if (!snapshot) { settle(); return }
    this.pending = { read, revision, generation, snapshot, settle }
    this.schedulePending()
  }

  private schedulePending(): void {
    if (this.running || !this.pending || this.cancellation.signal.aborted) return
    if (this.scheduling === 'requested' && this.requests === 0) return
    this.scheduler.schedule({
      key: this.runtimeSessionId,
      taskClass: 'background-derived',
      defer: true,
      run: () => this.runPending(),
    })
  }

  private async runPending(): Promise<void> {
    const demand = this.pending
    if (!demand || this.cancellation.signal.aborted) return
    this.pending = null
    this.running = true
    const { revision, generation, read, snapshot } = demand
    try {
      const result = await this.session.analyze(read)
      this.publish(read.revision.point, generation, { kind: 'ready', revision, snapshot, result })
    } catch (error) {
      this.publish(read.revision.point, generation, { kind: 'failed', revision, error })
    } finally {
      this.running = false
      demand.settle()
      this.schedulePending()
    }
  }

  private publish(point: DocumentSyncPoint, generation: number, state: EditorAnalysisRead<T>): void {
    if (
      this.cancellation.signal.aborted ||
      point !== this.buffer.getDocumentSyncPoint() ||
      generation !== this.generation
    )
      return
    this.state = state
  }

  private assertCurrent(point: DocumentSyncPoint, generation = this.generation): void {
    if (
      this.cancellation.signal.aborted ||
      point !== this.buffer.getDocumentSyncPoint() ||
      generation !== this.generation
    )
      throw cancelled()
  }
}

export class StructuralEntry extends AnalysisEntry<EditorSyntaxResult> {
  private readonly displayed = new Map<AbortSignal, EditorAnalysisDisplayDemand>()
  private readonly queryWaiters = new Map<
    AbortSignal,
    { snapshot: DocumentTextSnapshot; range: EditorSyntaxRange }
  >()
  private ranges = new Map<
    string,
    { revision: number; range: EditorSyntaxRange; result: EditorSyntaxResult }
  >()
  private queries = new Map<string, Promise<EditorSyntaxResult>>()
  private rangeRevision = -1

  constructor(
    buffer: EditorTextBuffer,
    readonly structuralSession: EditorSyntaxRuntime,
    delivery: DocumentDelivery,
    sourceScope: DocumentContributionScope,
    scheduler: EditorWorkScheduler,
    runtimeSessionId: string,
  ) {
    super(buffer, structuralSession, delivery, sourceScope, scheduler, runtimeSessionId, 'ordered')
  }

  canQueryRange(): boolean {
    return (
      this.structuralSession.queryRange !== undefined &&
      (this.structuralSession.canQueryRange?.() ?? true)
    )
  }

  registerDisplayDemand(signal: AbortSignal): void {
    if (signal.aborted) return
    this.displayed.set(signal, { kind: 'unmanaged' })
    signal.addEventListener('abort', () => this.displayed.delete(signal), { once: true })
  }

  setDisplayDemand(signal: AbortSignal, demand: EditorAnalysisDisplayDemand): void {
    if (signal.aborted) return
    const stored =
      demand.kind === 'frame' || demand.kind === 'preparation'
        ? {
            ...demand,
            ranges: demand.ranges.map((range) => boundedRange(range, demand.snapshot.length)),
          }
        : demand
    this.displayed.set(signal, stored)
  }

  override inspectDisplayDemand(): AnalysisDisplayInspection {
    let unmanagedLeases = 0
    let unknownLeases = 0
    let frames = 0
    let preparationLeases = 0
    const ranges: EditorSyntaxRange[] = []
    const preparationRanges: EditorSyntaxRange[] = []
    const snapshot = this.buffer.getTextSnapshot()
    for (const demand of this.displayed.values()) {
      if (demand.kind === 'unmanaged') {
        unmanagedLeases++
        continue
      }
      if (demand.kind === 'unknown' || demand.snapshot !== snapshot) {
        unknownLeases++
        continue
      }
      if (demand.kind === 'preparation') {
        preparationLeases++
        preparationRanges.push(...demand.ranges)
        continue
      }
      frames++
      ranges.push(...demand.ranges)
    }
    const queryRanges = [...this.queryWaiters.values()]
      .filter((waiter) => waiter.snapshot === snapshot)
      .map((waiter) => waiter.range)
    return {
      unmanagedLeases,
      unknownLeases,
      frames,
      preparationLeases,
      preparationRanges,
      ranges,
      queryWaiters: this.queryWaiters.size,
      queryRanges,
    }
  }

  waitForRange(range: EditorSyntaxRange, signal: AbortSignal): Promise<EditorSyntaxResult> {
    if (signal.aborted) return Promise.reject(cancelled())
    this.queryWaiters.set(signal, {
      snapshot: this.buffer.getTextSnapshot(),
      range: boundedRange(range, this.buffer.getTextSnapshot().length),
    })
    const release = () => this.queryWaiters.delete(signal)
    signal.addEventListener('abort', release, { once: true })
    return interruptible(this.range(range), signal).finally(() => {
      release()
      signal.removeEventListener('abort', release)
    })
  }

  override get cachedRangeCount(): number {
    return this.ranges.size
  }

  override get pendingRangeCount(): number {
    return this.queries.size
  }

  override retainedResults(): readonly EditorSyntaxResult[] {
    return [
      ...new Set([
        ...super.retainedResults(),
        ...[...this.ranges.values()].map((cached) => cached.result),
      ]),
    ]
  }

  override dispose(): void {
    this.displayed.clear()
    this.queryWaiters.clear()
    this.ranges.clear()
    this.queries.clear()
    super.dispose()
  }

  readRange(range?: EditorSyntaxRange): EditorAnalysisRead<EditorSyntaxResult> {
    const state = this.read()
    if (!range || state.kind !== 'ready') return state
    range = boundedRange(range, state.snapshot.length)
    const cached =
      this.ranges.get(rangeKey(range)) ??
      [...this.ranges.values()].find(
        (candidate) =>
          candidate.range.startIndex <= range.startIndex &&
          candidate.range.endIndex >= range.endIndex,
      )
    if (cached?.revision === state.revision) return { ...state, result: cached.result }
    if (!this.canQueryRange()) return state
    return { kind: 'pending', revision: state.revision }
  }

  range(range: EditorSyntaxRange): Promise<EditorSyntaxResult> {
    range = boundedRange(range, this.buffer.getTextSnapshot().length)
    if (!this.structuralSession.queryRange) return this.current()
    const state = this.readRange(range)
    if (state.kind === 'ready') return Promise.resolve(state.result)
    const revision = this.buffer.getRevision()
    const key = `${revision}:${rangeKey(range)}`
    const existing = this.queries.get(key)
    if (existing) return existing
    let queried = false
    const pending = this.query(() => {
      const current = this.readRange(range)
      if (current.kind === 'ready') return Promise.resolve(current.result)
      queried = true
      return this.structuralSession.queryRange?.(range) ?? this.current()
    }).then((result) => {
      if (queried && this.buffer.getRevision() === revision)
        this.ranges.set(rangeKey(range), { revision, range, result })
      return result
    })
    this.queries.set(key, pending)
    void pending.finally(() => this.queries.delete(key)).catch(() => undefined)
    return pending
  }

  override changed(read: DocumentRead): void {
    if (read.revision.point.revision <= this.rangeRevision) return
    this.rangeRevision = read.revision.point.revision
    this.ranges.clear()
    super.changed(read)
  }
}

export class HighlighterEntry extends AnalysisEntry<EditorHighlightResult> {
  private readonly themes = new EditorEventSource<void>({ action: 'document.highlighter.theme' })
  constructor(buffer: EditorTextBuffer, readonly highlighterSession: EditorHighlighterRuntime, delivery: DocumentDelivery, sourceScope: DocumentContributionScope, scheduler: EditorWorkScheduler, runtimeSessionId: string) {
    super(buffer, highlighterSession, delivery, sourceScope, scheduler, runtimeSessionId, 'ordered')
    const unsubscribe = highlighterSession.onDidChangeTheme?.(() => {
      this.refresh()
      this.themes.fire()
    })
    if (unsubscribe) this.signal.addEventListener('abort', unsubscribe, { once: true })
  }
  onDidChangeTheme(listener: () => void): () => void {
    const subscription = this.themes.subscribe(listener)
    return () => subscription.dispose()
  }
}

type AnalysisOwner = {
  readonly analysis: EditorDocumentAnalysis
  explicit: boolean
  views: number
}
const analysisOwners = new WeakMap<EditorTextBuffer, AnalysisOwner>()

export function createEditorDocumentAnalysis(options: {
  readonly buffer: EditorTextBuffer
  readonly documentId: string
}): EditorDocumentAnalysis {
  const existing = analysisOwners.get(options.buffer)
  if (existing) {
    existing.explicit = true
    return existing.analysis
  }
  const analysis = createAnalysis(options)
  analysisOwners.set(options.buffer, { analysis, explicit: true, views: 0 })
  return analysis
}

export function acquireEditorDocumentAnalysis(options: {
  readonly buffer: EditorTextBuffer
  readonly documentId: string
}): { readonly analysis: EditorDocumentAnalysis; dispose(): void } {
  let owner = analysisOwners.get(options.buffer)
  if (!owner) {
    owner = { analysis: createAnalysis(options), explicit: false, views: 0 }
    analysisOwners.set(options.buffer, owner)
  }
  owner.views++
  const retained = owner
  let disposed = false
  return {
    analysis: retained.analysis,
    dispose() {
      if (disposed) return
      disposed = true
      retained.views--
      if (!retained.explicit && retained.views === 0) retained.analysis.dispose()
    },
  }
}

function createAnalysis(options: {
  readonly buffer: EditorTextBuffer
  readonly documentId: string
}): EditorDocumentAnalysis {
  const { buffer, documentId } = options
  const delivery = new DocumentDelivery(buffer, documentId)
  const scheduler = new EditorWorkScheduler()
  const lifecycle = new AbortController()
  const entries = new Set<ContributionEntry<unknown>>()
  let unsubscribe: (() => void) | undefined
  const releaseSubscription = () => {
    if (entries.size > 0) return
    unsubscribe?.()
    unsubscribe = undefined
  }
  const host: DocumentOperationHost = {
    buffer, documentId, delivery, scheduler, signal: lifecycle.signal,
    subscribe() {
      unsubscribe ??= buffer.subscribe(event => {
        const read = delivery.accept(event)
        if (!read) return
        for (const entry of entries) entry.changed(read)
      })
    },
    releaseIdleSubscription: releaseSubscription,
    adopt(entry) {
      if (lifecycle.signal.aborted) { entry.dispose(); return }
      entries.add(entry)
      entry.signal.addEventListener('abort', () => { entries.delete(entry); releaseSubscription() }, { once: true })
    },
  }
  const analysis: EditorDocumentAnalysis = {
    buffer, documentId,
    contributions: contributions(host),
    borrowStructural(request) {
      if (lifecycle.signal.aborted || request.signal?.aborted) return null
      const entry = bindDocumentOperation(request.provider.operation, host, {
        languageId: request.languageId, includeCaptures: request.includeCaptures,
        includeHighlights: request.includeHighlights, syntaxMode: request.syntaxMode,
      }, request)
      return entry ? structuralLease(entry, request.signal) : null
    },
    borrowHighlighter(request) {
      if (lifecycle.signal.aborted || request.signal?.aborted) return null
      const input = { languageId: request.languageId }
      let entry = bindDocumentOperation(request.provider.operation, host, input, request)
      if (entry?.read().kind === 'failed' && entry.leaseCount === 0) {
        entry.dispose()
        entry = bindDocumentOperation(request.provider.operation, host, input, request)
      }
      return entry ? highlighterLease(entry, entry.highlighterSession, request.signal) : null
    },
    inspectRetention() {
      const records = new Set<ArrayBufferLike>()
      const retained = []
      for (const entry of entries) {
        if (entry instanceof StructuralEntry) retained.push(inspectEntry('structural', entry, records))
        if (entry instanceof HighlighterEntry) retained.push(inspectEntry('highlighter', entry, records))
      }
      return { entries: retained, syntaxRecordBackingBytes: backingBytes(records), unmeasuredBytes: ['token-store-backing', 'javascript-objects', 'provider-sessions', 'worker-heaps', 'wasm'] }
    },
    reclaimInactive(options) {
      const requested = options.runtimeSessionIds ? new Set(options.runtimeSessionIds) : null
      const runtimeSessionIds: string[] = []
      let cachedRangeCount = 0
      let pendingRangeCount = 0
      for (const entry of Array.from(entries)) {
        if (entry.leaseCount > 0 || (requested && !requested.has(entry.runtimeSessionId))) continue
        runtimeSessionIds.push(entry.runtimeSessionId)
        if (entry instanceof StructuralEntry) { cachedRangeCount += entry.cachedRangeCount; pendingRangeCount += entry.pendingRangeCount }
        entries.delete(entry)
        entry.dispose()
      }
      releaseSubscription()
      return { reason: options.reason, runtimeSessionIds, cachedRangeCount, pendingRangeCount }
    },
    dispose() {
      if (lifecycle.signal.aborted) return
      lifecycle.abort()
      if (analysisOwners.get(buffer)?.analysis === analysis) analysisOwners.delete(buffer)
      const owned = Array.from(entries)
      entries.clear()
      unsubscribe?.()
      unsubscribe = undefined
      for (const entry of owned) entry.dispose()
      scheduler.dispose()
      void delivery.dispose().catch(() => undefined)
    },
  }
  return analysis
}

function contributions(host: DocumentOperationHost): EditorDocumentContributions {
  function retain<Input, Result, Entry extends ContributionEntry<Result>>(operation: DocumentOperation<Input, Result, Entry>, input: Input, options?: DocumentOperationOptions): DocumentContributionLease<Result> | null {
    return retainDocumentOperation(operation, host, input, options)
  }
  async function request<Input, Result, Entry extends ContributionEntry<Result>>(operation: DocumentOperation<Input, Result, Entry>, input: Input, options?: DocumentOperationOptions): Promise<Result | null> {
    const lease = retain(operation, input, options)
    if (!lease) return null
    try { return await lease.request() }
    finally { lease.dispose() }
  }
  return { retain, request }
}

function inspectEntry(
  family: AnalysisRetentionEntry['family'],
  entry: AnalysisEntry<RetentionResult>,
  sharedRecords: Set<ArrayBufferLike>,
): AnalysisRetentionEntry {
  const results = new Set(entry.retainedResults())
  const tokens = new Set<EditorTokenInput>()
  const records = new Set<ArrayBufferLike>()
  for (const result of results) {
    tokens.add(result.tokens)
    const backing = result.records?.data.buffer
    if (!backing) continue
    records.add(backing)
    sharedRecords.add(backing)
  }
  const state = entry.read()
  return {
    family,
    runtimeSessionId: entry.runtimeSessionId,
    leaseCount: entry.leaseCount,
    lastLeaseReleasedAt: entry.lastLeaseReleasedAt,
    revision: state.revision,
    status: state.kind,
    resultCount: results.size,
    tokenCount: [...tokens].reduce((count, input) => count + input.length, 0),
    cachedRangeCount: entry.cachedRangeCount,
    pendingRangeCount: entry.pendingRangeCount,
    syntaxRecordBackingBytes: backingBytes(records),
    displayDemand: entry.inspectDisplayDemand(),
  }
}

function backingBytes(buffers: ReadonlySet<ArrayBufferLike>): number {
  let total = 0
  for (const buffer of buffers) total += buffer.byteLength
  return total
}

function structuralLease(
  entry: StructuralEntry,
  signal?: AbortSignal,
): EditorRetainedSyntaxSession {
  const lease = entry.lease(signal)
  entry.registerDisplayDemand(lease.signal)
  let demand: EditorSyntaxRange | undefined
  const result = () => (demand ? entry.range(demand) : entry.current())
  const current = () => lease.wait(result)
  return {
    runtimeSessionId: entry.runtimeSessionId,
    setDisplayDemand: (demand) => entry.setDisplayDemand(lease.signal, demand),
    get foldingSupport() {
      return entry.structuralSession.foldingSupport
    },
    refresh: () =>
      lease.wait(() => {
        if (entry.read().kind === 'failed') entry.refresh()
        return result()
      }),
    applyChange: current,
    canQueryRange: () => entry.read().kind === 'ready' && entry.canQueryRange(),
    queryRange(range, interest = {}) {
      demand = range
      const waiter = leaseCancellation(lease.signal, interest.signal)
      return entry.waitForRange(range, waiter.signal).finally(waiter.dispose)
    },
    getResult: () => {
      const state = entry.readRange(demand)
      return state.kind === 'ready' ? state.result : createEmptySyntaxResult()
    },
    getTokens: () => {
      const state = entry.readRange(demand)
      return state.kind === 'ready' ? state.result.tokens : []
    },
    getSnapshotVersion: () => entry.structuralSession.getSnapshotVersion(),
    read: (range) =>
      lease.signal.aborted
        ? { kind: 'failed', revision: entry.buffer.getRevision(), error: cancelled() }
        : entry.readRange(range ?? demand),
    dispose: lease.dispose,
  }
}

function highlighterLease(
  entry: HighlighterEntry,
  session: EditorHighlighterRuntime,
  signal?: AbortSignal,
): EditorRetainedHighlighterSession {
  const lease = entry.lease(signal)
  return {
    runtimeSessionId: entry.runtimeSessionId,
    refresh: () =>
      lease.wait(() => {
        if (entry.read().kind === 'failed') entry.refresh()
        return entry.current()
      }),
    applyChange: () => lease.wait(() => entry.current()),
    onDidChangeTheme: session.onDidChangeTheme
      ? (listener) => {
          if (lease.signal.aborted) return
          const unsubscribe = entry.onDidChangeTheme(listener)
          if (!unsubscribe) return
          const release = () => {
            unsubscribe?.()
            lease.signal.removeEventListener('abort', release)
          }
          lease.signal.addEventListener('abort', release, { once: true })
          return release
        }
      : undefined,
    read: () =>
      lease.signal.aborted
        ? { kind: 'failed', revision: entry.buffer.getRevision(), error: cancelled() }
        : entry.read(),
    dispose: lease.dispose,
  }
}

function leaseCancellation(ownerSignal: AbortSignal, signal?: AbortSignal) {
  const controller = new AbortController()
  const dispose = () => {
    controller.abort()
    ownerSignal.removeEventListener('abort', dispose)
    signal?.removeEventListener('abort', dispose)
  }
  ownerSignal.addEventListener('abort', dispose, { once: true })
  signal?.addEventListener('abort', dispose, { once: true })
  if (ownerSignal.aborted || signal?.aborted) dispose()
  return {
    signal: controller.signal,
    dispose,
    wait: <T>(run: () => Promise<T>) =>
      controller.signal.aborted
        ? Promise.reject<T>(cancelled())
        : interruptible(run(), controller.signal),
  }
}

function interruptible<T>(result: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void result.catch(() => undefined)
    return Promise.reject(cancelled())
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(cancelled())
    signal.addEventListener('abort', abort, { once: true })
    void result.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

function cancelled(): DOMException {
  return new DOMException('Document analysis was superseded or released', 'AbortError')
}
function rangeKey(range: EditorSyntaxRange): string {
  return `${range.startIndex}:${range.endIndex}`
}
function boundedRange(range: EditorSyntaxRange, length: number): EditorSyntaxRange {
  const startIndex = Math.max(0, Math.min(length, range.startIndex))
  return { startIndex, endIndex: Math.max(startIndex, Math.min(length, range.endIndex)) }
}
