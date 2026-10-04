import type {
  DocumentSessionChange,
  EditorTextBuffer,
  EditorTextBufferChange,
} from '../documentSession'
import type { DocumentTextSnapshot } from '../documentTextSnapshot'
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
  inspectRetention(): AnalysisRetentionInspection
  reclaimInactive(options: AnalysisReclamationOptions): AnalysisReclamation
  dispose(): void
}

type AnalysisSession<T> = {
  refresh(snapshot: DocumentTextSnapshot): Promise<T>
  applyChange(change: DocumentSessionChange): Promise<T>
  dispose(): void
}

class AnalysisEntry<T extends RetentionResult> {
  readonly runtimeSessionId: string
  private readonly cancellation = new AbortController()
  private interests = 0
  private lastRelease: number | null = null
  private queuedRevision = -1
  private generation = 0
  private pendingInterest = new AbortController()
  private tail: Promise<void> = Promise.resolve()
  private state: EditorAnalysisRead<T>

  constructor(
    readonly buffer: EditorTextBuffer,
    readonly session: AnalysisSession<T>,
    runtimeSessionId: string,
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
  }

  private publish(revision: number, generation: number, state: EditorAnalysisRead<T>): void {
    if (
      this.cancellation.signal.aborted ||
      revision !== this.buffer.getRevision() ||
      generation !== this.generation
    )
      return
    this.state = state
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

class StructuralEntry extends AnalysisEntry<EditorSyntaxResult> {
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
    readonly structuralSession: EditorSyntaxSession,
    runtimeSessionId: string,
  ) {
    super(buffer, structuralSession, runtimeSessionId)
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
  let disposed = false
  let unsubscribe: (() => void) | undefined
  const subscribe = () => {
    unsubscribe ??= buffer.subscribe((event) => {
      for (const { entry } of structural) entry.changed(event)
      for (const { entry } of highlighters) entry.changed(event)
    })
  }
  const releaseSubscription = () => {
    if (structural.length > 0 || highlighters.length > 0) return
    unsubscribe?.()
    unsubscribe = undefined
  }
  return {
    buffer,
    documentId,
    borrowStructural(request) {
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
        found = {
          request: {
            ...request,
            signal: undefined,
            configurationTag: [...(request.configurationTag ?? [])],
          },
          entry: new StructuralEntry(buffer, session, runtimeSessionId),
        }
        structural.push(found)
      }
      return structuralLease(found.entry, request.signal)
    },
    borrowHighlighter(request) {
      if (disposed || request.signal?.aborted) return null
      let found = highlighters.find((candidate) => sameRequest(candidate.request, request))
      if (found?.entry.read().kind === 'failed' && found.entry.leaseCount === 0) {
        const failed = found
        highlighters.splice(highlighters.indexOf(failed), 1)
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
        const entry = new AnalysisEntry(buffer, session, runtimeSessionId)
        found = {
          request: {
            ...request,
            signal: undefined,
            configurationTag: [...(request.configurationTag ?? [])],
          },
          session,
          entry,
          unsubscribeTheme: session.onDidChangeTheme?.(() => entry.refresh()),
        }
        highlighters.push(found)
      }
      return highlighterLease(found.entry, found.session, request.signal)
    },
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
    reclaimInactive(options) {
      const requested = options.runtimeSessionIds ? new Set(options.runtimeSessionIds) : null
      const reclaimed: string[] = []
      let cachedRangeCount = 0
      let pendingRangeCount = 0
      for (const retained of structural.slice()) {
        const { entry } = retained
        if (entry.leaseCount > 0 || (requested && !requested.has(entry.runtimeSessionId))) continue
        const index = structural.indexOf(retained)
        if (index < 0) continue
        structural.splice(index, 1)
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
        reclaimed.push(entry.runtimeSessionId)
        unsubscribeTheme?.()
        entry.dispose()
      }
      releaseSubscription()
      return {
        reason: options.reason,
        runtimeSessionIds: reclaimed,
        cachedRangeCount,
        pendingRangeCount,
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
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
