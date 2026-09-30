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
export type EditorAnalysisRead<T> =
  | { readonly kind: 'pending'; readonly revision: number }
  | {
      readonly kind: 'ready'
      readonly revision: number
      readonly snapshot: DocumentTextSnapshot
      readonly result: T
    }
  | { readonly kind: 'failed'; readonly revision: number; readonly error: unknown }

export type EditorRetainedSyntaxSession = EditorSyntaxSession & {
  readonly runtimeSessionId: string
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
  dispose(): void
}

type AnalysisSession<T> = {
  refresh(snapshot: DocumentTextSnapshot): Promise<T>
  applyChange(change: DocumentSessionChange): Promise<T>
  dispose(): void
}

class AnalysisEntry<T> {
  readonly runtimeSessionId: string
  private readonly cancellation = new AbortController()
  private interests = 0
  private queuedRevision = -1
  private generation = 0
  private pendingInterest = new AbortController()
  private tail: Promise<unknown> = Promise.resolve()
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

  lease(signal?: AbortSignal) {
    const lease = leaseCancellation(this.signal, signal)
    if (lease.signal.aborted) return lease
    this.interests++
    lease.signal.addEventListener('abort', () => this.interests--, { once: true })
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
    this.synchronize()
    const revision = this.buffer.getRevision()
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
    this.tail = result.catch(() => undefined)
    const value = await interruptible(interruptible(result, this.cancellation.signal), interest)
    this.assertCurrent(revision, generation)
    return value
  }

  dispose(): void {
    if (this.cancellation.signal.aborted) return
    this.cancellation.abort()
    this.pendingInterest.abort()
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
    if (!this.structuralSession.queryRange) return state
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
    const pending = this.query(
      () => this.structuralSession.queryRange?.(range) ?? this.current(),
    ).then((result) => {
      if (this.buffer.getRevision() === revision)
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
        found.unsubscribeTheme?.()
        found.entry.dispose()
        highlighters.splice(highlighters.indexOf(found), 1)
        found = undefined
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
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribe?.()
      for (const { entry } of structural) entry.dispose()
      for (const { entry, unsubscribeTheme } of highlighters) {
        unsubscribeTheme?.()
        entry.dispose()
      }
      structural.length = 0
      highlighters.length = 0
    },
  }
}

function structuralLease(
  entry: StructuralEntry,
  signal?: AbortSignal,
): EditorRetainedSyntaxSession {
  const lease = entry.lease(signal)
  let demand: EditorSyntaxRange | undefined
  const result = () => (demand ? entry.range(demand) : entry.current())
  const current = () => lease.wait(result)
  return {
    runtimeSessionId: entry.runtimeSessionId,
    get foldingSupport() {
      return entry.structuralSession.foldingSupport
    },
    refresh: () =>
      lease.wait(() => {
        if (entry.read().kind === 'failed') entry.refresh()
        return result()
      }),
    applyChange: current,
    canQueryRange: () => entry.read().kind === 'ready',
    queryRange(range) {
      demand = range
      return current()
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
