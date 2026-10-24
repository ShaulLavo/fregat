import { afterEach, expect, test } from 'vitest'
import {
  applyBatchToPieceTable,
  createPieceTableSnapshot,
  snapBatchEditRanges,
} from '@singapore-editor/textbuffer'
import { createDocumentTextSnapshot } from '../src/documentTextSnapshot'
import { createFoldMap } from '../src/foldMap'
import { createInlineMap } from '../src/inlineMap'
import { DisplayProjection } from '../src/virtualization/displayProjection'
import { VirtualizedTextView } from '../src/virtualization/virtualizedTextView'
import {
  multiLineEditPatch,
  sameLineEditPatch,
} from '../src/virtualization/virtualizedTextViewLayout'

const views: VirtualizedTextView[] = []
afterEach(() => {
  for (const view of views) view.dispose()
  views.length = 0
})
const kinds = ['plain', 'fold', 'wrap', 'inline', 'injected', 'combined'] as const
const seeds = [
  1,
  51,
  0xdeadbeef,
  Number(process.env.E051_SEED ?? Math.floor(Math.random() * 2 ** 32)),
]

test.each(kinds.flatMap((kind) => seeds.map((seed) => ({ kind, seed }))))(
  'incremental rows equal full layout: $kind seed=$seed',
  ({ kind, seed }) => {
    const random = generator(seed)
    const suffix = Array.from({ length: 1 + Math.floor(random() * 8) }, () =>
      'abc'.repeat(1 + Math.floor(random() * 8)),
    ).join('\n')
    let piece = createPieceTableSnapshot('head\nabcdefghij\ninside\ntail\n' + suffix)
    const view = createView()
    views.push(view)
    view.setText(createDocumentTextSnapshot(piece))
    view.setScrollMetrics(0, 2000, 40)
    view.setRowDecorations(new Map([[3, { className: 'marked-source-row' }]]))
    if (kind === 'fold' || kind === 'combined')
      view.setFoldState(
        [],
        createFoldMap(piece, [
          { startIndex: 5, endIndex: 22, startLine: 1, endLine: 2, type: 'test' },
        ]),
      )
    if (kind === 'inline' || kind === 'combined')
      view.setInlineMap(
        createInlineMap(piece, [{ id: 'replacement', startIndex: 5, endIndex: 7, text: 'XYZ' }]),
      )
    if (kind === 'injected' || kind === 'combined')
      view.setInjectedTextRows([
        { id: 'hint', anchorBufferRow: 1, placement: 'before', text: 'hint' },
      ])
    if (kind === 'wrap' || kind === 'combined') view.setWrapEnabled(true)
    expect(view['view'].model.projection.supportsIncrementalRowPatch).toBe(kind === 'plain')
    if (kind !== 'plain') {
      expect(sameLineEditPatch(view['view'], { from: 0, to: 0, text: 'x' })).toBeNull()
      expect(multiLineEditPatch(view['view'], { from: 0, to: 0, text: '\n' })).toBeNull()
    }
    for (let step = 0; step < 24; step += 1) {
      const state = view['view']
      const from = Math.floor(random() * (state.model.textLength + 1))
      const to = Math.min(state.model.textLength, from + Math.floor(random() * 4))
      const text = ['x', '\n', 'ab\ncd', '', '\t', 'é', '👩‍💻'][Math.floor(random() * 7)]!
      const edit = snapBatchEditRanges(piece, [{ from, to, text }])[0]!
      const same = sameLineEditPatch(state, edit)
      const multi = multiLineEditPatch(state, edit)
      if (kind === 'plain') expect(Boolean(same) !== Boolean(multi)).toBe(true)
      piece = applyBatchToPieceTable(piece, [edit])
      view.applyEdit(edit, createDocumentTextSnapshot(piece))
      compareFullLayout(view, step)
    }
  },
)

function compareFullLayout(view: VirtualizedTextView, step: number): void {
  const state = view['view']
  const projection = state.model.projection
  const full = new DisplayProjection({
    textSnapshot: state.model.textSnapshot,
    ...projection.config,
  })
  expect(projection.rowCount, `step ${step}`).toBe(full.rowCount)
  expect(projection.materializeWindow(0, projection.rowCount), `step ${step}`).toEqual(
    full.materializeWindow(0, full.rowCount),
  )
  const rebuilt = createView()
  try {
    rebuilt.setText(state.model.textSnapshot)
    rebuilt.setScrollMetrics(0, 2000, 40)
    rebuilt.setFoldState([], projection.config.foldMap)
    rebuilt.setInlineMap(projection.config.inlineMap)
    rebuilt.setInjectedTextRows(projection.config.injectedTextRows)
    rebuilt.setWrapEnabled(state.wrapEnabled)
    rebuilt.setRowDecorations(state.rowDecorations)
    expect(rowText(view), `mounted step ${step}`).toEqual(rowText(rebuilt))
  } finally {
    rebuilt.dispose()
  }
}

function createView(): VirtualizedTextView {
  return new VirtualizedTextView(document.createElement('div'), {
    rowHeight: 20,
    textMetrics: { rowHeight: 20, characterWidth: 8 },
  })
}

function rowText(view: VirtualizedTextView) {
  return Array.from(view['view'].rowElements.values(), (row) => ({
    index: row.index,
    bufferRow: row.bufferRow,
    text: row.element.textContent,
    className: row.element.className,
    top: row.element.style.top,
    transform: row.element.style.transform,
    height: row.element.style.height,
  })).sort((left, right) => left.index - right.index)
}

function generator(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}
