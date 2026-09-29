import { scheduleFrame, type ScheduledFrame } from '@singapore-editor/core/rendering'
import type { TextReadSnapshot } from '@singapore-editor/core/document'
import type { VirtualizedFoldMarker } from '@singapore-editor/core/rendering'
import type {
  EditorContributionChange,
  EditorPlugin,
  EditorViewContribution,
  EditorViewContributionContext,
  EditorViewContributionUpdateKind,
  EditorViewSnapshot,
  EditorVisiblePaintCapture,
  EditorVisiblePaintRectangle,
  EditorVisibleRowSnapshot,
} from '@singapore-editor/core/extensions'
import './style.css'

export { BRACKET_COLOR_Z_INDEX, createBracketColorsPlugin } from './bracketColors'
export type { BracketColorsPluginOptions } from './bracketColors'
export { createStickyScrollPlugin } from './stickyScroll'
export type { StickyScrollPluginOptions } from './stickyScroll'

export type ScopeLinesPluginOptions = {
  readonly enabled?: boolean
  readonly className?: string
  readonly minLineSpan?: number
  readonly mode?: ScopeLinesMode
  readonly showActive?: boolean
}

export type ScopeLinesMode = 'all' | 'current'

type ResolvedScopeLinesOptions = {
  readonly enabled: boolean
  readonly className?: string
  readonly minLineSpan: number
  readonly mode: ScopeLinesMode
  readonly showActive: boolean
}

type ScopeGuide = {
  readonly marker: VirtualizedFoldMarker
  readonly column: number
  readonly indentLevel: number
  readonly containsCursor: boolean
  readonly active: boolean
}

type ScopeLineSegment = {
  readonly column: number
  readonly indentLevel: number
  readonly top: number
  readonly height: number
  readonly active: boolean
}

type RenderedScopeLineSegment = {
  readonly segment: ScopeLineSegment
  readonly element: HTMLDivElement
}

type ScopeGuidePlacement = {
  readonly column: number
  readonly indentLevel: number
}

type ScopeGuideGeometry = ScopeGuidePlacement & {
  readonly marker: VirtualizedFoldMarker
}

type ScopeLinesRenderContext = {
  readonly snapshot: EditorViewSnapshot
  readonly textSnapshot: TextReadSnapshot
  readonly lineTextCache: Map<number, string>
  readonly indentColumnCache: Map<number, number>
}

type ScopeLinesRenderModel = {
  readonly signature: string
  readonly segments: readonly ScopeLineSegment[]
}

type VisibleTextRowBounds = {
  readonly startRow: number
  readonly endRow: number
}

const DEFAULT_MIN_LINE_SPAN = 1
// The body is only sampled this far in. Every scope on screen is measured on every frame that moves
// one of them, so a file-length scope must not cost a file-length scan; the first lines of a block
// are also where its indentation is decided, and a later outlier is not worth a frame to find.
const BODY_INDENT_PROBE_LINES = 24
const SCOPE_LINE_COLOR_COUNT = 6

export function createScopeLinesPlugin(options: ScopeLinesPluginOptions = {}): EditorPlugin {
  const resolved = resolveScopeLinesOptions(options)

  return {
    name: 'scope-lines',
    activate(context) {
      return context.registerViewContribution({
        createContribution: (contributionContext) =>
          createScopeLinesContribution(contributionContext, resolved),
      })
    },
  }
}

function createScopeLinesContribution(
  context: EditorViewContributionContext,
  options: ResolvedScopeLinesOptions,
): EditorViewContribution | null {
  if (!options.enabled) return null
  return new ScopeLinesContribution(context, options)
}

class ScopeLinesContribution implements EditorViewContribution {
  public readonly snapshotKey: string
  private readonly context: EditorViewContributionContext
  private readonly root: HTMLDivElement
  private readonly options: ResolvedScopeLinesOptions
  private pendingContentSnapshot: EditorViewSnapshot | null = null
  private pendingContentFrame: ScheduledFrame | null = null
  private renderedSnapshot: EditorViewSnapshot | null = null
  private renderedSegments: readonly RenderedScopeLineSegment[] = []
  private signature = ''

  public constructor(context: EditorViewContributionContext, options: ResolvedScopeLinesOptions) {
    this.context = context
    this.options = options
    this.snapshotKey = `scope-lines:${JSON.stringify(options)}`
    this.root = createRoot(context, options)
    this.update(context.getSnapshot(), 'document')
  }

  public update(
    snapshot: EditorViewSnapshot,
    kind: EditorViewContributionUpdateKind,
    _change?: EditorContributionChange | null,
  ): void {
    if (snapshot.geometryCommitted === false) return
    if (kind === 'content') {
      this.scheduleContentUpdate(snapshot)
      return
    }

    this.cancelContentUpdate()
    this.renderSnapshot(snapshot)
  }

  public captureVisiblePaint(snapshot: EditorViewSnapshot): EditorVisiblePaintCapture {
    if (this.pendingContentSnapshot || snapshot !== this.renderedSnapshot) {
      return { id: 'scope-lines', status: 'pending' }
    }
    if (snapshot.syntaxStatus === 'loading') return { id: 'scope-lines', status: 'pending' }

    const rectangles = captureScopeLineRectangles(this.renderedSegments, snapshot)
    if (!rectangles) return { id: 'scope-lines', status: 'pending' }
    return { id: 'scope-lines', status: 'ready', rectangles }
  }

  public dispose(): void {
    this.cancelContentUpdate()
    this.root.remove()
  }

  private scheduleContentUpdate(snapshot: EditorViewSnapshot): void {
    this.pendingContentSnapshot = snapshot
    if (this.pendingContentFrame !== null) return

    this.pendingContentFrame = scheduleFrame(
      this.flushContentUpdate,
      this.root.ownerDocument.defaultView ?? globalThis,
    )
  }

  private flushContentUpdate = (): void => {
    const snapshot = this.pendingContentSnapshot
    this.pendingContentFrame = null
    this.pendingContentSnapshot = null
    if (!snapshot || this.context.getSnapshot().geometryCommitted === false) return

    this.renderSnapshot(snapshot)
    this.context.requestViewUpdate()
  }

  private cancelContentUpdate(): void {
    const frame = this.pendingContentFrame
    this.pendingContentFrame = null
    this.pendingContentSnapshot = null
    if (frame === null) return

    frame.cancel()
  }

  private renderSnapshot(snapshot: EditorViewSnapshot): void {
    const renderContext = createScopeLinesRenderContext(snapshot)
    const model = measureScopeLinesPerformance(
      'scopeLines.renderModel',
      () => createScopeLinesRenderModel(renderContext, this.options),
      () => ({
        markerCount: snapshot.foldMarkers.length,
        visibleRows: snapshot.visibleRows.length,
      }),
    )
    if (model.signature === this.signature) {
      this.renderedSnapshot = snapshot
      return
    }

    this.signature = model.signature
    this.renderedSegments = renderScopeLines(this.root, snapshot, model)
    this.renderedSnapshot = snapshot
  }
}

function captureScopeLineRectangles(
  segments: readonly RenderedScopeLineSegment[],
  snapshot: EditorViewSnapshot,
): readonly EditorVisiblePaintRectangle[] | null {
  const rectangles: EditorVisiblePaintRectangle[] = []
  for (const rendered of segments) {
    if (rendered.segment.height <= 4) continue
    const rectangle = captureScopeLineRectangle(rendered, snapshot)
    if (!rectangle) return null
    if (rectangle.width <= 0) continue
    rectangles.push(rectangle)
  }
  return rectangles
}

function captureScopeLineRectangle(
  { element, segment }: RenderedScopeLineSegment,
  snapshot: EditorViewSnapshot,
): EditorVisiblePaintRectangle | null {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  if (!style?.backgroundColor) return null
  const width = Number.parseFloat(style.width)
  if (!Number.isFinite(width)) return null

  return {
    left: snapshot.gutterWidth + segment.column * snapshot.metrics.characterWidth,
    top: segment.top + 1,
    width,
    height: Math.max(0, segment.height - 4),
    backgroundColor: style.backgroundColor,
  }
}

function createScopeLinesRenderContext(snapshot: EditorViewSnapshot): ScopeLinesRenderContext {
  return {
    snapshot,
    textSnapshot: snapshot.textSnapshot,
    lineTextCache: new Map(),
    indentColumnCache: new Map(),
  }
}

function resolveScopeLinesOptions(options: ScopeLinesPluginOptions): ResolvedScopeLinesOptions {
  return {
    enabled: options.enabled ?? true,
    className: options.className,
    minLineSpan: normalizeMinLineSpan(options.minLineSpan),
    mode: options.mode ?? 'all',
    showActive: options.showActive ?? true,
  }
}

function normalizeMinLineSpan(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MIN_LINE_SPAN
  if (!Number.isFinite(value)) return DEFAULT_MIN_LINE_SPAN
  return Math.max(1, Math.floor(value))
}

function createRoot(
  context: EditorViewContributionContext,
  options: ResolvedScopeLinesOptions,
): HTMLDivElement {
  const root = context.container.ownerDocument.createElement('div')
  root.className = 'editor-scope-lines'
  root.setAttribute('aria-hidden', 'true')
  if (options.className) root.classList.add(options.className)
  context.contentElement.appendChild(root)
  return root
}

function renderScopeLines(
  root: HTMLDivElement,
  snapshot: EditorViewSnapshot,
  model: ScopeLinesRenderModel,
): readonly RenderedScopeLineSegment[] {
  root.style.setProperty('--editor-scope-lines-content-width', `${snapshot.contentWidth}px`)
  const rendered = model.segments.map((segment) => ({
    segment,
    element: createSegmentElement(root.ownerDocument, segment, snapshot),
  }))
  root.replaceChildren(...rendered.map(({ element }) => element))
  return rendered
}

function createSegmentElement(
  document: Document,
  segment: ScopeLineSegment,
  snapshot: EditorViewSnapshot,
): HTMLDivElement {
  const element = document.createElement('div')
  element.className = 'editor-scope-line'
  element.dataset.editorScopeLineLevel = String(segment.indentLevel % SCOPE_LINE_COLOR_COUNT)
  element.style.left = `${segment.column * snapshot.metrics.characterWidth}px`
  element.style.top = `${segment.top + 1}px`
  element.style.height = `${Math.max(0, segment.height - 4)}px`
  if (segment.active) element.classList.add('editor-scope-line-active')
  return element
}

function createScopeLinesRenderModel(
  context: ScopeLinesRenderContext,
  options: ResolvedScopeLinesOptions,
): ScopeLinesRenderModel {
  const guides = createScopeGuides(context, options)
  const segments: ScopeLineSegment[] = []
  for (const guide of guides) appendGuideSegments(segments, guide, context.snapshot.visibleRows)

  return {
    signature: snapshotSignature(context, options, guides),
    segments,
  }
}

function createScopeGuides(
  context: ScopeLinesRenderContext,
  options: ResolvedScopeLinesOptions,
): ScopeGuide[] {
  const guides: ScopeGuide[] = []
  for (const marker of candidateFoldMarkers(context, options)) {
    const guide = createScopeGuide(marker, context, options)
    if (guide) guides.push(guide)
  }
  if (options.mode === 'all') return guides
  return nearestCursorScopeGuides(guides)
}

function candidateFoldMarkers(
  context: ScopeLinesRenderContext,
  options: ResolvedScopeLinesOptions,
): readonly VirtualizedFoldMarker[] {
  const snapshot = context.snapshot
  const bounds = visibleTextRowBounds(snapshot.visibleRows)
  if (!bounds) return []

  const cursor = options.mode === 'current' ? snapshot.selections[0]?.headOffset : undefined
  if (options.mode === 'current' && cursor === undefined) return []

  const markers: VirtualizedFoldMarker[] = []
  for (const marker of snapshot.foldMarkers) {
    if (!markerIntersectsVisibleRows(marker, bounds)) continue
    if (cursor !== undefined && !markerContainsOffset(marker, cursor)) continue
    markers.push(marker)
  }
  return markers
}

function visibleTextRowBounds(
  rows: readonly EditorVisibleRowSnapshot[],
): VisibleTextRowBounds | null {
  let startRow = Number.POSITIVE_INFINITY
  let endRow = Number.NEGATIVE_INFINITY

  for (const row of rows) {
    if (row.kind !== 'text') continue
    startRow = Math.min(startRow, row.bufferRow)
    endRow = Math.max(endRow, row.bufferRow)
  }

  if (!Number.isFinite(startRow) || !Number.isFinite(endRow)) return null
  return { startRow, endRow }
}

function markerIntersectsVisibleRows(
  marker: VirtualizedFoldMarker,
  bounds: VisibleTextRowBounds,
): boolean {
  if (marker.startRow >= bounds.endRow) return false
  return marker.endRow > bounds.startRow
}

function createScopeGuide(
  marker: VirtualizedFoldMarker,
  context: ScopeLinesRenderContext,
  options: ResolvedScopeLinesOptions,
): ScopeGuide | null {
  const geometry = scopeGuideGeometry(marker, context, options)
  if (!geometry) return null

  const containsCursor = markerContainsCursor(marker, context.snapshot)

  return {
    marker,
    column: geometry.column,
    indentLevel: geometry.indentLevel,
    containsCursor,
    active: options.showActive && containsCursor,
  }
}

function scopeGuideGeometry(
  marker: VirtualizedFoldMarker,
  context: ScopeLinesRenderContext,
  options: ResolvedScopeLinesOptions,
): ScopeGuideGeometry | null {
  if (marker.collapsed) return null
  if (marker.endRow - marker.startRow < options.minLineSpan) return null

  const placement = scopeGuidePlacement(marker, context)
  if (placement.column < 0) return null

  return {
    marker,
    column: placement.column,
    indentLevel: placement.indentLevel,
  }
}

function scopeGuidePlacement(
  marker: VirtualizedFoldMarker,
  context: ScopeLinesRenderContext,
): ScopeGuidePlacement {
  const snapshot = context.snapshot
  const startIndent = lineIndentColumn(context, marker.startRow)
  const bodyIndent = minimumBodyIndentColumn(context, marker)
  if (bodyIndent === null) return placementFromIndent(startIndent, startIndent, snapshot.tabSize)
  if (bodyIndent <= startIndent) {
    return placementFromIndent(startIndent, startIndent, snapshot.tabSize)
  }

  return placementFromIndent(
    Math.max(startIndent, bodyIndent - snapshot.tabSize),
    bodyIndent,
    snapshot.tabSize,
  )
}

function placementFromIndent(column: number, indent: number, tabSize: number): ScopeGuidePlacement {
  return {
    column,
    indentLevel: indentLevelForColumn(indent, tabSize),
  }
}

function indentLevelForColumn(column: number, tabSize: number): number {
  return Math.max(0, Math.floor(column / Math.max(1, tabSize)))
}

/**
 * Shallowest indentation any line of the body is written at, which is the only column the whole
 * guide can sit left of. Reading the first line instead puts the guide inside the code of every
 * block that opens with a deeper line — a wrapped argument list, a chained call, a `case` label
 * whose statements are outdented — and a guide drawn through text reads as a rendering fault.
 *
 * The closing row is excluded because the guide does not span it, and it is written at the opener's
 * own indentation, which would drag the minimum back to where the opener sits every time.
 */
function minimumBodyIndentColumn(
  context: ScopeLinesRenderContext,
  marker: VirtualizedFoldMarker,
): number | null {
  const probeEnd = Math.min(marker.endRow - 1, marker.startRow + BODY_INDENT_PROBE_LINES)
  let minimum: number | null = null

  for (let row = marker.startRow + 1; row <= probeEnd; row += 1) {
    if (isBlankLine(lineText(context, row))) continue

    const column = indentColumnForRow(context, row)
    if (minimum === null || column < minimum) minimum = column
  }

  return minimum
}

function lineIndentColumn(context: ScopeLinesRenderContext, row: number): number {
  return indentColumnForRow(context, row)
}

function lineText(context: ScopeLinesRenderContext, row: number): string {
  const cached = context.lineTextCache.get(row)
  if (cached !== undefined) return cached

  const text = uncachedLineText(context, row)
  context.lineTextCache.set(row, text)
  return text
}

function uncachedLineText(context: ScopeLinesRenderContext, row: number): string {
  const snapshot = context.snapshot
  const lineStarts = snapshot.lineStartsView
  const start = lineStarts.at(row)
  if (start === undefined) return ''

  const textSnapshot = context.textSnapshot
  const nextStart = lineStarts.at(row + 1) ?? textSnapshot.length + 1
  const end = Math.max(start, Math.min(textSnapshot.length, nextStart - 1))
  return textSnapshot.readRange(start, end)
}

function indentColumnForRow(context: ScopeLinesRenderContext, row: number): number {
  const cached = context.indentColumnCache.get(row)
  if (cached !== undefined) return cached

  const column = indentColumn(lineText(context, row), context.snapshot.tabSize)
  context.indentColumnCache.set(row, column)
  return column
}

function isBlankLine(text: string): boolean {
  return text.trim().length === 0
}

function indentColumn(text: string, tabSize: number): number {
  let column = 0
  for (const character of text) {
    if (character === ' ') {
      column += 1
      continue
    }
    if (character !== '\t') return column
    column += tabSize - (column % tabSize)
  }
  return column
}

function markerContainsCursor(
  marker: VirtualizedFoldMarker,
  snapshot: EditorViewSnapshot,
): boolean {
  const cursor = snapshot.selections[0]?.headOffset
  if (cursor === undefined) return false
  return markerContainsOffset(marker, cursor)
}

function markerContainsOffset(marker: VirtualizedFoldMarker, offset: number): boolean {
  return offset > marker.startOffset && offset < marker.endOffset
}

function nearestCursorScopeGuides(guides: readonly ScopeGuide[]): ScopeGuide[] {
  const nearest = guides.reduce<ScopeGuide | null>(nearestCursorScopeGuide, null)
  return nearest ? [nearest] : []
}

function nearestCursorScopeGuide(
  current: ScopeGuide | null,
  candidate: ScopeGuide,
): ScopeGuide | null {
  if (!candidate.containsCursor) return current
  if (!current) return candidate

  const currentSpan = current.marker.endOffset - current.marker.startOffset
  const candidateSpan = candidate.marker.endOffset - candidate.marker.startOffset
  if (candidateSpan >= currentSpan) return current
  return candidate
}

function appendGuideSegments(
  segments: ScopeLineSegment[],
  guide: ScopeGuide,
  visibleRows: readonly EditorVisibleRowSnapshot[],
): void {
  let open: ScopeLineSegment | null = null
  for (const row of visibleRows) {
    const rowSegment = guideSegmentForRow(guide, row)
    if (!rowSegment) {
      if (open) segments.push(open)
      open = null
      continue
    }

    if (open && canMergeSegments(open, rowSegment)) {
      const merged: ScopeLineSegment = open
      open = { ...merged, height: rowSegment.top + rowSegment.height - merged.top }
      continue
    }
    if (open) segments.push(open)
    open = rowSegment
  }

  if (open) segments.push(open)
}

function guideSegmentForRow(
  guide: ScopeGuide,
  row: EditorVisibleRowSnapshot,
): ScopeLineSegment | null {
  if (row.kind !== 'text') return null
  if (row.bufferRow <= guide.marker.startRow) return null
  if (row.bufferRow >= guide.marker.endRow) return null

  return {
    column: guide.column,
    indentLevel: guide.indentLevel,
    top: row.top,
    height: row.height,
    active: guide.active,
  }
}

function canMergeSegments(left: ScopeLineSegment, right: ScopeLineSegment): boolean {
  if (left.column !== right.column) return false
  if (left.indentLevel !== right.indentLevel) return false
  if (left.active !== right.active) return false
  return Math.abs(left.top + left.height - right.top) < 0.5
}

function snapshotSignature(
  context: ScopeLinesRenderContext,
  options: ResolvedScopeLinesOptions,
  guides: readonly ScopeGuide[],
): string {
  const snapshot = context.snapshot
  return [
    snapshot.contentWidth,
    snapshot.metrics.characterWidth,
    snapshot.tabSize,
    options.minLineSpan,
    options.mode,
    options.showActive,
    scopeGuideSignature(guides),
    visibleRowSignature(snapshot.visibleRows),
  ].join('|')
}

function scopeGuideSignature(guides: readonly ScopeGuide[]): string {
  return guides.map(scopeGuideKey).join(',')
}

function scopeGuideKey(guide: ScopeGuide): string {
  return [
    guide.marker.startRow,
    guide.marker.endRow,
    guide.column,
    guide.indentLevel,
    guide.active ? 1 : 0,
  ].join(':')
}

function visibleRowSignature(rows: readonly EditorVisibleRowSnapshot[]): string {
  return rows
    .map((row) => [row.index, row.bufferRow, row.top, row.height, row.kind].join(':'))
    .join(',')
}

type ScopeLinesDiagnostic = {
  readonly name: string
  readonly durationMs?: number
  readonly detail?: Readonly<Record<string, unknown>>
}

type ScopeLinesDiagnosticSink =
  | ((diagnostic: ScopeLinesDiagnostic) => void)
  | {
      readonly enabled?: boolean
      readonly record?: (diagnostic: ScopeLinesDiagnostic) => void
    }

type ScopeLinesDiagnosticGlobal = typeof globalThis & {
  __EDITOR_PERFORMANCE_DIAGNOSTICS__?: ScopeLinesDiagnosticSink | null
}

type DiagnosticDetail =
  | Readonly<Record<string, unknown>>
  | (() => Readonly<Record<string, unknown>> | undefined)
  | undefined

function measureScopeLinesPerformance<T>(name: string, run: () => T, detail?: DiagnosticDetail): T {
  const sink = scopeLinesDiagnosticSink()
  if (!sink) return run()

  const start = nowMs()
  try {
    return run()
  } finally {
    recordScopeLinesDiagnostic(sink, name, detail, nowMs() - start)
  }
}

function recordScopeLinesDiagnostic(
  sink: ScopeLinesDiagnosticSink,
  name: string,
  detail: DiagnosticDetail,
  durationMs: number,
): void {
  const diagnostic = createDiagnostic(name, detail, durationMs)
  if (typeof sink === 'function') {
    sink(diagnostic)
    return
  }

  sink.record?.(diagnostic)
}

function scopeLinesDiagnosticSink(): ScopeLinesDiagnosticSink | null {
  const sink = scopeLinesDiagnosticGlobal().__EDITOR_PERFORMANCE_DIAGNOSTICS__
  if (!sink) return null
  if (typeof sink === 'function') return sink
  if (sink.enabled !== true && typeof sink.record !== 'function') return null
  return sink
}

function createDiagnostic(
  name: string,
  detail: DiagnosticDetail,
  durationMs: number,
): ScopeLinesDiagnostic {
  const resolvedDetail = resolveDiagnosticDetail(detail)
  if (resolvedDetail === undefined) return { name, durationMs }
  return { name, durationMs, detail: resolvedDetail }
}

function resolveDiagnosticDetail(
  detail: DiagnosticDetail,
): Readonly<Record<string, unknown>> | undefined {
  if (typeof detail === 'function') return detail()
  return detail
}

function scopeLinesDiagnosticGlobal(): ScopeLinesDiagnosticGlobal {
  return globalThis as ScopeLinesDiagnosticGlobal
}

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now()
}
