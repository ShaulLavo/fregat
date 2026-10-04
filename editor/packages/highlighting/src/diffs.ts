import {
  prepareDiffSyntax,
  type DiffFile,
  type DiffGutterSide,
  type DiffSyntaxBackend,
  type DiffSyntaxSourceReader,
  type PreparedDiffSyntaxInput,
  type PreparedDiffSyntaxSource,
} from '@singapore-editor/diff'

type SourceSide = 'old' | 'new'

export type HighlightingDiffView = {
  setFile(file: DiffFile | null, prepared?: PreparedDiffSyntaxInput): void
  /** Ends a plugin's pending or ready readers without changing its projection. */
  releaseSyntax?(): void
}

export type DiffSyntaxSnapshot = {
  readonly prepared: number
  readonly running: number
  readonly viewed: number
  readonly borrowed: number
  /** Original input lines retained for exact equality; excludes worker/snippet/token storage. */
  readonly retainedInputCodeUnits: number
}

const PREPARED_SOURCE_LIMIT = 16

type SourceEntry = {
  readonly scope: string
  readonly backend: DiffSyntaxBackend
  readonly side: SourceSide
  readonly path: string
  readonly languageId: DiffFile['languageId']
  readonly lines: readonly string[]
  readonly cancellation: AbortController
  readonly ready: Promise<PreparedDiffSyntaxSource | null>
  interests: number
  state:
    | { readonly kind: 'pending' }
    | { readonly kind: 'ready'; readonly source: PreparedDiffSyntaxSource }
    | { readonly kind: 'retired' }
}

type SourceInterest = {
  readonly entry: SourceEntry
  readonly subscriptions: Set<() => void>
  current: boolean
  dispose(): void
}

/** Owns immutable source sessions; views borrow independent interests and idle sides use LRU. */
export class DiffSyntaxStore {
  private readonly entries = new Set<SourceEntry>()
  private readonly views = new Map<HighlightingDiffView, () => void>()
  private disposed = false

  public canPrepare(file: DiffFile, scope: string, backend: DiffSyntaxBackend): boolean {
    if (this.disposed || file.isPartial) return false
    return this.sides('stacked').some((side) => !this.find(file, side, scope, backend))
  }

  public async prepare(
    file: DiffFile,
    scope: string,
    backend: DiffSyntaxBackend,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (signal?.aborted || !this.canPrepare(file, scope, backend)) return false
    const interests = this.sides('stacked').map((side) => this.acquire(file, side, scope, backend))
    let cancel = () => {}
    const aborted = new Promise<false>((resolve) => {
      cancel = () => {
        for (const interest of interests) interest.dispose()
        resolve(false)
      }
      signal?.addEventListener('abort', cancel, { once: true })
    })
    try {
      const completed = Promise.all(interests.map(({ entry }) => entry.ready)).then(
        (sources) => !this.disposed && sources.some((source) => source !== null),
      )
      return await Promise.race([completed, aborted])
    } finally {
      signal?.removeEventListener('abort', cancel)
      for (const interest of interests) interest.dispose()
    }
  }

  public show(
    view: HighlightingDiffView,
    file: DiffFile,
    paneSide: DiffGutterSide,
    scope: string,
    backend: DiffSyntaxBackend,
  ): { dispose(): void } {
    this.views.get(view)?.()
    if (this.disposed) {
      view.releaseSyntax?.()
      return { dispose: () => {} }
    }
    const interests = file.isPartial
      ? []
      : this.sides(paneSide).map((side) => this.acquire(file, side, scope, backend))
    let current = true
    const readers = (): readonly DiffSyntaxSourceReader[] => {
      if (!current || this.disposed) return []
      return interests.flatMap((interest) => this.reader(interest))
    }
    const claim: PreparedDiffSyntaxInput = interests.every(
      ({ entry }) => entry.state.kind === 'ready',
    )
      ? readers()
      : Promise.all(interests.map(({ entry }) => entry.ready)).then(readers, () => [])
    const dispose = () => {
      if (!current) return
      current = false
      this.views.delete(view)
      view.releaseSyntax?.()
      for (const interest of interests) interest.dispose()
    }
    this.views.set(view, dispose)
    view.setFile(file, claim)
    return { dispose }
  }

  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const dispose of this.views.values()) dispose()
    for (const entry of this.entries) this.retire(entry)
  }

  public inspect(): DiffSyntaxSnapshot {
    let prepared = 0
    let running = 0
    let borrowed = 0
    let retainedInputCodeUnits = 0
    for (const entry of this.entries) {
      if (entry.state.kind === 'pending') running += 1
      if (entry.state.kind === 'ready' && entry.interests === 0) prepared += 1
      borrowed += entry.interests
      retainedInputCodeUnits += entry.lines.reduce((length, line) => length + line.length, 0)
    }
    return { prepared, running, viewed: this.views.size, borrowed, retainedInputCodeUnits }
  }

  private acquire(
    file: DiffFile,
    side: SourceSide,
    scope: string,
    backend: DiffSyntaxBackend,
  ): SourceInterest {
    const entry = this.find(file, side, scope, backend) ?? this.start(file, side, scope, backend)
    entry.interests += 1
    this.entries.delete(entry)
    this.entries.add(entry)
    const interest: SourceInterest = {
      entry,
      current: true,
      subscriptions: new Set(),
      dispose: () => {
        if (!interest.current) return
        interest.current = false
        for (const unsubscribe of interest.subscriptions) unsubscribe()
        interest.subscriptions.clear()
        entry.interests -= 1
        if (entry.interests > 0) return
        if (entry.state.kind === 'pending') this.retire(entry)
        if (entry.state.kind === 'ready') {
          this.entries.delete(entry)
          this.entries.add(entry)
        }
        this.trim()
      },
    }
    return interest
  }

  private reader(interest: SourceInterest): readonly DiffSyntaxSourceReader[] {
    if (!interest.current || interest.entry.state.kind !== 'ready') return []
    const source = interest.entry.state.source
    return [
      {
        side: source.side,
        lineStarts: source.lineStarts,
        get tokens() {
          return source.tokens
        },
        onDidChangeTokens: (listener) => {
          if (!interest.current) return () => {}
          const unsubscribe = source.onDidChangeTokens(listener)
          interest.subscriptions.add(unsubscribe)
          return () => {
            interest.subscriptions.delete(unsubscribe)
            unsubscribe()
          }
        },
        dispose: () => interest.dispose(),
      },
    ]
  }

  private start(
    file: DiffFile,
    side: SourceSide,
    scope: string,
    backend: DiffSyntaxBackend,
  ): SourceEntry {
    const cancellation = new AbortController()
    const cancelled = Promise.withResolvers<null>()
    cancellation.signal.addEventListener('abort', () => cancelled.resolve(null), { once: true })
    const entry: SourceEntry = {
      scope,
      backend,
      side,
      path: file.path,
      languageId: file.languageId,
      lines: side === 'old' ? file.oldLines : file.newLines,
      cancellation,
      interests: 0,
      state: { kind: 'pending' },
      ready: Promise.race([
        prepareDiffSyntax(file, { backend, side, signal: cancellation.signal }).then(
          (sources) => this.finish(entry, sources),
          (error: unknown) => {
            entry.state = { kind: 'retired' }
            this.entries.delete(entry)
            throw error
          },
        ),
        cancelled.promise,
      ]),
    }
    this.entries.add(entry)
    return entry
  }

  private finish(
    entry: SourceEntry,
    sources: readonly PreparedDiffSyntaxSource[],
  ): PreparedDiffSyntaxSource | null {
    const source = sources[0]
    if (this.disposed || entry.state.kind === 'retired' || !source) {
      for (const value of sources) value.dispose()
      this.retire(entry)
      return null
    }
    entry.state = { kind: 'ready', source }
    this.trim()
    return source
  }

  private find(
    file: DiffFile,
    side: SourceSide,
    scope: string,
    backend: DiffSyntaxBackend,
  ): SourceEntry | undefined {
    const lines = side === 'old' ? file.oldLines : file.newLines
    for (const entry of this.entries) {
      if (entry.scope !== scope || entry.side !== side) continue
      if (entry.path !== file.path || entry.languageId !== file.languageId) continue
      if (entry.backend.kind !== backend.kind || entry.backend.provider !== backend.provider)
        continue
      if (sameLines(entry.lines, lines)) return entry
    }
    return undefined
  }

  private sides(side: DiffGutterSide): readonly SourceSide[] {
    return side === 'stacked' ? ['old', 'new'] : [side]
  }

  private trim(): void {
    const idle = [...this.entries].filter(
      (entry) => entry.interests === 0 && entry.state.kind === 'ready',
    )
    for (const entry of idle.slice(0, Math.max(0, idle.length - PREPARED_SOURCE_LIMIT)))
      this.retire(entry)
  }

  private retire(entry: SourceEntry): void {
    if (entry.state.kind === 'retired') return
    const state = entry.state
    entry.state = { kind: 'retired' }
    this.entries.delete(entry)
    entry.cancellation.abort()
    if (state.kind === 'ready') state.source.dispose()
  }
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((line, index) => line === b[index])
}
