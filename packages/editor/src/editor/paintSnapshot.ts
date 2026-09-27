import type { EditorVisibleSnapshotJSON } from '../plugins'

const MAX_EDITOR_SNAPSHOT_BYTES = 262_144
const MAX_ABSOLUTE_PAINT_EXTENT = 16_000_000

type Segment = {
  readonly text: string
  readonly kind: 'text' | 'control' | 'refusal'
  readonly width: number
  readonly color: string
  readonly backgroundColor: string
  readonly textDecoration: string
}

export type SavedPaintRow = {
  readonly top: number
  readonly height: number
  readonly left: number
  readonly fold: 'collapsed' | 'expanded' | null
  readonly cursor: boolean
  readonly activeLanes: readonly string[]
  readonly segments: readonly Segment[]
  readonly backgroundColor: string
  readonly color: string
  readonly gutterBackgroundColor: string
  readonly gutterCells: readonly { readonly id: string; readonly paint: string }[]
}

export type SavedPaint = {
  readonly format: 5
  readonly appearance: string
  readonly scrollTop: number
  readonly scrollLeft: number
  readonly scrollHeight: number
  readonly scrollWidth: number
  readonly reservedLeft: number
  readonly reservedRight: number
  readonly viewportWidth: number
  readonly viewportHeight: number
  // The scroller's outer box: unlike the viewport, a scrollbar arriving with content cannot move it.
  readonly boxWidth: number
  readonly boxHeight: number
  readonly gutterWidth: number
  readonly gutterLayout: EditorVisibleSnapshotJSON['gutterLayout']
  readonly rows: readonly SavedPaintRow[]
  readonly layers: EditorVisibleSnapshotJSON['paintLayers']
}

export function encodePaintSnapshot(
  snapshot: EditorVisibleSnapshotJSON,
  appearance: string,
  gutters: readonly SavedPaintRow['gutterCells'][],
  reservations: { readonly left: number; readonly right: number },
  backgrounds: readonly {
    readonly backgroundColor: string
    readonly color: string
    readonly gutterBackgroundColor: string
  }[] = [],
): string | null {
  const paint: SavedPaint = {
    format: 5,
    reservedLeft: reservations.left,
    reservedRight: reservations.right,
    appearance,
    scrollTop: snapshot.viewport.scrollTop,
    scrollLeft: snapshot.viewport.scrollLeft,
    scrollHeight: snapshot.viewport.scrollHeight,
    scrollWidth: snapshot.viewport.scrollWidth,
    viewportWidth: snapshot.viewport.clientWidth,
    viewportHeight: snapshot.viewport.clientHeight,
    boxWidth: snapshot.viewport.borderBoxWidth ?? 0,
    boxHeight: snapshot.viewport.borderBoxHeight ?? 0,
    gutterWidth: snapshot.gutterWidth,
    gutterLayout: snapshot.gutterLayout,
    rows: snapshot.rows.map((row, index) => ({
      gutterCells: gutters[index] ?? [],
      backgroundColor: backgrounds[index]?.backgroundColor ?? '',
      color: backgrounds[index]?.color ?? '',
      gutterBackgroundColor: backgrounds[index]?.gutterBackgroundColor ?? '',
      top: row.top,
      height: row.height,
      left: row.leftSpacerWidth,
      fold: paintFold(row.foldMarker),
      cursor: row.contentCursorLine,
      activeLanes: row.gutterCursorLineBackgroundLaneIds,
      segments: row.chunks.flatMap((chunk) =>
        paintSegments(chunk, snapshot.metrics.characterWidth),
      ),
    })),
    layers: snapshot.paintLayers,
  }
  if (!isSavedPaint(paint)) return null
  const serialized = JSON.stringify(paint)
  return boundedPayload(serialized) ? serialized : null
}

function paintSegments(
  chunk: EditorVisibleSnapshotJSON['rows'][number]['chunks'][number],
  width: number,
): Segment[] {
  if (chunk.runs.length === 0 || chunk.parts.some((part) => part.kind !== 'text'))
    return chunk.parts.map((part) => ({
      text: part.text,
      kind: part.kind,
      width: part.kind === 'control' ? part.widthCells * width : 0,
      color: '',
      backgroundColor: '',
      textDecoration: '',
    }))
  const text = chunk.parts.map((part) => part.text).join('')
  const segments: Segment[] = []
  let cursor = 0
  for (const run of chunk.runs) {
    if (run.start > cursor) segments.push(plainSegment(text.slice(cursor, run.start)))
    segments.push({ ...plainSegment(text.slice(run.start, run.end)), ...run.style })
    cursor = run.end
  }
  if (cursor < text.length) segments.push(plainSegment(text.slice(cursor)))
  return segments
}

function paintFold(marker: { readonly collapsed: boolean } | null): SavedPaintRow['fold'] {
  if (!marker) return null
  return marker.collapsed ? 'collapsed' : 'expanded'
}

function plainSegment(text: string): Segment {
  return { text, kind: 'text', width: 0, color: '', backgroundColor: '', textDecoration: '' }
}

export function decodePaintSnapshot(serialized: string): SavedPaint | null {
  if (!boundedPayload(serialized)) return null
  try {
    const value: unknown = JSON.parse(serialized)
    return isSavedPaint(value) ? value : null
  } catch {
    return null
  }
}

function boundedPayload(serialized: string): boolean {
  return (
    serialized.length <= MAX_EDITOR_SNAPSHOT_BYTES &&
    new TextEncoder().encode(serialized).length <= MAX_EDITOR_SNAPSHOT_BYTES
  )
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function number(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e10
}

function string(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 65_536
}

function color(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 256
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 32 && value.every(color)
}

function array<T>(
  value: unknown,
  limit: number,
  validate: (item: unknown) => item is T,
): value is T[] {
  return Array.isArray(value) && value.length <= limit && value.every(validate)
}

function isSegment(value: unknown): value is Segment {
  if (!record(value)) return false
  return (
    string(value.text) &&
    ['text', 'control', 'refusal'].includes(String(value.kind)) &&
    number(value.width) &&
    color(value.color) &&
    color(value.backgroundColor) &&
    color(value.textDecoration)
  )
}

function isRow(value: unknown): value is SavedPaintRow {
  if (!record(value)) return false
  return (
    color(value.backgroundColor) &&
    color(value.color) &&
    color(value.gutterBackgroundColor) &&
    number(value.top) &&
    number(value.height) &&
    value.height > 0 &&
    number(value.left) &&
    (value.fold === null || value.fold === 'collapsed' || value.fold === 'expanded') &&
    typeof value.cursor === 'boolean' &&
    strings(value.activeLanes) &&
    array(value.segments, 16_384, isSegment) &&
    array(value.gutterCells, 32, isGutterCell)
  )
}

function isGutterCell(value: unknown): value is SavedPaintRow['gutterCells'][number] {
  return record(value) && color(value.id) && string(value.paint)
}

function isLane(value: unknown): value is SavedPaint['gutterLayout']['lanes'][number] {
  return record(value) && color(value.id) && number(value.width)
}

function isRectangle(value: unknown): value is SavedPaint['layers'][number]['rectangles'][number] {
  if (!record(value)) return false
  return (
    number(value.left) &&
    number(value.top) &&
    number(value.width) &&
    number(value.height) &&
    value.width > 0 &&
    value.height > 0 &&
    color(value.backgroundColor)
  )
}

function isLayer(value: unknown): value is SavedPaint['layers'][number] {
  return record(value) && color(value.id) && array(value.rectangles, 8192, isRectangle)
}

function isSavedPaint(value: unknown): value is SavedPaint {
  if (!record(value) || value.format !== 5 || !string(value.appearance)) return false
  if (
    ![
      'scrollTop',
      'scrollLeft',
      'scrollHeight',
      'scrollWidth',
      'reservedLeft',
      'reservedRight',
      'viewportWidth',
      'viewportHeight',
      'boxWidth',
      'boxHeight',
      'gutterWidth',
    ].every((key) => number(value[key]))
  )
    return false
  if (
    !record(value.gutterLayout) ||
    !number(value.gutterLayout.leadingInset) ||
    !number(value.gutterLayout.fixedWidth)
  )
    return false
  if (!array(value.gutterLayout.lanes, 32, isLane)) return false
  if (!array(value.rows, 400, isRow) || !array(value.layers, 32, isLayer)) return false
  const segmentCount = value.rows.reduce((count, row) => count + row.segments.length, 0)
  const rectangles = value.layers.reduce((count, layer) => count + layer.rectangles.length, 0)
  if (segmentCount > 16_384 || rectangles > 8192 || value.rows.length === 0) return false
  return validPaintGeometry(value as SavedPaint)
}

function validPaintGeometry(paint: SavedPaint): boolean {
  if (paint.reservedLeft + paint.reservedRight > MAX_ABSOLUTE_PAINT_EXTENT) return false
  if (paint.viewportWidth <= 0 || paint.viewportHeight <= 0) return false
  if (
    paint.scrollHeight > MAX_ABSOLUTE_PAINT_EXTENT ||
    paint.scrollWidth > MAX_ABSOLUTE_PAINT_EXTENT
  )
    return false
  if (paint.scrollTop > Math.max(0, paint.scrollHeight - paint.viewportHeight) + 1) return false
  if (paint.scrollLeft > Math.max(0, paint.scrollWidth - paint.viewportWidth) + 1) return false
  const laneWidth = paint.gutterLayout.lanes.reduce(
    (sum, lane) => sum + lane.width,
    paint.gutterLayout.leadingInset + paint.gutterLayout.fixedWidth,
  )
  if (Math.abs(laneWidth - paint.gutterWidth) > 0.001) return false
  if (!uniqueIds(paint.gutterLayout.lanes) || !uniqueIds(paint.layers)) return false
  let previousEnd = -1
  for (const row of paint.rows) {
    if (row.top < previousEnd - 0.001 || row.top + row.height > paint.scrollHeight + 0.001)
      return false
    if (row.left > paint.scrollWidth || !uniqueIds(row.gutterCells)) return false
    previousEnd = row.top + row.height
  }
  return (
    paint.rows[0]!.top < paint.scrollTop + paint.viewportHeight && previousEnd > paint.scrollTop
  )
}

function uniqueIds(values: readonly { readonly id: string }[]): boolean {
  return (
    values.every((value) => value.id.length > 0) &&
    new Set(values.map((value) => value.id)).size === values.length
  )
}
