import { compareTextOffsetRanges, type DocumentSyncPoint } from '@singapore-editor/core/document'
import {
  type EditorContributionChange,
  projectDecorationRangeThroughEdits,
} from '@singapore-editor/core/extensions'
import type {
  EditorCapabilityContribution,
  EditorCapabilityContributionContext,
  EditorCapabilityContributionProvider,
  EditorCommandContribution,
  EditorCommandContributionContext,
  EditorCommandContributionProvider,
  EditorDisposable,
  EditorEditContribution,
  EditorEditContributionContext,
  EditorEditContributionProvider,
  EditorFindFeature,
  EditorMinimapDecoration,
  EditorMinimapFeature,
  EditorPlugin,
  EditorResolvedSelection,
  EditorViewContribution,
  EditorViewContributionContext,
  EditorViewContributionProvider,
  EditorViewContributionUpdateKind,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import {
  EDITOR_FIND_FEATURE,
  EDITOR_FIND_FEATURE_ID,
  EDITOR_MINIMAP_FEATURE,
} from '@singapore-editor/core/extensions'
import type { VirtualizedTextHighlightStyle } from '@singapore-editor/core/rendering'
import {
  EditorFindController,
  type EditorFindHost,
  type EditorFindResolvedSelection,
  type EditorFindUiEvent,
  type FindTrackedRanges,
} from './findController'
import { EditorFindWidget, type EditorFindWidgetOptions } from './findWidget'
import { type FindLineStartsView, type FindRange, type FindTextSource } from './search'
import type { EditorFindOptions } from './types'

export { EDITOR_FIND_FEATURE, EDITOR_FIND_FEATURE_ID }

export type EditorFindContributionProviders = {
  readonly view: EditorViewContributionProvider
  readonly command: EditorCommandContributionProvider
  readonly capability: EditorCapabilityContributionProvider
  readonly edit: EditorEditContributionProvider
}

export function createEditorFindPlugin(options: EditorFindOptions = {}): EditorPlugin {
  return {
    name: 'editor.find',
    activate(context) {
      const providers = createEditorFindContributionProviders(options)
      return [
        context.registerViewContribution(providers.view),
        context.registerCommandContribution(providers.command),
        context.registerCapabilityContribution(providers.capability),
        context.registerEditContribution(providers.edit),
      ]
    },
  }
}

export function createEditorFindContributionProviders(
  options: EditorFindOptions = {},
): EditorFindContributionProviders {
  const controller = new EditorFindController(options)
  return {
    view: {
      createContribution: (context) => new EditorFindViewContribution(context, controller),
    },
    command: {
      createContribution: (context) => new EditorFindCommandContribution(context, controller),
    },
    capability: {
      createContribution: (context) => new EditorFindCapabilityContribution(context, controller),
    },
    edit: {
      createContribution: (context) => new EditorFindEditContribution(context, controller),
    },
  }
}

class EditorFindViewContribution implements EditorViewContribution {
  private readonly hostRegistration: EditorDisposable
  private readonly subscription: EditorDisposable
  private readonly visibleKey: EditorDisposable
  private latestSnapshot: EditorViewSnapshot
  private widget: EditorFindWidget | null = null
  private reservationListener: EditorDisposable | null = null
  private paintedMatches: PaintedFindRanges | null = null

  public constructor(
    private readonly context: EditorViewContributionContext,
    private readonly controller: EditorFindController,
  ) {
    this.latestSnapshot = context.getSnapshot()
    this.hostRegistration = controller.attachHost(
      createFindHost(context, () => this.latestSnapshot, this.trackPaintedRanges),
      context.highlightPrefix,
    )
    this.subscription = controller.subscribe(this.handleUiEvent)
    this.visibleKey = context.registerKeymapContextKey('findVisible', () => controller.isVisible())
  }

  public update(
    snapshot: EditorViewSnapshot,
    kind: EditorViewContributionUpdateKind,
    change?: EditorContributionChange | null,
  ): void {
    if (
      kind === 'layout' ||
      snapshot.viewport.clientWidth !== this.latestSnapshot.viewport.clientWidth
    ) {
      this.syncTrailingInset()
    }
    this.latestSnapshot = snapshot
    // Scrolling is the one thing that moves rows under the marks without an edit
    // having happened yet, which is the only moment left to start following the
    // ones it brought in front of the reader.
    // Re-read after the line moves, not only after an edit: the set the controller is painting was
    // copied out of these ranges, so a match promoted into the mounted rows by the scroll is still
    // at the offset it was found at until the copy is taken again.
    if (kind === 'viewport' || kind === 'layout') {
      if (this.paintedMatches?.repartition(snapshot)) this.controller.refreshTrackedMatches()
    }
    this.controller.handleViewUpdate(kind, change ?? null)
  }

  public dispose(): void {
    this.visibleKey.dispose()
    this.subscription.dispose()
    this.reservationListener?.dispose()
    this.reservationListener = null
    this.widget?.dispose()
    this.widget = null
    this.paintedMatches = null
    this.hostRegistration.dispose()
  }

  private readonly trackPaintedRanges = (ranges: readonly FindRange[]): FindTrackedRanges => {
    this.paintedMatches = new PaintedFindRanges(this.context, this.latestSnapshot, ranges)
    return this.paintedMatches
  }

  private readonly handleUiEvent = (event: EditorFindUiEvent): void => {
    if (event.type === 'show') {
      this.ensureWidget().show(event.replaceVisible)
      return
    }

    if (event.type === 'hide') {
      this.widget?.hide()
      // Nothing reads the set once it is off screen, so leaving it here would
      // have every scroll from now on redraw a line across it for nobody.
      this.paintedMatches = null
      return
    }

    if (event.type === 'update') {
      this.widget?.update(event.state)
      return
    }

    this.focusWidget(event.target)
  }

  private focusWidget(target: 'find' | 'replace'): void {
    const widget = this.widget
    if (!widget) return

    if (target === 'find') widget.focusFindInput()
    if (target === 'replace') widget.focusReplaceInput()
  }

  private ensureWidget(): EditorFindWidget {
    if (this.widget) return this.widget

    this.widget = new EditorFindWidget(
      this.context.container,
      this.context.scrollElement,
      this.createWidgetOptions(),
    )
    this.observeReservedWidth()
    this.syncTrailingInset()
    return this.widget
  }

  private observeReservedWidth(): void {
    this.reservationListener ??= this.context.onDidChangeReservedOverlayWidth((side) => {
      if (side === 'right') this.syncTrailingInset()
    })
  }

  private syncTrailingInset(): void {
    if (!this.widget) return

    const { container, scrollElement } = this.context
    const containerRight =
      container.getBoundingClientRect().left + container.clientLeft + container.clientWidth
    const viewportRight =
      scrollElement.getBoundingClientRect().left +
      scrollElement.clientLeft +
      scrollElement.clientWidth
    const reservedWidth = this.context.getReservedOverlayWidth('right')
    this.widget.setTrailingInset(reservedWidth + Math.max(0, containerRight - viewportRight))
  }

  private createWidgetOptions(): EditorFindWidgetOptions {
    return {
      onSearchInput: (value) => this.controller.setSearchString(value),
      onReplaceInput: (value) => this.controller.setReplaceString(value),
      onToggleReplace: () => this.controller.toggleReplace(),
      onPrevious: () => this.controller.findPrevious(),
      onNext: () => this.controller.findNext(),
      onClose: () => this.controller.close(),
      onToggleCase: () => this.controller.toggleMatchCase(),
      onToggleWholeWord: () => this.controller.toggleWholeWord(),
      onToggleRegex: () => this.controller.toggleRegex(),
      onToggleScope: () => this.controller.toggleFindInSelection(),
      onTogglePreserveCase: () => this.controller.togglePreserveCase(),
      onReplaceOne: () => this.controller.replaceOne(),
      onReplaceAll: () => this.controller.replaceAll(),
    }
  }
}

class EditorFindCommandContribution implements EditorCommandContribution {
  private readonly commands: readonly EditorDisposable[]

  public constructor(context: EditorCommandContributionContext, controller: EditorFindController) {
    this.commands = [
      context.registerCommand('find', () => controller.toggleFind()),
      context.registerCommand('findReplace', () => controller.openFindReplace()),
      context.registerCommand('findNext', () => controller.findNext()),
      context.registerCommand('findPrevious', () => controller.findPrevious()),
      context.registerCommand('closeFind', () => controller.close()),
      context.registerCommand('toggleFindCaseSensitive', () => controller.toggleMatchCase()),
      context.registerCommand('toggleFindWholeWord', () => controller.toggleWholeWord()),
      context.registerCommand('toggleFindRegex', () => controller.toggleRegex()),
      context.registerCommand('toggleFindInSelection', () => controller.toggleFindInSelection()),
      context.registerCommand('togglePreserveCase', () => controller.togglePreserveCase()),
      context.registerCommand('replaceOne', () => controller.replaceOne()),
      context.registerCommand('replaceAll', () => controller.replaceAll()),
      context.registerCommand('selectAllMatches', () => controller.selectAllMatches()),
    ]
  }

  public dispose(): void {
    disposeAll(this.commands)
  }
}

class EditorFindCapabilityContribution implements EditorCapabilityContribution {
  private readonly registration: EditorDisposable

  public constructor(
    context: EditorCapabilityContributionContext,
    controller: EditorFindController,
  ) {
    this.registration = context.registerFeature(EDITOR_FIND_FEATURE, createFindFeature(controller))
  }

  public dispose(): void {
    this.registration.dispose()
  }
}

class EditorFindEditContribution implements EditorEditContribution {
  private readonly registration: EditorDisposable

  public constructor(context: EditorEditContributionContext, controller: EditorFindController) {
    this.registration = controller.attachEditHost({
      textSnapshot: () => context.getTextSnapshot(),
      getSelections: () => findSelections(context.getSelections()),
      applyEdits: (edits, timingName, selection) =>
        context.applyEdits(edits, timingName, selection),
    })
  }

  public dispose(): void {
    this.registration.dispose()
  }
}

function createFindFeature(controller: EditorFindController): EditorFindFeature {
  return {
    openFind: () => controller.openFind(),
    toggleFind: () => controller.toggleFind(),
    openFindReplace: () => controller.openFindReplace(),
    closeFind: () => controller.close(),
    findNext: () => controller.findNext(),
    findPrevious: () => controller.findPrevious(),
    replaceOne: () => controller.replaceOne(),
    replaceAll: () => controller.replaceAll(),
    selectAllMatches: () => controller.selectAllMatches(),
  }
}

function createFindHost(
  context: EditorViewContributionContext,
  getSnapshot: () => EditorViewSnapshot,
  trackPaintedRanges: (ranges: readonly FindRange[]) => FindTrackedRanges,
): EditorFindHost {
  const textSource = snapshotTextSource()
  return {
    hasDocument: () => context.hasDocument(),
    textSource: () => textSource(getSnapshot()),
    hasTextSnapshot: (snapshot) => getSnapshot().textSnapshot === snapshot,
    trackRanges: (ranges) => context.trackRanges(ranges),
    trackPaintedRanges,
    getSelections: () => findSelections(getSnapshot().selections),
    focusEditor: () => context.focusEditor(),
    announce: (message) => context.announce(message),
    setSelection: (anchor, head, timingName, options) =>
      context.setSelection(anchor, head, timingName, options),
    setSelections: (selections, timingName, revealOffset) =>
      context.setSelections(selections, timingName, revealOffset),
    setRangeHighlight: (name, ranges, style) => {
      context.setRangeHighlight(name, ranges, style)
      minimapFeature(context)?.setDecorations(
        name,
        minimapBands(textSource(getSnapshot()).lineStartsView, ranges, style),
      )
    },
    clearRangeHighlight: (name) => {
      context.clearRangeHighlight(name)
      minimapFeature(context)?.clearDecorations(name)
    },
  }
}

function minimapFeature(context: EditorViewContributionContext): EditorMinimapFeature | null {
  return context.getFeature(EDITOR_MINIMAP_FEATURE)
}

/**
 * A count says how many matches there are and nothing says where they are until
 * they reach the scroll furniture, so every group find paints in the text is
 * published under the name it is painted under.
 *
 * The band keeps its group's own colour: the minimap paints onto a canvas from a
 * worker, which has no element to resolve a registered colour against and
 * silently substitutes the selection colour for anything it cannot parse, so the
 * literal has to travel with the group rather than be looked up there.
 */
function minimapBands(
  lineStartsView: FindLineStartsView,
  ranges: readonly FindRange[],
  style: VirtualizedTextHighlightStyle,
): readonly EditorMinimapDecoration[] {
  return ranges.map((range): EditorMinimapDecoration => {
    const rows = bandRows(lineStartsView, range)
    return {
      startLineNumber: rows.start,
      startColumn: 1,
      endLineNumber: rows.end,
      endColumn: 1,
      color: style.backgroundColor,
      position: 'inline',
      zIndex: style.zIndex,
    }
  })
}

// A range ending exactly at a line start ends on the row before it: the break
// belongs to the line it terminates, and a selection taken to the end of one row
// should not shade the next.
function bandRows(
  lineStartsView: FindLineStartsView,
  range: FindRange,
): { readonly start: number; readonly end: number } {
  const startIndex = lineStartsView.indexForOffset(range.start)
  const endIndex = lineStartsView.indexForOffset(range.end)
  if (endIndex > startIndex && lineStartsView.at(endIndex) === range.end) {
    return { start: startIndex + 1, end: endIndex }
  }

  return { start: startIndex + 1, end: endIndex + 1 }
}

/**
 * Follows the ranges as far as they are painted, answering for the rest with the
 * offsets it was handed.
 *
 * A span the reader cannot see cannot be seen standing on text that moved out
 * from under it, and the re-search already on its way replaces the whole set
 * either way. Handing the document every match instead costs it an anchor pair
 * each, on every keystroke — the bill deferring that re-search was supposed to
 * take off the keystroke in the first place.
 *
 * Which of them those are is a fact about the rows mounted at the time and not
 * about the set, so it stops being true the moment the reader scrolls. Drawn once
 * and left, the line would divide the screenful they have scrolled away from,
 * and every mark now in front of them would be one nobody is following.
 */
// A match is the text the query answered for, so typing against either edge of one is not part of
// it — unlike a scope, which is a region the reader drew and which takes in what they add at its
// edges. The same pair decides how an offset is carried across an edit nobody was following.
const MATCH_BIAS = { startBias: 'right', endBias: 'left' } as const

class PaintedFindRanges implements FindTrackedRanges {
  private span: FindRange | null = null
  private tracked: FindTrackedRanges | null = null
  private elsewhere: readonly FindRange[]
  /** Text version the offsets in `elsewhere` describe, which is not always the document's. */
  private elsewhereVersion: number
  private elsewhereSyncPoint: DocumentSyncPoint

  public constructor(
    private readonly context: EditorViewContributionContext,
    snapshot: EditorViewSnapshot,
    ranges: readonly FindRange[],
  ) {
    this.elsewhere = ranges
    this.elsewhereVersion = snapshot.textVersion
    this.elsewhereSyncPoint = snapshot.documentSyncPoint
    this.partition(snapshot)
  }

  public resolve(): readonly FindRange[] {
    if (!this.tracked) return this.elsewhere
    return mergeRanges(this.tracked.resolve(), this.elsewhere)
  }

  /** Answers whether the line moved, so a caller only re-reads the set when there is a reason to. */
  public repartition(snapshot: EditorViewSnapshot): boolean {
    return this.partition(snapshot)
  }

  private partition(snapshot: EditorViewSnapshot): boolean {
    const span = paintedSpan(snapshot)
    if (!span || sameSpan(span, this.span)) return false

    // Read back first: what is already followed has moved since it was handed
    // over, and re-partitioning the offsets of the search would undo that.
    this.carryElsewhereForward(snapshot)
    const ranges = this.resolve()
    const painted = ranges.filter((range) => overlapsSpan(range, span))
    const tracked = painted.length === 0 ? null : this.context.trackRanges(painted, MATCH_BIAS)

    this.span = span
    this.tracked = tracked
    this.elsewhere = tracked ? ranges.filter((range) => !overlapsSpan(range, span)) : ranges
    this.elsewhereVersion = snapshot.textVersion
    this.elsewhereSyncPoint = snapshot.documentSyncPoint
    return true
  }

  /**
   * Brings the unfollowed half up to the document before any of it is promoted.
   *
   * Nothing follows a match the reader cannot see, so an edit that lands while they are looking
   * elsewhere leaves those offsets describing text that has moved. Scrolling then hands one of them
   * to the document to be followed from where it used to be, and the mark lands beside its word —
   * the defect being followed at all was supposed to prevent, arriving one scroll later. The edits
   * are replayed where the host can name them, and where it cannot the offsets are dropped rather
   * than promoted: no mark is the honest answer for the moment before the re-search lands, and a
   * mark on the wrong word is not.
   */
  private carryElsewhereForward(snapshot: EditorViewSnapshot): void {
    if (snapshot.textVersion === this.elsewhereVersion) return
    if (this.elsewhere.length === 0) {
      this.elsewhereVersion = snapshot.textVersion
      this.elsewhereSyncPoint = snapshot.documentSyncPoint
      return
    }

    const edits =
      snapshot.changesSinceDocumentSyncPoint(this.elsewhereSyncPoint, null)?.edits ?? null
    this.elsewhere = edits
      ? this.elsewhere
          .map((range) => projectDecorationRangeThroughEdits({ ...range, ...MATCH_BIAS }, edits))
          .filter((range) => range !== null)
          .map((range) => ({ end: range.end, start: range.start }))
      : []
    this.elsewhereVersion = snapshot.textVersion
    this.elsewhereSyncPoint = snapshot.documentSyncPoint
  }
}

// The view adds a range highlight to the rows it has mounted and to no others.
function paintedSpan(snapshot: EditorViewSnapshot): FindRange | null {
  const first = snapshot.visibleRows[0]
  const last = snapshot.visibleRows.at(-1)
  if (!first || !last) return null

  return { start: first.startOffset, end: last.endOffset }
}

function overlapsSpan(range: FindRange, span: FindRange): boolean {
  return range.end > span.start && range.start < span.end
}

function sameSpan(span: FindRange, other: FindRange | null): boolean {
  return other !== null && span.start === other.start && span.end === other.end
}

// Navigation steps the set rather than searching it, so an entry out of order
// answers the next press with the wrong match.
function mergeRanges(
  left: readonly FindRange[],
  right: readonly FindRange[],
): readonly FindRange[] {
  if (right.length === 0) return left

  const merged: FindRange[] = []
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    if (compareTextOffsetRanges(left[leftIndex]!, right[rightIndex]!) <= 0) {
      merged.push(left[leftIndex]!)
      leftIndex += 1
      continue
    }

    merged.push(right[rightIndex]!)
    rightIndex += 1
  }

  for (; leftIndex < left.length; leftIndex += 1) merged.push(left[leftIndex]!)
  for (; rightIndex < right.length; rightIndex += 1) merged.push(right[rightIndex]!)
  return merged
}

/**
 * The text a search reads, kept for as long as the snapshot it was taken from.
 *
 * Either view can be absent, and standing in for a missing one materializes what
 * it exists to avoid: a copy of the document, or the whole line-start array.
 * Every press in the find box searches again, so a stand-in built per search
 * would hand a keystroke exactly the bill that ranged reads are here to spare it.
 * Held against the snapshot itself rather than its text version, because a
 * document swap can carry that version across unchanged.
 */
function snapshotTextSource(): (snapshot: EditorViewSnapshot) => FindTextSource {
  let cached: { readonly snapshot: EditorViewSnapshot; readonly source: FindTextSource } | null =
    null
  return (snapshot) => {
    if (cached?.snapshot !== snapshot) cached = { snapshot, source: findTextSource(snapshot) }
    return cached.source
  }
}

function findTextSource(snapshot: EditorViewSnapshot): FindTextSource {
  const text = snapshot.textSnapshot
  return {
    length: text.length,
    readRange: (start, end) => text.readRange(start, end),
    lineStartsView: snapshot.lineStartsView,
  }
}

function findSelections(
  selections: readonly EditorResolvedSelection[],
): readonly EditorFindResolvedSelection[] {
  return selections.map((selection) => ({
    ...selection,
    collapsed: selection.startOffset === selection.endOffset,
  }))
}

function disposeAll(disposables: readonly EditorDisposable[]): void {
  for (const disposable of disposables.toReversed()) disposable.dispose()
}

export type { EditorFindFeature, EditorFindOptions }
