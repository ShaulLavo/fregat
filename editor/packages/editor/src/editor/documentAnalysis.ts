import type {
  DocumentSessionChange,
  EditorTextBuffer,
  EditorTextBufferChange,
} from '../documentSession'
import type { DocumentTextSnapshot } from '../documentTextSnapshot'
import { EditorEventSource } from './emitter'
import type {
  EditorHighlighterProvider,
  EditorHighlighterSession,
  EditorHighlightResult,
} from '../syntax/highlighter'
import type { EditorTokenInput } from '../syntax/tokenStore'
import {
  createEditorRuntimeSessionId,
  createEmptySyntaxResult,
  type EditorSyntaxProvider,
  type EditorSyntaxSession,
  type EditorSyntaxSessionOptions,
  type EditorSyntaxResult,
  type EditorSyntaxRange,
} from '../syntax/session'

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
  'documentId' | 'runtimeSessionId' | 'snapshot' | 'textSnapshot'
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

export type EditorDocumentAnalysis = {
  readonly buffer: EditorTextBuffer
  readonly documentId: string
  borrowStructural(request: EditorAnalysisStructuralRequest): EditorRetainedSyntaxSession | null
  borrowHighlighter(
    request: EditorAnalysisHighlighterRequest,
  ): EditorRetainedHighlighterSession | null
  subscribeRetention(listener: () => void): () => void
  inspectRetention(): AnalysisRetentionInspection
  reclaimInactive(options: AnalysisReclamationOptions): AnalysisReclamation
  dispose(): void
}

type AnalysisSession<T> = {
  refresh(snapshot: DocumentTextSnapshot): Promise<T>
  applyChange(change: DocumentSessionChange): Promise<T>
  dispose(): void
}

class RetentionChanges {
  private readonly events = new EditorEventSource<void>({
    action: 'editor.analysis.retention_listener_failed',
  })
  private readonly subscriptions = new Set<() => void>()
  private depth = 0
  private pending = false
  private delivering = false
  private disposed = false

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => undefined
    const subscription = this.events.subscribe(() => {
      if (!this.disposed) listener()
    })
    const release = () => {
      subscription.dispose()
      this.subscriptions.delete(release)
    }
    this.subscriptions.add(release)
    return release
  }

  mutate<T>(run: () => T): T {
    this.depth++
    try {
      return run()
    } finally {
      this.depth--
      this.flush()
    }
  }

  changed(): void {
    this.pending = true
    this.flush()
  }

  dispose(): void {
    this.disposed = true
    this.pending = false
    for (const release of this.subscriptions) release()
  }

  private flush(): void {
    if (this.disposed || this.depth > 0 || this.delivering || !this.pending) return
    this.pending = false
    this.delivering = true
    try {
      this.events.fire()
    } finally {
      // Reentrant mutations belong to this delivery; hosts reconcile after their callback.
      this.pending = false
      this.delivering = false
    }
  }
}

class AnalysisEntry<T extends RetentionResult> {
  readonly runtimeSessionId: string
  private readonly cancellation = new AbortController()
  private interests = 0
  private lastRelease: number | null = null
  protected queuedRevision = -1
  protected generation = 0
  private pendingInterest = new AbortController()
  private tail: Promise<void> = Promise.resolve()
  private state: EditorAnalysisRead<T>

  constructor(
    readonly buffer: EditorTextBuffer,
    readonly session: AnalysisSession<T>,
    runtimeSessionId: string,
    readonly retention: RetentionChanges,
  ) {
    this.runtimeSessionId = runtimeSessionId
    this.state = { kind: 'pending', revision: buffer.getRevision() }
    this.synchronize()
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
    const lease = leaseCancellation(this.signal, this.retention, signal)
    if (lease.signal.aborted) return lease
    this.interests++
    lease.signal.addEventListener(
      'abort',
      () => {
        this.interests--
        this.lastRelease = Date.now()
        this.retention.changed()
      },
      { once: true },
    )
    this.retention.changed()
    return lease
  }

  read(): EditorAnalysisRead<T> {
    const revision = this.buffer.getRevision()
    if (this.cancellation.signal.aborted) return { kind: 'failed', revision, error: cancelled() }
    return this.state.revision === revision ? this.state : { kind: 'pending', revision }
  }

  changed(event: EditorTextBufferChange): void {
    if (event.revisionAfter <= this.queuedRevision) return
    this.enqueue(
      event.revisionAfter,
      () => this.session.applyChange(event.change),
      event.change.textSnapshot,
    )
  }

  synchronize(): void {
    const revision = this.buffer.getRevision()
    if (revision === this.queuedRevision) return
    const snapshot = this.buffer.getTextSnapshot()
    this.enqueue(revision, () => this.session.refresh(snapshot))
  }

  refresh(): void {
    const snapshot = this.buffer.getTextSnapshot()
    this.enqueue(this.buffer.getRevision(), () => this.session.refresh(snapshot))
  }

  async current(): Promise<T> {
    const revision = this.buffer.getRevision()
    const expectedGeneration = this.queuedRevision === revision ? this.generation : null
    // Synchronous publication must enqueue its captured changes before a read repairs the head.
    await Promise.resolve()
    this.assertCurrent(revision, expectedGeneration ?? this.generation)
    this.synchronize()
    const generation = this.generation
    await interruptible(this.tail, this.pendingInterest.signal)
    this.assertCurrent(revision, generation)
    const state = this.read()
    if (state.kind === 'ready') return state.result
    if (state.kind === 'failed') throw state.error
    throw cancelled()
  }

  async query(run: () => Promise<T>): Promise<T> {
    await this.current()
    const revision = this.buffer.getRevision()
    const generation = this.generation
    const interest = this.pendingInterest.signal
    const result = this.tail.then(() => {
      this.assertCurrent(revision, generation)
      return run()
    })
    this.tail = result.then(
      () => undefined,
      () => undefined,
    )
    const value = await interruptible(interruptible(result, this.cancellation.signal), interest)
    this.assertCurrent(revision, generation)
    return value
  }

  dispose(): void {
    if (this.cancellation.signal.aborted) return
    this.cancellation.abort()
    this.pendingInterest.abort()
    this.state = { kind: 'failed', revision: this.buffer.getRevision(), error: cancelled() }
    this.session.dispose()
  }

  private enqueue(
    revision: number,
    run: () => Promise<T>,
    snapshot = this.buffer.getTextSnapshot(),
  ): void {
    this.pendingInterest.abort()
    this.pendingInterest = new AbortController()
    this.queuedRevision = revision
    const generation = ++this.generation
    this.state = { kind: 'pending', revision }
    const result = this.tail.then(() => {
      if (this.cancellation.signal.aborted) throw cancelled()
      return run()
    })
    this.tail = interruptible(result, this.cancellation.signal).then(
      (value) =>
        this.publish(revision, generation, { kind: 'ready', revision, snapshot, result: value }),
      (error: unknown) => this.publish(revision, generation, { kind: 'failed', revision, error }),
    )
    this.retention.changed()
  }

  private publish(revision: number, generation: number, state: EditorAnalysisRead<T>): void {
    if (
      this.cancellation.signal.aborted ||
      revision !== this.buffer.getRevision() ||
      generation !== this.generation
    )
      return
    this.state = state
    this.retention.changed()
  }

  private assertCurrent(revision: number, generation = this.generation): void {
    if (
      this.cancellation.signal.aborted ||
      revision !== this.buffer.getRevision() ||
      generation !== this.generation
    )
      throw cancelled()
  }
}

type RetainedRangeContributor = {
  readonly range: EditorSyntaxRange
  readonly result: EditorSyntaxResult
}
type ReadyRange = RetainedRangeContributor & { readonly revision: number }
type PendingRangeQuery = {
  readonly snapshot: DocumentTextSnapshot
  readonly revision: number
  readonly range: EditorSyntaxRange
  readonly promise: Promise<EditorSyntaxResult>
  admission: 'cache' | 'return-only'
  work:
    | { readonly kind: 'queued'; readonly generation: number | null }
    | { readonly kind: 'running'; readonly generation: number }
}

const structuralLeaseOwners = new WeakMap<
  EditorRetainedSyntaxSession,
  { readonly entry: StructuralEntry; readonly signal: AbortSignal }
>()

export function setRetainedSyntaxDisplayDemand(
  session: EditorRetainedSyntaxSession,
  demand: EditorAnalysisDisplayDemand,
  contributors: readonly RetainedRangeContributor[] | null,
  discarded: readonly RetainedRangeContributor[] | null = null,
): void {
  const owner = structuralLeaseOwners.get(session)
  owner?.entry.setContributors(owner.signal, contributors)
  session.setDisplayDemand(demand)
  if (discarded) owner?.entry.retireOptionalContributors(owner.signal, discarded)
}

export function retainedSyntaxCanWarm(session: EditorRetainedSyntaxSession): boolean {
  const owner = structuralLeaseOwners.get(session)
  return owner !== undefined && owner.entry.canWarm(owner.signal)
}

class StructuralEntry extends AnalysisEntry<EditorSyntaxResult> {
  private readonly displayed = new Map<AbortSignal, EditorAnalysisDisplayDemand>()
  private readonly queryWaiters = new Map<
    AbortSignal,
    { snapshot: DocumentTextSnapshot; range: EditorSyntaxRange }
  >()
  private readonly contributors = new Map<AbortSignal, readonly RetainedRangeContributor[]>()
  private readonly resultOrigins = new WeakMap<
    EditorSyntaxResult,
    {
      readonly snapshot: DocumentTextSnapshot
      readonly revision: number
      readonly generation: number
    }
  >()
  private ranges = new Map<string, ReadyRange>()
  private queries = new Map<string, PendingRangeQuery>()
  private rangeRevision = -1
  private stoppedWarmGeneration: number | null = null

  constructor(
    buffer: EditorTextBuffer,
    readonly structuralSession: EditorSyntaxSession,
    runtimeSessionId: string,
    retention: RetentionChanges,
  ) {
    super(buffer, structuralSession, runtimeSessionId, retention)
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
    signal.addEventListener(
      'abort',
      () => {
        this.displayed.delete(signal)
        this.contributors.delete(signal)
        this.trimOptionalRanges()
        this.retention.changed()
      },
      { once: true },
    )
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
    this.trimOptionalRanges()
    this.retention.changed()
  }

  setContributors(
    signal: AbortSignal,
    contributors: readonly RetainedRangeContributor[] | null,
  ): void {
    if (signal.aborted) return
    if (contributors) this.contributors.set(signal, contributors)
    else this.contributors.delete(signal)
  }

  canWarm(signal: AbortSignal): boolean {
    if (signal.aborted || this.signal.aborted) return false
    return this.stoppedWarmGeneration !== this.generation
  }

  retireOptionalContributors(
    signal: AbortSignal,
    discarded: readonly RetainedRangeContributor[],
  ): void {
    if (signal.aborted || this.signal.aborted) return
    const protection = this.rangeProtection()
    if (protection.fullyPinned) return
    const snapshot = this.buffer.getTextSnapshot()
    const revision = this.buffer.getRevision()
    const retired = discarded.some((contributor) => {
      const origin = this.resultOrigins.get(contributor.result)
      if (
        origin?.snapshot !== snapshot ||
        origin.revision !== revision ||
        origin.generation !== this.generation
      )
        return false
      if (protection.intervals.some((range) => rangesIntersect(range, contributor.range)))
        return false
      return ![...protection.protectedSlots].some(
        (cached) =>
          cached.result === contributor.result && rangeContains(cached.range, contributor.range),
      )
    })
    if (retired) this.stoppedWarmGeneration = this.generation
  }

  private rangeProtection() {
    const snapshot = this.buffer.getTextSnapshot()
    const intervals: EditorSyntaxRange[] = []
    const protectedSlots = new Set<ReadyRange>()
    let fullyPinned = false
    for (const [signal, demand] of this.displayed) {
      if (
        demand.kind === 'unknown' ||
        demand.kind === 'unmanaged' ||
        demand.snapshot !== snapshot
      ) {
        fullyPinned = true
        break
      }
      intervals.push(...demand.ranges)
      const contributors = this.contributors.get(signal)
      if (contributors) this.protectContributors(contributors, protectedSlots)
      if (!contributors || demand.kind === 'preparation')
        this.protectIntersecting(demand.ranges, protectedSlots)
      this.protectLookup(demand.ranges, protectedSlots)
    }
    for (const waiter of this.queryWaiters.values()) {
      if (waiter.snapshot !== snapshot) continue
      intervals.push(waiter.range)
      this.protectLookup([waiter.range], protectedSlots)
    }
    return { intervals, protectedSlots, fullyPinned }
  }

  private trimOptionalRanges(): void {
    const { intervals, protectedSlots, fullyPinned } = this.rangeProtection()
    for (const query of this.queries.values()) {
      query.admission =
        fullyPinned || intervals.some((range) => rangesIntersect(range, query.range))
          ? 'cache'
          : 'return-only'
    }
    if (fullyPinned || this.displayed.size === 0) return
    for (const [key, cached] of this.ranges) {
      if (!protectedSlots.has(cached)) this.ranges.delete(key)
    }
  }

  private protectContributors(
    contributors: readonly RetainedRangeContributor[],
    protectedSlots: Set<ReadyRange>,
  ): void {
    for (const contributor of contributors) this.protectContributor(contributor, protectedSlots)
  }

  private protectContributor(
    contributor: RetainedRangeContributor,
    protectedSlots: Set<ReadyRange>,
  ): void {
    const snapshot = this.buffer.getTextSnapshot()
    const origin = this.resultOrigins.get(contributor.result)
    let cached = this.ranges.get(rangeKey(contributor.range))
    if (cached?.result !== contributor.result) cached = undefined
    cached ??= [...this.ranges.values()].find(
      (candidate) =>
        candidate.result === contributor.result &&
        rangeContains(candidate.range, contributor.range),
    )
    if (
      !cached &&
      origin?.snapshot === snapshot &&
      origin.revision === this.buffer.getRevision() &&
      origin.generation === this.generation
    ) {
      cached = { ...contributor, revision: origin.revision }
      this.ranges.set(rangeKey(contributor.range), cached)
    }
    if (cached) protectedSlots.add(cached)
  }

  private protectIntersecting(
    ranges: readonly EditorSyntaxRange[],
    protectedSlots: Set<ReadyRange>,
  ): void {
    for (const cached of this.ranges.values()) {
      if (
        ranges.some(
          (range) =>
            rangesIntersect(range, cached.range) || foldResultIntersects(cached.result, range),
        )
      )
        protectedSlots.add(cached)
    }
  }

  private protectLookup(
    ranges: readonly EditorSyntaxRange[],
    protectedSlots: Set<ReadyRange>,
  ): void {
    for (const range of ranges) {
      if ([...protectedSlots].some((cached) => rangeContains(cached.range, range))) continue
      const cached =
        this.ranges.get(rangeKey(range)) ??
        [...this.ranges.values()].find((candidate) => rangeContains(candidate.range, range))
      if (cached) protectedSlots.add(cached)
    }
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
    const release = () => {
      if (!this.queryWaiters.delete(signal)) return
      this.trimOptionalRanges()
      this.retention.changed()
    }
    signal.addEventListener('abort', release, { once: true })
    const pending = interruptible(this.range(range), signal)
    this.retention.changed()
    return pending.finally(() => {
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
    this.stoppedWarmGeneration = null
    this.displayed.clear()
    this.contributors.clear()
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
    const generation = this.queuedRevision === revision ? this.generation : null
    const key = `${revision}:${generation ?? 'publication'}:${rangeKey(range)}`
    const existing = [...this.queries.values()].find((query) =>
      this.compatibleQuery(query, revision, range),
    )
    if (existing) {
      this.trimOptionalRanges()
      return existing.promise
    }
    let queried = false
    const pending: PendingRangeQuery = {
      snapshot: this.buffer.getTextSnapshot(),
      revision,
      range,
      admission: 'cache',
      work: { kind: 'queued', generation },
      promise: this.query(() => {
        pending.work = { kind: 'running', generation: this.generation }
        const current = this.readRange(range)
        if (current.kind === 'ready') return Promise.resolve(current.result)
        queried = true
        return this.structuralSession.queryRange?.(range) ?? this.current()
      }).then((result) => {
        if (queried && this.canAdmitRange(key, pending)) {
          this.resultOrigins.set(result, {
            snapshot: pending.snapshot,
            revision,
            generation: this.generation,
          })
          this.ranges.set(rangeKey(range), { revision, range, result })
        }
        this.retention.changed()
        return result
      }),
    }
    this.queries.set(key, pending)
    this.trimOptionalRanges()
    this.retention.changed()
    void pending.promise
      .finally(() => {
        if (this.queries.get(key) !== pending) return
        this.queries.delete(key)
        this.retention.changed()
      })
      .catch(() => undefined)
    return pending.promise
  }

  private compatibleQuery(
    query: PendingRangeQuery,
    revision: number,
    range: EditorSyntaxRange,
  ): boolean {
    return (
      query.revision === revision &&
      query.snapshot === this.buffer.getTextSnapshot() &&
      rangeKey(query.range) === rangeKey(range) &&
      (query.work.generation === null || query.work.generation === this.generation)
    )
  }

  private canAdmitRange(key: string, query: PendingRangeQuery): boolean {
    return (
      !this.signal.aborted &&
      this.queries.get(key) === query &&
      query.admission === 'cache' &&
      query.work.kind === 'running' &&
      query.work.generation === this.generation &&
      query.revision === this.buffer.getRevision() &&
      query.snapshot === this.buffer.getTextSnapshot()
    )
  }

  override changed(event: EditorTextBufferChange): void {
    if (event.revisionAfter <= this.rangeRevision) return
    this.rangeRevision = event.revisionAfter
    this.ranges.clear()
    super.changed(event)
  }
}

export function createEditorDocumentAnalysis(options: {
  readonly buffer: EditorTextBuffer
  readonly documentId: string
}): EditorDocumentAnalysis {
  const { buffer, documentId } = options
  const structural: { request: EditorAnalysisStructuralRequest; entry: StructuralEntry }[] = []
  const highlighters: {
    request: EditorAnalysisHighlighterRequest
    entry: AnalysisEntry<EditorHighlightResult>
    session: EditorHighlighterSession
    unsubscribeTheme: (() => void) | void
  }[] = []
  const retention = new RetentionChanges()
  let disposed = false
  let unsubscribe: (() => void) | undefined
  const subscribe = () => {
    unsubscribe ??= buffer.subscribe((event) =>
      retention.mutate(() => {
        for (const { entry } of structural) entry.changed(event)
        for (const { entry } of highlighters) entry.changed(event)
      }),
    )
  }
  const releaseSubscription = () => {
    if (structural.length > 0 || highlighters.length > 0) return
    unsubscribe?.()
    unsubscribe = undefined
  }
  const borrowStructural = (request: EditorAnalysisStructuralRequest) => {
    if (disposed || request.signal?.aborted) return null
    let found = structural.find((candidate) => sameStructuralRequest(candidate.request, request))
    subscribe()
    if (!found) {
      const runtimeSessionId = createEditorRuntimeSessionId()
      const session = request.provider.createSession({
        ...request,
        documentId,
        runtimeSessionId,
        snapshot: buffer.getSnapshot(),
        textSnapshot: buffer.getTextSnapshot(),
      })
      if (!session) return null
      if (disposed || request.signal?.aborted) {
        try {
          session.dispose()
        } finally {
          releaseSubscription()
        }
        return null
      }
      found = {
        request: {
          ...request,
          signal: undefined,
          configurationTag: [...(request.configurationTag ?? [])],
        },
        entry: new StructuralEntry(buffer, session, runtimeSessionId, retention),
      }
      structural.push(found)
    }
    return structuralLease(found.entry, request.signal)
  }
  const borrowHighlighter = (request: EditorAnalysisHighlighterRequest) => {
    if (disposed || request.signal?.aborted) return null
    let found = highlighters.find((candidate) => sameRequest(candidate.request, request))
    if (found?.entry.read().kind === 'failed' && found.entry.leaseCount === 0) {
      const failed = found
      highlighters.splice(highlighters.indexOf(failed), 1)
      retention.changed()
      failed.unsubscribeTheme?.()
      failed.entry.dispose()
      if (disposed || request.signal?.aborted) return null
      found = highlighters.find((candidate) => sameRequest(candidate.request, request))
    }
    subscribe()
    if (!found) {
      const runtimeSessionId = createEditorRuntimeSessionId()
      const session = request.provider.createSession({
        languageId: request.languageId,
        documentId,
        runtimeSessionId,
        snapshot: buffer.getSnapshot(),
        textSnapshot: buffer.getTextSnapshot(),
      })
      if (!session) return null
      if (disposed || request.signal?.aborted) {
        try {
          session.dispose()
        } finally {
          releaseSubscription()
        }
        return null
      }
      const entry = new AnalysisEntry(buffer, session, runtimeSessionId, retention)
      found = {
        request: {
          ...request,
          signal: undefined,
          configurationTag: [...(request.configurationTag ?? [])],
        },
        session,
        entry,
        unsubscribeTheme: undefined,
      }
      highlighters.push(found)
      const unsubscribeTheme = session.onDidChangeTheme?.(() => entry.refresh())
      if (disposed || entry.signal.aborted) {
        unsubscribeTheme?.()
        entry.dispose()
        releaseSubscription()
        return null
      }
      found.unsubscribeTheme = unsubscribeTheme
    }
    return highlighterLease(found.entry, found.session, request.signal)
  }
  const reclaimInactive = (options: AnalysisReclamationOptions): AnalysisReclamation => {
    const requested = options.runtimeSessionIds ? new Set(options.runtimeSessionIds) : null
    const reclaimed: string[] = []
    let cachedRangeCount = 0
    let pendingRangeCount = 0
    try {
      for (const retained of structural.slice()) {
        const { entry } = retained
        if (entry.leaseCount > 0 || (requested && !requested.has(entry.runtimeSessionId))) continue
        const index = structural.indexOf(retained)
        if (index < 0) continue
        structural.splice(index, 1)
        retention.changed()
        reclaimed.push(entry.runtimeSessionId)
        cachedRangeCount += entry.cachedRangeCount
        pendingRangeCount += entry.pendingRangeCount
        entry.dispose()
      }
      for (const retained of highlighters.slice()) {
        const { entry, unsubscribeTheme } = retained
        if (entry.leaseCount > 0 || (requested && !requested.has(entry.runtimeSessionId))) continue
        const index = highlighters.indexOf(retained)
        if (index < 0) continue
        highlighters.splice(index, 1)
        retention.changed()
        reclaimed.push(entry.runtimeSessionId)
        unsubscribeTheme?.()
        entry.dispose()
      }
    } finally {
      releaseSubscription()
    }
    return {
      reason: options.reason,
      runtimeSessionIds: reclaimed,
      cachedRangeCount,
      pendingRangeCount,
    }
  }
  return {
    buffer,
    documentId,
    borrowStructural: (request) => retention.mutate(() => borrowStructural(request)),
    borrowHighlighter: (request) => retention.mutate(() => borrowHighlighter(request)),
    subscribeRetention: (listener) => retention.subscribe(listener),
    inspectRetention() {
      const records = new Set<ArrayBufferLike>()
      const entries = [
        ...structural.map(({ entry }) => inspectEntry('structural', entry, records)),
        ...highlighters.map(({ entry }) => inspectEntry('highlighter', entry, records)),
      ]
      return {
        entries,
        syntaxRecordBackingBytes: backingBytes(records),
        unmeasuredBytes: [
          'token-store-backing',
          'javascript-objects',
          'provider-sessions',
          'worker-heaps',
          'wasm',
        ],
      }
    },
    reclaimInactive: (options) => retention.mutate(() => reclaimInactive(options)),
    dispose() {
      if (disposed) return
      disposed = true
      retention.dispose()
      const ownedStructural = structural.splice(0)
      const ownedHighlighters = highlighters.splice(0)
      const releaseBuffer = unsubscribe
      unsubscribe = undefined
      releaseBuffer?.()
      for (const { entry } of ownedStructural) entry.dispose()
      for (const { entry, unsubscribeTheme } of ownedHighlighters) {
        unsubscribeTheme?.()
        entry.dispose()
      }
    },
  }
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
  const retained: EditorRetainedSyntaxSession = {
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
      const waiter = leaseCancellation(lease.signal, entry.retention, interest.signal)
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
  if (!lease.signal.aborted) {
    structuralLeaseOwners.set(retained, { entry, signal: lease.signal })
    lease.signal.addEventListener('abort', () => structuralLeaseOwners.delete(retained), {
      once: true,
    })
  }
  return retained
}

function highlighterLease(
  entry: AnalysisEntry<EditorHighlightResult>,
  session: EditorHighlighterSession,
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
          const unsubscribe = session.onDidChangeTheme?.(listener)
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

function leaseCancellation(
  ownerSignal: AbortSignal,
  retention: RetentionChanges,
  signal?: AbortSignal,
) {
  const controller = new AbortController()
  const dispose = () =>
    retention.mutate(() => {
      controller.abort()
      ownerSignal.removeEventListener('abort', dispose)
      signal?.removeEventListener('abort', dispose)
    })
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
function sameRequest(
  left: EditorAnalysisHighlighterRequest | EditorAnalysisStructuralRequest,
  right: EditorAnalysisHighlighterRequest | EditorAnalysisStructuralRequest,
): boolean {
  const leftTag = left.configurationTag ?? []
  const rightTag = right.configurationTag ?? []
  return (
    left.provider === right.provider &&
    left.languageId === right.languageId &&
    leftTag.length === rightTag.length &&
    leftTag.every((value, index) => Object.is(value, rightTag[index]))
  )
}
function sameStructuralRequest(
  left: EditorAnalysisStructuralRequest,
  right: EditorAnalysisStructuralRequest,
): boolean {
  return (
    sameRequest(left, right) &&
    (left.includeCaptures ?? true) === (right.includeCaptures ?? true) &&
    (left.includeHighlights ?? true) === (right.includeHighlights ?? true) &&
    (left.syntaxMode ?? 'full') === (right.syntaxMode ?? 'full')
  )
}

function boundedRange(range: EditorSyntaxRange, length: number): EditorSyntaxRange {
  const startIndex = Math.max(0, Math.min(length, range.startIndex))
  return { startIndex, endIndex: Math.max(startIndex, Math.min(length, range.endIndex)) }
}

function rangesIntersect(left: EditorSyntaxRange, right: EditorSyntaxRange): boolean {
  return left.startIndex < right.endIndex && left.endIndex > right.startIndex
}
function rangeContains(outer: EditorSyntaxRange, inner: EditorSyntaxRange): boolean {
  return outer.startIndex <= inner.startIndex && outer.endIndex >= inner.endIndex
}

function foldResultIntersects(result: EditorSyntaxResult, range: EditorSyntaxRange): boolean {
  return result.folds.some((fold) => rangesIntersect(range, fold))
}
