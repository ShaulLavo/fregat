import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import {
  readWorkspaceCacheEntry,
  removeWorkspaceCacheEntry,
  workspaceCacheStorageKey,
  writeWorkspaceCacheEntry,
  type WorkspaceCacheWriteResult,
} from '@/lib/workspace-cache-storage'
import { log } from '@/lib/client-logging'
import type {
  EditorMountedChunkPaintPartJSON,
  EditorVisiblePaintChunkJSON,
  EditorVisiblePaintRowJSON,
  EditorVisiblePaintRunJSON,
  EditorVisibleSnapshotJSON,
} from '@singapor/core'
import * as v from 'valibot'

export const EDITOR_VISIBLE_SNAPSHOT_CACHE_MAX_BYTES = 262_144
export const EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY =
  workspaceCacheStorageKey('editorVisibleSnapshot')

const MAX_ROWS = 400
const MAX_CHUNKS = 4_096
const MAX_PAINT_PARTS = 16_384
const MAX_PAINT_RUNS = 2_048
const MAX_PAINT_LAYERS = 32
const MAX_PAINT_RECTANGLES = 8_192

export type CachedEditorVisibleSnapshot = {
  readonly cacheVersion: 4
  readonly contentVersion: string
  readonly rootPath: string
  readonly path: string
  readonly themeId: string
  readonly snapshot: EditorVisibleSnapshotJSON
}

export type EditorVisibleSnapshotCacheKey = Pick<
  CachedEditorVisibleSnapshot,
  'rootPath' | 'path' | 'themeId'
>

export type EditorVisibleSnapshotCacheWriteResult =
  | WorkspaceCacheWriteResult
  | {
      readonly serializedBytes: null
      readonly status: 'invalid'
    }

const finiteNumberSchema = v.pipe(v.number(), v.finite())
const nonNegativeNumberSchema = v.pipe(finiteNumberSchema, v.minValue(0))
const positiveNumberSchema = v.pipe(
  finiteNumberSchema,
  v.check((value) => value > 0),
)
const nonNegativeIntegerSchema = v.pipe(nonNegativeNumberSchema, v.safeInteger())
const positiveIntegerSchema = v.pipe(nonNegativeIntegerSchema, v.minValue(1))

const editorSyntaxThemeSchema = v.strictObject({
  attribute: v.optional(v.string()),
  bracket: v.optional(v.string()),
  comment: v.optional(v.string()),
  constant: v.optional(v.string()),
  function: v.optional(v.string()),
  keyword: v.optional(v.string()),
  keywordDeclaration: v.optional(v.string()),
  keywordImport: v.optional(v.string()),
  namespace: v.optional(v.string()),
  number: v.optional(v.string()),
  parameter: v.optional(v.string()),
  property: v.optional(v.string()),
  string: v.optional(v.string()),
  type: v.optional(v.string()),
  typeDefinition: v.optional(v.string()),
  typeParameter: v.optional(v.string()),
  variable: v.optional(v.string()),
  variableBuiltin: v.optional(v.string()),
})
const editorThemeSchema = v.strictObject({
  type: v.optional(v.union([v.literal('light'), v.literal('dark'), v.literal('highContrast')])),
  backgroundColor: v.optional(v.string()),
  foregroundColor: v.optional(v.string()),
  gutterBackgroundColor: v.optional(v.string()),
  gutterForegroundColor: v.optional(v.string()),
  caretColor: v.optional(v.string()),
  minimapBackgroundColor: v.optional(v.string()),
  syntax: v.optional(editorSyntaxThemeSchema),
  colors: v.optional(v.record(v.string(), v.string())),
})
const metricsSchema = v.strictObject({
  rowHeight: positiveNumberSchema,
  characterWidth: positiveNumberSchema,
})
const gutterLaneSchema = v.strictObject({
  id: v.string(),
  width: nonNegativeNumberSchema,
})
const gutterLayoutSchema = v.strictObject({
  fixedWidth: nonNegativeNumberSchema,
  lanes: v.array(gutterLaneSchema),
})
const paintRectangleSchema = v.strictObject({
  left: finiteNumberSchema,
  top: finiteNumberSchema,
  width: positiveNumberSchema,
  height: positiveNumberSchema,
  backgroundColor: v.string(),
})
const paintLayerSchema = v.strictObject({
  id: v.pipe(v.string(), v.minLength(1)),
  rectangles: v.pipe(v.array(paintRectangleSchema), v.maxLength(MAX_PAINT_RECTANGLES)),
})
const visibleRangeSchema = v.pipe(
  v.strictObject({
    start: nonNegativeIntegerSchema,
    end: nonNegativeIntegerSchema,
  }),
  v.check((range) => range.start <= range.end),
)
const viewportSchema = v.strictObject({
  scrollTop: nonNegativeNumberSchema,
  scrollLeft: nonNegativeNumberSchema,
  scrollHeight: nonNegativeNumberSchema,
  scrollWidth: nonNegativeNumberSchema,
  clientHeight: nonNegativeNumberSchema,
  clientWidth: nonNegativeNumberSchema,
  borderBoxHeight: v.nullable(nonNegativeNumberSchema),
  borderBoxWidth: v.nullable(nonNegativeNumberSchema),
  visibleRange: visibleRangeSchema,
})
const foldMarkerSchema = v.pipe(
  v.strictObject({
    key: v.string(),
    startOffset: nonNegativeIntegerSchema,
    endOffset: nonNegativeIntegerSchema,
    startRow: nonNegativeIntegerSchema,
    endRow: nonNegativeIntegerSchema,
    collapsed: v.boolean(),
  }),
  v.check((marker) => marker.startOffset <= marker.endOffset && marker.startRow <= marker.endRow),
)
const paintPartSchema = v.union([
  v.strictObject({ kind: v.literal('text'), text: v.string() }),
  v.strictObject({
    kind: v.literal('control'),
    text: v.string(),
    widthCells: positiveIntegerSchema,
  }),
  v.strictObject({ kind: v.literal('refusal'), text: v.string() }),
])
const paintRunStyleSchema = v.strictObject({
  color: v.optional(v.string()),
  backgroundColor: v.optional(v.string()),
  textDecoration: v.optional(v.string()),
})
const paintRunSchema = v.pipe(
  v.strictObject({
    start: nonNegativeIntegerSchema,
    end: nonNegativeIntegerSchema,
    style: paintRunStyleSchema,
  }),
  v.check((run) => run.start < run.end && Object.keys(run.style).length > 0),
)
const paintChunkSchema = v.pipe(
  v.strictObject({
    sourceStartOffset: nonNegativeIntegerSchema,
    sourceEndOffset: nonNegativeIntegerSchema,
    rowLocalStart: nonNegativeIntegerSchema,
    rowLocalEnd: nonNegativeIntegerSchema,
    parts: v.pipe(v.array(paintPartSchema), v.maxLength(MAX_PAINT_PARTS)),
    replayFidelity: v.union([
      v.literal('exact'),
      v.literal('plain-transformed'),
      v.literal('plain-overlap'),
      v.literal('plain-core-rendered'),
    ]),
    runs: v.pipe(v.array(paintRunSchema), v.maxLength(MAX_PAINT_RUNS)),
  }),
  v.check((chunk) => paintChunkIsValid(chunk)),
)
const paintRowSchema = v.strictObject({
  index: nonNegativeIntegerSchema,
  bufferRow: nonNegativeIntegerSchema,
  source: v.union([v.literal('document'), v.literal('injected')]),
  injectedTextRowId: v.nullable(v.string()),
  firstWrapSegment: v.boolean(),
  top: nonNegativeNumberSchema,
  height: positiveNumberSchema,
  leftSpacerWidth: nonNegativeNumberSchema,
  contentCursorLine: v.boolean(),
  gutterNumberCursorLine: v.boolean(),
  gutterCursorLineBackgroundLaneIds: v.array(v.string()),
  foldMarker: v.nullable(foldMarkerSchema),
  chunks: v.pipe(v.array(paintChunkSchema), v.maxLength(MAX_CHUNKS)),
})
const editorVisibleSnapshotSchema = v.pipe(
  v.strictObject({
    kind: v.literal('editor-visible'),
    schemaVersion: v.literal(1),
    documentId: v.nullable(v.string()),
    languageId: v.nullable(v.string()),
    theme: v.nullable(editorThemeSchema),
    textVersion: nonNegativeIntegerSchema,
    initialHighlightStatus: v.union([
      v.literal('painted'),
      v.literal('plain'),
      v.literal('degraded'),
      v.literal('error'),
    ]),
    metrics: metricsSchema,
    lineCount: positiveIntegerSchema,
    contentWidth: nonNegativeNumberSchema,
    totalHeight: nonNegativeNumberSchema,
    gutterWidth: nonNegativeNumberSchema,
    gutterLayout: gutterLayoutSchema,
    tabSize: positiveIntegerSchema,
    viewport: viewportSchema,
    rows: v.pipe(v.array(paintRowSchema), v.maxLength(MAX_ROWS)),
    paintLayers: v.pipe(v.array(paintLayerSchema), v.maxLength(MAX_PAINT_LAYERS)),
  }),
  v.check((snapshot) => editorVisibleSnapshotIsValid(snapshot)),
)
const cachedEditorVisibleSnapshotSchema = v.strictObject({
  cacheVersion: v.literal(4),
  contentVersion: v.string(),
  rootPath: v.string(),
  path: v.string(),
  themeId: v.string(),
  snapshot: editorVisibleSnapshotSchema,
})

export function readEditorVisibleSnapshotCache(
  storage: ScopedStorage,
  key: EditorVisibleSnapshotCacheKey,
): CachedEditorVisibleSnapshot | null {
  const cached = readStoredEditorVisibleSnapshot(storage)
  if (!cached) return null
  if (cached.rootPath !== key.rootPath) return null
  if (cached.path !== key.path) return null
  if (cached.themeId !== key.themeId) return null
  return cached
}

export function writeEditorVisibleSnapshotCache(
  storage: ScopedStorage,
  record: CachedEditorVisibleSnapshot,
): EditorVisibleSnapshotCacheWriteResult {
  const parsed = v.safeParse(cachedEditorVisibleSnapshotSchema, record)
  if (!parsed.success) {
    log.warn({
      action: 'editor.visible_snapshot.cache_write',
      area: 'editor',
      outcome: 'invalid',
      validationIssueCount: parsed.issues.length,
    })
    return { serializedBytes: null, status: 'invalid' }
  }

  const result = writeWorkspaceCacheEntry(
    EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY,
    parsed.output,
    {
      storage,
      maxSerializedBytes: EDITOR_VISIBLE_SNAPSHOT_CACHE_MAX_BYTES,
    },
  )
  if (result.status === 'written' || result.status === 'unavailable') return result

  log.warn({
    action: 'editor.visible_snapshot.cache_write',
    area: 'editor',
    outcome: result.status,
    path: parsed.output.path,
    rootPath: parsed.output.rootPath,
    serializedBytes: result.serializedBytes,
  })
  return result
}

export function removeEditorVisibleSnapshotCacheForPath(
  storage: ScopedStorage,
  { rootPath, path }: Pick<EditorVisibleSnapshotCacheKey, 'rootPath' | 'path'>,
) {
  const cached = readStoredEditorVisibleSnapshot(storage)
  if (!cached) return
  if (cached.rootPath !== rootPath || cached.path !== path) return

  removeEditorVisibleSnapshotCache(storage)
}

export function removeEditorVisibleSnapshotCacheForRoot(storage: ScopedStorage, rootPath: string) {
  const cached = readStoredEditorVisibleSnapshot(storage)
  if (!cached || cached.rootPath !== rootPath) return

  removeEditorVisibleSnapshotCache(storage)
}

export function removeEditorVisibleSnapshotCache(storage: ScopedStorage) {
  removeWorkspaceCacheEntry(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY, storage)
}

function readStoredEditorVisibleSnapshot(storage: ScopedStorage) {
  return readWorkspaceCacheEntry<CachedEditorVisibleSnapshot | null>(
    EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY,
    cachedEditorVisibleSnapshotSchema,
    null,
    { storage, maxSerializedBytes: EDITOR_VISIBLE_SNAPSHOT_CACHE_MAX_BYTES },
  )
}

function paintChunkIsValid(chunk: EditorVisiblePaintChunkJSON) {
  if (chunk.sourceStartOffset > chunk.sourceEndOffset) return false
  if (chunk.rowLocalStart > chunk.rowLocalEnd) return false
  if (chunk.replayFidelity !== 'exact' && chunk.runs.length > 0) return false

  const paintLength = paintTextPartsLength(chunk.parts)
  if (!paintRunsAreValid(chunk.runs, paintLength)) return false
  if (chunk.replayFidelity !== 'exact') return true
  if (chunk.parts.some((part) => part.kind !== 'text')) return false
  if (paintLength !== chunk.sourceEndOffset - chunk.sourceStartOffset) return false

  return paintLength === chunk.rowLocalEnd - chunk.rowLocalStart
}

function paintTextPartsLength(parts: readonly EditorMountedChunkPaintPartJSON[]) {
  let length = 0
  for (const part of parts) {
    if (part.kind !== 'text') continue

    length += part.text.length
  }

  return length
}

function paintRunsAreValid(runs: readonly EditorVisiblePaintRunJSON[], paintLength: number) {
  let previousEnd = 0
  for (const run of runs) {
    if (run.start < previousEnd) return false
    if (run.end > paintLength) return false

    previousEnd = run.end
  }

  return true
}

function editorVisibleSnapshotIsValid(snapshot: EditorVisibleSnapshotJSON) {
  const paintLayerIds = new Set<string>()
  let rectangles = 0
  for (const layer of snapshot.paintLayers) {
    if (paintLayerIds.has(layer.id)) return false
    paintLayerIds.add(layer.id)
    rectangles += layer.rectangles.length
  }
  if (rectangles > MAX_PAINT_RECTANGLES) return false

  const laneIds = new Set<string>()
  let gutterWidth = snapshot.gutterLayout.fixedWidth
  for (const lane of snapshot.gutterLayout.lanes) {
    if (laneIds.has(lane.id)) return false

    laneIds.add(lane.id)
    gutterWidth += lane.width
  }
  if (!numbersEqual(gutterWidth, snapshot.gutterWidth)) return false

  let chunks = 0
  let parts = 0
  let runs = 0
  let previousRowIndex = -1
  let previousRowBottom = -1
  for (const row of snapshot.rows) {
    if (row.index <= previousRowIndex) return false
    if (row.bufferRow >= snapshot.lineCount) return false
    if (row.top < previousRowBottom) return false
    const rowBottom = row.top + row.height
    if (rowBottom > snapshot.totalHeight && !numbersEqual(rowBottom, snapshot.totalHeight)) {
      return false
    }
    if (row.leftSpacerWidth > snapshot.contentWidth) return false
    if (!rowGutterLaneIdsAreValid(row, laneIds)) return false
    if (!rowChunksAreValid(row)) return false

    previousRowIndex = row.index
    previousRowBottom = rowBottom
    chunks += row.chunks.length
    for (const chunk of row.chunks) {
      parts += chunk.parts.length
      runs += chunk.runs.length
    }
  }

  return chunks <= MAX_CHUNKS && parts <= MAX_PAINT_PARTS && runs <= MAX_PAINT_RUNS
}

function rowGutterLaneIdsAreValid(
  row: EditorVisiblePaintRowJSON,
  knownLaneIds: ReadonlySet<string>,
) {
  const rowLaneIds = new Set<string>()
  for (const laneId of row.gutterCursorLineBackgroundLaneIds) {
    if (!knownLaneIds.has(laneId)) return false
    if (rowLaneIds.has(laneId)) return false

    rowLaneIds.add(laneId)
  }

  return true
}

function rowChunksAreValid(row: EditorVisiblePaintRowJSON) {
  if (row.source === 'document' && row.injectedTextRowId !== null) return false
  if (row.source === 'injected' && row.injectedTextRowId === null) return false
  if (row.source === 'injected' && row.firstWrapSegment) return false
  if (row.foldMarker && !row.firstWrapSegment) return false

  const firstChunk = row.chunks[0]
  if (!firstChunk) return row.leftSpacerWidth === 0
  if (firstChunk.rowLocalStart === 0 && row.leftSpacerWidth !== 0) return false
  if (firstChunk.rowLocalStart > 0 && row.leftSpacerWidth === 0) return false

  let previousSourceEnd = -1
  let previousRowLocalEnd = -1
  for (const chunk of row.chunks) {
    if (row.source === 'injected' && chunk.replayFidelity === 'exact') return false
    if (chunk.sourceStartOffset < previousSourceEnd) return false
    if (chunk.rowLocalStart < previousRowLocalEnd) return false

    previousSourceEnd = chunk.sourceEndOffset
    previousRowLocalEnd = chunk.rowLocalEnd
  }

  return true
}

function numbersEqual(left: number, right: number) {
  return Math.abs(left - right) < 0.001
}
