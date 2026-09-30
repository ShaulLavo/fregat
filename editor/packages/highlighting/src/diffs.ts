import {
  prepareDiffSyntax,
  type DiffFile,
  type DiffGutterSide,
  type DiffSyntaxBackend,
  type PreparedDiffSyntaxInput,
  type PreparedDiffSyntaxSource,
} from '@singapore-editor/diff'

type SourceSide = 'old' | 'new'

/** The plugin surface a shown diff needs: take prepared syntax, hand back its own parse. */
export type HighlightingDiffView = {
  setFile(file: DiffFile | null, prepared?: PreparedDiffSyntaxInput): void
  releasePreparedSyntax(): readonly PreparedDiffSyntaxSource[]
}

export type DiffSyntaxSnapshot = {
  readonly prepared: number
  readonly running: number
  readonly viewed: number
}

// Source sides, not files: a stacked pane takes both, a split pane one. Eight two-sided diffs.
const PREPARED_SOURCE_LIMIT = 16

/**
 * Parsed diff sides kept by content, so a hovered diff and a revisit paint colour with their first
 * rows. Each entry owns a live worker session; eviction and `clear` dispose it.
 */
export class DiffSyntaxStore {
  private readonly prepared = new Map<string, PreparedDiffSyntaxSource>()
  private readonly running = new Map<string, Promise<unknown>>()
  private readonly viewed = new Map<string, number>()
  private readonly fingerprints = new WeakMap<DiffFile, Partial<Record<SourceSide, string>>>()
  private disposed = false

  /** False when the diff is prepared, on screen, or already being prepared. */
  public canPrepare(file: DiffFile, scope: string): boolean {
    const key = this.fileKey(file, scope)
    if (this.viewed.has(key) || this.running.has(key)) return false

    const keys = this.sideKeys(file, 'stacked', scope)
    for (const side of keys) this.touch(side)
    return !keys.every((side) => this.prepared.has(side))
  }

  /** Parses both sides ahead of a view; resolves true when it kept a preparation. */
  public async prepare(
    file: DiffFile,
    scope: string,
    backend: DiffSyntaxBackend,
  ): Promise<boolean> {
    if (this.disposed || !this.canPrepare(file, scope)) return false

    const key = this.fileKey(file, scope)
    const task = prepareDiffSyntax(file, { backend })
    this.running.set(key, task)
    try {
      const sources = await task
      if (this.disposed) {
        for (const source of sources) source.dispose()
        return false
      }
      this.store(file, scope, sources)
      return sources.length > 0
    } finally {
      if (this.running.get(key) === task) this.running.delete(key)
    }
  }

  /**
   * Shows `file` in `view`, with syntax prepared on intent or kept from an earlier view. A running
   * preparation is awaited rather than parsed twice; a view that has left by then leaves its result
   * for the next visit. Disposing hands the view's parse back.
   */
  public show(
    view: HighlightingDiffView,
    file: DiffFile,
    paneSide: DiffGutterSide,
    scope: string,
  ): { dispose(): void } {
    const key = this.fileKey(file, scope)
    const running = this.disposed ? undefined : this.running.get(key)
    let current = true
    const claim: PreparedDiffSyntaxInput = running
      ? running.then(
          () => (current ? this.take(file, paneSide, scope) : []),
          () => [],
        )
      : this.take(file, paneSide, scope)
    view.setFile(file, claim)
    this.viewed.set(key, (this.viewed.get(key) ?? 0) + 1)

    return {
      dispose: () => {
        if (!current) return
        current = false
        const count = (this.viewed.get(key) ?? 1) - 1
        if (count > 0) this.viewed.set(key, count)
        else this.viewed.delete(key)
        this.store(file, scope, view.releasePreparedSyntax())
      },
    }
  }

  /** Terminal: kept sides are disposed, and every later preparation or returned parse too. */
  public dispose(): void {
    this.disposed = true
    for (const entry of this.prepared.values()) entry.dispose()
    this.prepared.clear()
  }

  public inspect(): DiffSyntaxSnapshot {
    return { prepared: this.prepared.size, running: this.running.size, viewed: this.viewed.size }
  }

  // A side already held keeps the older entry.
  private store(file: DiffFile, scope: string, sources: readonly PreparedDiffSyntaxSource[]): void {
    for (const entry of sources) {
      if (this.disposed) {
        entry.dispose()
        continue
      }
      const key = this.sideKey(file, entry.side, scope)
      if (this.prepared.has(key)) {
        entry.dispose()
        continue
      }
      this.prepared.set(key, entry)
    }
    for (const [key, entry] of this.prepared) {
      if (this.prepared.size <= PREPARED_SOURCE_LIMIT) return
      entry.dispose()
      this.prepared.delete(key)
    }
  }

  // Every side the pane draws, or none: a partial set would parse anyway.
  private take(
    file: DiffFile,
    paneSide: DiffGutterSide,
    scope: string,
  ): readonly PreparedDiffSyntaxSource[] {
    const keys = this.sideKeys(file, paneSide, scope)
    if (!keys.every((key) => this.prepared.has(key))) return []

    return keys.map((key) => {
      const entry = this.prepared.get(key)!
      this.prepared.delete(key)
      return entry
    })
  }

  private fileKey(file: DiffFile, scope: string): string {
    return this.sideKeys(file, 'stacked', scope).join('\u0000')
  }

  private sideKeys(file: DiffFile, paneSide: DiffGutterSide, scope: string): readonly string[] {
    const sides: readonly SourceSide[] = paneSide === 'stacked' ? ['old', 'new'] : [paneSide]
    return sides.map((side) => this.sideKey(file, side, scope))
  }

  private sideKey(file: DiffFile, side: SourceSide, scope: string): string {
    let memo = this.fingerprints.get(file)
    if (!memo) {
      memo = {}
      this.fingerprints.set(file, memo)
    }
    memo[side] ??= sourceFingerprint(file, side)
    return `${scope}\u0000${side}\u0000${memo[side]}`
  }

  private touch(key: string): void {
    const entry = this.prepared.get(key)
    if (!entry) return
    this.prepared.delete(key)
    this.prepared.set(key, entry)
  }
}

/**
 * One side's syntax input: its language and text. Line count and length ride beside the FNV-1a
 * hash so two texts must agree on all three to share prepared tokens.
 */
function sourceFingerprint(file: DiffFile, side: SourceSide): string {
  const lines = side === 'old' ? file.oldLines : file.newLines
  let hash = 0x811c9dc5
  let length = 0
  for (const line of lines) {
    for (let index = 0; index < line.length; index += 1) {
      hash = Math.imul(hash ^ line.charCodeAt(index), 0x01000193)
    }
    hash = Math.imul(hash ^ 10, 0x01000193)
    length += line.length + 1
  }
  const language = file.languageId ?? file.path
  return `${language}\u0000${lines.length}:${length}:${(hash >>> 0).toString(36)}`
}
