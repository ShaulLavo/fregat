import { waitForDocumentWork as interruptible } from './documentWork'
import {
  DocumentContributionAudience,
  DocumentContributionOwner,
  requestDocumentContribution,
  type DocumentContributionDemand,
  type DocumentContributionTask,
} from './contributionDemand'
import type { EditorTextBuffer } from '../documentSession'
import type { DocumentTextSnapshot } from '../documentTextSnapshot'
import { EditorEventSource } from './emitter'
import { completeDocumentCleanup } from './documentCleanup'
import type {
  EditorHighlighterProvider,
  EditorHighlighterRuntime,
  EditorHighlighterSession,
  EditorHighlightResult,
} from '../syntax/highlighter'
import type { EditorTokenInput } from '../syntax/tokenStore'
import type { EditorTheme } from '../theme'
import {
  captureThemeCohort,
  loadOrderedHighlighterTheme,
  themeCohortIsCurrent,
  type ThemeCohort,
} from '../syntax/providerTheme'
import {
  createEmptySyntaxResult,
  type EditorSyntaxProvider,
  type EditorSyntaxSession,
  type EditorSyntaxRuntime,
  type EditorSyntaxSessionOptions,
  type EditorSyntaxResult,
  type EditorSyntaxRange,
} from '../syntax/session'
import {
  DocumentDelivery,
  type DocumentRead,
  type DocumentContributionScope,
} from './documentDelivery'
import { EditorWorkScheduler } from './workScheduler'
import type { DocumentSyncPoint } from './editChain'
import {
  bindDocumentOperation,
  retainDocumentOperation,
  type DocumentOperation,
  type DocumentOperationHost,
  type DocumentOperationOptions,
  type DocumentContributionLease,
  type ContributionEntry,
} from './contributionOperation'
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
  read(): HighlighterAnalysisRead
  waitForProviderTheme(signal: AbortSignal): Promise<ProviderThemeOutcome>
  readProducedTokens(): EditorHighlightResult | null
  onDidProduceTokens(listener: () => void): () => void
}

export function readRetainedHighlighterResult(
  session: EditorRetainedHighlighterSession,
  snapshot: DocumentTextSnapshot,
): Promise<EditorHighlightResult> {
  const read = session.read()
  if (read.kind === 'ready') return Promise.resolve(read.result)
  if (read.kind === 'failed') return Promise.reject(read.error)
  return session.refresh(snapshot)
}
type ProviderThemeOutcome =
  | { readonly kind: 'ready'; readonly theme: EditorTheme | null }
  | { readonly kind: 'failed'; readonly error: unknown }
type HighlighterAnalysisRead =
  | Extract<EditorAnalysisRead<EditorHighlightResult>, { kind: 'pending' | 'failed' }>
  | (Extract<EditorAnalysisRead<EditorHighlightResult>, { kind: 'ready' }> & {
      readonly providerTheme: ProviderThemeOutcome
    })
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
  readonly themeProviders?: readonly EditorHighlighterProvider[]
  readonly languageId: string | null
  readonly configurationTag?: EditorAnalysisConfigurationTag
  readonly signal?: AbortSignal
}

export type EditorStructuralContributionRequest = Omit<
  EditorAnalysisStructuralRequest,
  'provider'
> & {
  readonly structural: EditorStructuralOperation
  readonly range?: EditorSyntaxRange
}
export type EditorHighlighterContributionRequest = Omit<
  EditorAnalysisHighlighterRequest,
  'provider'
> & {
  readonly highlighter: EditorHighlighterOperation
}
export type EditorDocumentContributions = {
  retain<Input, Result, Entry extends ContributionEntry<Result>>(
    operation: DocumentOperation<Input, Result, Entry>,
    input: Input,
    options?: DocumentOperationOptions,
  ): DocumentContributionLease<Result> | null
  createAudience(options?: { readonly signal?: AbortSignal }): DocumentContributionAudience
  pin(options?: { readonly signal?: AbortSignal }): DocumentContributionOwner | null
  request<Input, Result, Entry extends ContributionEntry<Result>>(
    operation: DocumentOperation<Input, Result, Entry>,
    input: Input,
    demand: DocumentContributionDemand<Result>,
  ): DocumentContributionTask<Result>
}

export type EditorDocumentAnalysis = {
  readonly buffer: EditorTextBuffer
  readonly documentId: string
  readonly contributions: EditorDocumentContributions
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
  analyze(read: DocumentRead, signal: AbortSignal): Promise<T>
  configurationKey?(): unknown
  dispose(): void
}

export class RetentionChanges {
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

export class AnalysisEntry<T> {
  readonly runtimeSessionId: string
  private readonly cancellation = new AbortController()
  private interests = 0
  private active = false
  private lastRelease: number | null = null
  protected queuedPoint: DocumentSyncPoint | null = null
  private queuedRead: DocumentRead | null = null
  private queuedConfiguration: unknown
  private requests = 0
  protected generation = 0
  private pendingInterest = new AbortController()
  private running = false
  private pending: {
    readonly read: DocumentRead
    readonly revision: number
    readonly generation: number
    readonly snapshot: DocumentTextSnapshot
    readonly signal: AbortSignal
    readonly configurationKey: unknown
    readonly settle: (result: T) => void
    readonly reject: (error: unknown) => void
  } | null = null
  private completion: Promise<T> | null = null
  private state: EditorAnalysisRead<T>

  constructor(
    readonly buffer: EditorTextBuffer,
    readonly session: AnalysisSession<T>,
    readonly delivery: DocumentDelivery,
    readonly sourceScope: DocumentContributionScope,
    readonly scheduler: EditorWorkScheduler,
    runtimeSessionId: string,
    readonly retention: RetentionChanges,
    private readonly scheduling: 'requested' | 'ordered' | 'pinned' = 'requested',
  ) {
    this.runtimeSessionId = runtimeSessionId
    this.state = { kind: 'pending', revision: buffer.getRevision() }
    const read = delivery.current()
    if (read) this.enqueue(read)
  }

  get analysisGeneration(): number {
    return this.generation
  }

  activate(): void {
    this.active = true
    this.retention.changed()
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
    return this.queuedPoint === this.buffer.getDocumentSyncPoint() && this.isConfigurationCurrent()
      ? this.state
      : { kind: 'pending', revision }
  }

  changed(read: DocumentRead): void {
    if (this.scheduling === 'pinned') return
    if (read.revision.point === this.queuedPoint && this.isConfigurationCurrent()) return
    this.enqueue(read)
  }

  synchronize(): void {
    const read = this.delivery.current()
    if (!read || (read.revision.point === this.queuedPoint && this.isConfigurationCurrent())) return
    this.changed(read)
  }

  refresh(): void {
    const read = this.scheduling === 'pinned' ? this.queuedRead : this.delivery.current()
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
      if (!this.completion) throw cancelled()
      await interruptible(this.completion, this.pendingInterest.signal)
      this.assertCurrent(point, generation)
      if (!this.isConfigurationCurrent()) throw cancelled()
      const state = this.read()
      if (state.kind === 'ready') return state.result
      if (state.kind === 'failed') throw state.error
      throw cancelled()
    } finally {
      this.requests--
    }
  }

  async at(read: DocumentRead): Promise<T> {
    if (this.signal.aborted || this.delivery.read(read.revision) !== read) throw cancelled()
    const result =
      this.queuedPoint === read.revision.point &&
      this.isConfigurationCurrent() &&
      this.completion &&
      this.state.kind !== 'failed'
        ? this.completion
        : this.enqueue(read)
    this.requests++
    this.schedulePending()
    const generation = this.generation
    const interest = this.pendingInterest.signal
    try {
      const value = await interruptible(interruptible(result, this.signal), interest)
      if (generation !== this.generation || !this.isConfigurationCurrent()) throw cancelled()
      return value
    } finally {
      this.requests--
    }
  }

  async query(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    await this.current()
    const point = this.buffer.getDocumentSyncPoint()
    const generation = this.generation
    const interest = this.pendingInterest.signal
    this.assertCurrent(point, generation)
    if (!this.isConfigurationCurrent()) throw cancelled()
    const result = run(interest)
    const value = await interruptible(interruptible(result, this.cancellation.signal), interest)
    this.assertCurrent(point, generation)
    if (!this.isConfigurationCurrent()) throw cancelled()
    return value
  }

  dispose(): void {
    if (!this.stop()) return
    completeDocumentCleanup([() => this.session.dispose(), () => this.finishDispose()])
  }

  protected stop(): boolean {
    if (this.cancellation.signal.aborted) return false
    this.cancellation.abort()
    this.pendingInterest.abort()
    this.scheduler.cancel(this.runtimeSessionId, 'scope-released')
    this.pending?.reject(cancelled())
    this.pending = null
    this.queuedRead = null
    this.state = { kind: 'failed', revision: this.buffer.getRevision(), error: cancelled() }
    return true
  }

  protected finishDispose(): void {
    completeDocumentCleanup([
      () => this.sourceScope.dispose(),
      () => {
        if (this.active) this.retention.changed()
      },
    ])
  }

  private enqueue(read: DocumentRead): Promise<T> {
    this.pendingInterest.abort()
    this.pendingInterest = new AbortController()
    const revision = read.revision.point.revision
    this.queuedPoint = read.revision.point
    this.queuedRead = read
    this.queuedConfiguration = this.session.configurationKey?.()
    const generation = ++this.generation
    this.state = { kind: 'pending', revision }
    this.pending?.reject(cancelled())
    let settle: (result: T) => void = () => {}
    let reject: (error: unknown) => void = () => {}
    const completion = new Promise<T>((resolve, fail) => {
      settle = resolve
      reject = fail
    })
    void completion.catch(() => undefined)
    this.completion = completion
    const snapshot = this.delivery.snapshot(read)
    if (!snapshot) {
      reject(cancelled())
      return completion
    }
    this.pending = {
      read,
      revision,
      generation,
      snapshot,
      signal: this.pendingInterest.signal,
      configurationKey: this.queuedConfiguration,
      settle,
      reject,
    }
    this.schedulePending()
    if (this.active) this.retention.changed()
    return completion
  }

  private schedulePending(): void {
    if (this.running || !this.pending || this.cancellation.signal.aborted) return
    if (this.scheduling !== 'ordered' && this.requests === 0) return
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
      const result = await this.session.analyze(read, demand.signal)
      if (demand.configurationKey !== this.session.configurationKey?.()) throw cancelled()
      this.publish(read.revision.point, generation, { kind: 'ready', revision, snapshot, result })
      if (this.signal.aborted) demand.reject(cancelled())
      else demand.settle(result)
    } catch (error) {
      this.publish(read.revision.point, generation, { kind: 'failed', revision, error })
      demand.reject(error)
    } finally {
      this.running = false
      if (this.scheduling === 'ordered' && !this.pending) this.synchronize()
      this.schedulePending()
    }
  }

  private publish(
    point: DocumentSyncPoint,
    generation: number,
    state: EditorAnalysisRead<T>,
  ): void {
    if (
      this.cancellation.signal.aborted ||
      point !== this.queuedPoint ||
      generation !== this.generation
    )
      return
    this.state = state
    this.retention.changed()
  }

  private assertCurrent(point: DocumentSyncPoint, generation = this.generation): void {
    if (
      this.cancellation.signal.aborted ||
      point !== this.buffer.getDocumentSyncPoint() ||
      generation !== this.generation
    )
      throw cancelled()
  }

  isConfigurationCurrent(): boolean {
    return this.queuedConfiguration === this.session.configurationKey?.()
  }
}

class HighlighterAnalysisSession implements AnalysisSession<EditorHighlightResult> {
  private readonly produced = new EditorEventSource<void>({ action: 'document.highlighter.tokens' })
  private producedTokens: {
    readonly point: DocumentSyncPoint
    readonly configuration: unknown
    readonly signal: AbortSignal
    readonly result: EditorHighlightResult
  } | null = null
  private readonly invalidCohort = {}
  private providerTheme: ProviderThemeOutcome | null = null
  private themeWork: Promise<ProviderThemeOutcome> | null = null
  private readonly lifetime = new AbortController()
  private configurationWork: AbortController | null = null

  constructor(
    private readonly highlighter: EditorHighlighterRuntime,
    private readonly cohort: ThemeCohort,
  ) {}

  configurationKey(): unknown {
    return themeCohortIsCurrent(this.cohort)
      ? this.highlighter.configurationKey?.()
      : this.invalidCohort
  }

  analyze(read: DocumentRead, signal: AbortSignal): Promise<EditorHighlightResult> {
    const configuration = this.configurationKey()
    const tokens = this.highlighter.analyze(read, signal).then((result) => {
      signal.throwIfAborted()
      if (configuration !== this.configurationKey()) throw cancelled()
      this.producedTokens = { point: read.revision.point, configuration, signal, result }
      if (!this.providerTheme && this.cohort.some((provider) => provider.loadTheme))
        this.produced.fire()
      return result
    })
    return this.combine(tokens, signal)
  }

  readProducedTokens(point: DocumentSyncPoint | null): EditorHighlightResult | null {
    const produced = this.producedTokens
    if (!produced || this.lifetime.signal.aborted || produced.signal.aborted) return null
    if (produced.point !== point || produced.configuration !== this.configurationKey()) return null
    return produced.result
  }

  onDidProduceTokens(listener: () => void): () => void {
    const subscription = this.produced.subscribe(listener)
    return () => subscription.dispose()
  }

  retainedTokens(): EditorHighlightResult | null {
    return this.producedTokens?.result ?? null
  }

  themeOutcome(): ProviderThemeOutcome {
    return this.providerTheme ?? { kind: 'ready', theme: null }
  }

  waitForProviderTheme(signal: AbortSignal): Promise<ProviderThemeOutcome> {
    if (!themeCohortIsCurrent(this.cohort)) return Promise.reject(cancelled())
    return interruptible(
      this.providerTheme
        ? Promise.resolve(this.providerTheme)
        : (this.themeWork ??= this.loadTheme(this.lifetime.signal)),
      signal,
    )
  }

  invalidateTheme(): void {
    this.configurationWork?.abort()
    this.providerTheme = null
    this.themeWork = null
  }

  dispose(): void {
    this.lifetime.abort()
    this.producedTokens = null
    this.invalidateTheme()
    this.highlighter.dispose()
  }

  private async combine(
    tokens: Promise<EditorHighlightResult>,
    signal: AbortSignal,
  ): Promise<EditorHighlightResult> {
    const [highlight, theme] = await Promise.allSettled([tokens, this.waitForProviderTheme(signal)])
    if (theme.status === 'rejected') throw theme.reason
    if (highlight.status === 'rejected') throw highlight.reason
    signal.throwIfAborted()
    if (!themeCohortIsCurrent(this.cohort)) throw cancelled()
    return highlight.value
  }

  private async loadTheme(owner: AbortSignal): Promise<ProviderThemeOutcome> {
    const work = new AbortController()
    this.configurationWork = work
    const abort = () => work.abort(owner.reason)
    owner.addEventListener('abort', abort, { once: true })
    if (owner.aborted) abort()
    try {
      const theme = await interruptible(
        loadOrderedHighlighterTheme(this.cohort, work.signal),
        work.signal,
      )
      work.signal.throwIfAborted()
      if (!themeCohortIsCurrent(this.cohort)) throw cancelled()
      const outcome = { kind: 'ready' as const, theme: theme ?? null }
      this.providerTheme = outcome
      return outcome
    } catch (error) {
      work.signal.throwIfAborted()
      const outcome = { kind: 'failed' as const, error }
      this.providerTheme = outcome
      return outcome
    } finally {
      owner.removeEventListener('abort', abort)
      if (this.configurationWork === work) this.configurationWork = null
    }
  }
}

type RetainedRangeContributor = {
  readonly range: EditorSyntaxRange
  readonly result: EditorSyntaxResult
}
type ReadyRange = RetainedRangeContributor & { readonly point: DocumentSyncPoint }
type PendingRangeQuery = {
  readonly snapshot: DocumentTextSnapshot
  readonly point: DocumentSyncPoint
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

export class StructuralEntry extends AnalysisEntry<EditorSyntaxResult> {
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
      readonly point: DocumentSyncPoint
      readonly generation: number
    }
  >()
  private ranges = new Map<string, ReadyRange>()
  private queries = new Map<string, PendingRangeQuery>()
  private rangePoint: DocumentSyncPoint | null = null
  private stoppedWarmGeneration: number | null = null

  constructor(
    buffer: EditorTextBuffer,
    readonly structuralSession: EditorSyntaxRuntime,
    delivery: DocumentDelivery,
    sourceScope: DocumentContributionScope,
    scheduler: EditorWorkScheduler,
    runtimeSessionId: string,
    retention: RetentionChanges,
    scheduling: 'requested' | 'ordered' | 'pinned' = 'ordered',
  ) {
    super(
      buffer,
      structuralSession,
      delivery,
      sourceScope,
      scheduler,
      runtimeSessionId,
      retention,
      scheduling,
    )
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
    const point = this.buffer.getDocumentSyncPoint()
    const retired = discarded.some((contributor) => {
      const origin = this.resultOrigins.get(contributor.result)
      if (
        origin?.snapshot !== snapshot ||
        origin.point !== point ||
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
      origin.point === this.buffer.getDocumentSyncPoint() &&
      origin.generation === this.generation
    ) {
      cached = { ...contributor, point: origin.point }
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
    if (cached?.point === this.queuedPoint) return { ...state, result: cached.result }
    if (!this.canQueryRange()) return state
    return { kind: 'pending', revision: state.revision }
  }

  range(range: EditorSyntaxRange): Promise<EditorSyntaxResult> {
    range = boundedRange(range, this.buffer.getTextSnapshot().length)
    if (!this.structuralSession.queryRange) return this.current()
    const state = this.readRange(range)
    if (state.kind === 'ready') return Promise.resolve(state.result)
    const point = this.buffer.getDocumentSyncPoint()
    const revision = point.revision
    const generation =
      this.queuedPoint === this.buffer.getDocumentSyncPoint() ? this.generation : null
    const key = `${revision}:${generation ?? 'publication'}:${rangeKey(range)}`
    const existing = [...this.queries.values()].find((query) =>
      this.compatibleQuery(query, point, range),
    )
    if (existing) {
      this.trimOptionalRanges()
      return existing.promise
    }
    let queried = false
    const pending: PendingRangeQuery = {
      snapshot: this.buffer.getTextSnapshot(),
      point,
      range,
      admission: 'cache',
      work: { kind: 'queued', generation },
      promise: this.query((signal) => {
        pending.work = { kind: 'running', generation: this.generation }
        const current = this.readRange(range)
        if (current.kind === 'ready') return Promise.resolve(current.result)
        queried = true
        return this.structuralSession.queryRange?.(range, signal) ?? this.current()
      }).then((result) => {
        if (queried && this.canAdmitRange(key, pending)) {
          this.resultOrigins.set(result, {
            snapshot: pending.snapshot,
            point,
            generation: this.generation,
          })
          this.ranges.set(rangeKey(range), { point, range, result })
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
    point: DocumentSyncPoint,
    range: EditorSyntaxRange,
  ): boolean {
    return (
      query.point === point &&
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
      query.point === this.buffer.getDocumentSyncPoint() &&
      query.snapshot === this.buffer.getTextSnapshot()
    )
  }

  override changed(read: DocumentRead): void {
    if (read.revision.point === this.rangePoint) return
    this.rangePoint = read.revision.point
    this.ranges.clear()
    super.changed(read)
  }
}

export class HighlighterEntry extends AnalysisEntry<EditorHighlightResult> {
  private readonly highlighter: HighlighterAnalysisSession
  private readonly themes = new EditorEventSource<void>({ action: 'document.highlighter.theme' })
  private unsubscribeTheme: (() => void) | void
  private readonly unsubscribeProduced: () => void
  constructor(
    buffer: EditorTextBuffer,
    readonly highlighterSession: EditorHighlighterRuntime,
    delivery: DocumentDelivery,
    sourceScope: DocumentContributionScope,
    scheduler: EditorWorkScheduler,
    runtimeSessionId: string,
    retention: RetentionChanges,
    scheduling: 'requested' | 'ordered' | 'pinned' = 'ordered',
    readonly cohort: ThemeCohort = [],
  ) {
    const adapter = new HighlighterAnalysisSession(highlighterSession, cohort)
    super(
      buffer,
      adapter,
      delivery,
      sourceScope,
      scheduler,
      runtimeSessionId,
      retention,
      scheduling,
    )
    this.highlighter = adapter
    this.unsubscribeProduced = adapter.onDidProduceTokens(() => this.retention.changed())
    this.unsubscribeTheme = highlighterSession.onDidChangeTheme?.(() => {
      this.refresh()
      this.themes.fire()
    })
  }
  override read(): HighlighterAnalysisRead {
    if (!themeCohortIsCurrent(this.cohort)) {
      this.highlighter.invalidateTheme()
      return { kind: 'failed', revision: this.buffer.getRevision(), error: cancelled() }
    }
    const state = super.read()
    return state.kind === 'ready'
      ? { ...state, providerTheme: this.highlighter.themeOutcome() }
      : state
  }
  override refresh(): void {
    this.highlighter.invalidateTheme()
    super.refresh()
  }
  override dispose(): void {
    if (!this.stop()) return
    const unsubscribe = this.unsubscribeTheme
    this.unsubscribeTheme = undefined
    completeDocumentCleanup([
      () => unsubscribe?.(),
      this.unsubscribeProduced,
      () => this.highlighter.dispose(),
      () => this.finishDispose(),
    ])
  }
  onDidChangeTheme(listener: () => void): () => void {
    const subscription = this.themes.subscribe(listener)
    return () => subscription.dispose()
  }

  waitForProviderTheme(signal: AbortSignal): Promise<ProviderThemeOutcome> {
    return this.highlighter.waitForProviderTheme(signal)
  }

  readProducedTokens(): EditorHighlightResult | null {
    if (this.signal.aborted || this.queuedPoint !== this.buffer.getDocumentSyncPoint()) return null
    if (!this.isConfigurationCurrent()) return null
    return this.highlighter.readProducedTokens(this.queuedPoint)
  }

  onDidProduceTokens(listener: () => void): () => void {
    return this.highlighter.onDidProduceTokens(listener)
  }

  override retainedResults(): readonly EditorHighlightResult[] {
    const produced = this.highlighter.retainedTokens()
    const results = super.retainedResults()
    return produced ? results.concat(produced) : results
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
  const retention = new RetentionChanges()
  const lifecycle = new AbortController()
  const entries = new Set<ContributionEntry<unknown>>()
  let unsubscribe: (() => void) | undefined
  const releaseSubscription = () => {
    if (entries.size > 0) return
    unsubscribe?.()
    unsubscribe = undefined
  }
  const host: DocumentOperationHost = {
    buffer,
    documentId,
    delivery,
    scheduler,
    retention,
    signal: lifecycle.signal,
    subscribe() {
      unsubscribe ??= buffer.subscribe((event) =>
        retention.mutate(() => {
          const read = delivery.accept(event)
          if (!read) return
          for (const entry of entries) entry.changed(read)
        }),
      )
    },
    releaseIdleSubscription: releaseSubscription,
    adopt(entry) {
      if (lifecycle.signal.aborted) {
        entry.dispose()
        return
      }
      entries.add(entry)
      entry.signal.addEventListener(
        'abort',
        () => {
          entries.delete(entry)
          retention.changed()
          releaseSubscription()
        },
        { once: true },
      )
      entry.activate()
    },
  }
  function borrowStructural(request: EditorAnalysisStructuralRequest) {
    if (lifecycle.signal.aborted || request.signal?.aborted) return null
    const input = {
      languageId: request.languageId,
      includeCaptures: request.includeCaptures,
      includeHighlights: request.includeHighlights,
      syntaxMode: request.syntaxMode,
    }
    let entry = bindDocumentOperation(request.provider.operation, host, input, request)
    if (entry?.read().kind === 'failed' && entry.leaseCount === 0) {
      entry.dispose()
      entry = bindDocumentOperation(request.provider.operation, host, input, request)
    }
    return entry ? structuralLease(entry, request.signal) : null
  }
  function borrowHighlighter(request: EditorAnalysisHighlighterRequest) {
    if (lifecycle.signal.aborted || request.signal?.aborted) return null
    const input = {
      languageId: request.languageId,
      themeCohort: captureThemeCohort(request.themeProviders ?? [request.provider]),
    }
    let entry = bindDocumentOperation(request.provider.operation, host, input, request)
    if (entry?.read().kind === 'failed' && entry.leaseCount === 0) {
      entry.dispose()
      entry = bindDocumentOperation(request.provider.operation, host, input, request)
    }
    return entry ? highlighterLease(entry, entry.highlighterSession, request.signal) : null
  }
  const analysis: EditorDocumentAnalysis = {
    buffer,
    documentId,
    contributions: contributions(host),
    borrowStructural: (request) => retention.mutate(() => borrowStructural(request)),
    borrowHighlighter: (request) => retention.mutate(() => borrowHighlighter(request)),
    subscribeRetention: (listener) => retention.subscribe(listener),
    inspectRetention() {
      const records = new Set<ArrayBufferLike>()
      const retained = []
      for (const entry of entries) {
        if (entry instanceof StructuralEntry)
          retained.push(inspectEntry('structural', entry, records))
        if (entry instanceof HighlighterEntry)
          retained.push(inspectEntry('highlighter', entry, records))
      }
      return {
        entries: retained,
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
      return retention.mutate(() => {
        try {
          return reclaimEntries(entries, options)
        } finally {
          releaseSubscription()
        }
      })
    },
    dispose() {
      if (lifecycle.signal.aborted) return
      retention.dispose()
      lifecycle.abort()
      if (analysisOwners.get(buffer)?.analysis === analysis) analysisOwners.delete(buffer)
      const owned = Array.from(entries)
      entries.clear()
      const releaseBuffer = unsubscribe
      unsubscribe = undefined
      completeDocumentCleanup([
        () => releaseBuffer?.(),
        ...owned.map((entry) => () => entry.dispose()),
        () => scheduler.dispose(),
        () => delivery.dispose(),
      ])
    },
  }
  return analysis
}

function reclaimEntries(
  entries: Set<ContributionEntry<unknown>>,
  options: AnalysisReclamationOptions,
): AnalysisReclamation {
  const requested = options.runtimeSessionIds ? new Set(options.runtimeSessionIds) : null
  const runtimeSessionIds: string[] = []
  let cachedRangeCount = 0
  let pendingRangeCount = 0
  const cleanups: (() => void)[] = []
  for (const entry of Array.from(entries)) {
    if (entry.leaseCount > 0 || (requested && !requested.has(entry.runtimeSessionId))) continue
    runtimeSessionIds.push(entry.runtimeSessionId)
    if (entry instanceof StructuralEntry) {
      cachedRangeCount += entry.cachedRangeCount
      pendingRangeCount += entry.pendingRangeCount
    }
    entries.delete(entry)
    cleanups.push(() => entry.dispose())
  }
  completeDocumentCleanup(cleanups)
  return { reason: options.reason, runtimeSessionIds, cachedRangeCount, pendingRangeCount }
}

function contributions(host: DocumentOperationHost): EditorDocumentContributions {
  function retain<Input, Result, Entry extends ContributionEntry<Result>>(
    operation: DocumentOperation<Input, Result, Entry>,
    input: Input,
    options?: DocumentOperationOptions,
  ): DocumentContributionLease<Result> | null {
    return host.retention.mutate(() => retainDocumentOperation(operation, host, input, options))
  }
  return {
    retain,
    createAudience: (options) => DocumentContributionAudience.issue(host, options?.signal),
    pin: (options) => DocumentContributionOwner.issue(host, options?.signal),
    request: (operation, input, demand) =>
      host.retention.mutate(() => requestDocumentContribution(host, operation, input, demand)),
  }
}

function inspectEntry<T extends RetentionResult>(
  family: AnalysisRetentionEntry['family'],
  entry: AnalysisEntry<T>,
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
  const refresh = refreshRetainedAnalysis(entry, result)
  const retained: EditorRetainedSyntaxSession = {
    runtimeSessionId: entry.runtimeSessionId,
    setDisplayDemand: (demand) => entry.setDisplayDemand(lease.signal, demand),
    get foldingSupport() {
      return entry.structuralSession.foldingSupport
    },
    refresh: () => lease.wait(refresh),
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
  entry: HighlighterEntry,
  session: EditorHighlighterRuntime,
  signal?: AbortSignal,
): EditorRetainedHighlighterSession {
  const lease = entry.lease(signal)
  const refresh = refreshRetainedAnalysis(
    entry,
    () => entry.current(),
    () => {
      const read = entry.read()
      return (
        read.kind === 'failed' || (read.kind === 'ready' && read.providerTheme.kind === 'failed')
      )
    },
  )
  return {
    runtimeSessionId: entry.runtimeSessionId,
    refresh: () => lease.wait(refresh),
    waitForProviderTheme: (signal) => lease.wait(() => entry.waitForProviderTheme(signal)),
    readProducedTokens: () => (lease.signal.aborted ? null : entry.readProducedTokens()),
    onDidProduceTokens: (listener) =>
      observeRetainedEvent(lease.signal, entry.onDidProduceTokens.bind(entry), listener),
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
    read: () => {
      if (lease.signal.aborted)
        return { kind: 'failed', revision: entry.buffer.getRevision(), error: cancelled() }
      const read = entry.read()
      if (read.kind !== 'ready') return read
      return {
        ...read,
        result: read.result,
        providerTheme: read.providerTheme,
      }
    },
    dispose: lease.dispose,
  }
}

function observeRetainedEvent(
  signal: AbortSignal,
  subscribe: (listener: () => void) => () => void,
  listener: () => void,
): () => void {
  if (signal.aborted) return () => undefined
  const unsubscribe = subscribe(listener)
  const release = () => {
    unsubscribe()
    signal.removeEventListener('abort', release)
  }
  signal.addEventListener('abort', release, { once: true })
  return release
}

function refreshRetainedAnalysis<Result>(
  entry: Pick<AnalysisEntry<Result>, 'read' | 'refresh' | 'synchronize' | 'analysisGeneration'>,
  run: () => Promise<Result>,
  hasFailed: () => boolean = () => entry.read().kind === 'failed',
): () => Promise<Result> {
  let failedGeneration: number | null = hasFailed() ? entry.analysisGeneration : null
  return async () => {
    entry.synchronize()
    if (hasFailed() && failedGeneration === entry.analysisGeneration) entry.refresh()
    const generation = entry.analysisGeneration
    try {
      const result = await run()
      if (entry.analysisGeneration === generation && hasFailed()) failedGeneration = generation
      return result
    } catch (error) {
      if (entry.analysisGeneration === generation) failedGeneration = generation
      throw error
    }
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

function rangesIntersect(left: EditorSyntaxRange, right: EditorSyntaxRange): boolean {
  return left.startIndex < right.endIndex && left.endIndex > right.startIndex
}
function rangeContains(outer: EditorSyntaxRange, inner: EditorSyntaxRange): boolean {
  return outer.startIndex <= inner.startIndex && outer.endIndex >= inner.endIndex
}

function foldResultIntersects(result: EditorSyntaxResult, range: EditorSyntaxRange): boolean {
  return result.folds.some((fold) => rangesIntersect(range, fold))
}
