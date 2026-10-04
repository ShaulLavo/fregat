import { registerDiffColors } from './theme'
import type {
  EditorContributionChange,
  EditorDecorationContribution,
  EditorDecorationContributionContext,
  EditorDisposable,
  EditorGutterRowContext,
  EditorInjectedTextRow,
  EditorPlugin,
  EditorPluginContext,
  EditorSnippetTokenSource,
  EditorViewContribution,
  EditorViewContributionContext,
  EditorViewContributionUpdateKind,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import { EDITOR_SNIPPET_TOKENS_FEATURE } from '@singapore-editor/core/extensions'
import type { EditorToken } from '@singapore-editor/core/syntax'
import { createDiffGutterContribution } from './diffGutter'
import { diffInlineHighlightRanges, diffRowDecorations } from './diffRows'
import { DiffSyntaxController, type PreparedDiffSyntaxInput } from './diffSyntax'
import {
  diffGutterDigits,
  type DiffGutterDigits,
  type DiffGutterLayout,
  type DiffGutterSide,
} from './gutters'
import { createLiveDiffProjection, type LiveDiffProjection } from './liveProjection'
import { createTextDiff } from './model'
import { createSplitProjection, createStackedProjection } from './projection'
import { createDiffRegionStore, type DiffRegionStore } from './regions'
import type { DiffFile, DiffRenderRow, DiffSyntaxBackend, DiffTextFile } from './types'

export type DiffPluginMode = 'document' | 'overlay'

export type DiffPluginOptions = {
  /**
   * §C1. `document` is the parity path; `overlay` is explicitly non-parity — see §C2.
   *
   * Required, with no default. The factory this replaced took no arguments and was always overlay,
   * so the natural migration — rename the call, keep the empty argument list — would otherwise
   * produce a plugin that mounts, registers everything, renders nothing and reports no error,
   * because `setBaseFile` and `setEnabled` both early-return outside overlay mode.
   */
  readonly mode: DiffPluginMode
  readonly side?: DiffGutterSide
  /**
   * Expansion state, shared when a host drives two sides of one diff. Omit it and the plugin keeps
   * a private store; pass one store to both split plugins and a toggle on either side moves both.
   * See regions.ts — this is what holds §C7 together.
   */
  readonly regions?: DiffRegionStore
  readonly syntaxBackend?: DiffSyntaxBackend
  readonly syntaxHighlight?: boolean
}

export type DiffPlugin = EditorPlugin & {
  /**
   * `document` mode: the file to project. The host owns the editor's text — §C3. `prepared`
   * streams from `prepareDiffSyntax` for this file paint with the first rows, and a preparation
   * still running is awaited in place of a second parse. The plugin disposes each reader interest.
   */
  setFile(file: DiffFile | null, prepared?: PreparedDiffSyntaxInput): void
  /** Releases syntax interests while retaining this pane's rows and shared expansion. */
  releaseSyntax(): void
  getRows(): readonly DiffRenderRow[]
  /** Both sides in row order. Cached until the file or expansion state changes. */
  getStackedRows(): readonly DiffRenderRow[]
  /**
   * Projected syntax tokens for the current rows. The host passes them with the rows' text,
   * `setText(text, { tokens })`, or an expansion toggle repaints uncoloured (§C10).
   */
  isSyntaxReady(): boolean
  getTokens(): readonly EditorToken[]
  onDidChangeRows(listener: () => void): EditorDisposable
  onDidChangeTokens(listener: () => void): EditorDisposable
  /** §C5. Hosts must not mirror this. */
  getExpandedRegions(): ReadonlySet<string>
  toggleRegion(key: string): void

  /** `overlay` mode: the buffer the live editor text is diffed against. */
  setBaseFile(file: DiffTextFile | null): void
  setEnabled(enabled: boolean): void
}

/** The diff row under a pointer: which pane, that pane's rows, and the index into them. */
export type DiffRowHit = {
  readonly side: DiffGutterSide
  readonly rowIndex: number
  readonly rows: readonly DiffRenderRow[]
}

// How a pointer event finds the plugin that owns the pane under it, so a host never reads row
// attributes or pane classes to work out where a press landed.
const viewsByScrollElement = new WeakMap<Element, DiffViewContribution>()

/** `null` outside a `document`-mode diff pane, or over something that is not a diff row. */
export function diffRowAtEvent(event: MouseEvent): DiffRowHit | null {
  const target = event.target
  if (!(target instanceof Element)) return null

  const scrollElement = target.closest('[data-editor-diff-side]')
  if (!scrollElement) return null

  return viewsByScrollElement.get(scrollElement)?.rowHitAt(event) ?? null
}

const EMPTY_PROJECTION: LiveDiffProjection = {
  injectedRows: [],
  rowDecorations: new Map(),
  rows: [],
  rowsByBufferRow: new Map(),
}
const ROW_DECORATION_SOURCE = 'editor.diff'
const INLINE_HIGHLIGHT_STYLE = { backgroundColor: 'rgba(255, 255, 255, 0.18)' } as const

let nextDiffPluginId = 0

/**
 * The one diff plugin (§C1), carrying two internal row-delivery modes.
 *
 * `document` — the editor holds a synthetic buffer of the projected rows and the plugin publishes
 * them for the host to push in. Everything works because the rows are real document lines.
 *
 * `overlay` — the editor holds the host's live, editable buffer and deletions arrive as injected
 * rows. Non-parity by construction; see §C2 and test/overlayModeLimits.test.ts before reaching for
 * it.
 */
export function createDiffPlugin(options: DiffPluginOptions): DiffPlugin {
  registerDiffColors()
  const runtime = new DiffPluginRuntime(options)

  return {
    name: `editor-diff-${options.mode}`,
    activate(context) {
      return runtime.activate(context)
    },
    setFile: (file, prepared) => runtime.setFile(file, prepared),
    releaseSyntax: () => runtime.releaseSyntax(),
    getRows: () => runtime.getRows(),
    getStackedRows: () => runtime.getStackedRows(),
    getTokens: () => runtime.getTokens(),
    isSyntaxReady: () => runtime.isSyntaxReady(),
    onDidChangeRows: (listener) => runtime.onDidChangeRows(listener),
    onDidChangeTokens: (listener) => runtime.onDidChangeTokens(listener),
    getExpandedRegions: () => runtime.getExpandedRegions(),
    toggleRegion: (key) => runtime.toggleRegion(key),
    setBaseFile: (file) => runtime.setBaseFile(file),
    setEnabled: (enabled) => runtime.setEnabled(enabled),
  }
}

class DiffPluginRuntime {
  private readonly id = nextDiffPluginId++
  private readonly mode: DiffPluginMode
  private readonly side: DiffGutterSide
  private syntax: DiffSyntaxController
  private readonly rowListeners = new Set<() => void>()
  private readonly tokenListeners = new Set<() => void>()

  private readonly regions: DiffRegionStore
  private file: DiffFile | null = null
  private rows: readonly DiffRenderRow[] = []
  private stackedRows: readonly DiffRenderRow[] | null = null
  private digits: DiffGutterDigits = { old: 0, new: 0 }
  private hunkRows = false
  private expandableRows = false

  private baseFile: DiffTextFile | null = null
  private enabled: boolean
  private liveProjection: LiveDiffProjection = EMPTY_PROJECTION

  private decoration: DiffDecorationContribution | null = null
  private view: DiffViewContribution | null = null
  private injectedRowsListener: (() => void) | null = null
  private lastGutterLayout: DiffGutterLayout | null = null
  private readonly regionSubscription: EditorDisposable

  constructor(private readonly options: DiffPluginOptions) {
    this.mode = options.mode
    this.side = options.side ?? 'stacked'
    this.regions = options.regions ?? createDiffRegionStore()
    // A shared store means the sibling side's toggle lands here too.
    //
    // Held for the plugin's whole life, and never released. Every narrower lifetime is wrong:
    //
    // - torn down with the ACTIVATION, next to the syntax controller, which is the obvious place:
    //   the first deactivation is then terminal. The plugin is re-activated against a fresh editor,
    //   renders correctly, and is silently deaf to every expansion toggle after that. React
    //   StrictMode makes mount -> unmount -> mount the normal development path, so a host that gets
    //   this wrong sees gutter clicks do nothing at all.
    // - created only on activation: a plugin driven headlessly as a projection source, with no
    //   editor behind it, never sees its own `toggleRegion`.
    // - released from `EditorPlugin.dispose`: that fires when an editor tears down, and a React
    //   host reuses the same plugin instance across the next editor — so this is the first case
    //   again with an extra step.
    //
    // Nothing leaks by holding it. The listener lives in the store, the store is the host's, and a
    // host drops both together; a plugin the host builds and never mounts — StrictMode
    // double-invokes the `useMemo` that builds one — is collected with it.
    this.regionSubscription = this.regions.onDidChange(() => this.handleRegionsChanged())
    // Overlay mode is switched on by the host once it has a base file; document mode is live from
    // the moment it has one.
    this.enabled = this.mode === 'document'
    this.syntax = this.createSyntaxController()
  }

  activate(context: EditorPluginContext): EditorDisposable[] {
    // A controller disposed by a previous deactivation is dead for good — its scheduler is
    // terminal, so `schedule()` returns an inactive handle forever and the diff would render
    // permanently uncoloured after a remove-then-re-add. The core supports that cycle
    // (`Editor.setPlugins`), so the controller's lifetime is the activation's, not the plugin's.
    //
    // Only a *replacement* controller needs the file pushed into it. Doing it unconditionally
    // re-parses a file the surviving controller is already holding — and when the host sets the
    // file before constructing the editor, which is the natural order, that means cancelling an
    // in-flight parse to start an identical one. Under shiki that is two worker owners for one
    // file.
    if (this.syntax.isDisposed()) {
      this.syntax = this.createSyntaxController()
      if (this.file) this.syntax.setFile(this.file, this.rows)
    }

    const disposables: EditorDisposable[] = [
      context.registerGutterContribution(
        createDiffGutterContribution({
          side: this.side,
          tint: this.mode === 'document' ? 'row' : 'cell',
          getDigits: () => this.gutterDigits(),
          resolveRow: (row) => this.resolveGutterRow(row),
          isEnabled: () => this.enabled,
          onLayout: (layout) => this.publishGutterLayout(layout),
        }),
      ),
      context.registerDecorationContribution({
        createContribution: (featureContext) => this.createDecorationContribution(featureContext),
      }),
      context.registerViewContribution({
        createContribution: (viewContext) => this.createViewContribution(viewContext),
      }),
      { dispose: () => this.syntax.dispose() },
    ]

    if (this.mode === 'overlay') {
      disposables.push(
        context.registerInjectedTextRowProvider({
          getInjectedTextRows: () => this.injectedRows(),
          onDidChangeInjectedTextRows: (listener) => this.setInjectedRowsListener(listener),
        }),
      )
    }

    return disposables
  }

  // ---------------------------------------------------------------- document mode (§C3, §C5)

  setFile(file: DiffFile | null, prepared: PreparedDiffSyntaxInput = []): void {
    if (this.mode !== 'document') {
      void Promise.resolve(prepared).then(
        (sources) => {
          for (const source of sources) source.dispose()
        },
        () => undefined,
      )
      return
    }

    this.file = file
    // The store decides whether this counts as the same diff, and drops expansion if not. Both
    // sides of a split share it, so both are told once.
    this.regions.setFile(file)
    this.rebuildRows()
    this.syntax.setFile(file, this.rows, prepared)
    this.notifyRows()
  }

  releaseSyntax(): void {
    this.syntax.release()
  }

  getRows(): readonly DiffRenderRow[] {
    if (this.mode === 'overlay') return this.liveProjection.rows
    return this.rows
  }

  getStackedRows(): readonly DiffRenderRow[] {
    if (this.mode === 'overlay') return this.liveProjection.rows
    if (this.side === 'stacked') return this.rows
    this.stackedRows ??= projectRows(this.file, 'stacked', this.regions.getExpandedRegions())
    return this.stackedRows
  }

  isSyntaxReady(): boolean {
    return this.syntax.isReady()
  }

  getTokens(): readonly EditorToken[] {
    return this.syntax.getTokens()
  }

  getExpandedRegions(): ReadonlySet<string> {
    return this.regions.getExpandedRegions()
  }

  toggleRegion(key: string): void {
    if (this.mode !== 'document') return
    if (!this.file) return

    // The store fans the change back to every plugin reading it, this one included, so the rebuild
    // happens in `handleRegionsChanged` rather than here.
    this.regions.toggleRegion(key)
  }

  private handleRegionsChanged(): void {
    if (this.mode !== 'document') return
    if (!this.file) return

    this.rebuildRows()
    // Same file, different rows: the parsed token streams still apply, so this re-projects
    // synchronously and `getTokens()` is correct before the host's `setText` returns (§C10).
    this.syntax.setRows(this.rows)
    this.notifyRows()
  }

  onDidChangeRows(listener: () => void): EditorDisposable {
    this.rowListeners.add(listener)
    return { dispose: () => this.rowListeners.delete(listener) }
  }

  onDidChangeTokens(listener: () => void): EditorDisposable {
    this.tokenListeners.add(listener)
    return { dispose: () => this.tokenListeners.delete(listener) }
  }

  private rebuildRows(): void {
    this.stackedRows = null
    this.rows = projectRows(this.file, this.side, this.regions.getExpandedRegions())
    // Both derived once here rather than per gutter-width recompute and per mousemove.
    this.digits = diffGutterDigits(this.rows)
    this.hunkRows = this.rows.some((row) => row.type === 'hunk')
    this.expandableRows = this.rows.some((row) => row.type === 'hunk' && row.expandable === true)
  }

  private notifyRows(): void {
    for (const listener of this.rowListeners) listener()
    this.decoration?.refresh()
    this.view?.refreshRows()
  }

  private notifyTokens(): void {
    for (const listener of this.tokenListeners) listener()
  }

  // ---------------------------------------------------------------- overlay mode

  setBaseFile(file: DiffTextFile | null): void {
    if (this.mode !== 'overlay') return

    this.baseFile = file
    this.decoration?.refresh()
  }

  setEnabled(enabled: boolean): void {
    if (this.mode !== 'overlay') return

    this.enabled = enabled
    this.decoration?.refresh()
  }

  private injectedRows(): readonly EditorInjectedTextRow[] {
    if (!this.enabled) return []
    return this.liveProjection.injectedRows
  }

  private setInjectedRowsListener(listener: () => void): EditorDisposable {
    this.injectedRowsListener = listener
    return {
      dispose: () => {
        if (this.injectedRowsListener === listener) this.injectedRowsListener = null
      },
    }
  }

  private gutterDigits(): DiffGutterDigits {
    if (this.mode === 'overlay') return diffGutterDigits(this.liveProjection.rows)
    return this.digits
  }

  /**
   * Which diff row a rendered gutter row is showing. The two modes cannot share an answer.
   *
   * `document` — §C4 holds, so the projection index is the buffer row and a positional lookup is
   * correct.
   *
   * `overlay` — the projection array interleaves injected deletion rows, so position and buffer
   * row diverge from the first deletion onwards; the mapping the projection publishes for exactly
   * this purpose is `rowsByBufferRow`, keyed `newLineNumber - 1`. An injected row is not in that
   * map at all and carries its own row as metadata instead.
   */
  private resolveGutterRow(row: EditorGutterRowContext): DiffRenderRow | null {
    if (this.mode === 'overlay') {
      if (row.source === 'injected') return injectedDiffRow(row)
      if (row.source !== 'document') return null
      return this.liveProjection.rowsByBufferRow.get(row.bufferRow) ?? null
    }

    if (row.source !== 'document') return null
    return this.rows[row.bufferRow] ?? null
  }

  // ---------------------------------------------------------------- contributions

  private createDecorationContribution(
    context: EditorDecorationContributionContext,
  ): EditorDecorationContribution {
    const contribution = new DiffDecorationContribution(context, {
      mode: this.mode,
      getRows: () => this.rows,
      buildLiveProjection: () => this.buildLiveProjection(context),
      setLiveProjection: (projection) => {
        this.liveProjection = projection
      },
      notifyInjectedRowsChanged: () => this.injectedRowsListener?.(),
    })
    this.decoration = contribution
    contribution.refresh()
    return {
      handleEditorChange: (change) => contribution.handleEditorChange(change),
      dispose: () => {
        if (this.decoration === contribution) this.decoration = null
        contribution.dispose()
      },
    }
  }

  private buildLiveProjection(context: EditorDecorationContributionContext): LiveDiffProjection {
    if (!this.enabled) return EMPTY_PROJECTION
    if (!this.baseFile) return EMPTY_PROJECTION
    if (!context.hasDocument()) return EMPTY_PROJECTION

    const file = createTextDiff({
      oldFile: this.baseFile,
      newFile: {
        path: this.baseFile.path,
        text: liveDiffDocumentText(context),
        languageId: this.baseFile.languageId,
      },
    })
    return createLiveDiffProjection(file)
  }

  private createViewContribution(
    context: EditorViewContributionContext,
  ): EditorViewContribution | null {
    const contribution = new DiffViewContribution(context, {
      highlightName: `editor-diff-${this.id}-${this.side}-inline`,
      mode: this.mode,
      side: this.side,
      getRows: () => this.getRows(),
      hasHunkRows: () => this.hunkRows,
      hasExpandableRows: () => this.expandableRows,
      toggleRegion: (key) => this.toggleRegion(key),
      detach: (disposed) => {
        lentSyntax?.dispose()
        if (this.view === disposed) this.view = null
      },
    })
    const lentSyntax = context
      .getFeature(EDITOR_SNIPPET_TOKENS_FEATURE)
      ?.addSource(snippetTokenSource(this.options.syntaxBackend))
    this.view = contribution
    if (this.lastGutterLayout) contribution.applyGutterLayout(this.lastGutterLayout)
    return contribution
  }

  private publishGutterLayout(layout: DiffGutterLayout): void {
    // Retained, never consumed. `width()` can run before a view contribution exists, and a
    // contribution can be torn down and rebuilt later on a fresh scroll element carrying none of
    // these custom properties. The gutter memoizes on the layout, so it will not republish an
    // unchanged one — leaving a replacement contribution with no other way to learn the geometry,
    // and `.editor-diff-gutter` falling back to `1fr 1fr 12px`, which is the drift the whole
    // custom-property dance exists to avoid.
    this.lastGutterLayout = layout
    this.view?.applyGutterLayout(layout)
  }

  private createSyntaxController(): DiffSyntaxController {
    return new DiffSyntaxController({
      side: this.side,
      backend: this.options.syntaxBackend,
      enabled: this.options.syntaxHighlight !== false,
      onDidChangeTokens: () => this.notifyTokens(),
    })
  }
}

// A live diff compares whole documents, and the diff library takes strings: an explicit extraction.
function liveDiffDocumentText(context: EditorDecorationContributionContext): string {
  return context.materializeFullText()
}

function projectRows(
  file: DiffFile | null,
  side: DiffGutterSide,
  expandedRegions: ReadonlySet<string>,
): readonly DiffRenderRow[] {
  if (!file) return []
  if (side === 'stacked') return createStackedProjection(file, { expandedRegions }).rows

  const projection = createSplitProjection(file, { expandedRegions })
  return side === 'old' ? projection.leftRows : projection.rightRows
}

type DiffDecorationOptions = {
  readonly mode: DiffPluginMode
  readonly getRows: () => readonly DiffRenderRow[]
  readonly buildLiveProjection: () => LiveDiffProjection
  readonly setLiveProjection: (projection: LiveDiffProjection) => void
  readonly notifyInjectedRowsChanged: () => void
}

class DiffDecorationContribution {
  private lastTextSnapshot: unknown = undefined

  constructor(
    private readonly context: EditorDecorationContributionContext,
    private readonly options: DiffDecorationOptions,
  ) {}

  /**
   * The editor's notification, which is not the same thing as "the text changed".
   *
   * Rebuilding an overlay projection materializes the whole document and runs `structuredPatch`
   * over it, synchronously. `handleEditorChange` also fires for selection-only changes —
   * `EditorContributionChange.kind` is one of edit/selection/undo/redo/none — and a caret move cannot
   * alter the diff, so paying for one is pure waste on the typing path. Text-snapshot identity is
   * the second guard, for the notification paths that carry no change object at all.
   *
   * Plugin-state changes (`setBaseFile`, `setEnabled`) call `refresh()` directly and are never
   * skipped: the text is the same but the diff it produces is not.
   */
  handleEditorChange(change: EditorContributionChange | null): void {
    if (this.options.mode === 'overlay') {
      if (change?.kind === 'selection') return

      const snapshot = this.context.getTextSnapshot()
      if (snapshot !== null && snapshot === this.lastTextSnapshot) return
    }

    this.refresh()
  }

  refresh(): void {
    this.lastTextSnapshot = this.context.getTextSnapshot()
    if (this.options.mode === 'document') {
      this.context.setRowDecorations(
        ROW_DECORATION_SOURCE,
        diffRowDecorations(this.options.getRows()),
      )
      return
    }

    this.applyLiveProjection(this.options.buildLiveProjection())
  }

  dispose(): void {
    if (this.options.mode === 'overlay') this.applyLiveProjection(EMPTY_PROJECTION)
    this.context.clearRowDecorations(ROW_DECORATION_SOURCE)
  }

  /**
   * These three steps are ordered, and the order is load-bearing.
   *
   * Announcing the injected-row change first would rebuild the row set before the cells are
   * repainted, and a row that the rebuild unmounts keeps whatever its cell last rendered — a
   * disabled live diff would leave a stale `4+` behind on a detached cell. Repainting first, while
   * that row is still mounted, is what clears it.
   *
   * The stored projection has to be current before the repaint, because the gutter reads its rows
   * from it.
   */
  private applyLiveProjection(projection: LiveDiffProjection): void {
    this.options.setLiveProjection(projection)
    this.context.setRowDecorations(ROW_DECORATION_SOURCE, projection.rowDecorations)
    this.options.notifyInjectedRowsChanged()
  }
}

type DiffViewOptions = {
  readonly highlightName: string
  readonly mode: DiffPluginMode
  readonly side: DiffGutterSide
  readonly getRows: () => readonly DiffRenderRow[]
  readonly hasHunkRows: () => boolean
  readonly hasExpandableRows: () => boolean
  readonly toggleRegion: (key: string) => void
  readonly detach: (contribution: DiffViewContribution) => void
}

/** Pointer handling and inline word-diff highlights. */
class DiffViewContribution implements EditorViewContribution {
  readonly snapshotKey = 'diff-inline-v1'
  private readonly pressParticipant: EditorDisposable
  private readonly separatorRows: EditorDisposable
  private snapshot: EditorViewSnapshot | null = null
  private lastHighlightRows: readonly DiffRenderRow[] | null = null
  private lastHighlightTextVersion = -1

  constructor(
    private readonly context: EditorViewContributionContext,
    private readonly options: DiffViewOptions,
  ) {
    this.context.scrollElement.dataset.editorDiffSide = options.side
    viewsByScrollElement.set(this.context.scrollElement, this)
    this.pressParticipant = this.context.registerPressParticipant(this.claimSeparatorPress)
    this.separatorRows = this.context.registerNonCaretRows(this.isSeparatorRow)
    this.context.scrollElement.addEventListener('click', this.handleClick)
    this.context.scrollElement.addEventListener('mousemove', this.handleMouseMove)
    this.context.scrollElement.addEventListener('mouseleave', this.handleMouseLeave)
  }

  /**
   * The snapshot is kept for every update kind — the pointer hit-test reads it — but the two
   * derived jobs below are not per-frame work.
   *
   * `update` is called for `'viewport'` too, which `Editor.handleViewportChange` fires on every
   * scroll frame, and the highlights can only change when the rows or the text do.
   */
  update(snapshot: EditorViewSnapshot, kind: EditorViewContributionUpdateKind): void {
    this.snapshot = snapshot
    if (this.options.mode !== 'document') return
    if (kind === 'viewport' || kind === 'selection') return

    this.applyInlineHighlights()
  }

  captureVisiblePaint(snapshot: EditorViewSnapshot) {
    const viewport = this.context.scrollElement.getBoundingClientRect()
    const rows = this.options.getRows()
    const ranges = snapshot.visibleRows.flatMap((visible) => {
      const row = rows[visible.bufferRow]
      if (!row) return []
      const start = snapshot.lineStartsView.at(visible.bufferRow) ?? visible.startOffset
      return diffInlineHighlightRanges([row]).map((range) => ({
        start: range.start + start,
        end: range.end + start,
      }))
    })
    const rectangles = []
    for (const range of ranges) {
      const rect = this.context.getRangeClientRect(range.start, range.end)
      if (!rect || rect.width <= 0 || rect.height <= 0) continue
      rectangles.push({
        left: rect.left - viewport.left + snapshot.viewport.scrollLeft,
        top: rect.top - viewport.top + snapshot.viewport.scrollTop,
        width: rect.width,
        height: rect.height,
        backgroundColor: INLINE_HIGHLIGHT_STYLE.backgroundColor,
      })
    }
    return { id: `diff-inline-${this.options.side}`, status: 'ready' as const, rectangles }
  }

  refreshRows(): void {
    this.lastHighlightRows = null
    this.applyInlineHighlights()
  }

  applyGutterLayout(layout: DiffGutterLayout): void {
    // §3.3 trap 1: the canvas derived lane geometry arithmetically, so a DOM gutter has to hand CSS
    // the same numbers rather than approximate them with `1fr 1fr 12px`.
    const style = this.context.scrollElement.style
    const columns = layout.lanes.map((lane) => `${lane.width}px`).join(' ')
    style.setProperty('--editor-diff-gutter-columns', columns)
    style.setProperty('--editor-diff-gutter-total-width', `${layout.width}px`)
  }

  dispose(): void {
    this.pressParticipant.dispose()
    this.separatorRows.dispose()
    this.context.scrollElement.removeEventListener('click', this.handleClick)
    this.context.scrollElement.removeEventListener('mousemove', this.handleMouseMove)
    this.context.scrollElement.removeEventListener('mouseleave', this.handleMouseLeave)
    this.context.scrollElement.style.cursor = ''
    // A replacement view on the same element may already have registered itself.
    if (viewsByScrollElement.get(this.context.scrollElement) === this) {
      viewsByScrollElement.delete(this.context.scrollElement)
    }
    this.context.clearRangeHighlight(this.options.highlightName)
    // Or the runtime keeps writing highlights and gutter geometry through a torn-down context,
    // and holds its scroll element alive for the plugin's lifetime.
    this.options.detach(this)
  }

  // A highlight failure must not dispose the contribution and disable gutter expansion.
  private applyInlineHighlights(): void {
    const rows = this.options.getRows()
    const textVersion = this.snapshot?.textVersion ?? -1
    // Rows alone cannot key this: the view clamps ranges to the text it holds when they are set,
    // and the host pushes the new text only after the rows notification that first lands here.
    if (rows === this.lastHighlightRows && textVersion === this.lastHighlightTextVersion) return

    this.lastHighlightRows = rows
    this.lastHighlightTextVersion = textVersion
    try {
      this.context.setRangeHighlight(
        this.options.highlightName,
        diffInlineHighlightRanges(rows),
        INLINE_HIGHLIGHT_STYLE,
      )
    } catch (error) {
      this.context.log({
        action: 'editor.diff.inline_highlight_failed',
        level: 'warn',
        error: { message: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  /**
   * Keeps the caret off a separator row, expandable or not.
   *
   * A separator is chrome, not content — but its label is real buffer text, because the host's
   * document is `joinRenderLines(rows)` and there is nowhere else for the label to live. So the
   * editor will happily rest a caret in the middle of `Show 12 unmodified lines`, and a collapsed
   * caret copies its own line: Cmd+C would put that sentence on the clipboard. The mousedown is
   * refused here, and arrow keys step over the row (`isSeparatorRow`). A drag that *crosses* a separator still
   * covers it, and always will while the label occupies offsets — giving these rows an offset
   * space of their own is the parallel coordinate system §C2 rules out.
   *
   * Every click count, not just the first: a second press would select a word of the label, a
   * third its line and a fourth the whole document.
   */
  private readonly claimSeparatorPress = (event: MouseEvent): boolean =>
    event.button === 0 && this.hunkRowAt(event) !== null

  /** The keyboard half of the same rule: arrow keys step over a separator. */
  private readonly isSeparatorRow = (bufferRow: number): boolean => {
    if (this.options.mode !== 'document' || !this.options.hasHunkRows()) return false
    return this.options.getRows()[bufferRow]?.type === 'hunk'
  }

  private readonly handleClick = (event: MouseEvent): void => {
    if (event.button !== 0) return

    const row = this.expandableRowAt(event)
    if (!row?.expandKey) return

    event.preventDefault()
    this.options.toggleRegion(row.expandKey)
  }

  private readonly handleMouseMove = (event: MouseEvent): void => {
    const cursor = this.expandableRowAt(event) ? 'pointer' : ''
    if (this.context.scrollElement.style.cursor === cursor) return

    this.context.scrollElement.style.cursor = cursor
  }

  private readonly handleMouseLeave = (): void => {
    if (!this.context.scrollElement.style.cursor) return

    this.context.scrollElement.style.cursor = ''
  }

  private expandableRowAt(event: MouseEvent): DiffRenderRow | null {
    // Avoid a point query on every mousemove when no separator can expand.
    if (!this.options.hasExpandableRows()) return null

    const row = this.hunkRowAt(event)
    return row?.expandable ? row : null
  }

  /**
   * The separator under the pointer, whether or not it can be expanded. A partial diff — a plain
   * patch with no file text behind it — has separators that say how much was skipped and cannot
   * open them, and those are still not somewhere a caret belongs.
   */
  private hunkRowAt(event: MouseEvent): DiffRenderRow | null {
    if (!this.options.hasHunkRows()) return null

    const hit = this.rowHitAt(event)
    const row = hit?.rows[hit.rowIndex]
    return row?.type === 'hunk' ? row : null
  }

  /** Only `document` mode has an answer: there a buffer row is an index into `getRows()`. */
  rowHitAt(event: MouseEvent): DiffRowHit | null {
    if (this.options.mode !== 'document') return null

    const hit = this.context.rowAtPoint(event.clientX, event.clientY)
    if (hit?.source !== 'document') return null
    const rowIndex = hit.bufferRow

    const rows = this.options.getRows()
    return rows[rowIndex] ? { side: this.options.side, rowIndex, rows } : null
  }
}

function injectedDiffRow(row: EditorGutterRowContext): DiffRenderRow | null {
  const metadata = row.metadata
  if (!metadata || typeof metadata !== 'object') return null
  return 'type' in metadata && 'text' in metadata ? (metadata as DiffRenderRow) : null
}

function snippetTokenSource(backend: DiffSyntaxBackend | undefined): EditorSnippetTokenSource {
  if (backend?.kind === 'highlighter') return { highlighter: backend.provider }
  return { syntax: backend?.provider }
}
