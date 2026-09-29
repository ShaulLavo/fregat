import type { EditorMarkerHit } from '../pointQueries'
import type { TextContent } from '../textContent'
import { measureWhitespaceDotGlyph, type WhitespaceDotGlyph } from './browserMetrics'
import { setStyleValue } from './virtualizedTextViewHelpers'
import { rangeSegments, unitRectForOffset } from './virtualizedTextViewGeometry'
import {
  normalizeSuspiciousCharactersOptions,
  type ResolvedSuspiciousCharactersOptions,
  sameSuspiciousCharactersOptions,
  type SuspiciousCharacterKind,
  type SuspiciousCharacterRange,
  suspiciousCharacterRanges,
  suspiciousCharactersEnabled,
} from '../unicodeHighlight'
import type {
  VirtualizedStoredSelection,
  VirtualizedTextViewInternal,
} from './virtualizedTextViewInternals'
import type {
  HiddenCharactersMode,
  MountedVirtualizedTextRow,
  VirtualizedTextChunk,
} from './virtualizedTextViewTypes'
import { rowOffsetForLocalIndex } from './virtualizedTextViewInlineMapping'

type WhitespaceKind = 'space' | 'tab'

type HiddenCharacterKind = WhitespaceKind | SuspiciousCharacterKind

/** Everything an element needs, so building one costs no measurement of any kind. */
type HiddenCharacterMarker = {
  readonly kind: HiddenCharacterKind
  readonly offset: number
  readonly left: number
  readonly width: number
  readonly glyph: string
}

/** Both -1 on a row with nothing but whitespace, which every index then falls outside. */
type NonWhitespaceBounds = {
  readonly first: number
  readonly last: number
}

/** `start` is where the row's own text sits in `text`, and is non-zero only on a wrapped row. */
type SuspiciousCharacterScanLine = {
  readonly text: TextContent
  readonly start: number
}

/**
 * State every row in one pass shares. The dot glyph costs a measurement to resolve, so it waits for
 * the first row that rebuilds its markers — a pass that changes nothing must not touch the font.
 */
type HiddenCharacterPass = {
  readonly mode: HiddenCharactersMode
  readonly selectionKey: string
  readonly suspicious: SuspiciousCharacterSettings
  spaceGlyph: WhitespaceDotGlyph | null
}

/**
 * What a view reports suspicious characters for. The revision is what a row's cached inputs compare
 * against: the settings decide which characters get a marker, so a row that kept its text still has
 * to rebuild when they change.
 */
export type SuspiciousCharacterSettings = {
  readonly options: ResolvedSuspiciousCharactersOptions
  readonly revision: number
}

type HiddenCharacterRowContext = {
  readonly view: VirtualizedTextViewInternal
  readonly row: MountedVirtualizedTextRow
  readonly pass: HiddenCharacterPass
  bounds: NonWhitespaceBounds | null
}

/** Null markers mean the row's inputs are unchanged and what it already draws still stands. */
type HiddenCharacterRowPlan = {
  readonly row: MountedVirtualizedTextRow
  readonly inputKey: string
  readonly markers: readonly HiddenCharacterMarker[] | null
}

/**
 * What a row's markers were last built from. Building them reads the row's geometry twice per
 * whitespace character, which on an indented file is hundreds of lookups per frame to usually
 * conclude that nothing moved — so the inputs are compared first and the row is left alone. The
 * geometry object stands in for every metric that shifts a column, because it is the thing that
 * gets retired when one of them changes.
 */
type HiddenCharacterInputs = {
  readonly key: string
  readonly geometry: unknown
}

const DEFAULT_HIDDEN_CHARACTERS: HiddenCharactersMode = 'show-on-selection'
const HIDDEN_CHARACTER_MODES: readonly HiddenCharactersMode[] = [
  'hidden',
  'show',
  'show-on-selection',
  'boundary',
  'trailing',
]
const TAB_GLYPH = '→'
/** Suspicious characters carry no glyph of their own; what marks them is the CSS on the marker. */
const NO_GLYPH = ''
export const DEFAULT_SUSPICIOUS_SETTINGS: SuspiciousCharacterSettings = {
  options: normalizeSuspiciousCharactersOptions(undefined),
  revision: 0,
}
const paintedMarkers = new WeakMap<HTMLElement, readonly HiddenCharacterMarker[]>()

export function markerAtRowX(row: MountedVirtualizedTextRow, x: number): EditorMarkerHit | null {
  // Invisible markers paint at least 2px, matching the layer's CSS minimum width.
  const marker = paintedMarkers
    .get(row.element)
    ?.find(
      (marker) =>
        x >= marker.left &&
        x < marker.left + (marker.kind === 'invisible' ? Math.max(2, marker.width) : marker.width),
    )
  return marker ? { kind: marker.kind, offset: marker.offset } : null
}

const hiddenCharacterInputs = new WeakMap<HTMLElement, HiddenCharacterInputs>()
/** Bumped per change rather than per view, so a row's cached inputs can compare it as one number. */
let suspiciousRevision = 0

export function normalizeHiddenCharactersMode(
  mode: HiddenCharactersMode | undefined,
): HiddenCharactersMode {
  if (mode && HIDDEN_CHARACTER_MODES.includes(mode)) return mode
  return DEFAULT_HIDDEN_CHARACTERS
}

/**
 * Points the view at a different set of suspicious characters, redrawing what is already mounted.
 *
 * Answers whether anything changed, so a caller that reports the change does not report a setting
 * being restated.
 */
export function setSuspiciousCharacters(
  view: VirtualizedTextViewInternal,
  options: ResolvedSuspiciousCharactersOptions,
): boolean {
  if (sameSuspiciousCharactersOptions(view.suspiciousCharacters.options, options)) return false

  suspiciousRevision += 1
  view.suspiciousCharacters = { options, revision: suspiciousRevision }
  renderHiddenCharacters(view)

  return true
}

/**
 * Every row is measured before any row is drawn. Where a column sits is read out of the layout, and
 * drawing into a row dirties that layout, so alternating the two per row makes each row pay to
 * settle the one before it. Splitting them means the pass settles at most once.
 */
export function renderHiddenCharacters(view: VirtualizedTextViewInternal): void {
  if (view.provisional) return
  const pass: HiddenCharacterPass = {
    mode: view.hiddenCharacters,
    selectionKey: hiddenCharacterSelectionKey(view),
    suspicious: view.suspiciousCharacters,
    spaceGlyph: null,
  }
  const plans: HiddenCharacterRowPlan[] = []
  for (const row of view.rowElements.values()) {
    plans.push(planHiddenCharactersForRow(view, row, pass))
  }

  for (const plan of plans) drawHiddenCharactersForRow(plan)
}

function planHiddenCharactersForRow(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  pass: HiddenCharacterPass,
): HiddenCharacterRowPlan {
  const inputKey = hiddenCharacterInputKey(row, pass)
  const previous = hiddenCharacterInputs.get(row.element)
  if (previous?.key === inputKey && previous.geometry === row.geometryCache) {
    return { row, inputKey, markers: null }
  }

  return { row, inputKey, markers: hiddenCharacterMarkersForRow(view, row, pass) }
}

function drawHiddenCharactersForRow(plan: HiddenCharacterRowPlan): void {
  const { row, markers } = plan
  if (!markers) {
    if (row.hiddenCharactersKey.length > 0) attachHiddenCharacterLayer(row)
    return
  }

  if (markers.length === 0) {
    clearHiddenCharactersForRow(row)
    rememberHiddenCharacterInputs(row, plan.inputKey)
    return
  }

  paintedMarkers.set(row.element, markers)
  const markerKey = hiddenCharacterMarkerKey(markers)
  if (row.hiddenCharactersKey !== markerKey) {
    setHiddenCharactersKey(row, markerKey)
    row.hiddenCharactersLayerElement.replaceChildren(
      ...markers.map((marker) => createHiddenCharacterMarker(row, marker)),
    )
  }

  rememberHiddenCharacterInputs(row, plan.inputKey)
  attachHiddenCharacterLayer(row)
}

/**
 * Everything outside the geometry that decides which characters get a marker: the text under the
 * row, the horizontal window of it that is mounted, the mode, and — only where the mode reads it —
 * the selection. The offset pins the row to a line, since a recycled row keeps its element.
 */
function hiddenCharacterInputKey(
  row: MountedVirtualizedTextRow,
  pass: HiddenCharacterPass,
): string {
  return [
    row.textRevision,
    row.startOffset,
    row.text.length,
    row.chunkKey,
    pass.mode,
    pass.selectionKey,
    pass.suspicious.revision,
  ].join(':')
}

function hiddenCharacterSelectionKey(view: VirtualizedTextViewInternal): string {
  if (view.hiddenCharacters !== 'show-on-selection') return ''
  return view.selections.map((selection) => `${selection.start}-${selection.end}`).join(',')
}

function rememberHiddenCharacterInputs(row: MountedVirtualizedTextRow, key: string): void {
  hiddenCharacterInputs.set(row.element, { key, geometry: row.geometryCache })
}

function hiddenCharacterMarkersForRow(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  pass: HiddenCharacterPass,
): readonly HiddenCharacterMarker[] {
  if (row.kind !== 'text') return []
  if (row.source === 'injected') return []

  const markers: HiddenCharacterMarker[] = []
  appendWhitespaceMarkers(markers, view, row, pass)
  appendSuspiciousCharacterMarkers(markers, view, row, pass)

  return markers
}

function appendWhitespaceMarkers(
  markers: HiddenCharacterMarker[],
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  pass: HiddenCharacterPass,
): void {
  if (pass.mode === 'hidden') return
  // What sits at the end of a wrapped segment is the middle of the line it was cut from, so a row
  // that carries on below has no trailing whitespace of its own to report.
  if (pass.mode === 'trailing' && rowContinuesBelow(view, row)) return

  const context: HiddenCharacterRowContext = {
    view,
    row,
    pass,
    bounds: null,
  }
  for (const chunk of row.chunks) {
    appendWhitespaceMarkersForChunk(markers, context, chunk)
  }
}

function appendWhitespaceMarkersForChunk(
  markers: HiddenCharacterMarker[],
  context: HiddenCharacterRowContext,
  chunk: VirtualizedTextChunk,
): void {
  for (let index = chunk.localStart; index < chunk.localEnd; index += 1) {
    const char = context.row.text.charAt(index)
    appendWhitespaceMarker(markers, context, char, index)
  }
}

function appendWhitespaceMarker(
  markers: HiddenCharacterMarker[],
  context: HiddenCharacterRowContext,
  char: string,
  localIndex: number,
): void {
  const kind = whitespaceKind(char)
  if (!kind) return

  const { view, row } = context
  const offset = rowOffsetForLocalIndex(row, localIndex)
  // Where the next column starts rather than the next offset. Text a replacement hangs off a point
  // stands in for no source text at all, so every column of it answers with that one offset — and a
  // mark per column would stack them on one box, over a space the document does not hold.
  const end = rowOffsetForLocalIndex(row, localIndex + 1)
  if (end <= offset) return
  if (!shouldShowHiddenCharacter(context, kind, localIndex, offset)) return

  const rect = unitRectForOffset(view, row, offset)
  if (!rect) return
  markers.push({
    kind,
    offset,
    left: rect.left,
    width: rect.width,
    glyph: hiddenCharacterGlyph(context, kind),
  })
}

/**
 * Marks the characters that are not what they appear to be, whatever the whitespace mode is: this
 * is a warning about the text rather than a way of looking at it, and nothing about wanting spaces
 * left alone says a bidirectional override should be.
 *
 * Scanning per chunk keeps a long line's cost proportional to what is mounted, which is the same
 * bargain the whitespace scan above makes.
 */
function appendSuspiciousCharacterMarkers(
  markers: HiddenCharacterMarker[],
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  pass: HiddenCharacterPass,
): void {
  const { options } = pass.suspicious
  if (!suspiciousCharactersEnabled(options)) return

  const line = suspiciousCharacterScanLine(view, row)
  // A code point the seam runs through belongs to the window before it, which reported it already:
  // the window after opens on the trailing half and reads back onto the leading one.
  let reportedThrough = -1
  for (const chunk of row.chunks) {
    const mounted = { start: line.start + chunk.localStart, end: line.start + chunk.localEnd }
    for (const range of suspiciousCharacterRanges(line.text, options, mounted)) {
      if (range.start < reportedThrough) continue

      reportedThrough = range.end
      markers.push(...suspiciousCharacterMarkers(view, row, line, range))
    }
  }
}

function suspiciousCharacterMarkers(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  line: SuspiciousCharacterScanLine,
  range: SuspiciousCharacterRange,
): readonly HiddenCharacterMarker[] {
  const offset = rowOffsetForLocalIndex(row, range.start - line.start)
  const end = rowOffsetForLocalIndex(row, range.end - line.start)
  return rangeSegments(view, row, offset, end).map(({ left, width }) => ({
    kind: range.kind,
    offset,
    left,
    width,
    glyph: NO_GLYPH,
  }))
}

/**
 * What the scan reads, and where in it this row's own text begins.
 *
 * A wrapped row carries a slice of a line, and a slice cuts words in half. What excuses a Cyrillic
 * letter is the word around it being Cyrillic throughout, so a row judging its own fragment reports
 * ordinary prose on every line long enough to wrap — the whole line has to be what the word is read
 * out of, however little of it this row draws.
 */
function suspiciousCharacterScanLine(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): SuspiciousCharacterScanLine {
  const metrics = view.model.projection.getRowMetrics(row.index)
  return {
    text: view.model.projection.getLineText(row.index),
    start: metrics?.displayStartColumn ?? 0,
  }
}

function whitespaceKind(char: string): WhitespaceKind | null {
  if (char === ' ') return 'space'
  if (char === '\t') return 'tab'
  return null
}

function shouldShowHiddenCharacter(
  context: HiddenCharacterRowContext,
  kind: WhitespaceKind,
  localIndex: number,
  offset: number,
): boolean {
  const { mode } = context.pass
  if (mode === 'show') return true
  // A tab is an indentation decision wherever it sits, so the quieting of interior whitespace does
  // not extend to it.
  if (mode === 'boundary') return kind === 'tab' || isBoundarySpace(context, localIndex)
  if (mode === 'trailing') return localIndex > rowWhitespaceBounds(context).last
  if (mode !== 'show-on-selection') return false

  return context.view.selections.some((selection) => selectionContainsOffset(selection, offset))
}

function isBoundarySpace(context: HiddenCharacterRowContext, localIndex: number): boolean {
  const { first, last } = rowWhitespaceBounds(context)
  if (localIndex < first || localIndex > last) return true

  // Inside the text a lone space is a word separator and marking it shreds prose; two or more in a
  // row are alignment, which is the thing worth seeing.
  const { text } = context.row
  return text.charAt(localIndex - 1) === ' ' || text.charAt(localIndex + 1) === ' '
}

function nonWhitespaceBounds(text: TextContent): NonWhitespaceBounds {
  let first = 0
  while (first < text.length && whitespaceKind(text.charAt(first))) first += 1
  if (first === text.length) return { first: -1, last: -1 }

  let last = text.length - 1
  while (last > first && whitespaceKind(text.charAt(last))) last -= 1

  return { first, last }
}

function rowWhitespaceBounds(context: HiddenCharacterRowContext): NonWhitespaceBounds {
  return (context.bounds ??= nonWhitespaceBounds(context.row.text))
}

function rowContinuesBelow(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): boolean {
  const next = view.model.projection.getRowMetrics(row.index + 1)
  return next?.source === 'document' && next.bufferRow === row.bufferRow
}

function selectionContainsOffset(selection: VirtualizedStoredSelection, offset: number): boolean {
  if (selection.start === selection.end) return false
  if (offset < selection.start) return false
  return offset < selection.end
}

function hiddenCharacterMarkerKey(markers: readonly HiddenCharacterMarker[]): string {
  return markers.map(hiddenCharacterMarkerKeyPart).join('|')
}

function hiddenCharacterMarkerKeyPart(marker: HiddenCharacterMarker): string {
  return `${marker.kind}:${marker.offset}:${marker.left}:${marker.width}`
}

function createHiddenCharacterMarker(
  row: MountedVirtualizedTextRow,
  marker: HiddenCharacterMarker,
): HTMLSpanElement {
  const element = row.element.ownerDocument.createElement('span')
  element.className = 'editor-virtualized-hidden-character-marker'
  element.dataset.editorHiddenCharacter = marker.kind
  element.dataset.editorHiddenCharacterOffset = String(marker.offset)
  element.textContent = marker.glyph
  setStyleValue(element, 'left', `${marker.left}px`)
  setStyleValue(element, 'width', `${marker.width}px`)
  return element
}

function hiddenCharacterGlyph(context: HiddenCharacterRowContext, kind: WhitespaceKind): string {
  if (kind === 'tab') return TAB_GLYPH

  const { pass } = context
  pass.spaceGlyph ??= measureWhitespaceDotGlyph(context.view.scrollElement)
  return pass.spaceGlyph
}

export function clearHiddenCharactersForRow(row: MountedVirtualizedTextRow): void {
  paintedMarkers.delete(row.element)
  setHiddenCharactersKey(row, '')
  row.hiddenCharactersLayerElement.replaceChildren()
  row.hiddenCharactersLayerElement.remove()
}

function attachHiddenCharacterLayer(row: MountedVirtualizedTextRow): void {
  const layer = row.hiddenCharactersLayerElement
  if (layer.parentElement === row.element) return
  if (row.foldPlaceholderElement.parentElement === row.element) {
    row.element.insertBefore(layer, row.foldPlaceholderElement)
    return
  }

  row.element.appendChild(layer)
}

function setHiddenCharactersKey(row: MountedVirtualizedTextRow, key: string): void {
  const mutable = row as { hiddenCharactersKey: string }
  mutable.hiddenCharactersKey = key
}
