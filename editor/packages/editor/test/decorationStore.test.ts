import { afterEach, describe, expect, it } from 'vitest'

import {
  EditorDecorationStore,
  projectDecorationRangeThroughEdits,
  type EditorDecoration,
  type EditorDecorationRange,
} from '../src/editor/decorationStore'
import {
  anchorAt,
  type AnchorBias,
  applyBatchToPieceTable,
  createPieceTableSnapshot,
  resolveAnchor,
} from '@singapore-editor/textbuffer'

import type { TextEdit } from '../src/tokens'

type Diagnostic = {
  readonly name: string
  readonly detail?: Readonly<Record<string, unknown>>
}

type DiagnosticGlobal = typeof globalThis & {
  __EDITOR_PERFORMANCE_DIAGNOSTICS__?: ((diagnostic: Diagnostic) => void) | null
}

const TEXT = 'one two three'
/** "two", the word the growth cases are measured against. */
const WORD_START = 4
const WORD_END = 7

const BIAS_PAIRS: readonly {
  readonly startBias: AnchorBias
  readonly endBias: AnchorBias
  readonly label: string
  readonly typedAtStart: readonly [number, number]
  readonly typedAtEnd: readonly [number, number]
}[] = [
  {
    startBias: 'left',
    endBias: 'right',
    label: 'absorbs text typed at either edge',
    typedAtStart: [4, 9],
    typedAtEnd: [4, 9],
  },
  {
    startBias: 'right',
    endBias: 'left',
    label: 'absorbs text typed at neither edge',
    typedAtStart: [6, 9],
    typedAtEnd: [4, 7],
  },
  {
    startBias: 'left',
    endBias: 'left',
    label: 'absorbs text typed at its start only',
    typedAtStart: [4, 9],
    typedAtEnd: [4, 7],
  },
  {
    startBias: 'right',
    endBias: 'right',
    label: 'absorbs text typed at its end only',
    typedAtStart: [6, 9],
    typedAtEnd: [4, 9],
  },
]

describe('decoration store edit tracking', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, '__EDITOR_PERFORMANCE_DIAGNOSTICS__')
  })

  for (const pair of BIAS_PAIRS) {
    it(`${pair.startBias}/${pair.endBias} ${pair.label}, without the owner re-supplying it`, () => {
      const before = trackWordThrough({ from: 0, to: 0, text: 'Z' }, pair)
      const atStart = trackWordThrough({ from: 4, to: 4, text: 'XY' }, pair)
      const inside = trackWordThrough({ from: 5, to: 5, text: 'XY' }, pair)
      const atEnd = trackWordThrough({ from: 7, to: 7, text: 'XY' }, pair)
      const after = trackWordThrough({ from: 9, to: 9, text: 'XY' }, pair)

      expect(before).toEqual([5, 8])
      expect(atStart).toEqual(pair.typedAtStart)
      expect(inside).toEqual([4, 9])
      expect(atEnd).toEqual(pair.typedAtEnd)
      expect(after).toEqual([4, 7])
    })
  }

  it('keeps text typed at either edge out of a decoration that named no bias', () => {
    const atStart = trackWordThrough({ from: WORD_START, to: WORD_START, text: 'XY' })
    const atEnd = trackWordThrough({ from: WORD_END, to: WORD_END, text: 'XY' })

    expect([atStart, atEnd]).toEqual([
      [6, 9],
      [4, 7],
    ])
  })

  it('keeps following the text across a run of edits it was never re-registered for', () => {
    const store = new EditorDecorationStore()
    const id = store.add({ owner: 'find', start: WORD_START, end: WORD_END, text: {} })

    store.applyEdits([{ from: 0, to: 0, text: 'Z' }])
    store.applyEdits([{ from: 6, to: 6, text: 'oo' }])
    store.applyEdits([{ from: 12, to: 14, text: '' }])

    const [decoration] = store.decorationsInRange('text', 0, 100)
    expect(decoration?.id).toBe(id)
    expect([decoration?.start, decoration?.end]).toEqual([5, 10])
  })

  it('drops a decoration whose text an edit swallowed whole, and shrinks a partly eaten one', () => {
    const store = new EditorDecorationStore()
    store.add({ owner: 'lsp', start: 4, end: 7, text: {} })
    store.add({ owner: 'lsp', start: 8, end: 13, text: {} })

    store.applyEdits([{ from: 3, to: 10, text: '' }])

    expect(offsetsOf(store)).toEqual([[3, 6]])
  })

  it('carries a zero-width decoration through an edit at its own offset', () => {
    const store = new EditorDecorationStore()
    store.add({ owner: 'anchor', start: 4, end: 4, startBias: 'right', endBias: 'right', text: {} })

    store.applyEdits([{ from: 4, to: 4, text: 'XY' }])

    expect(offsetsOf(store)).toEqual([[6, 6]])
  })
})

// The piece table's anchors are the repo's existing statement of what a biased endpoint does when
// the text under it changes. Pinning the store to them keeps one meaning of `left` and `right`
// rather than a second convention that drifts.
describe('decoration range projection against piece table anchors', () => {
  const edits: readonly TextEdit[] = [
    { from: 0, to: 0, text: 'Z' },
    { from: 4, to: 4, text: 'XY' },
    { from: 5, to: 5, text: 'XY' },
    { from: 7, to: 7, text: 'XY' },
    { from: 9, to: 9, text: 'XY' },
    { from: 4, to: 7, text: '' },
    { from: 4, to: 5, text: '' },
    { from: 6, to: 7, text: '' },
    { from: 5, to: 8, text: '' },
    { from: 3, to: 9, text: '' },
    { from: 0, to: 4, text: '' },
    { from: 7, to: 13, text: '' },
    { from: 4, to: 7, text: 'AB' },
    { from: 4, to: 5, text: 'AB' },
    { from: 6, to: 7, text: 'AB' },
    { from: 3, to: 5, text: 'AB' },
    { from: 6, to: 9, text: 'AB' },
  ]

  for (const pair of BIAS_PAIRS) {
    it(`resolves ${pair.startBias}/${pair.endBias} endpoints where the anchors resolve them`, () => {
      const snapshot = createPieceTableSnapshot(TEXT)
      const start = anchorAt(snapshot, WORD_START, pair.startBias)
      const end = anchorAt(snapshot, WORD_END, pair.endBias)

      for (const edit of edits) {
        const edited = applyBatchToPieceTable(snapshot, [edit])
        const anchored = [resolveAnchor(edited, start).offset, resolveAnchor(edited, end).offset]
        const range: EditorDecorationRange = {
          start: WORD_START,
          end: WORD_END,
          startBias: pair.startBias,
          endBias: pair.endBias,
        }
        const projected = projectDecorationRangeThroughEdits(range, [edit])
        const label = `[${edit.from},${edit.to})"${edit.text}"`

        if (anchored[1]! <= anchored[0]!) {
          expect(projected, label).toBeNull()
          continue
        }

        expect([projected?.start, projected?.end], label).toEqual(anchored)
      }
    })
  }

  // Multi-cursor and replace-all emit their edits highest offset first, and every offset in the
  // batch addresses the document as it stood before any of them applied.
  it('resolves a batch handed over out of order where the anchors resolve it', () => {
    const batch: readonly TextEdit[] = [
      { from: 9, to: 9, text: 'XYZWV' },
      { from: 2, to: 2, text: 'AB' },
    ]
    const snapshot = createPieceTableSnapshot(TEXT)
    const edited = applyBatchToPieceTable(snapshot, batch)

    for (const pair of BIAS_PAIRS) {
      const start = anchorAt(snapshot, WORD_START, pair.startBias)
      const end = anchorAt(snapshot, WORD_END, pair.endBias)
      const range: EditorDecorationRange = {
        start: WORD_START,
        end: WORD_END,
        startBias: pair.startBias,
        endBias: pair.endBias,
      }
      const projected = projectDecorationRangeThroughEdits(range, batch)
      const label = `${pair.startBias}/${pair.endBias}`

      expect([projected?.start, projected?.end], label).toEqual([
        resolveAnchor(edited, start).offset,
        resolveAnchor(edited, end).offset,
      ])
    }
  })
})

describe('decoration store surface partitioning', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, '__EDITOR_PERFORMANCE_DIAGNOSTICS__')
  })

  it('never examines another surface when querying one', () => {
    const store = new EditorDecorationStore()
    for (let line = 0; line < 200; line += 1) {
      store.add({ owner: 'lsp', start: line, end: line + 1, row: { gutterClassName: 'error' } })
    }
    store.add({ owner: 'find', start: 0, end: 200, text: {} })

    const diagnostics = collectDiagnostics()
    const matched = store.decorationsInRange('text', 100, 110)

    expect(matched).toHaveLength(1)
    expect(queryDetails(diagnostics)).toEqual([
      { surface: 'text', examined: 1, matched: 1, stored: 1 },
    ])
  })

  it('lets one decoration light up several surfaces from one registration', () => {
    const store = new EditorDecorationStore()
    store.add({
      owner: 'lsp',
      start: 20,
      end: 30,
      text: { className: 'squiggly' },
      row: { gutterClassName: 'error' },
      minimap: { position: 'inline', color: 'red' },
    })

    store.applyEdits([{ from: 0, to: 0, text: 'Z' }])

    for (const surface of ['text', 'row', 'minimap'] as const) {
      const [decoration] = store.decorationsInRange(surface, 0, 100)
      expect([surface, decoration?.start, decoration?.end]).toEqual([surface, 21, 31])
    }
  })

  it('stops the viewport walk once no earlier decoration can reach the window', () => {
    const store = new EditorDecorationStore()
    for (let match = 0; match < 500; match += 1) {
      store.add({ owner: 'find', start: match * 10, end: match * 10 + 3, text: {} })
    }

    const diagnostics = collectDiagnostics()
    const matched = store.decorationsInRange('text', 2000, 2020)

    expect(matched.map((decoration) => decoration.start)).toEqual([2000, 2010, 2020])
    expect(queryDetails(diagnostics)).toEqual([
      { surface: 'text', examined: 4, matched: 3, stored: 500 },
    ])
  })
})

describe('decoration store query index', () => {
  it('finds a decoration enclosing the window from behind nearer ones that stop short of it', () => {
    const store = new EditorDecorationStore()
    store.add({ owner: 'folding', start: 0, end: 1000, text: {} })
    store.add({ owner: 'find', start: 10, end: 12, text: {} })

    expect(rangesOf(store.decorationsInRange('text', 500, 600))).toEqual([[0, 1000]])
  })

  it('answers from where an edit moved a decoration a query had already indexed', () => {
    const store = new EditorDecorationStore()
    store.add({ owner: 'find', start: 0, end: 2, text: {} })
    store.add({ owner: 'find', start: 10, end: 12, text: {} })
    expect(offsetsOf(store)).toHaveLength(2)

    store.applyEdits([{ from: 0, to: 0, text: 'Z'.repeat(100) }])

    expect(rangesOf(store.decorationsInRange('text', 100, 105))).toEqual([[100, 102]])
  })

  it('answers without a decoration a removal took out of an index a query had built', () => {
    const store = new EditorDecorationStore()
    const id = store.add({ owner: 'find', start: 0, end: 2, text: {} })
    store.add({ owner: 'find', start: 10, end: 12, text: {} })
    expect(offsetsOf(store)).toHaveLength(2)

    store.remove(id)

    expect(rangesOf(store.decorationsInRange('text', 10, 12))).toEqual([[10, 12]])
  })
})

describe('decoration store ownership', () => {
  it('reports an unchanged owner set as unchanged', () => {
    const store = new EditorDecorationStore()
    const surface = {}
    const specs = [{ owner: 'occurrences', start: 4, end: 7, text: surface }]

    expect(store.replaceOwner('occurrences', specs)).toBe(true)
    expect(store.replaceOwner('occurrences', [...specs])).toBe(false)
    expect(store.replaceOwner('occurrences', [])).toBe(true)
    expect(store.decorationsInRange('text', 0, 100)).toEqual([])
  })

  it('leaves other owners alone when one replaces its set', () => {
    const store = new EditorDecorationStore()
    store.add({ owner: 'find', start: 0, end: 3, text: {} })
    store.replaceOwner('occurrences', [{ owner: 'occurrences', start: 4, end: 7, text: {} }])

    store.replaceOwner('occurrences', [])

    expect(offsetsOf(store)).toEqual([[0, 3]])
  })

  it('reports an owner whose decorations an edit moved as changed, identical specs or not', () => {
    const store = new EditorDecorationStore()
    const surface = {}
    const registered = [{ owner: 'occurrences', start: 4, end: 7, text: surface }]
    const recomputed = [{ owner: 'occurrences', start: 5, end: 8, text: surface }]
    store.replaceOwner('occurrences', registered)

    store.applyEdits([{ from: 0, to: 0, text: 'Z' }])

    expect(store.replaceOwner('occurrences', recomputed)).toBe(true)
    expect(store.replaceOwner('occurrences', [...recomputed])).toBe(false)
    expect(offsetsOf(store)).toEqual([[5, 8]])
  })

  it('reports a payload the owner changed under an unmoved range as changed', () => {
    const store = new EditorDecorationStore()
    store.replaceOwner('lsp', [{ owner: 'lsp', start: 4, end: 7, text: { className: 'error' } }])

    const repainted = store.replaceOwner('lsp', [
      { owner: 'lsp', start: 4, end: 7, text: { className: 'warning' } },
    ])

    expect(repainted).toBe(true)
    expect(store.decorationsInRange('text', 0, 100).map((one) => one.text?.className)).toEqual([
      'warning',
    ])
  })

  it('refuses specs attributed to anyone but the owner being replaced', () => {
    const store = new EditorDecorationStore()
    const foreign = [{ owner: 'find', start: 4, end: 7, text: {} }]

    expect(() => store.replaceOwner('occurrences', foreign)).toThrow(/owner/)
    expect(() => store.replaceOwner('occurrences', foreign)).toThrow(/owner/)
    expect(offsetsOf(store)).toEqual([])
  })

  it('forgets a removed decoration', () => {
    const store = new EditorDecorationStore()
    const id = store.add({ owner: 'find', start: 0, end: 3, text: {} })

    expect(store.remove(id)).toBe(true)
    expect(store.remove(id)).toBe(false)
    expect(offsetsOf(store)).toEqual([])
  })

  it('refuses a decoration that would draw nowhere', () => {
    const store = new EditorDecorationStore()

    expect(() => store.add({ owner: 'find', start: 0, end: 3 })).toThrow(/surface/)
  })

  // What the editor reaches for when the document these were measured in is replaced: every surface
  // goes, and the owners start again from nothing rather than from a set that says it is unchanged.
  it('empties every surface at once, and asks for a repaint of what is registered next', () => {
    const store = new EditorDecorationStore()
    const specs = [{ owner: 'find', start: 0, end: 3, text: {} }]
    store.replaceOwner('find', specs)
    store.add({ owner: 'lsp', start: 1, end: 2, row: { className: 'error' } })
    store.add({ owner: 'lsp', start: 1, end: 2, minimap: { color: 'red', position: 'inline' } })

    store.clear()

    expect(offsetsOf(store)).toEqual([])
    expect(store.decorationsInRange('row', 0, 100)).toEqual([])
    expect(store.decorationsInRange('minimap', 0, 100)).toEqual([])
    expect(store.replaceOwner('find', [...specs])).toBe(true)
  })
})

function trackWordThrough(
  edit: TextEdit,
  biases: { readonly startBias?: AnchorBias; readonly endBias?: AnchorBias } = {},
): readonly [number, number] {
  const store = new EditorDecorationStore()
  store.add({
    owner: 'find',
    start: WORD_START,
    end: WORD_END,
    text: {},
    ...(biases.startBias ? { startBias: biases.startBias } : {}),
    ...(biases.endBias ? { endBias: biases.endBias } : {}),
  })

  store.applyEdits([edit])
  const [tracked] = offsetsOf(store)
  if (!tracked) throw new Error('decoration did not survive the edit')

  return tracked
}

function offsetsOf(store: EditorDecorationStore): readonly (readonly [number, number])[] {
  return rangesOf(store.decorationsInRange('text', 0, Number.MAX_SAFE_INTEGER))
}

function rangesOf(
  decorations: readonly EditorDecoration[],
): readonly (readonly [number, number])[] {
  return decorations.map((decoration) => [decoration.start, decoration.end] as const)
}

function queryDetails(diagnostics: readonly Diagnostic[]): readonly unknown[] {
  return diagnostics
    .filter((diagnostic) => diagnostic.name === 'editor.decorationStore.query')
    .map((diagnostic) => diagnostic.detail)
}

function collectDiagnostics(): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const diagnosticGlobal = globalThis as DiagnosticGlobal
  diagnosticGlobal.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = (diagnostic) => {
    diagnostics.push(diagnostic)
  }
  return diagnostics
}
