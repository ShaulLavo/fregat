import { describe, expect, it, vi } from 'vitest'

import {
  createFoldGutterContribution,
  createLineGutterContribution,
} from '../../gutters/src/index.ts'

import { createEditorViewSnapshot, serializeEditorViewSnapshot } from '../src/editor/viewSnapshot'
import { EditorViewContributionController } from '../src/editor/viewContributions'
import { MAX_VISIBLE_PAINT_RECTANGLES } from '../src/editor/visiblePaint'
import { createInlineMap } from '../src/inlineMap'
import { createPieceTableSnapshot } from '../src/public/document'
import type {
  EditorMountedChunkPaintJSON,
  EditorViewContribution,
  EditorVisiblePaintRectangle,
  EditorViewSnapshot,
  EditorVisibleRowSnapshot,
} from '../src/plugins'
import { EditorTokenStore } from '../src/syntax/tokenStore'
import type { EditorToken } from '../src/tokens'
import { VirtualizedTextView } from '../src/virtualization'

const TEXT = 'const value = 1'

type SnapshotHarness = {
  readonly snapshot: EditorViewSnapshot
  readonly materializeFullText: ReturnType<typeof vi.fn<() => string>>
  readonly readRange: ReturnType<typeof vi.fn<(start: number, end: number) => string>>
  readonly readLineStarts: ReturnType<typeof vi.fn<() => readonly number[]>>
  readonly lineStartsViewToArray: ReturnType<typeof vi.fn<() => readonly number[]>>
}

describe('editor view snapshot serialization', () => {
  it('attaches non-enumerable methods and keeps compact extraction mounted and bounded', () => {
    const tokens = EditorTokenStore.fromTokens([
      {
        start: 0,
        end: 5,
        style: { color: '#ff0000', fontWeight: 700 },
      },
    ])
    const harness = snapshotHarness({ tokens })

    expect(harness.snapshot).not.toHaveProperty('toJSON')
    expect(Object.keys(harness.snapshot)).not.toContain('toVisibleSnapshot')

    const visible = harness.snapshot.toVisibleSnapshot()

    expect(visible).not.toBeNull()
    expect(harness.materializeFullText).not.toHaveBeenCalled()
    expect(harness.readLineStarts).not.toHaveBeenCalled()
    expect(harness.lineStartsViewToArray).not.toHaveBeenCalled()
    expect(visible?.rows[0]?.chunks[0]).toEqual({
      sourceStartOffset: 0,
      sourceEndOffset: 5,
      rowLocalStart: 0,
      rowLocalEnd: 5,
      parts: [{ kind: 'text', text: 'const' }],
      replayFidelity: 'exact',
      runs: [{ start: 0, end: 5, style: { color: '#ff0000' } }],
    })
    expect(visible?.rows[0]?.chunks[0]).not.toHaveProperty('text')
    expect(Object.getOwnPropertyDescriptor(visible, 'toJSON')?.enumerable).toBe(false)

    const visibleJSON = visible!.toJSON()
    expect(visibleJSON.viewport.scrollRow).toBe(harness.snapshot.viewport.scrollRow)
    expect(visibleJSON.viewport.borderBoxHeight).toBeNull()
    expect(visible!.toJSON()).toEqual(visibleJSON)
    expect(() => structuredClone(visibleJSON)).not.toThrow()

    const fullJSON = serializeEditorViewSnapshot(harness.snapshot)
    expect(fullJSON.viewport.scrollRow).toBe(harness.snapshot.viewport.scrollRow)
    expect(harness.materializeFullText).not.toHaveBeenCalled()
    expect(harness.readRange).toHaveBeenLastCalledWith(0, TEXT.length)
    expect(harness.readLineStarts).toHaveBeenCalledTimes(1)
    expect(harness.lineStartsViewToArray).not.toHaveBeenCalled()
    expect(fullJSON).not.toHaveProperty('documentSyncPoint')
    expect(fullJSON).not.toHaveProperty('changesSinceDocumentSyncPoint')
    expect(fullJSON).not.toHaveProperty('textSnapshot')
    expect(fullJSON.visibleRows[0]?.chunks[0]?.text).toBe('ignored runtime chunk text')
    expect(() => structuredClone(fullJSON)).not.toThrow()
  })

  it('does no source or token work for transformed, injected, core-rendered, or refused paint', () => {
    const tokens = EditorTokenStore.fromTokens([{ start: 0, end: 5, style: { color: 'red' } }])
    const tokenReads = watchTokenReads(tokens)
    const transformed = snapshotHarness({
      tokens,
      chunks: [chunk(0, 1_000_000, [{ kind: 'text', text: 'x' }])],
    })

    expect(transformed.snapshot.toVisibleSnapshot()?.rows[0]?.chunks[0]?.replayFidelity).toBe(
      'plain-transformed',
    )
    expect(transformed.readRange).not.toHaveBeenCalled()
    expect(tokenReads.calls()).toBe(0)

    const injected = snapshotHarness({
      rowSource: 'injected',
      chunks: [chunk(0, 5, [{ kind: 'text', text: 'const' }])],
    })
    expect(injected.snapshot.toVisibleSnapshot()?.rows[0]?.chunks[0]?.replayFidelity).toBe(
      'plain-transformed',
    )
    expect(injected.readRange).not.toHaveBeenCalled()

    const control = snapshotHarness({
      chunks: [chunk(0, 1, [{ kind: 'control', text: 'NUL', widthCells: 3 }])],
    })
    expect(control.snapshot.toVisibleSnapshot()?.rows[0]?.chunks[0]).toMatchObject({
      replayFidelity: 'plain-core-rendered',
      parts: [{ kind: 'control', text: 'NUL', widthCells: 3 }],
      runs: [],
    })
    expect(control.readRange).not.toHaveBeenCalled()

    const unsupported = snapshotHarness({ mountedPaintSupport: 'unreplayable-plugin-css' })
    expect(unsupported.snapshot.toVisibleSnapshot()).toBeNull()
    expect(unsupported.readRange).not.toHaveBeenCalled()
  })

  it('replays hand-built unsorted overlap exactly, in store order', () => {
    const tokens = EditorTokenStore.fromTokens([
      { start: 2, end: 5, style: { color: 'blue' } },
      { start: 0, end: 4, style: { color: 'red' } },
    ])
    const harness = snapshotHarness({ tokens })

    expect(harness.snapshot.toVisibleSnapshot()?.rows[0]?.chunks[0]).toMatchObject({
      replayFidelity: 'exact',
      runs: [
        { start: 0, end: 2, style: { color: 'red' } },
        { start: 2, end: 5, style: { color: 'blue' } },
      ],
    })
  })

  it('replays overlap in deterministic store order', () => {
    const tokens = EditorTokenStore.fromTokens([
      { start: 0, end: 5, style: { color: 'red' } },
      { start: 2, end: 4, style: { color: 'blue' } },
    ])
    const harness = snapshotHarness({ tokens })

    expect(harness.snapshot.toVisibleSnapshot()?.rows[0]?.chunks[0]?.runs).toEqual([
      { start: 0, end: 2, style: { color: 'red' } },
      { start: 2, end: 4, style: { color: 'blue' } },
      { start: 4, end: 5, style: { color: 'red' } },
    ])
  })

  it('reads the captured text once through the named serializer and never on spread or stringify', () => {
    const harness = snapshotHarness()

    const spread = { ...harness.snapshot }
    JSON.stringify(harness.snapshot)
    expect(spread.textSnapshot).toBe(harness.snapshot.textSnapshot)
    expect(harness.readRange).not.toHaveBeenCalled()
    expect(harness.materializeFullText).not.toHaveBeenCalled()

    const parsed = JSON.parse(JSON.stringify(serializeEditorViewSnapshot(harness.snapshot)))

    expect(parsed).toMatchObject({ kind: 'editor-view', schemaVersion: 1, fullText: TEXT })
    expect(harness.readRange).toHaveBeenCalledTimes(1)
    expect(harness.readRange).toHaveBeenCalledWith(0, TEXT.length)
    expect(harness.materializeFullText).not.toHaveBeenCalled()
    expect(harness.lineStartsViewToArray).not.toHaveBeenCalled()
  })

  it('serializes tokens packed, and the packed arrays rebuild an equal store', () => {
    const keyword = { color: '#ff0000', fontWeight: 700 }
    const tokens = EditorTokenStore.fromTokens([
      { start: 6, end: 11, style: { color: '#00ff00', fontStyle: 'italic' } },
      { start: 0, end: 5, style: keyword },
      { start: 14, end: 15, style: keyword },
    ])
    const harness = snapshotHarness({ tokens })

    const json = JSON.parse(JSON.stringify(serializeEditorViewSnapshot(harness.snapshot))).tokens
    expect(json).toEqual({
      starts: [0, 6, 14],
      ends: [5, 11, 15],
      styleIds: [1, 0, 1],
      styles: [{ color: '#00ff00', fontStyle: 'italic' }, keyword],
    })

    const rebuilt = EditorTokenStore.fromPacked({
      starts: Uint32Array.from(json.starts),
      ends: Uint32Array.from(json.ends),
      styleIds: Uint32Array.from(json.styleIds),
      styles: json.styles,
      monotonicEnd: false,
      nonOverlapping: false,
      sortedByStart: false,
    })
    expect(rebuilt.equals(tokens)).toBe(true)
    expect(rebuilt.nonOverlapping).toBe(true)
  })

  it('rejects non-finite numeric token style values instead of JSON-null coercion', () => {
    const harness = snapshotHarness({
      tokens: EditorTokenStore.fromTokens([
        { start: 0, end: 5, style: { fontWeight: Number.POSITIVE_INFINITY } },
      ]),
    })

    expect(() => serializeEditorViewSnapshot(harness.snapshot)).toThrow(/fontWeight.*finite/)
  })

  it('checks same-length transformed paint before token work and keeps all fallbacks zero-work', () => {
    const tokens = EditorTokenStore.fromTokens([{ start: 0, end: 5, style: { color: 'red' } }])
    const tokenReads = watchTokenReads(tokens)
    const sameLength = snapshotHarness({
      tokens,
      chunks: [chunk(0, 5, [{ kind: 'text', text: 'other' }])],
    })

    expect(sameLength.snapshot.toVisibleSnapshot()?.rows[0]?.chunks[0]?.replayFidelity).toBe(
      'plain-transformed',
    )
    expect(sameLength.readRange).toHaveBeenCalledTimes(1)
    expect(tokenReads.calls()).toBe(0)

    const allFallback = snapshotHarness({
      tokens,
      chunks: [
        chunk(0, 1_000_000, [{ kind: 'text', text: 'tiny' }]),
        chunk(5, 10, [{ kind: 'control', text: '[U+0081]', widthCells: 8 }]),
      ],
    })
    expect(allFallback.snapshot.toVisibleSnapshot()?.rows[0]?.chunks).toHaveLength(2)
    expect(allFallback.readRange).not.toHaveBeenCalled()
    expect(tokenReads.calls()).toBe(0)
  })

  it('bounds token reads to the mounted exact chunk', () => {
    const text = 'x'.repeat(100_000)
    const source = Array.from({ length: 10_000 }, (_value, index): EditorToken => ({
      start: index * 10,
      end: index * 10 + 5,
      style: { color: `#${index.toString(16).padStart(6, '0').slice(-6)}` },
    }))
    const tokens = EditorTokenStore.fromTokens(source)
    const tokenReads = watchTokenReads(tokens)
    const harness = snapshotHarness({
      text,
      tokens,
      chunks: [chunk(50_000, 50_005, [{ kind: 'text', text: 'xxxxx' }])],
    })

    expect(harness.snapshot.toVisibleSnapshot()?.rows[0]?.chunks[0]?.runs).toHaveLength(1)
    expect(tokenReads.visited()).toBeLessThan(64)
    expect(harness.readRange).toHaveBeenCalledWith(50_000, 50_005)
  })

  it('projects many non-overlapping runs in one linear pass', () => {
    const count = 5_000
    const text = 'x'.repeat(count)
    const red = { color: 'red' }
    const blue = { color: 'blue' }
    const tokens = EditorTokenStore.fromTokens(
      Array.from({ length: count }, (_value, index): EditorToken => ({
        start: index,
        end: index + 1,
        style: index % 2 === 0 ? red : blue,
      })),
    )
    const harness = snapshotHarness({
      text,
      tokens,
      chunks: [chunk(0, count, [{ kind: 'text', text }])],
    })

    expect(harness.snapshot.toVisibleSnapshot()?.rows[0]?.chunks[0]?.runs).toHaveLength(count)
  })

  it('reads each token once across many exact chunks', () => {
    const text = 'x'.repeat(2_000)
    const source = Array.from({ length: 200 }, (_value, index): EditorToken => ({
      start: index * 10,
      end: index * 10 + 5,
      style: { color: 'red' },
    }))
    const tokens = EditorTokenStore.fromTokens(source)
    const tokenReads = watchTokenReads(tokens)
    const chunks = source.map((token) =>
      chunk(token.start, token.end, [{ kind: 'text', text: 'xxxxx' }]),
    )
    const harness = snapshotHarness({ text, tokens, chunks })

    expect(harness.snapshot.toVisibleSnapshot()?.rows[0]?.chunks).toHaveLength(chunks.length)
    expect(tokenReads.visited()).toBe(source.length)
  })

  it('copies only live horizontal chunks and source ranges from a huge mounted line', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
      textMetrics: { rowHeight: 20, characterWidth: 8 },
      longLineChunkSize: 1_000,
      longLineChunkThreshold: 1_000,
      horizontalOverscanColumns: 0,
    })
    const text = 'x'.repeat(1_000_000)
    view.setText(text)

    for (const scrollLeft of [0, 20_000]) {
      view.setScrollMetrics(0, 20, 80, scrollLeft)
      const harness = snapshotHarnessFromView(view, text)
      const visible = harness.snapshot.toVisibleSnapshot()
      const mountedChunk = view.getState().mountedRows[0]!.chunks[0]!

      expect(visible?.rows[0]?.chunks).toHaveLength(1)
      expect(visible?.rows[0]?.chunks[0]?.parts.map((part) => part.text).join('')).toBe(
        mountedChunk.text,
      )
      expect(harness.readRange).toHaveBeenCalledTimes(1)
      expect(harness.readRange).toHaveBeenCalledWith(
        mountedChunk.startOffset,
        mountedChunk.endOffset,
      )
      expect(mountedChunk.text.length).toBeLessThanOrEqual(1_000)
      if (scrollLeft > 0) expect(visible?.rows[0]?.leftSpacerWidth).toBeGreaterThan(0)
    }

    view.dispose()
    container.remove()
  })

  it('captures mounted C0/C1 labels and bounded oversized BiDi refusal paint', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
      textMetrics: { rowHeight: 20, characterWidth: 8 },
    })

    const controls = '\u0000\u0081'
    view.setText(controls)
    view.setScrollMetrics(0, 20, 160)
    const controlHarness = snapshotHarnessFromView(view, controls)
    const controlChunk = controlHarness.snapshot.toVisibleSnapshot()?.rows[0]?.chunks[0]
    expect(controlChunk?.replayFidelity).toBe('plain-core-rendered')
    expect(controlChunk?.parts).toEqual([
      { kind: 'text', text: '\u2400' },
      { kind: 'control', text: '[U+0081]', widthCells: 8 },
    ])
    expect(controlHarness.readRange).not.toHaveBeenCalled()

    const bidi = `${'א'.repeat(32_000)}tail`
    view.setText(bidi)
    view.setScrollMetrics(0, 20, 160)
    const bidiHarness = snapshotHarnessFromView(view, bidi)
    const bidiChunk = bidiHarness.snapshot.toVisibleSnapshot()?.rows[0]?.chunks[0]
    expect(bidiChunk?.replayFidelity).toBe('plain-core-rendered')
    expect(bidiChunk?.parts.every((part) => part.kind === 'refusal')).toBe(true)
    expect(bidiChunk?.parts.map((part) => part.text).join('').length).toBeLessThan(256)
    expect(bidiHarness.readRange).not.toHaveBeenCalled()

    view.dispose()
    container.remove()
  })

  it('refuses arbitrary widget and plugin-class paint before source or token access', () => {
    const text = '# Title'
    const container = document.createElement('div')
    document.body.appendChild(container)
    const view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
      textMetrics: { rowHeight: 20, characterWidth: 8 },
    })
    view.setText(text)
    view.setScrollMetrics(0, 20, 160)
    view.setInlineMap(
      createInlineMap(createPieceTableSnapshot(text), [
        {
          id: 'widget',
          startIndex: 2,
          endIndex: 7,
          text: 'W',
          render: (host) => host.append('mounted widget'),
        },
      ]),
    )
    const widget = snapshotHarnessFromView(view, text)
    expect(widget.snapshot.toVisibleSnapshot()).toBeNull()
    expect(widget.readRange).not.toHaveBeenCalled()

    view.setInlineMap(null)
    view.setRowDecorations(
      new Map([[0, { className: 'plugin-row', gutterClassName: 'plugin-gutter' }]]),
    )
    const decorated = snapshotHarnessFromView(view, text)
    expect(decorated.snapshot.toVisibleSnapshot()).toBeNull()
    expect(decorated.readRange).not.toHaveBeenCalled()

    view.setRowDecorations(new Map())
    view.setInlineMap(
      createInlineMap(createPieceTableSnapshot(text), [
        {
          id: 'heading',
          startIndex: 0,
          endIndex: 2,
          text: '',
          kind: 'markdown-heading',
        },
      ]),
    )
    const heading = snapshotHarnessFromView(view, text)
    expect(heading.snapshot.toVisibleSnapshot()).toBeNull()
    expect(heading.readRange).not.toHaveBeenCalled()

    view.dispose()
    container.remove()
  })

  it('captures gutter, fold, wrap, and caret facts without remounting rows or scanning folds', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
      textMetrics: { rowHeight: 20, characterWidth: 8 },
      gutterWidth: 7,
      gutterContributions: [createLineGutterContribution(), createFoldGutterContribution()],
      cursorLineHighlight: {
        gutterNumber: true,
        gutterBackground: ['fold-gutter'],
        rowBackground: true,
      },
    })
    const text = 'alpha\nbeta\ngamma'
    const marker = {
      key: 'fold:0',
      startOffset: 0,
      endOffset: 10,
      startRow: 0,
      endRow: 1,
      collapsed: false,
    }
    view.setText(text)
    view.setFoldMarkers([marker])
    view.setScrollMetrics(0, 80, 160)
    view.setSelection(6, 6)
    view.setSelection(0, 0)
    const before = view.getState().mountedRows.map((row) => row.element)
    const first = snapshotHarnessFromView(view, text, unreadableFoldMarkers())
    const firstVisible = first.snapshot.toVisibleSnapshot()!

    expect(firstVisible.gutterLayout.fixedWidth).toBe(7)
    expect(firstVisible.gutterLayout.lanes.map((lane) => lane.id)).toEqual([
      'line-gutter',
      'fold-gutter',
    ])
    expect(firstVisible.rows[0]).toMatchObject({
      contentCursorLine: true,
      gutterNumberCursorLine: true,
      gutterCursorLineBackgroundLaneIds: ['fold-gutter'],
      foldMarker: marker,
    })

    view.setSelection(6, 6)
    const after = view.getState().mountedRows.map((row) => row.element)
    const secondVisible = snapshotHarnessFromView(view, text).snapshot.toVisibleSnapshot()!
    expect(after).toEqual(before)
    expect(secondVisible.rows[0]).toMatchObject({
      contentCursorLine: false,
      gutterNumberCursorLine: false,
      gutterCursorLineBackgroundLaneIds: [],
    })
    expect(secondVisible.rows[1]).toMatchObject({
      contentCursorLine: true,
      gutterNumberCursorLine: true,
      gutterCursorLineBackgroundLaneIds: ['fold-gutter'],
    })

    view.dispose()
    const wrappedView = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
      wrap: true,
      textMetrics: { rowHeight: 20, characterWidth: 8 },
      gutterContributions: [createLineGutterContribution()],
    })
    wrappedView.setText('abcdefghij')
    wrappedView.setScrollMetrics(0, 80, 72)
    wrappedView.setSelection(8, 8)
    const wrappedSnapshot = snapshotHarnessFromView(wrappedView, 'abcdefghij').snapshot
    const wrappedRows = wrappedSnapshot.visibleRows
    // Four text columns plus the caret fit beside the gutter in the 72 px viewport.
    expect(wrappedRows.map((row) => row.primaryText)).toEqual([true, true, true])
    expect(wrappedRows.map((row) => row.firstWrapSegment)).toEqual([true, false, false])
    expect(wrappedSnapshot.toVisibleSnapshot()!.rows.map((row) => row.firstWrapSegment)).toEqual([
      true,
      false,
      false,
    ])
    expect(wrappedRows.map((row) => row.contentCursorLine)).toEqual([true, true, true])
    expect(wrappedRows.map((row) => row.gutterNumberCursorLine)).toEqual([false, false, false])

    wrappedView.dispose()
    container.remove()
  })

  it('omits cyclic metadata and returns detached JSON-safe copies', () => {
    const metadata: { self?: unknown } = {}
    metadata.self = metadata
    const theme = { foregroundColor: '#ffffff', syntax: { keyword: '#ff0000' } }
    const parts: Extract<EditorMountedChunkPaintJSON, { kind: 'replayable' }>['parts'] = [
      { kind: 'text', text: 'const' },
    ]
    const style = { color: '#ff0000', fontStyle: 'italic' as const, fontWeight: 700 }
    const tokens = EditorTokenStore.fromTokens([{ start: 0, end: 5, style }])
    const harness = snapshotHarness({
      metadata,
      theme,
      tokens,
      chunks: [chunk(0, 5, parts)],
    })
    const visible = harness.snapshot.toVisibleSnapshot()!
    const visibleJSON = visible.toJSON()

    expect(() => serializeEditorViewSnapshot(harness.snapshot)).not.toThrow()
    expect(serializeEditorViewSnapshot(harness.snapshot).visibleRows[0]).not.toHaveProperty(
      'metadata',
    )
    expect(JSON.parse(JSON.stringify(visible))).toEqual(visible.toJSON())
    expect(visible.rows).not.toBe(harness.snapshot.visibleRows)
    expect(visible.rows[0]?.chunks).not.toBe(harness.snapshot.visibleRows[0]?.chunks)
    expect(visible.rows[0]?.chunks[0]?.parts).not.toBe(parts)
    expect(visible.rows[0]?.chunks[0]?.runs[0]?.style).not.toBe(style)

    theme.syntax.keyword = '#changed'
    ;(parts[0] as { text: string }).text = 'changed'
    style.color = '#changed'
    ;(visibleJSON.rows[0]!.chunks[0]!.parts[0] as { text: string }).text = 'json changed'
    expect(visible.theme?.syntax?.keyword).toBe('#ff0000')
    expect(visible.rows[0]?.chunks[0]?.parts[0]).toEqual({ kind: 'text', text: 'const' })
    expect(visible.rows[0]?.chunks[0]?.runs[0]).toEqual({
      start: 0,
      end: 5,
      style: { color: '#ff0000' },
    })
    expect(visible.toJSON().rows[0]?.chunks[0]?.parts[0]).toEqual({
      kind: 'text',
      text: 'const',
    })
  })

  it('preserves empty and overscanned mounted viewports without full-document reads', () => {
    const empty = snapshotHarness({
      rows: [],
      viewport: {
        scrollRow: 0,
        scrollTop: 0,
        scrollLeft: 0,
        scrollHeight: 0,
        scrollWidth: 0,
        clientHeight: 0,
        clientWidth: 0,
        visibleRange: { start: 0, end: 0 },
      },
    })
    expect(empty.snapshot.toVisibleSnapshot()?.rows).toEqual([])
    expect(empty.readRange).not.toHaveBeenCalled()
    expect(empty.materializeFullText).not.toHaveBeenCalled()

    const container = document.createElement('div')
    document.body.appendChild(container)
    const view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 2,
      textMetrics: { rowHeight: 20, characterWidth: 8 },
    })
    const text = Array.from({ length: 20 }, (_value, index) => `line ${index}`).join('\n')
    view.setText(text)
    view.setScrollMetrics(60, 40, 160)
    const state = view.getState()
    const visible = snapshotHarnessFromView(view, text).snapshot.toVisibleSnapshot()!
    expect(visible.rows.map((row) => row.index)).toEqual(state.mountedRows.map((row) => row.index))
    expect(visible.rows.length).toBeGreaterThan(state.visibleRange.end - state.visibleRange.start)

    view.dispose()
    container.remove()
  })

  it('clips half-open token edges to an exact mounted chunk', () => {
    const text = 'abcdefghijklmno'
    const tokens = EditorTokenStore.fromTokens([
      { start: 0, end: 5, style: { color: 'before' } },
      { start: 4, end: 6, style: { color: 'crossing' } },
      { start: 10, end: 12, style: { color: 'after' } },
    ])
    const harness = snapshotHarness({
      text,
      tokens,
      chunks: [chunk(5, 10, [{ kind: 'text', text: 'fghij' }])],
    })

    expect(harness.snapshot.toVisibleSnapshot()?.rows[0]?.chunks[0]?.runs).toEqual([
      { start: 0, end: 1, style: { color: 'crossing' } },
    ])
  })

  it('preserves a mounted tab and token offsets in buffer coordinates', () => {
    const tokens = EditorTokenStore.fromTokens([
      { start: 1, end: 6, style: { color: 'after-tab' } },
    ])
    const harness = snapshotHarness({
      text: '\talpha',
      tokens,
      chunks: [chunk(0, 6, [{ kind: 'text', text: '\talpha' }])],
    })

    expect(harness.snapshot.toVisibleSnapshot()?.rows[0]?.chunks[0]).toMatchObject({
      parts: [{ kind: 'text', text: '\talpha' }],
      replayFidelity: 'exact',
      runs: [{ start: 1, end: 6, style: { color: 'after-tab' } }],
    })
  })
})

describe('visible contribution paint snapshots', () => {
  it('delivers an update triggered from inside update() to every contribution after the pass', () => {
    const snapshot = snapshotHarness().snapshot
    const seen: string[] = []
    const writer = {
      update: vi.fn((_snapshot: EditorViewSnapshot, kind: string) => {
        seen.push(`writer:${kind}`)
        // Stands in for a contribution that moves the selection while tokens are being painted.
        if (kind === 'tokens') controller.notify('selection')
      }),
      dispose: vi.fn(),
    }
    const reader = {
      update: vi.fn((_snapshot: EditorViewSnapshot, kind: string) => seen.push(`reader:${kind}`)),
      dispose: vi.fn(),
    }
    const controller = new EditorViewContributionController([writer, reader], () => snapshot)
    seen.length = 0

    controller.notify('tokens')

    expect(seen).toEqual(['writer:tokens', 'reader:tokens', 'writer:selection', 'reader:selection'])
    controller.dispose()
  })

  it('blames the contribution that keeps the cycle going, not the next one in the queue', () => {
    const snapshot = snapshotHarness().snapshot
    // Asks once for tokens after each selection, which on its own always settles.
    const reacting = {
      update: vi.fn((_snapshot: EditorViewSnapshot, kind: string) => {
        if (kind === 'selection') controller.notify('tokens')
      }),
      dispose: vi.fn(),
    }
    const looping = {
      update: vi.fn((_snapshot: EditorViewSnapshot, kind: string) => {
        if (kind === 'selection') controller.notify('selection')
      }),
      dispose: vi.fn(),
    }
    const onFailure = vi.fn()
    const controller = new EditorViewContributionController(
      [reacting, looping],
      () => snapshot,
      onFailure,
    )

    controller.notify('selection')

    expect(onFailure).toHaveBeenCalledExactlyOnceWith(
      looping,
      'update',
      expect.objectContaining({ code: 'EDITOR_VIEW_UPDATE_LOOP' }),
    )
    expect(looping.dispose).toHaveBeenCalledOnce()
    expect(reacting.dispose).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('delivers a large one-off burst of re-entrant updates without calling it a loop', () => {
    const snapshot = snapshotHarness().snapshot
    const bursting = {
      update: vi.fn((_snapshot: EditorViewSnapshot, kind: string) => {
        if (kind !== 'tokens') return
        for (let index = 0; index < 100; index += 1) controller.notify('selection')
      }),
      dispose: vi.fn(),
    }
    const reader = { update: vi.fn(), dispose: vi.fn() }
    const onFailure = vi.fn()
    const controller = new EditorViewContributionController(
      [bursting, reader],
      () => snapshot,
      onFailure,
    )

    controller.notify('tokens')

    expect(onFailure).not.toHaveBeenCalled()
    const selections = reader.update.mock.calls.filter(([, kind]) => kind === 'selection')
    expect(selections).toHaveLength(100)
    controller.dispose()
  })

  it('removes a contribution that keeps re-notifying and keeps serving the rest', () => {
    const snapshot = snapshotHarness().snapshot
    const looping = {
      update: vi.fn((_snapshot: EditorViewSnapshot, kind: string) => {
        if (kind === 'selection') controller.notify('selection')
      }),
      dispose: vi.fn(),
    }
    const healthy = { update: vi.fn(), dispose: vi.fn() }
    const onFailure = vi.fn()
    const controller = new EditorViewContributionController(
      [looping, healthy],
      () => snapshot,
      onFailure,
    )

    controller.notify('selection')

    expect(onFailure).toHaveBeenCalledExactlyOnceWith(
      looping,
      'update',
      expect.objectContaining({ code: 'EDITOR_VIEW_UPDATE_LOOP' }),
    )
    expect(looping.dispose).toHaveBeenCalledOnce()
    looping.update.mockClear()
    healthy.update.mockClear()
    controller.notify('tokens')
    expect(looping.update).not.toHaveBeenCalled()
    expect(healthy.update).toHaveBeenCalledExactlyOnceWith(snapshot, 'tokens', null)
    controller.dispose()
  })

  it('defers reentrant layout work and prevents recursive continuous viewport delivery', () => {
    const snapshot = snapshotHarness().snapshot
    const createSnapshot = vi.fn(() => snapshot)
    const update = vi.fn()
    const updateViewport = vi.fn(() => {
      controller.notify('layout')
      if (updateViewport.mock.calls.length < 3) controller.notifyViewport(() => snapshot.viewport)
    })
    const controller = new EditorViewContributionController(
      [{ update, updateViewport, dispose: vi.fn() }],
      createSnapshot,
    )

    controller.notifyViewport(() => snapshot.viewport)

    expect(updateViewport).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledExactlyOnceWith(snapshot, 'layout', null)
    expect(createSnapshot).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('disposes failed viewport contributors and continues delivering to the remaining ones', () => {
    const snapshot = snapshotHarness().snapshot
    const failure = new TypeError('viewport contribution failed')
    const onFailure = vi.fn()
    const failed = {
      update: vi.fn(),
      updateViewport: vi.fn(() => {
        throw failure
      }),
      dispose: vi.fn(),
    }
    const healthy = { update: vi.fn(), updateViewport: vi.fn(), dispose: vi.fn() }
    const controller = new EditorViewContributionController(
      [failed, healthy],
      () => snapshot,
      onFailure,
    )

    controller.notifyViewport(() => snapshot.viewport)
    controller.notifyViewport(() => snapshot.viewport)

    expect(onFailure).toHaveBeenCalledExactlyOnceWith(failed, 'viewport', failure)
    expect(failed.updateViewport).toHaveBeenCalledTimes(1)
    expect(failed.dispose).toHaveBeenCalledTimes(1)
    expect(healthy.updateViewport).toHaveBeenCalledTimes(2)
    controller.dispose()
    expect(failed.dispose).toHaveBeenCalledTimes(1)
  })

  it('delivers continuous viewport updates only to opted-in contributions without snapshots', () => {
    const harness = snapshotHarness()
    const createSnapshot = vi.fn(() => harness.snapshot)
    const createViewport = vi.fn(() => harness.snapshot.viewport)
    const update = vi.fn()
    const updateViewport = vi.fn()
    const contribution = { update, updateViewport, dispose: vi.fn() }
    const controller = new EditorViewContributionController(
      [{ update, dispose: vi.fn() }],
      createSnapshot,
    )

    controller.notifyViewport(createViewport)
    expect(createViewport).not.toHaveBeenCalled()
    controller.add(contribution)
    createSnapshot.mockClear()
    update.mockClear()

    controller.notifyViewport(createViewport)
    expect(updateViewport).toHaveBeenCalledExactlyOnceWith(harness.snapshot.viewport)
    expect(createSnapshot).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()

    controller.dispose()
    controller.notifyViewport(createViewport)
    expect(createViewport).toHaveBeenCalledTimes(1)
    expect(contribution.dispose).toHaveBeenCalledTimes(1)
  })

  it('keeps built-in folded paint pending without any optional paint contributors', () => {
    const snapshots: EditorViewSnapshot[] = []
    let syntaxStatus: EditorViewSnapshot['syntaxStatus'] = 'loading'
    const controller = new EditorViewContributionController(
      [
        {
          update(snapshot) {
            snapshots.push(snapshot)
          },
          dispose() {},
        },
      ],
      () => snapshotHarness({ syntaxStatus }).snapshot,
    )

    controller.notify('document')
    expect(snapshots[0]!.paintLayers).toBeNull()
    expect(snapshots[0]!.toVisibleSnapshot()).toBeNull()
    syntaxStatus = 'ready'
    controller.notify('tokens')
    expect(snapshots[1]!.paintLayers).toEqual([])
    expect(snapshots[1]!.toVisibleSnapshot()?.paintLayers).toEqual([])
    controller.dispose()
  })

  it('captures lazily after the entire update pass and clones both serialization boundaries', () => {
    const harness = snapshotHarness()
    const rectangle = paintRectangle()
    let committed: EditorViewSnapshot | null = null
    const capture = vi.fn((snapshot: EditorViewSnapshot) => {
      expect(snapshot).toBe(committed)
      return { id: 'guides', status: 'ready' as const, rectangles: [rectangle] }
    })
    const observer: EditorViewContribution = {
      update(snapshot) {
        expect(snapshot.paintLayers).toBeNull()
        expect(snapshot.toVisibleSnapshot()).toBeNull()
        expect(harness.readRange).not.toHaveBeenCalled()
      },
      dispose() {},
    }
    const painter: EditorViewContribution = {
      update(snapshot) {
        committed = snapshot
      },
      captureVisiblePaint: capture,
      dispose() {},
    }
    const controller = new EditorViewContributionController(
      [observer, painter],
      () => harness.snapshot,
    )

    controller.notify('document')
    expect(capture).not.toHaveBeenCalled()
    expect(harness.snapshot.paintLayers).toEqual([{ id: 'guides', rectangles: [rectangle] }])
    expect(Object.isFrozen(harness.snapshot.paintLayers?.[0]?.rectangles[0])).toBe(true)
    const visible = harness.snapshot.toVisibleSnapshot()!
    const json = visible.toJSON()
    rectangle.left = 99
    expect(visible.paintLayers[0]?.rectangles[0]?.left).toBe(12)
    expect(json.paintLayers[0]?.rectangles[0]).not.toBe(visible.paintLayers[0]?.rectangles[0])
    expect(visible.paintLayers).not.toBe(harness.snapshot.paintLayers)
    expect(capture).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('invalidates uncaptured old snapshots and preserves captured historical paint', () => {
    const snapshots: EditorViewSnapshot[] = []
    const rectangle = paintRectangle()
    const capture = vi.fn(() => ({
      id: 'guides',
      status: 'ready' as const,
      rectangles: [rectangle],
    }))
    const controller = new EditorViewContributionController(
      [
        {
          update(snapshot) {
            snapshots.push(snapshot)
          },
          captureVisiblePaint: capture,
          dispose() {},
        },
      ],
      () => snapshotHarness().snapshot,
    )

    controller.notify('document')
    controller.notify('viewport')
    expect(snapshots[0]!.paintLayers).toBeNull()
    expect(snapshots[0]!.toVisibleSnapshot()).toBeNull()
    expect(capture).not.toHaveBeenCalled()
    expect(snapshots[1]!.paintLayers?.[0]?.rectangles[0]?.left).toBe(12)
    rectangle.left = 44
    controller.notify('layout')
    expect(snapshots[1]!.paintLayers?.[0]?.rectangles[0]?.left).toBe(12)
    expect(snapshots[2]!.paintLayers?.[0]?.rectangles[0]?.left).toBe(44)
    controller.notify('selection')
    controller.dispose()
    expect(snapshots[3]!.paintLayers).toBeNull()
    expect(snapshots[2]!.paintLayers?.[0]?.rectangles[0]?.left).toBe(44)
  })

  it('keeps a pending pass unavailable until an asynchronous producer requests a fresh update', () => {
    const snapshots: EditorViewSnapshot[] = []
    let ready = false
    const controller = new EditorViewContributionController(
      [
        {
          update(snapshot) {
            snapshots.push(snapshot)
          },
          captureVisiblePaint() {
            if (!ready) return { id: 'guides', status: 'pending' }
            return { id: 'guides', status: 'ready', rectangles: [paintRectangle()] }
          },
          dispose() {},
        },
      ],
      () => snapshotHarness().snapshot,
    )

    controller.notify('content')
    expect(snapshots[0]!.paintLayers).toBeNull()
    ready = true
    expect(snapshots[0]!.toVisibleSnapshot()).toBeNull()
    controller.notify('layout')
    expect(snapshots[1]!.toVisibleSnapshot()?.paintLayers[0]?.id).toBe('guides')
    controller.dispose()
  })

  it.each([
    { left: Infinity },
    { top: NaN },
    { width: 0 },
    { height: -1 },
    { backgroundColor: '' },
  ])('rejects malformed rectangle paint through contribution failure handling: %j', (invalid) => {
    const snapshots: EditorViewSnapshot[] = []
    const onFailure = vi.fn()
    const dispose = vi.fn()
    const painter: EditorViewContribution = {
      update() {},
      captureVisiblePaint: () => ({
        id: 'guides',
        status: 'ready',
        rectangles: [paintRectangle(invalid)],
      }),
      dispose,
    }
    const controller = new EditorViewContributionController(
      [
        {
          update(snapshot) {
            snapshots.push(snapshot)
          },
          dispose() {},
        },
        painter,
      ],
      () => snapshotHarness().snapshot,
      onFailure,
    )

    controller.notify('document')
    expect(snapshots[0]!.toVisibleSnapshot()).toBeNull()
    expect(onFailure).toHaveBeenCalledWith(painter, 'capture-visible-paint', expect.any(RangeError))
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(snapshots[1]!.paintLayers).toEqual([])
    controller.dispose()
  })

  it('bounds rectangle payloads before copying producer data', () => {
    const snapshots: EditorViewSnapshot[] = []
    const onFailure = vi.fn()
    const controller = new EditorViewContributionController(
      [
        {
          update(snapshot) {
            snapshots.push(snapshot)
          },
          captureVisiblePaint: () => ({
            id: 'guides',
            status: 'ready',
            rectangles: Array.from({ length: MAX_VISIBLE_PAINT_RECTANGLES + 1 }, () =>
              paintRectangle(),
            ),
          }),
          dispose() {},
        },
      ],
      () => snapshotHarness().snapshot,
      onFailure,
    )

    controller.notify('document')
    expect(snapshots[0]!.paintLayers).toBeNull()
    expect(onFailure).toHaveBeenCalledWith(
      expect.anything(),
      'capture-visible-paint',
      expect.any(RangeError),
    )
    controller.dispose()
  })

  it('notifies observers when paint contributions are added or removed', () => {
    const snapshots: EditorViewSnapshot[] = []
    const controller = new EditorViewContributionController(
      [
        {
          update(snapshot) {
            snapshots.push(snapshot)
          },
          dispose() {},
        },
      ],
      () => snapshotHarness().snapshot,
    )
    const painter: EditorViewContribution = {
      update() {},
      captureVisiblePaint: () => ({
        id: 'guides',
        status: 'ready',
        rectangles: [paintRectangle()],
      }),
      dispose() {},
    }
    controller.notify('document')
    controller.add(painter)
    expect(snapshots[0]!.paintLayers).toBeNull()
    expect(snapshots[1]!.paintLayers?.[0]?.id).toBe('guides')
    controller.remove(painter)
    expect(snapshots[2]!.paintLayers).toEqual([])
    controller.dispose()
  })
})

// Every snapshot token read goes through a bisection and then `forEachInRange`.
function watchTokenReads(tokens: EditorTokenStore) {
  const bisect = vi.spyOn(tokens, 'firstStartingAtOrAfter')
  const walk = vi.spyOn(tokens, 'forEachInRange')
  return {
    calls: () => bisect.mock.calls.length + walk.mock.calls.length,
    visited: () => walk.mock.calls.reduce((sum, [from, to]) => sum + Math.max(0, to - from), 0),
  }
}

function paintRectangle(overrides: Partial<EditorVisiblePaintRectangle> = {}) {
  return { left: 12, top: 20, width: 1, height: 40, backgroundColor: 'rgb(1, 2, 3)', ...overrides }
}

function snapshotHarness(
  options: {
    readonly text?: string
    readonly syntaxStatus?: EditorViewSnapshot['syntaxStatus']
    readonly metadata?: unknown
    readonly theme?: EditorViewSnapshot['theme']
    readonly tokens?: EditorTokenStore
    readonly chunks?: readonly EditorVisibleRowSnapshot['chunks'][number][]
    readonly rows?: readonly EditorVisibleRowSnapshot[]
    readonly rowSource?: EditorVisibleRowSnapshot['source']
    readonly mountedPaintSupport?: EditorVisibleRowSnapshot['mountedPaintSupport']
    readonly gutterWidth?: number
    readonly gutterLayout?: EditorViewSnapshot['gutterLayout']
    readonly foldMarkers?: EditorViewSnapshot['foldMarkers']
    readonly viewport?: EditorViewSnapshot['viewport']
  } = {},
): SnapshotHarness {
  const text = options.text ?? TEXT
  const materializeFullText = vi.fn(() => text)
  const readRange = vi.fn((start: number, end: number) => text.slice(start, end))
  const readLineStarts = vi.fn(() => [0])
  const lineStartsViewToArray = vi.fn(() => [0])
  const textSnapshot = {
    lineCount: 1,
    lineStart: () => 0,
    lineRange: () => ({ start: 0, end: text.length }),
    lineAt: () => 0,
    length: text.length,
    readRange,
    materializeFullText,
    forEachTextChunk: vi.fn(),
  }
  const row: EditorVisibleRowSnapshot = {
    index: 0,
    bufferRow: 0,
    source: options.rowSource ?? 'document',
    metadata: options.metadata,
    startOffset: 0,
    endOffset: text.length,
    text: 'logical row text must not enter the compact DTO',
    kind: 'text',
    primaryText: true,
    firstWrapSegment: true,
    top: 0,
    height: 20,
    leftSpacerWidth: 12,
    contentCursorLine: true,
    gutterNumberCursorLine: true,
    gutterCursorLineBackgroundLaneIds: ['fold-gutter'],
    mountedPaintSupport: options.mountedPaintSupport ?? 'replayable',
    chunks: options.chunks ?? [chunk(0, 5, [{ kind: 'text', text: 'const' }])],
    foldMarker: {
      key: 'fold:0',
      startOffset: 0,
      endOffset: text.length,
      startRow: 0,
      endRow: 1,
      collapsed: false,
    },
  }
  const runtime = {
    documentId: 'snapshot.ts',
    languageId: 'typescript' as const,
    theme: options.theme ?? { foregroundColor: '#ffffff', syntax: { keyword: '#ff0000' } },
    textSnapshot,
    textVersion: 4,
    initialHighlightStatus: 'painted' as const,
    syntaxStatus: options.syntaxStatus ?? 'ready',
    documentSyncPoint: {
      revision: 4,
      segment: Object.freeze({}) as EditorViewSnapshot['documentSyncPoint']['segment'],
      textVersion: 4,
    },
    changesSinceDocumentSyncPoint: () => null,
    get lineStarts() {
      return readLineStarts()
    },
    lineStartsView: {
      length: 1,
      at: () => 0,
      indexForOffset: () => 0,
      firstIndexAtOrAfter: () => 0,
      toArray: lineStartsViewToArray,
    },
    tokens: options.tokens ?? EditorTokenStore.empty(),
    brackets: [{ index: 0, char: '{', depth: 0 }],
    selections: [
      { anchorOffset: 0, headOffset: 0, startOffset: 0, endOffset: 0, affinity: 'after' as const },
    ],
    metrics: { rowHeight: 20, characterWidth: 8 },
    lineCount: 1,
    contentWidth: 160,
    totalHeight: 20,
    gutterWidth: options.gutterWidth ?? 32,
    gutterLayout: options.gutterLayout ?? {
      leadingInset: 0,
      fixedWidth: 0,
      lanes: [{ id: 'line-gutter', width: 32 }],
    },
    tabSize: 2,
    foldMarkers: options.foldMarkers ?? (row.foldMarker ? [row.foldMarker] : []),
    visibleRows: options.rows ?? [row],
    viewport:
      options.viewport ??
      ({
        scrollRow: 0,
        scrollTop: 0,
        scrollLeft: 24,
        scrollHeight: 20,
        scrollWidth: 160,
        clientHeight: 20,
        clientWidth: 80,
        visibleRange: { start: 0, end: 1 },
      } satisfies EditorViewSnapshot['viewport']),
  }

  return {
    snapshot: createEditorViewSnapshot(runtime),
    materializeFullText,
    readRange,
    readLineStarts,
    lineStartsViewToArray,
  }
}

function snapshotHarnessFromView(
  view: VirtualizedTextView,
  text: string,
  foldMarkers?: EditorViewSnapshot['foldMarkers'],
): SnapshotHarness {
  const state = view.getState()
  const rows: EditorVisibleRowSnapshot[] = state.mountedRows.map((row) => ({
    index: row.index,
    bufferRow: row.bufferRow,
    source: row.source,
    injectedTextRowId: row.injectedTextRowId,
    startOffset: row.startOffset,
    endOffset: row.endOffset,
    text: row.text,
    kind: 'text',
    primaryText: row.source === 'document',
    firstWrapSegment: row.primaryText,
    top: row.top,
    height: row.height,
    leftSpacerWidth: row.leftSpacerWidth,
    contentCursorLine: row.cursorLineContentActive,
    gutterNumberCursorLine: row.gutterNumberCursorLine,
    gutterCursorLineBackgroundLaneIds: row.gutterCursorLineBackgroundLaneIds,
    mountedPaintSupport: row.mountedPaintSupport,
    chunks: row.chunks.map((mounted) => ({
      sourceStartOffset: mounted.startOffset,
      sourceEndOffset: mounted.endOffset,
      rowLocalStart: mounted.localStart,
      rowLocalEnd: mounted.localEnd,
      text: mounted.text,
      mountedPaint: mounted.mountedPaint,
    })),
    foldMarker: row.foldMarker,
  }))

  return snapshotHarness({
    text,
    rows,
    gutterWidth: state.gutterWidth,
    gutterLayout: state.gutterLayout,
    foldMarkers: foldMarkers ?? state.foldMarkers,
    viewport: {
      scrollRow: state.scrollRow,
      scrollTop: state.scrollTop,
      scrollLeft: state.scrollLeft,
      scrollHeight: state.scrollHeight,
      scrollWidth: state.scrollWidth,
      clientHeight: state.viewportHeight,
      clientWidth: state.viewportWidth,
      visibleRange: state.visibleRange,
    },
  })
}

function unreadableFoldMarkers(): EditorViewSnapshot['foldMarkers'] {
  return new Proxy([] as unknown as EditorViewSnapshot['foldMarkers'], {
    get(_target, property) {
      if (property === 'length') return 10_000
      throw new Error(`compact snapshot must not read foldMarkers.${String(property)}`)
    },
  })
}

function chunk(
  sourceStartOffset: number,
  sourceEndOffset: number,
  parts: Extract<EditorMountedChunkPaintJSON, { kind: 'replayable' }>['parts'],
): EditorVisibleRowSnapshot['chunks'][number] {
  return {
    sourceStartOffset,
    sourceEndOffset,
    rowLocalStart: 0,
    rowLocalEnd: sourceEndOffset - sourceStartOffset,
    text: 'ignored runtime chunk text',
    mountedPaint: { kind: 'replayable', parts },
  }
}
