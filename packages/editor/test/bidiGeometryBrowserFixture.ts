import { createInlineMap, type InlineReplacementSpec } from '../src/inlineMap'
import { createPieceTableSnapshot } from '../src/public/document'
import { VirtualizedTextView } from '../src/virtualization'
import { clearBrowserTextMetricsCache } from '../src/virtualization/browserMetrics'
import {
  domBoundaryForOffset,
  rangeSegments,
} from '../src/virtualization/virtualizedTextViewGeometry'
import type { VirtualizedTextViewInternal } from '../src/virtualization/virtualizedTextViewInternals'
import type { MountedVirtualizedTextRow } from '../src/virtualization/virtualizedTextViewTypes'

export const BIDI_CORPUS = {
  pureHebrew: 'אבגדהוזחט',
  pureArabic: 'مرحبا بالعالم',
  mixed: 'let x = שלום world',
  nested: 'אבג 123 דהו',
  tabRtl: '\tאבג דהו',
  override: 'abc\u202Edefghi',
  latin: 'const value = 42',
} as const

export const BIDI_CORPUS_NAMES = Object.keys(BIDI_CORPUS) as readonly BidiCorpusName[]

const SUPPLEMENTARY_BIDI_LINES = {
  controlRtl: 'אבג\u0085דהו',
  widgetRtl: 'אבג דהו',
} as const

export type BidiCorpusName = keyof typeof BIDI_CORPUS

export type OracleRect = {
  readonly left: number
  readonly width: number
}

export type GlyphRectEntry = {
  readonly index: number
  readonly rects: readonly OracleRect[]
}

export type BidiGeometryFixture = {
  readonly container: HTMLElement
  readonly view: VirtualizedTextView
  readonly internal: VirtualizedTextViewInternal
  readonly rows: Readonly<Record<BidiCorpusName, MountedVirtualizedTextRow>>
  dispose(): void
}

export type SupplementaryBidiFixture = {
  readonly control: VirtualizedTextView
  readonly widget: VirtualizedTextView
  readonly controlInternal: VirtualizedTextViewInternal
  readonly widgetInternal: VirtualizedTextViewInternal
  readonly controlRow: MountedVirtualizedTextRow
  readonly widgetRow: MountedVirtualizedTextRow
  dispose(): void
}

const ROW_HEIGHT = 20
const FIXTURE_WIDTH = 600
const RECT_MERGE_EPSILON = 0.9

export function mountBidiGeometryFixture(): BidiGeometryFixture {
  const container = createFixtureContainer(BIDI_CORPUS_NAMES.length)
  const view = createFixtureView(
    container,
    BIDI_CORPUS_NAMES.map((name) => BIDI_CORPUS[name]).join('\n'),
  )
  // The oracle reads carets synchronously, which only a focused editor draws.
  view.focusInput()
  const rows = Object.fromEntries(
    BIDI_CORPUS_NAMES.map((name, index) => [name, mountedRow(view, index)]),
  ) as Record<BidiCorpusName, MountedVirtualizedTextRow>

  return {
    container,
    view,
    internal: Reflect.get(view, 'view') as VirtualizedTextViewInternal,
    rows,
    dispose: () => disposeFixture(view, container),
  }
}

export function mountSupplementaryBidiFixture(): SupplementaryBidiFixture {
  const controlContainer = createFixtureContainer(1)
  const widgetContainer = createFixtureContainer(1)
  const control = createFixtureView(controlContainer, SUPPLEMENTARY_BIDI_LINES.controlRtl)
  const widget = createFixtureView(widgetContainer, SUPPLEMENTARY_BIDI_LINES.widgetRtl)
  widget.setInlineMap(
    createInlineMap(createPieceTableSnapshot(SUPPLEMENTARY_BIDI_LINES.widgetRtl), [widgetSpec()]),
  )

  return {
    control,
    widget,
    controlInternal: Reflect.get(control, 'view') as VirtualizedTextViewInternal,
    widgetInternal: Reflect.get(widget, 'view') as VirtualizedTextViewInternal,
    controlRow: mountedRow(control, 0),
    widgetRow: mountedRow(widget, 0),
    dispose: () => {
      disposeFixture(control, controlContainer)
      disposeFixture(widget, widgetContainer)
    },
  }
}

export function collapsedRangeOracle(
  row: MountedVirtualizedTextRow,
  localOffset: number,
): readonly OracleRect[] {
  const boundary = requiredBoundary(row, localOffset)
  const range = row.element.ownerDocument.createRange()
  range.setStart(boundary.node, boundary.offset)
  range.collapse(true)
  return localRects(row, range)
}

export function mergedRangeOracle(
  row: MountedVirtualizedTextRow,
  localStart: number,
  localEnd: number,
): readonly OracleRect[] {
  if (localEnd <= localStart) return []

  const start = requiredBoundary(row, localStart)
  const end = requiredBoundary(row, localEnd)
  const range = row.element.ownerDocument.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  return mergeOracleRects(localRects(row, range))
}

export function glyphRectOracle(row: MountedVirtualizedTextRow): readonly GlyphRectEntry[] {
  return Array.from({ length: row.text.length }, (_, index) => ({
    index,
    rects: mergedRangeOracle(row, index, index + 1),
  }))
}

export function unsplitGlyphRectOracle(row: MountedVirtualizedTextRow): readonly GlyphRectEntry[] {
  const reference = createUnsplitReferenceRow(row)
  const node = reference.firstChild
  if (!(node instanceof Text)) throw new Error('unsplit reference did not mount a text node')

  const entries = Array.from({ length: row.text.length }, (_, index) => ({
    index,
    rects: mergedTextNodeRangeRects(reference, node, index, index + 1),
  }))
  reference.remove()
  return entries
}

export function subjectRangeSegments(
  fixture: BidiGeometryFixture,
  row: MountedVirtualizedTextRow,
  localStart: number,
  localEnd: number,
): readonly OracleRect[] {
  return rangeSegments(
    fixture.internal,
    row,
    row.startOffset + localStart,
    row.startOffset + localEnd,
  ).map(({ left, width }) => ({ left, width }))
}

function mergeOracleRects(rects: readonly OracleRect[]): readonly OracleRect[] {
  const sorted = rects.toSorted((left, right) => left.left - right.left || left.width - right.width)
  const merged: OracleRect[] = []
  for (const rect of sorted) appendMergedRect(merged, rect)
  return merged
}

function appendMergedRect(merged: OracleRect[], rect: OracleRect): void {
  const previous = merged.at(-1)
  if (!previous || rect.left > previous.left + previous.width + RECT_MERGE_EPSILON) {
    merged.push(rect)
    return
  }

  const right = Math.max(previous.left + previous.width, rect.left + rect.width)
  merged[merged.length - 1] = { left: previous.left, width: right - previous.left }
}

function requiredBoundary(
  row: MountedVirtualizedTextRow,
  localOffset: number,
): { readonly node: Node; readonly offset: number } {
  const boundary = domBoundaryForOffset(row, row.startOffset + localOffset)
  if (!boundary) throw new Error(`no DOM boundary for local offset ${localOffset}`)
  return boundary
}

function localRects(row: MountedVirtualizedTextRow, range: Range): readonly OracleRect[] {
  const rowLeft = row.element.getBoundingClientRect().left
  return Array.from(range.getClientRects(), (rect) => ({
    left: rect.left - rowLeft,
    width: rect.width,
  }))
}

function mergedTextNodeRangeRects(
  row: HTMLElement,
  node: Text,
  start: number,
  end: number,
): readonly OracleRect[] {
  const range = row.ownerDocument.createRange()
  range.setStart(node, start)
  range.setEnd(node, end)
  const rowLeft = row.getBoundingClientRect().left
  const rects = Array.from(range.getClientRects(), (rect) => ({
    left: rect.left - rowLeft,
    width: rect.width,
  }))
  return mergeOracleRects(rects)
}

function createUnsplitReferenceRow(row: MountedVirtualizedTextRow): HTMLDivElement {
  const reference = row.element.ownerDocument.createElement('div')
  const style = getComputedStyle(row.element)
  reference.style.direction = style.direction
  reference.style.font = style.font
  reference.style.fontKerning = style.fontKerning
  reference.style.letterSpacing = style.letterSpacing
  reference.style.position = 'absolute'
  reference.style.tabSize = style.tabSize
  reference.style.visibility = 'hidden'
  reference.style.whiteSpace = 'pre'
  reference.style.width = `${row.element.offsetWidth}px`
  reference.style.left = '0'
  reference.style.top = '-10000px'
  reference.append(row.element.ownerDocument.createTextNode(row.text.slice(0, row.text.length)))
  row.element.ownerDocument.body.append(reference)
  return reference
}

function createFixtureContainer(rowCount: number): HTMLDivElement {
  const container = document.createElement('div')
  container.style.font = '14px monospace'
  container.style.height = `${rowCount * ROW_HEIGHT}px`
  container.style.width = `${FIXTURE_WIDTH}px`
  document.body.append(container)
  return container
}

function createFixtureView(container: HTMLElement, text: string): VirtualizedTextView {
  clearBrowserTextMetricsCache()
  const view = new VirtualizedTextView(container, {
    rowHeight: ROW_HEIGHT,
    overscan: 0,
    tabSize: 4,
  })
  view.setText(text)
  view.setScrollMetrics(0, Math.max(ROW_HEIGHT, container.clientHeight), FIXTURE_WIDTH)
  return view
}

function mountedRow(view: VirtualizedTextView, index: number): MountedVirtualizedTextRow {
  const row = view.getState().mountedRows.find((candidate) => candidate.index === index)
  if (!row) throw new Error(`row ${index} is not mounted`)
  return row
}

function widgetSpec(): InlineReplacementSpec {
  return {
    id: 'bidi-widget',
    startIndex: 3,
    endIndex: 4,
    text: 'W',
    render: (host) => {
      const box = host.ownerDocument.createElement('span')
      box.style.display = 'inline-block'
      box.style.height = '1em'
      box.style.width = '1em'
      host.append(box)
      return { dispose: () => {} }
    },
  }
}

function disposeFixture(view: VirtualizedTextView, container: HTMLElement): void {
  view.dispose()
  container.remove()
  clearBrowserTextMetricsCache()
}
