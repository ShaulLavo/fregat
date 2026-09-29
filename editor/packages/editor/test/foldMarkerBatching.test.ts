import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { serializeEditorViewSnapshot } from '../src/editor/viewSnapshot'
import { createFoldGutterContribution } from '../../gutters/src/foldGutter'
import { createDocumentTextSnapshot } from '../src/documentTextSnapshot'
import type { Editor } from '../src/editor'
import { EditorFoldState } from '../src/editor/foldState'
import { foldRangeKey } from '../src/editor/folds'
import { IndentationFoldIndex } from '../src/editor/indentationFoldIndex'
import type { EditorDisplayProjection } from '../src/editor/displayProjectionRegistry'
import { createPieceTableSnapshot } from '@singapore-editor/textbuffer'
import type { FoldRange } from '../src/syntax/session'
import type { EditorViewSnapshot } from '../src/plugins'
import { setHighlightRegistry } from '../src/public/testing'
import { VirtualizedTextView } from '../src/virtualization/virtualizedTextView'
import { createVisibleEditor } from './factories/visibleEditor'

const views: VirtualizedTextView[] = []
const editors: Editor[] = []

beforeEach(() => vi.stubGlobal('Highlight', class extends Set<Range> {}))

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  for (const view of views.splice(0)) view.dispose()
  document.body.replaceChildren()
  setHighlightRegistry(undefined)
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('visible fold marker batches', () => {
  it('skips unconsumed markers on open and input, then renders folds and newly installed gutters', async () => {
    vi.useFakeTimers()
    const { editor, container } = createEditorFixture()
    const headers = vi.spyOn(IndentationFoldIndex.prototype, 'headers')
    const all = vi.spyOn(IndentationFoldIndex.prototype, 'all')

    editor.openDocument({
      documentId: 'plain.txt',
      languageId: null,
      text: 'root\n  child\nnext\n  tail\nend',
    })
    await vi.runAllTimersAsync()
    const source = editor['view']['view'].foldMarkerSource!
    const readRows = vi.spyOn(source, 'readRows')
    editor.edit({ from: 4, to: 4, text: '!' })
    await vi.runAllTimersAsync()

    expect(headers).not.toHaveBeenCalled()
    expect(readRows).not.toHaveBeenCalled()
    expect(all).not.toHaveBeenCalled()
    expect(container.querySelector('.editor-virtualized-row')?.textContent).toContain('root!')

    expect(editor.fold(0)).toBe(true)
    expect(container.querySelector('.editor-virtualized-fold-placeholder')).not.toBeNull()
    expect(headers).toHaveBeenCalled()
    expect(editor.unfold(0)).toBe(true)
    expect(container.querySelector('.editor-virtualized-fold-placeholder')).toBeNull()

    headers.mockClear()
    editor.addPlugin({
      activate: (context) => context.registerGutterContribution(createFoldGutterContribution()),
    })
    expect(headers).toHaveBeenCalled()
    expect(
      container.querySelectorAll('.editor-virtualized-fold-toggle:not([hidden])'),
    ).toHaveLength(2)
    expect(all).not.toHaveBeenCalled()
    expect(editor['view'].getState().foldMarkers).toHaveLength(2)
    expect(all).toHaveBeenCalledTimes(1)
  })

  it('lazily exports one immutable marker batch after edits and disposal', async () => {
    vi.useFakeTimers()
    const { editor, snapshots } = createEditorFixture()
    editor.openDocument({
      documentId: 'plain.txt',
      languageId: null,
      text: 'root\n  child\nnext\n  tail\nend',
    })
    await vi.runAllTimersAsync()
    const original = snapshots.at(-1)!
    const index = editor['fallbackFolds'].index!
    const source = editor['view']['view'].foldMarkerSource!
    const headers = vi.spyOn(index, 'headers')
    const readRows = vi.spyOn(source, 'readRows')
    const all = vi.spyOn(index, 'all')

    expect(original.visibleRows.map((row) => row.text)).toEqual([
      'root',
      '  child',
      'next',
      '  tail',
      'end',
    ])
    expect(original.paintLayers).toEqual([])
    expect(readRows).not.toHaveBeenCalled()
    editor.edit({ from: 0, to: 0, text: 'intro\n' })
    await vi.runAllTimersAsync()
    expect(editor.fold(6)).toBe(true)
    editor.dispose()

    expect(original.visibleRows[0]?.foldMarker).toMatchObject({
      startRow: 0,
      endRow: 1,
      collapsed: false,
    })
    expect(original.visibleRows[2]?.foldMarker).toMatchObject({
      startRow: 2,
      endRow: 3,
      collapsed: false,
    })
    expect(readRows).toHaveBeenCalledExactlyOnceWith([0, 1, 2, 3, 4])
    expect(headers).toHaveBeenCalledExactlyOnceWith(0, 4)
    expect(all).not.toHaveBeenCalled()

    const visible = original.toVisibleSnapshot()!.toJSON()
    expect(visible.rows[0]?.foldMarker).toEqual(original.visibleRows[0]?.foldMarker)
    expect(readRows).toHaveBeenCalledTimes(1)
    expect(all).not.toHaveBeenCalled()
    expect(serializeEditorViewSnapshot(original).visibleRows[2]?.foldMarker).toEqual(
      original.visibleRows[2]?.foldMarker,
    )
    expect(original.foldMarkers.map((marker) => marker.startRow)).toEqual([0, 2])
    expect(readRows).toHaveBeenCalledTimes(1)
    expect(all).toHaveBeenCalledTimes(1)
  })

  it('queries one visible header range when ready folds join an atomic first render', () => {
    const fixture = createFixture('root\n  child\nnext\n  tail\n'.repeat(200))
    const headers = vi.spyOn(fixture.index, 'headers')
    const all = vi.spyOn(fixture.index, 'all')

    fixture.view.runAtomicRender(() => fixture.view.setScrollMetrics(0, 100, 240))

    expect(headers).toHaveBeenCalledExactlyOnceWith(0, 4)
    expect(all).not.toHaveBeenCalled()
    expect(fixture.view.getState().mountedRows).toHaveLength(5)
    expect(
      fixture.container.querySelectorAll('.editor-virtualized-fold-toggle:not([hidden])'),
    ).toHaveLength(3)
  })

  it('does not query fold headers in a collapsed source gap', () => {
    const fixture = createFixture(
      'root\n' + '  nested\n    leaf\n'.repeat(1_000) + 'tail\n  leaf\nend',
    )
    fixture.view.setScrollMetrics(0, 100, 240)
    const root = fixture.index.headers(0, 0)[0]!
    const headers = vi.spyOn(fixture.index, 'headers')
    const all = vi.spyOn(fixture.index, 'all')

    expect(fixture.folds.fold(root)).toBe(true)

    const mounted = fixture.view.getState().mountedRows
    const visible = new Set(mounted.map((row) => row.bufferRow))
    expect([...visible]).toEqual([0, 2_001, 2_002, 2_003])
    expect(headers).toHaveBeenCalledWith(2_001, 2_003)
    for (const [start, end] of headers.mock.calls) {
      for (let row = start; row <= end; row += 1) expect(visible.has(row)).toBe(true)
    }
    expect(all).not.toHaveBeenCalled()
    expect(mounted[0]?.foldCollapsed).toBe(true)
    expect(mounted[1]?.foldMarkerKey).not.toBe('')
  })

  it('requests only primary document rows across wrapping and injected diff rows', () => {
    const fixture = createFixture('heading-long-long\n  child\nnext\n  tail', { wrap: true })
    fixture.view.setInjectedTextRows([
      {
        id: 'deleted',
        anchorBufferRow: 1,
        placement: 'before',
        text: 'old source',
        metadata: { kind: 'diff-delete' },
      },
    ])
    const source = fixture.view['view'].foldMarkerSource!
    const readRows = vi.spyOn(source, 'readRows')
    const headers = vi.spyOn(fixture.index, 'headers')

    fixture.view.setScrollMetrics(0, 400, 80)

    expect(readRows).toHaveBeenCalledExactlyOnceWith([0, 1, 2, 3])
    expect(headers).toHaveBeenCalledExactlyOnceWith(0, 3)
    const mounted = fixture.view.getState().mountedRows
    expect(mounted.length).toBeGreaterThan(5)
    expect(mounted.filter((row) => row.foldMarkerKey !== '').map((row) => row.bufferRow)).toEqual([
      0, 2,
    ])
    expect(mounted.find((row) => row.source === 'injected')?.foldMarkerKey).toBe('')
  })

  it('preserves the shortest header and existing tie precedence with manual ranges', () => {
    const fixture = createFixture('root\n  child\n  second\nnext')
    const root = fixture.index.headers(0, 0)[0]!
    const equal = { ...root, type: 'manual-equal' }
    fixture.folds.setFoldProjections([foldProjection([equal])], fixture.index)
    expect(fixture.view['view'].foldMarkerSource?.readRows([0]).get(0)?.key).toBe(
      foldRangeKey(root),
    )

    const shorter = {
      ...root,
      endLine: 1,
      endIndex: fixture.snapshot.lineStart(2) - 1,
      type: 'manual-shorter',
    }
    fixture.folds.setFoldProjections(
      [foldProjection([shorter, { ...shorter, type: 'manual-second' }, equal])],
      fixture.index,
    )

    const markers = fixture.view['view'].foldMarkerSource?.readRows([0, 0, 3])
    expect(markers?.size).toBe(1)
    expect(markers?.get(0)?.key).toBe(foldRangeKey(shorter))
  })

  it('clears an indexed source before a document replacement', () => {
    const fixture = createFixture('root\n  child\nnext')
    fixture.view.setScrollMetrics(0, 100, 240)
    const source = fixture.view['view'].foldMarkerSource!
    const readRows = vi.spyOn(source, 'readRows')
    const all = vi.spyOn(source, 'all')

    fixture.view.setFoldState([], null)
    expect(fixture.view['view'].foldMarkerSource).toBeNull()
    expect(fixture.view.getState().mountedRows.every((row) => row.foldMarkerKey === '')).toBe(true)
    fixture.view.setText('replacement\n  child\nend')

    expect(readRows).not.toHaveBeenCalled()
    expect(all).not.toHaveBeenCalled()
    expect(fixture.view.getState().foldMarkers).toEqual([])
  })

  it('queries only the old and new caret rows during cursor-line refresh', () => {
    const fixture = createFixture('root\n  child\nnext\n  tail\nend')
    fixture.view.setScrollMetrics(0, 100, 240)
    fixture.view.setSelection(0, 0)
    const source = fixture.view['view'].foldMarkerSource!
    const readRows = vi.spyOn(source, 'readRows')

    const offset = fixture.snapshot.lineStart(2)
    fixture.view.setSelection(offset, offset)

    expect(readRows).toHaveBeenCalledExactlyOnceWith([0, 2])
  })
})

function createEditorFixture() {
  setHighlightRegistry(new Map())
  const container = document.createElement('div')
  document.body.append(container)
  const snapshots: EditorViewSnapshot[] = []
  const editor = createVisibleEditor(container, {
    tabSize: 2,
    plugins: [
      {
        activate: (context) =>
          context.registerViewContribution({
            createContribution: () => ({
              update: (snapshot) => snapshots.push(snapshot),
              dispose: () => undefined,
            }),
          }),
      },
    ],
  })
  editor['view'].setScrollMetrics(0, 240, 640)
  editors.push(editor)
  return { editor, container, snapshots }
}

function createFixture(
  text: string,
  options: ConstructorParameters<typeof VirtualizedTextView>[1] = {},
) {
  const container = document.createElement('div')
  document.body.append(container)
  const view = new VirtualizedTextView(container, {
    rowHeight: 20,
    overscan: 0,
    textMetrics: { characterWidth: 8, rowHeight: 20 },
    highlightRegistry: new Map(),
    gutterContributions: [createFoldGutterContribution()],
    ...options,
  })
  views.push(view)
  const piece = createPieceTableSnapshot(text)
  const snapshot = createDocumentTextSnapshot(piece)
  const index = new IndentationFoldIndex({ snapshot, languageId: null, tabSize: 2 }).complete()
  const folds = new EditorFoldState(
    view,
    () => piece,
    () => [],
  )
  view.setText(snapshot)
  folds.setFoldProjections([], index)
  return { container, view, snapshot, index, folds }
}

function foldProjection(folds: readonly FoldRange[]): EditorDisplayProjection<'folds'> {
  return {
    kind: 'folds',
    owner: 'manual',
    source: { documentId: 'batch', documentVersion: 1, textVersion: 1 },
    invalidationRange: { kind: 'document' },
    layer: 0,
    priority: 2,
    disposal: { behavior: 'none' },
    value: folds,
  }
}
