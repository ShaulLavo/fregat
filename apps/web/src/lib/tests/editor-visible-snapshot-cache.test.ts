import { testScopedStorage } from '../../../test/factories/scoped-storage'
import { afterEach, beforeEach, vi } from 'vitest'
import type { EditorVisibleSnapshotJSON } from '@singapor/core'

import { expect, test } from '../../../test/fixtures'
import { log } from '@/lib/client-logging'
import {
  EDITOR_VISIBLE_SNAPSHOT_CACHE_MAX_BYTES,
  EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY,
  readEditorVisibleSnapshotCache,
  removeEditorVisibleSnapshotCacheForPath,
  removeEditorVisibleSnapshotCacheForRoot,
  writeEditorVisibleSnapshotCache,
  type CachedEditorVisibleSnapshot,
} from '@/lib/editor-visible-snapshot-cache'

const STORE = new Map<string, string>()
const CONTENT_VERSION = 'stat:1:5'

beforeEach(() => {
  STORE.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: memoryLocalStorage(),
  })
})

afterEach(() => {
  STORE.clear()
  vi.restoreAllMocks()
  delete (globalThis as { localStorage?: Storage }).localStorage
})

test('round-trips one matching record and leaves mismatches untouched', () => {
  const record = cachedSnapshot('/repo', '/repo/src/app.ts', 'dark-plus')

  expect(writeEditorVisibleSnapshotCache(testScopedStorage, record).status).toBe('written')
  expect(
    readEditorVisibleSnapshotCache(testScopedStorage, {
      rootPath: '/repo',
      path: '/repo/src/app.ts',
      themeId: 'dark-plus',
    }),
  ).toEqual(record)
  expect(
    readEditorVisibleSnapshotCache(testScopedStorage, {
      rootPath: '/other',
      path: '/repo/src/app.ts',
      themeId: 'dark-plus',
    }),
  ).toBeNull()
  expect(
    readEditorVisibleSnapshotCache(testScopedStorage, {
      rootPath: '/repo',
      path: '/repo/src/app.ts',
      themeId: 'light-plus',
    }),
  ).toBeNull()
  expect(Boolean(testScopedStorage.getItem(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY))).toBe(true)
})

test('a write overwrites the single prior record', () => {
  writeEditorVisibleSnapshotCache(
    testScopedStorage,
    cachedSnapshot('/first', '/first/a.ts', 'dark-plus'),
  )
  const latest = cachedSnapshot('/second', '/second/b.ts', 'light-plus')

  writeEditorVisibleSnapshotCache(testScopedStorage, latest)

  expect(
    readEditorVisibleSnapshotCache(testScopedStorage, {
      rootPath: '/first',
      path: '/first/a.ts',
      themeId: 'dark-plus',
    }),
  ).toBeNull()
  expect(
    readEditorVisibleSnapshotCache(testScopedStorage, {
      rootPath: '/second',
      path: '/second/b.ts',
      themeId: 'light-plus',
    }),
  ).toEqual(latest)
})

test('removes malformed, unsupported, and deeply invalid records', () => {
  testScopedStorage.setItem(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY, '{not json')
  expect(readMatchingSnapshot()).toBeNull()
  expect(Boolean(testScopedStorage.getItem(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY))).toBe(false)

  const unsupported = { ...cachedSnapshot(), cacheVersion: 3 }
  testScopedStorage.setItem(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY, JSON.stringify(unsupported))
  expect(readMatchingSnapshot()).toBeNull()

  const invalid = structuredClone(cachedSnapshot())
  invalid.snapshot.rows[0]!.chunks[0]!.runs[0]!.end = 99
  testScopedStorage.setItem(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY, JSON.stringify(invalid))
  expect(readMatchingSnapshot()).toBeNull()
  expect(Boolean(testScopedStorage.getItem(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY))).toBe(false)
})

test('rejects invalid geometry, gutter lane ids, and run fidelity', () => {
  const invalidGeometry = structuredClone(cachedSnapshot())
  invalidGeometry.snapshot.rows[0]!.chunks[0]!.sourceEndOffset = -1
  expect(writeUntyped(invalidGeometry).status).toBe('invalid')

  const unknownLane = structuredClone(cachedSnapshot())
  unknownLane.snapshot.rows[0]!.gutterCursorLineBackgroundLaneIds = ['unknown']
  expect(writeUntyped(unknownLane).status).toBe('invalid')

  const duplicateLane = structuredClone(cachedSnapshot())
  duplicateLane.snapshot.rows[0]!.gutterCursorLineBackgroundLaneIds = ['fold-gutter', 'fold-gutter']
  expect(writeUntyped(duplicateLane).status).toBe('invalid')

  const wrongWidth = structuredClone(cachedSnapshot())
  wrongWidth.snapshot.gutterWidth += 1
  expect(writeUntyped(wrongWidth).status).toBe('invalid')

  const transformedRun = structuredClone(cachedSnapshot())
  transformedRun.snapshot.rows[0]!.chunks[0]!.replayFidelity = 'plain-transformed'
  expect(writeUntyped(transformedRun).status).toBe('invalid')
})

test('round-trips bounded paint rectangles including positions before the viewport', () => {
  const record = cachedSnapshot()
  record.snapshot.paintLayers = [
    {
      id: 'scope-lines',
      rectangles: [
        { left: -1, top: -20, width: 1, height: 40, backgroundColor: 'rgb(90, 90, 90)' },
      ],
    },
  ]

  expect(writeEditorVisibleSnapshotCache(testScopedStorage, record).status).toBe('written')
  expect(readMatchingSnapshot()?.snapshot.paintLayers).toEqual(record.snapshot.paintLayers)
})

test.each([
  ['left', Number.NaN],
  ['left', Number.POSITIVE_INFINITY],
  ['top', Number.NEGATIVE_INFINITY],
  ['width', 0],
  ['width', -1],
  ['height', 0],
  ['height', Number.POSITIVE_INFINITY],
])('rejects invalid paint rectangle %s = %s', (field, value) => {
  const record = cachedSnapshot()
  const rectangle = { left: 56, top: 0, width: 1, height: 20, backgroundColor: 'gray' }
  record.snapshot.paintLayers = [
    { id: 'scope-lines', rectangles: [{ ...rectangle, [field]: value }] },
  ]

  expect(writeEditorVisibleSnapshotCache(testScopedStorage, record).status).toBe('invalid')
})

test('rejects missing and pending paint layers in a persisted snapshot', () => {
  const record = cachedSnapshot()
  const { paintLayers: _paintLayers, ...withoutLayers } = record.snapshot

  expect(writeUntyped({ ...record, snapshot: withoutLayers }).status).toBe('invalid')
  expect(
    writeUntyped({ ...record, snapshot: { ...record.snapshot, paintLayers: null } }).status,
  ).toBe('invalid')
})

test('requires unique nonempty paint layer identities and bounds their count', () => {
  const record = cachedSnapshot()
  record.snapshot.paintLayers = [{ id: '', rectangles: [] }]
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, record).status).toBe('invalid')

  record.snapshot.paintLayers = [
    { id: 'scope-lines', rectangles: [] },
    { id: 'scope-lines', rectangles: [] },
  ]
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, record).status).toBe('invalid')

  record.snapshot.paintLayers = Array.from({ length: 32 }, (_, index) => ({
    id: `layer-${index}`,
    rectangles: [],
  }))
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, record).status).toBe('written')

  record.snapshot.paintLayers.push({ id: 'layer-overflow', rectangles: [] })
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, record).status).toBe('invalid')
})

test('bounds the aggregate rectangle count across paint layers', () => {
  const record = cachedSnapshot()
  const rectangles = Array.from({ length: 4_096 }, () => ({
    left: 0,
    top: 0,
    width: 1,
    height: 1,
    backgroundColor: '',
  }))
  record.snapshot.paintLayers = [
    { id: 'first', rectangles },
    { id: 'second', rectangles },
  ]
  // Geometry passes validation at the limit; serialization still enforces its smaller byte cap.
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, record).status).toBe('oversized')

  record.snapshot.paintLayers.push({ id: 'overflow', rectangles: [rectangles[0]!] })
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, record).status).toBe('invalid')

  record.snapshot.paintLayers = [
    { id: 'one-layer', rectangles: [...rectangles, ...rectangles, rectangles[0]!] },
  ]
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, record).status).toBe('invalid')
})

test('a rejected write preserves the prior record and emits a structured warning', () => {
  const prior = cachedSnapshot('/repo', '/repo/src/prior.ts')
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, prior).status).toBe('written')
  const storedPrior = testScopedStorage.getItem(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY)
  const warn = vi.spyOn(log, 'warn')
  const invalid = structuredClone(cachedSnapshot())
  invalid.snapshot.gutterWidth += 1

  expect(writeUntyped(invalid).status).toBe('invalid')
  expect(testScopedStorage.getItem(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY)).toBe(storedPrior)
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'editor.visible_snapshot.cache_write',
      outcome: 'invalid',
    }),
  )
})

test('rejects nonterminal paint and impossible mounted text geometry', () => {
  const loading = structuredClone(cachedSnapshot())
  loading.snapshot.initialHighlightStatus = 'loading'
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, loading).status).toBe('invalid')

  const zeroRowHeight = structuredClone(cachedSnapshot())
  zeroRowHeight.snapshot.metrics.rowHeight = 0
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, zeroRowHeight).status).toBe('invalid')

  const zeroCharacterWidth = structuredClone(cachedSnapshot())
  zeroCharacterWidth.snapshot.metrics.characterWidth = 0
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, zeroCharacterWidth).status).toBe(
    'invalid',
  )

  const zeroMountedHeight = structuredClone(cachedSnapshot())
  zeroMountedHeight.snapshot.rows[0]!.height = 0
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, zeroMountedHeight).status).toBe(
    'invalid',
  )

  const missingBufferRow = structuredClone(cachedSnapshot())
  missingBufferRow.snapshot.rows[0]!.bufferRow = missingBufferRow.snapshot.lineCount
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, missingBufferRow).status).toBe(
    'invalid',
  )

  const oversizedSpacer = structuredClone(cachedSnapshot())
  oversizedSpacer.snapshot.rows[0]!.leftSpacerWidth = oversizedSpacer.snapshot.contentWidth + 1
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, oversizedSpacer).status).toBe('invalid')

  const overlappingRows = structuredClone(cachedSnapshot())
  overlappingRows.snapshot.rows.push({ ...paintRow(), index: 1, top: 10 })
  overlappingRows.snapshot.totalHeight = 30
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, overlappingRows).status).toBe('invalid')
})

test('accepts a row bottom within the geometry tolerance', () => {
  const record = cachedSnapshot()
  record.snapshot.rows[0]!.top = 281.40000000000003
  record.snapshot.rows[0]!.height = 20.1
  record.snapshot.totalHeight = 301.5

  expect(record.snapshot.rows[0]!.top + record.snapshot.rows[0]!.height).toBeGreaterThan(
    record.snapshot.totalHeight,
  )
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, record).status).toBe('written')
})

test('rejects row, chunk, part, and run count overflows', () => {
  const rowOverflow = cachedSnapshot()
  rowOverflow.snapshot.rows = Array.from({ length: 401 }, (_, index) => ({
    ...paintRow(),
    index,
    top: index * 20,
  }))
  rowOverflow.snapshot.totalHeight = 8_020
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, rowOverflow).status).toBe('invalid')

  const chunkOverflow = cachedSnapshot()
  chunkOverflow.snapshot.rows[0]!.chunks = Array.from({ length: 4_097 }, emptyPaintChunk)
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, chunkOverflow).status).toBe('invalid')

  const partOverflow = cachedSnapshot()
  partOverflow.snapshot.rows[0]!.chunks = [
    {
      ...emptyPaintChunk(),
      parts: Array.from({ length: 16_385 }, () => ({ kind: 'text' as const, text: '' })),
    },
  ]
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, partOverflow).status).toBe('invalid')

  const runOverflow = cachedSnapshot()
  runOverflow.snapshot.rows[0]!.chunks = [paintChunkWithRuns(2_049)]
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, runOverflow).status).toBe('invalid')
})

test('enforces aggregate chunk, part, and run caps across rows', () => {
  const chunkOverflow = cachedSnapshot()
  chunkOverflow.snapshot.rows = [
    { ...paintRow(), chunks: Array.from({ length: 2_049 }, emptyPaintChunk) },
    {
      ...paintRow(),
      index: 1,
      top: 20,
      chunks: Array.from({ length: 2_048 }, emptyPaintChunk),
    },
  ]
  chunkOverflow.snapshot.totalHeight = 40
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, chunkOverflow).status).toBe('invalid')

  const partOverflow = cachedSnapshot()
  partOverflow.snapshot.rows[0]!.chunks = [
    {
      ...emptyPaintChunk(),
      parts: Array.from({ length: 8_193 }, () => ({ kind: 'text' as const, text: '' })),
    },
    {
      ...emptyPaintChunk(),
      parts: Array.from({ length: 8_192 }, () => ({ kind: 'text' as const, text: '' })),
    },
  ]
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, partOverflow).status).toBe('invalid')

  const runOverflow = cachedSnapshot()
  runOverflow.snapshot.rows[0]!.chunks = [paintChunkWithRuns(1_025), paintChunkWithRuns(1_024)]
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, runOverflow).status).toBe('invalid')
})

test('rejects an oversized write before storage and an oversized read before parsing', () => {
  const prior = cachedSnapshot('/repo', '/repo/src/prior.ts')
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, prior).status).toBe('written')
  const storedPrior = testScopedStorage.getItem(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY)
  const oversized = cachedSnapshot()
  const text = 'x'.repeat(EDITOR_VISIBLE_SNAPSHOT_CACHE_MAX_BYTES / 2)
  oversized.snapshot.rows[0]!.chunks = [exactPaintChunk(text)]

  const writeResult = writeEditorVisibleSnapshotCache(testScopedStorage, oversized)
  expect(writeResult.status).toBe('oversized')
  expect(writeResult.serializedBytes).toBeGreaterThan(EDITOR_VISIBLE_SNAPSHOT_CACHE_MAX_BYTES)
  expect(testScopedStorage.getItem(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY)).toBe(storedPrior)

  const parse = vi.spyOn(JSON, 'parse')
  testScopedStorage.setItem(
    EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY,
    'x'.repeat(EDITOR_VISIBLE_SNAPSHOT_CACHE_MAX_BYTES / 2 + 1),
  )
  expect(readMatchingSnapshot()).toBeNull()
  expect(parse).not.toHaveBeenCalled()
  expect(Boolean(testScopedStorage.getItem(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY))).toBe(false)
})

test('a quota failure preserves the prior visible snapshot', () => {
  const prior = cachedSnapshot('/repo', '/repo/src/prior.ts')
  const serializedPrior = JSON.stringify(prior)
  testScopedStorage.setItem(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY, serializedPrior)
  STORE.set('unrelated', 'keep')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: memoryLocalStorage({ failSnapshotWrites: true }),
  })

  expect(writeEditorVisibleSnapshotCache(testScopedStorage, cachedSnapshot()).status).toBe(
    'storage-failed',
  )
  expect(testScopedStorage.getItem(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY)).toBe(serializedPrior)
  expect(STORE.get('unrelated')).toBe('keep')
})

test('root and path removals affect only a matching record', () => {
  writeEditorVisibleSnapshotCache(testScopedStorage, cachedSnapshot('/repo', '/repo/src/app.ts'))

  removeEditorVisibleSnapshotCacheForRoot(testScopedStorage, '/other')
  removeEditorVisibleSnapshotCacheForPath(testScopedStorage, {
    rootPath: '/repo',
    path: '/repo/src/other.ts',
  })
  expect(Boolean(testScopedStorage.getItem(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY))).toBe(true)

  removeEditorVisibleSnapshotCacheForPath(testScopedStorage, {
    rootPath: '/repo',
    path: '/repo/src/app.ts',
  })
  expect(Boolean(testScopedStorage.getItem(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY))).toBe(false)

  writeEditorVisibleSnapshotCache(testScopedStorage, cachedSnapshot('/repo', '/repo/src/app.ts'))
  removeEditorVisibleSnapshotCacheForRoot(testScopedStorage, '/repo')
  expect(Boolean(testScopedStorage.getItem(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY))).toBe(false)
})

test('accepts wrapped and injected display indices beyond document line count', () => {
  const record = cachedSnapshot()
  const injected = paintRow()
  injected.index = 1
  injected.source = 'injected'
  injected.injectedTextRowId = 'hint-1'
  injected.firstWrapSegment = false
  injected.top = 20
  injected.contentCursorLine = false
  injected.gutterNumberCursorLine = false
  injected.gutterCursorLineBackgroundLaneIds = []
  injected.chunks = [
    {
      ...exactPaintChunk('hint'),
      replayFidelity: 'plain-transformed',
      runs: [],
    },
  ]
  const wrapped = paintRow()
  wrapped.index = 2
  wrapped.firstWrapSegment = false
  wrapped.top = 40
  record.snapshot.rows.push(injected, wrapped)
  record.snapshot.totalHeight = 60
  record.snapshot.viewport.visibleRange = { start: 0, end: 3 }

  expect(writeEditorVisibleSnapshotCache(testScopedStorage, record).status).toBe('written')
})

function readMatchingSnapshot() {
  return readEditorVisibleSnapshotCache(testScopedStorage, {
    rootPath: '/repo',
    path: '/repo/src/app.ts',
    themeId: 'dark-plus',
  })
}

function cachedSnapshot(
  rootPath = '/repo',
  path = '/repo/src/app.ts',
  themeId = 'dark-plus',
): Mutable<CachedEditorVisibleSnapshot> {
  return {
    cacheVersion: 4,
    contentVersion: CONTENT_VERSION,
    rootPath,
    path,
    themeId,
    snapshot: visibleSnapshot(),
  }
}

function visibleSnapshot(): Mutable<EditorVisibleSnapshotJSON> {
  return {
    paintLayers: [],
    kind: 'editor-visible',
    schemaVersion: 1,
    documentId: 'document-1',
    languageId: 'typescript',
    theme: { foregroundColor: '#ffffff', syntax: { keyword: '#ff00ff' } },
    textVersion: 1,
    initialHighlightStatus: 'painted',
    metrics: { rowHeight: 20, characterWidth: 8 },
    lineCount: 1,
    contentWidth: 40,
    totalHeight: 20,
    gutterWidth: 56,
    gutterLayout: {
      fixedWidth: 16,
      lanes: [
        { id: 'line-gutter', width: 24 },
        { id: 'fold-gutter', width: 16 },
      ],
    },
    tabSize: 2,
    viewport: {
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: 20,
      scrollWidth: 96,
      clientHeight: 20,
      clientWidth: 96,
      borderBoxHeight: 20,
      borderBoxWidth: 96,
      visibleRange: { start: 0, end: 1 },
    },
    rows: [paintRow()],
  }
}

function paintRow(): Mutable<EditorVisibleSnapshotJSON['rows'][number]> {
  return {
    index: 0,
    bufferRow: 0,
    source: 'document',
    injectedTextRowId: null,
    firstWrapSegment: true,
    top: 0,
    height: 20,
    leftSpacerWidth: 0,
    contentCursorLine: true,
    gutterNumberCursorLine: true,
    gutterCursorLineBackgroundLaneIds: ['fold-gutter'],
    foldMarker: null,
    chunks: [exactPaintChunk('const')],
  }
}

function exactPaintChunk(
  text: string,
): Mutable<EditorVisibleSnapshotJSON['rows'][number]['chunks'][number]> {
  return {
    sourceStartOffset: 0,
    sourceEndOffset: text.length,
    rowLocalStart: 0,
    rowLocalEnd: text.length,
    parts: [{ kind: 'text', text }],
    replayFidelity: 'exact',
    runs: text.length > 0 ? [{ start: 0, end: text.length, style: { color: '#ff00ff' } }] : [],
  }
}

function emptyPaintChunk() {
  return exactPaintChunk('')
}

function paintChunkWithRuns(count: number) {
  const text = 'x'.repeat(count)
  return {
    ...exactPaintChunk(text),
    runs: Array.from({ length: count }, (_, index) => ({
      start: index,
      end: index + 1,
      style: { color: index % 2 === 0 ? '#ffffff' : '#000000' },
    })),
  }
}

function writeUntyped(value: unknown) {
  return writeEditorVisibleSnapshotCache(testScopedStorage, value as CachedEditorVisibleSnapshot)
}

type Mutable<T> = {
  -readonly [Key in keyof T]: Mutable<T[Key]>
}

function memoryLocalStorage({ failSnapshotWrites = false } = {}): Storage {
  return {
    get length() {
      return STORE.size
    },
    clear: () => STORE.clear(),
    getItem: (key) => STORE.get(key) ?? null,
    key: (index) => Array.from(STORE.keys())[index] ?? null,
    removeItem: (key) => void STORE.delete(key),
    setItem: (key, value) => {
      if (
        failSnapshotWrites &&
        key ===
          `env:${testScopedStorage.environmentId}|${EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY}`
      ) {
        throw new DOMException('localStorage quota exceeded')
      }

      STORE.set(key, value)
    },
  }
}
