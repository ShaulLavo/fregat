import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectPlatform } from '@tanstack/hotkeys'
import '../src/style.css'

import { Editor, type EditorOptions } from '../src/editor'
import { createInlineMap } from '../src/inlineMap'
import { createDocumentSession, createPieceTableSnapshot } from '../src/public/document'
import { resolveSelection } from '../src/selections'
import {
  normalizeSuspiciousCharactersOptions,
  suspiciousCharacterRanges,
} from '../src/unicodeHighlight'
import { VirtualizedTextView } from '../src/virtualization'
import {
  BIDI_LINE_MEASUREMENT_CEILING,
  caretPosition,
  gutterWidth,
} from '../src/virtualization/virtualizedTextViewRows'
import {
  bidiRunsForRow,
  boundaryPositionXs,
  boundaryPositionXsForAffinity,
  domBoundaryForOffset,
  getRowGeometrySweepCount,
  isBidiMeasurementRefusalRow,
  measureRowContentWidth,
  offsetToX,
  resetRowGeometrySweepCount,
  rowTextExtent,
  unitRectForOffset,
  visualCaretAtRowEdge,
  xToOffset,
} from '../src/virtualization/virtualizedTextViewGeometry'
import {
  BIDI_CORPUS,
  BIDI_CORPUS_NAMES,
  collapsedRangeOracle,
  glyphRectOracle,
  mergedRangeOracle,
  mountBidiGeometryFixture,
  mountSupplementaryBidiFixture,
  subjectRangeSegments,
  unsplitGlyphRectOracle,
  type BidiGeometryFixture,
  type OracleRect,
} from './bidiGeometryBrowserFixture'

const DIRECTION_BOUNDARIES = {
  pureHebrew: [],
  pureArabic: [],
  mixed: [8, 12],
  nested: [4, 7],
  tabRtl: [1],
  override: [3],
  latin: [],
} as const

const CARET_TRUTH_CASES = [
  { name: 'ab', text: 'ab', before: [0], after: [0] },
  { name: 'aB', text: 'aא', before: [0, 1], after: [1, 0] },
  { name: 'Ab', text: 'אb', before: [0, 1], after: [1, 0] },
  { name: 'AB', text: 'אב', before: [0], after: [0] },
] as const

const BIDI_RUN_TRUTH = {
  pureHebrew: [{ start: 0, end: 9, direction: 'rtl' }],
  pureArabic: [{ start: 0, end: 13, direction: 'rtl' }],
  mixed: [
    { start: 0, end: 8, direction: 'ltr' },
    { start: 8, end: 12, direction: 'rtl' },
    { start: 12, end: 18, direction: 'ltr' },
  ],
  nested: [
    { start: 7, end: 11, direction: 'rtl' },
    { start: 4, end: 7, direction: 'ltr' },
    { start: 0, end: 4, direction: 'rtl' },
  ],
  tabRtl: [
    { start: 0, end: 1, direction: 'ltr' },
    { start: 1, end: 8, direction: 'rtl' },
  ],
  override: [
    { start: 0, end: 3, direction: 'ltr' },
    { start: 3, end: 10, direction: 'rtl' },
  ],
  latin: null,
} as const

type CaretState = {
  readonly offset: number
  readonly affinity: 'before' | 'after'
}

type VisualCaretPath = {
  readonly right: readonly CaretState[]
  readonly left: readonly CaretState[]
}

const BIDI_VISUAL_PATHS = {
  pureHebrew: simpleRtlVisualPath(BIDI_CORPUS.pureHebrew.length),
  pureArabic: simpleRtlVisualPath(BIDI_CORPUS.pureArabic.length),
  mixed: {
    right: caretStates([
      [0, 'after'],
      [1, 'before'],
      [2, 'before'],
      [3, 'before'],
      [4, 'before'],
      [5, 'before'],
      [6, 'before'],
      [7, 'before'],
      [8, 'before'],
      [11, 'after'],
      [10, 'after'],
      [9, 'after'],
      [8, 'after'],
      [13, 'before'],
      [14, 'before'],
      [15, 'before'],
      [16, 'before'],
      [17, 'before'],
      [18, 'before'],
    ]),
    left: caretStates([
      [18, 'before'],
      [17, 'after'],
      [16, 'after'],
      [15, 'after'],
      [14, 'after'],
      [13, 'after'],
      [12, 'after'],
      [9, 'before'],
      [10, 'before'],
      [11, 'before'],
      [12, 'before'],
      [7, 'after'],
      [6, 'after'],
      [5, 'after'],
      [4, 'after'],
      [3, 'after'],
      [2, 'after'],
      [1, 'after'],
      [0, 'after'],
    ]),
  },
  nested: {
    right: caretStates([
      [11, 'before'],
      [10, 'after'],
      [9, 'after'],
      [8, 'after'],
      [7, 'after'],
      [5, 'before'],
      [6, 'before'],
      [7, 'before'],
      [3, 'after'],
      [2, 'after'],
      [1, 'after'],
      [0, 'after'],
    ]),
    left: caretStates([
      [0, 'after'],
      [1, 'before'],
      [2, 'before'],
      [3, 'before'],
      [4, 'before'],
      [6, 'after'],
      [5, 'after'],
      [4, 'after'],
      [8, 'before'],
      [9, 'before'],
      [10, 'before'],
      [11, 'before'],
    ]),
  },
  tabRtl: {
    right: caretStates([
      [0, 'after'],
      [1, 'before'],
      [7, 'after'],
      [6, 'after'],
      [5, 'after'],
      [4, 'after'],
      [3, 'after'],
      [2, 'after'],
      [1, 'after'],
    ]),
    left: caretStates([
      [1, 'after'],
      [2, 'before'],
      [3, 'before'],
      [4, 'before'],
      [5, 'before'],
      [6, 'before'],
      [7, 'before'],
      [8, 'before'],
      [0, 'after'],
    ]),
  },
  override: {
    right: caretStates([
      [0, 'after'],
      [1, 'before'],
      [2, 'before'],
      [3, 'before'],
      [9, 'after'],
      [8, 'after'],
      [7, 'after'],
      [6, 'after'],
      [5, 'after'],
      [4, 'after'],
    ]),
    left: caretStates([
      [3, 'after'],
      [5, 'before'],
      [6, 'before'],
      [7, 'before'],
      [8, 'before'],
      [9, 'before'],
      [10, 'before'],
      [2, 'after'],
      [1, 'after'],
      [0, 'after'],
    ]),
  },
  latin: simpleLtrVisualPath(BIDI_CORPUS.latin.length),
} satisfies Record<(typeof BIDI_CORPUS_NAMES)[number], VisualCaretPath>

describe.skipIf(typeof globalThis.Highlight === 'undefined')('BiDi geometry browser oracle', () => {
  let fixture: BidiGeometryFixture | null

  beforeEach(() => {
    fixture = mountBidiGeometryFixture()
  })

  afterEach(() => {
    fixture?.dispose()
    fixture = null
  })

  it('keeps a tab as U+0009 and advances it to the native tab stop', () => {
    const row = fixture!.rows.tabRtl
    const codePoints = Array.from(row.element.textContent ?? '', (char) => char.codePointAt(0))
    const tab = mergedRangeOracle(row, 0, 1)[0]
    const followingGlyph = mergedRangeOracle(row, 1, 2)[0]

    expect(codePoints).toContain(0x0009)
    expect(codePoints).not.toContain(0x2409)
    expect(tab).toBeDefined()
    expect(followingGlyph).toBeDefined()
    expect(tab!.width).toBeCloseTo(followingGlyph!.width * 4, 0)
  })

  it('keeps direction-boundary ambiguity visible in the collapsed-range oracle', () => {
    for (const name of BIDI_CORPUS_NAMES) {
      const row = fixture!.rows[name]
      const ambiguous = new Set<number>(DIRECTION_BOUNDARIES[name])
      for (let offset = 0; offset <= BIDI_CORPUS[name].length; offset += 1) {
        const rects = collapsedRangeOracle(row, offset)
        expect(rects.length, `${name} offset ${offset}`).toBe(ambiguous.has(offset) ? 2 : 1)
      }
    }
  })

  it('agrees with the editor geometry on the Latin control line', () => {
    const row = fixture!.rows.latin
    for (let offset = 0; offset <= row.text.length; offset += 1) {
      const oracle = collapsedRangeOracle(row, offset)[0]
      expect(oracle).toBeDefined()
      expect(offsetToX(fixture!.internal, row, row.startOffset + offset)).toBeCloseTo(
        oracle!.left,
        0,
      )
    }

    for (let start = 0; start < row.text.length; start += 1) {
      assertRectsClose(
        subjectRangeSegments(fixture!, row, start, row.text.length),
        mergedRangeOracle(row, start, row.text.length),
      )
    }
  })

  it('preserves each glyph position across the mounted row DOM structure', () => {
    for (const name of BIDI_CORPUS_NAMES) {
      const mounted = glyphRectOracle(fixture!.rows[name])
      const unsplit = unsplitGlyphRectOracle(fixture!.rows[name])
      expect(mounted).toHaveLength(unsplit.length)
      for (let index = 0; index < mounted.length; index += 1) {
        assertRectsClose(mounted[index]!.rects, unsplit[index]!.rects)
      }
    }
  })

  it('mounts the two supplementary element-boundary fixtures separately from the corpus', () => {
    const supplementary = mountSupplementaryBidiFixture()
    try {
      expect(
        supplementary.controlRow.chunks[0]!.parts.some((part) => part.kind === 'control'),
      ).toBe(true)
      expect(supplementary.widgetRow.chunks[0]!.parts.some((part) => part.kind === 'widget')).toBe(
        true,
      )
    } finally {
      supplementary.dispose()
    }
  })

  it('reads every BiDi boundary from the browser engine', () => {
    for (const name of BIDI_CORPUS_NAMES) {
      const row = fixture!.rows[name]
      for (let offset = 0; offset <= row.text.length; offset += 1) {
        const oracle = collapsedRangeOracle(row, offset)
        expect(oracle.length, `${name} offset ${offset}`).toBeGreaterThan(0)
        expect(offsetToX(fixture!.internal, row, row.startOffset + offset)).toBeCloseTo(
          Math.min(...oracle.map((rect) => rect.left)),
          0,
        )
      }
    }
  })

  it('removes every single-position boundary collision and pins the intrinsic twins', () => {
    const expected = {
      pureHebrew: [],
      pureArabic: [],
      mixed: ['8:12'],
      nested: ['4:7'],
      tabRtl: ['1:8'],
      override: ['3:10'],
      latin: [],
    } as const

    for (const name of BIDI_CORPUS_NAMES) {
      const row = fixture!.rows[name]
      const collisions = boundaryCollisions(row)
      expect(
        collisions.map(({ left, right }) => `${left}:${right}`),
        name,
      ).toEqual(expected[name])
      for (const collision of collisions) {
        expect(
          collision.leftRects > 1 || collision.rightRects > 1,
          `${name} ${collision.left}:${collision.right}`,
        ).toBe(true)
      }
    }
  })

  it('keeps both sub-pixel nested twins reachable at their own browser x', () => {
    const row = fixture!.rows.nested
    const fourX = offsetToX(fixture!.internal, row, row.startOffset + 4)
    const sevenX = offsetToX(fixture!.internal, row, row.startOffset + 7)

    expect(xToOffset(fixture!.internal, row, fourX)).toBe(row.startOffset + 4)
    expect(xToOffset(fixture!.internal, row, sevenX)).toBe(row.startOffset + 7)
  })

  it('draws carets at the browser boundary on mixed and nested lines', () => {
    for (const name of ['mixed', 'nested'] as const) {
      const row = fixture!.rows[name]
      for (let local = 0; local <= row.text.length; local += 1) {
        fixture!.view.setSelection(row.startOffset + local, row.startOffset + local)
        const oracle = collapsedRangeOracle(row, local)
        const caret = fixture!.container.querySelector<HTMLElement>('.editor-virtualized-caret')
        expect(caret).not.toBeNull()
        expect(
          caret!.getBoundingClientRect().left - row.element.getBoundingClientRect().left,
        ).toBeCloseTo(defaultAfterCaretX(name, oracle), 0)
      }
    }
  })

  it('matches the CodeMirror affinity truth table for ab, aB, Ab, and AB', () => {
    for (const testCase of CARET_TRUTH_CASES) assertCaretTruthCase(testCase)
  })

  it('draws the affinity caret first and mounts the other BiDi position second', () => {
    const row = fixture!.rows.mixed
    const glyph = glyphRectOracle(row)[8]!.rects[0]!
    const click = rowClientPoint(row, glyph.left + glyph.width * 0.75)
    const hit = fixture!.view.textPositionFromPoint(click.x, click.y)
    expect(hit).toMatchObject({
      offset: row.startOffset + 12,
      affinity: 'after',
    })

    const oracle = collapsedRangeOracle(row, 12)
      .map((rect) => rect.left)
      .toSorted((left, right) => left - right)
    expect(oracle).toHaveLength(2)
    fixture!.view.setSelection(hit!.offset, hit!.offset, hit!.affinity)
    assertCaretLayerPositions(fixture!.container, row, oracle[1]!, oracle[0]!)
    assertInputAndCompositionAtPrimaryCaret(fixture!, hit!.offset, hit!.affinity)

    fixture!.view.setSelection(hit!.offset, hit!.offset, 'before')
    assertCaretLayerPositions(fixture!.container, row, oracle[0]!, oracle[1]!)
    assertInputAndCompositionAtPrimaryCaret(fixture!, hit!.offset, 'before')

    fixture!.view.setSelections([
      {
        anchorOffset: row.startOffset + 13,
        headOffset: row.startOffset + 13,
        affinity: 'after',
      },
      {
        anchorOffset: row.startOffset + 14,
        headOffset: row.startOffset + 14,
        affinity: 'after',
      },
    ])
    const reused = visibleCaretElements(fixture!.container)
    expect(reused).toHaveLength(2)
    expect(reused[1]!.classList.contains('editor-virtualized-caret-bidi-secondary')).toBe(false)
    expect(reused[1]!.getBoundingClientRect().height).toBeCloseTo(
      reused[0]!.getBoundingClientRect().height,
      0,
    )

    fixture!.view.setSelection(row.startOffset + 13, row.startOffset + 13, 'after')
    expect(visibleCaretElements(fixture!.container)).toHaveLength(1)
  })

  it('renders affinity supplied by a real document session', () => {
    const cases = [
      { affinity: 'before', primary: 0, secondary: 1 },
      { affinity: 'after', primary: 1, secondary: 0 },
    ] as const
    for (const testCase of cases) {
      const mounted = mountBidiEditor(BIDI_CORPUS.mixed, {
        offset: 12,
        affinity: testCase.affinity,
      })
      try {
        const oracle = collapsedRangeOracle(mounted.row, 12)
          .map((rect) => rect.left)
          .toSorted((left, right) => left - right)
        expect(resolvedPrimary(mounted.session).affinity).toBe(testCase.affinity)
        assertCaretLayerPositions(
          mounted.container,
          mounted.row,
          oracle[testCase.primary]!,
          oracle[testCase.secondary]!,
        )
      } finally {
        mounted.dispose()
      }
    }
  })

  it('derives visually ordered engine runs for the complete corpus', () => {
    for (const name of BIDI_CORPUS_NAMES) {
      const row = fixture!.rows[name]
      const runs = bidiRunsForRow(fixture!.internal, row)
      const expected = BIDI_RUN_TRUTH[name]
      if (expected === null) {
        expect(runs, name).toBeNull()
        continue
      }

      expect(localBidiRuns(row, runs), name).toEqual(expected)
      assertBidiRunsAgainstBrowser(row, runs!)
    }
  })

  it('keeps a leading combining mark out of the homogeneous RTL fast path', () => {
    const mounted = mountStandaloneView(`\u0301${'א'.repeat(80)}`)
    try {
      const runs = bidiRunsForRow(mounted.internal, mounted.row)
      expect(localBidiRuns(mounted.row, runs)).toEqual([
        { start: 0, end: 1, direction: 'ltr' },
        { start: 1, end: 81, direction: 'rtl' },
      ])
      assertBidiRunsAgainstBrowser(mounted.row, runs!)

      const extent = rowOracleExtent(mounted.row)
      for (const edge of ['left', 'right'] as const) {
        const target = visualCaretAtRowEdge(mounted.internal, mounted.row, edge)
        expect(target).not.toBeNull()
        const x = boundaryPositionXsForAffinity(
          mounted.internal,
          mounted.row,
          target!.offset,
          target!.affinity,
        )[0]
        expect(x).toBeCloseTo(extent[edge], 0)
      }
    } finally {
      mounted.dispose()
    }
  })

  it('moves Left and Right one painted glyph across every corpus line', () => {
    for (const name of BIDI_CORPUS_NAMES) {
      assertVisualCaretPath(name, 'right', BIDI_VISUAL_PATHS[name].right)
      assertVisualCaretPath(name, 'left', BIDI_VISUAL_PATHS[name].left)
    }
  })

  it('matches short-row visual motion at interior boundaries of long mixed rows', () => {
    const prefix = 'x'.repeat(40)
    const short = mountBidiEditor(BIDI_CORPUS.mixed)
    const long = mountBidiEditor(`${prefix}${BIDI_CORPUS.mixed}${'x'.repeat(40)}`)
    const cases = [
      { offset: 8, affinity: 'before', direction: 'right' },
      { offset: 8, affinity: 'after', direction: 'left' },
      { offset: 9, affinity: 'after', direction: 'right' },
      { offset: 11, affinity: 'before', direction: 'left' },
      { offset: 12, affinity: 'before', direction: 'left' },
      { offset: 12, affinity: 'after', direction: 'right' },
    ] as const
    try {
      for (const testCase of cases) {
        const expected = short.view.visualHorizontalTarget(
          testCase.offset,
          testCase.affinity,
          testCase.direction,
        )
        expect(expected).not.toBeNull()

        const actual = long.view.visualHorizontalTarget(
          prefix.length + testCase.offset,
          testCase.affinity,
          testCase.direction,
        )
        expect(actual).toEqual({
          offset: prefix.length + expected!.offset,
          affinity: expected!.affinity,
        })
      }
    } finally {
      short.dispose()
      long.dispose()
    }
  })

  it('matches short-row affinity steps inside long alternating direction runs', () => {
    const short = mountBidiEditor('aא'.repeat(10))
    const long = mountBidiEditor('aא'.repeat(50))
    const shortOffset = 9
    const longOffset = 49
    const offsetDelta = longOffset - shortOffset
    try {
      for (const affinity of ['before', 'after'] as const) {
        for (const direction of ['left', 'right'] as const) {
          const expected = short.view.visualHorizontalTarget(shortOffset, affinity, direction)
          const actual = long.view.visualHorizontalTarget(longOffset, affinity, direction)

          const caseName = `${affinity} + ${direction}`
          expect(expected, caseName).not.toBeNull()
          expect(actual, caseName).toEqual({
            offset: expected!.offset + offsetDelta,
            affinity: expected!.affinity,
          })
        }
      }
    } finally {
      short.dispose()
      long.dispose()
    }
  })

  it('matches short-row visual twins at interior boundaries of long nested rows', () => {
    const prefix = 'x'.repeat(40)
    const short = mountBidiEditor(BIDI_CORPUS.nested)
    const long = mountBidiEditor(`${prefix}${BIDI_CORPUS.nested}${'x'.repeat(40)}`)
    const cases = [
      { offset: 3, affinity: 'before', direction: 'left' },
      { offset: 8, affinity: 'after', direction: 'right' },
    ] as const
    try {
      for (const testCase of cases) {
        const expected = short.view.visualHorizontalTarget(
          testCase.offset,
          testCase.affinity,
          testCase.direction,
        )
        const actual = long.view.visualHorizontalTarget(
          prefix.length + testCase.offset,
          testCase.affinity,
          testCase.direction,
        )

        expect(expected).not.toBeNull()
        expect(actual).toEqual({
          offset: prefix.length + expected!.offset,
          affinity: expected!.affinity,
        })
      }
    } finally {
      short.dispose()
      long.dispose()
    }
  })

  it('keeps long inline-mapped rows on mapping-aware visual motion', () => {
    const base = BIDI_CORPUS.mixed
    const prefix = 'x'.repeat(40)
    const longText = `${prefix}${base}${'x'.repeat(40)}`
    const short = mountBidiEditor(base)
    const long = mountBidiEditor(longText)
    short.view.setInlineMap(
      createInlineMap(createPieceTableSnapshot(base), [
        { id: 'hint', startIndex: 1, endIndex: 1, text: 'HINT', insertion: true },
      ]),
    )
    long.view.setInlineMap(
      createInlineMap(createPieceTableSnapshot(longText), [
        {
          id: 'hint',
          startIndex: prefix.length + 1,
          endIndex: prefix.length + 1,
          text: 'HINT',
          insertion: true,
        },
      ]),
    )

    try {
      const expected = short.view.visualHorizontalTarget(9, 'after', 'right')
      expect(expected).toEqual({ offset: 8, affinity: 'after' })
      expect(long.view.visualHorizontalTarget(prefix.length + 9, 'after', 'right')).toEqual({
        offset: prefix.length + expected!.offset,
        affinity: expected!.affinity,
      })
    } finally {
      short.dispose()
      long.dispose()
    }
  })

  it('keeps long mixed-row visual motion exact when the queried glyph is horizontally clipped', () => {
    const prefix = 'x'.repeat(40)
    const text = `${prefix}${BIDI_CORPUS.mixed}${'x'.repeat(40)}`
    const reference = mountBidiEditor(text, undefined, {}, { width: 1_200 })
    const clipped = mountBidiEditor(text, undefined, {}, { width: 80 })
    clipped.container.style.transform = 'translateX(-75px)'
    const cases = [
      { offset: prefix.length + 8, affinity: 'before', direction: 'right' },
      { offset: prefix.length + 8, affinity: 'after', direction: 'left' },
      { offset: prefix.length + 12, affinity: 'before', direction: 'left' },
      { offset: prefix.length + 12, affinity: 'after', direction: 'right' },
    ] as const
    try {
      const row = clipped.view.getState().mountedRows[0]!
      row.element.style.setProperty('translate', '3px 0px', 'important')
      const scrollLeft = clipped.view.scrollElement.scrollLeft
      const translate = row.element.style.getPropertyValue('translate')
      const translatePriority = row.element.style.getPropertyPriority('translate')
      for (const testCase of cases) {
        const expected = reference.view.visualHorizontalTarget(
          testCase.offset,
          testCase.affinity,
          testCase.direction,
        )
        expect(expected).not.toBeNull()
        expect(
          clipped.view.visualHorizontalTarget(
            testCase.offset,
            testCase.affinity,
            testCase.direction,
          ),
        ).toEqual(expected)
      }

      expect(clipped.view.scrollElement.scrollLeft).toBe(scrollLeft)
      expect(row.element.style.getPropertyValue('translate')).toBe(translate)
      expect(row.element.style.getPropertyPriority('translate')).toBe(translatePriority)
    } finally {
      reference.dispose()
      clipped.dispose()
    }
  })

  it('crosses Left at the visual edge of a horizontally clipped long mixed prior row', () => {
    const firstLine = `${'x'.repeat(80)} אב`
    const text = `${firstLine}\nx`
    const start = firstLine.length + 1
    const reference = mountBidiEditor(
      text,
      { offset: start, affinity: 'after' },
      { rtlMoveVisually: true },
      { height: 48, width: 1_200 },
    )
    const clipped = mountBidiEditor(
      text,
      { offset: start, affinity: 'after' },
      { rtlMoveVisually: true },
      { height: 48, width: 80 },
    )
    try {
      const referenceInternal = Reflect.get(
        reference.view,
        'view',
      ) as BidiGeometryFixture['internal']
      const referencePriorRow = reference.view.getState().mountedRows[0]!
      const expected = visualCaretAtRowEdge(referenceInternal, referencePriorRow, 'right')
      const priorRow = clipped.view.getState().mountedRows[0]!
      const scrollLeft = clipped.view.scrollElement.scrollLeft
      const translate = priorRow.element.style.getPropertyValue('translate')
      const translatePriority = priorRow.element.style.getPropertyPriority('translate')
      expect(expected).not.toBeNull()
      expect(expected?.offset).not.toBe(firstLine.length)
      expect(clipped.view.visualHorizontalTarget(start, 'after', 'left')).toEqual(expected)
      expect(clipped.view.scrollElement.scrollLeft).toBe(scrollLeft)
      expect(priorRow.element.style.getPropertyValue('translate')).toBe(translate)
      expect(priorRow.element.style.getPropertyPriority('translate')).toBe(translatePriority)
      expect(clipped.editor.dispatchCommand('cursorLeft')).toBe(true)
      expect(resolvedPrimary(clipped.session)).toMatchObject({
        headOffset: expected!.offset,
        affinity: expected!.affinity,
      })
      expect(priorRow.element.style.getPropertyValue('translate')).toBe(translate)
      expect(priorRow.element.style.getPropertyPriority('translate')).toBe(translatePriority)
    } finally {
      reference.dispose()
      clipped.dispose()
    }
  })

  it('crosses a long overridden row at the visual edge owned by an invisible control', () => {
    const prefix = 'x'.repeat(40)
    const firstLine = `${prefix}${BIDI_CORPUS.override}${'x'.repeat(40)}`
    const text = `${firstLine}\nx`
    const start = firstLine.length + 1
    const mounted = mountBidiEditor(
      text,
      { offset: start, affinity: 'after' },
      { rtlMoveVisually: true },
      { height: 48, width: 1_200 },
    )
    try {
      const internal = Reflect.get(mounted.view, 'view') as BidiGeometryFixture['internal']
      const firstRow = mounted.view.getState().mountedRows[0]!
      const expected = visualCaretAtRowEdge(internal, firstRow, 'right')

      expect(expected).toEqual({ offset: prefix.length + 3, affinity: 'after' })
      expect(mounted.view.visualHorizontalTarget(start, 'after', 'left')).toEqual(expected)
      expect(mounted.editor.dispatchCommand('cursorLeft')).toBe(true)
      expect(resolvedPrimary(mounted.session)).toMatchObject({
        headOffset: expected!.offset,
        affinity: expected!.affinity,
      })
    } finally {
      mounted.dispose()
    }
  })

  it('end-reveals the affinity side of an offscreen mixed row after mounting it', () => {
    const prefix = 'x'.repeat(80)
    const targetLine = `${prefix}${BIDI_CORPUS.mixed}${'x'.repeat(40)}`
    const leadingLines = Array.from({ length: 40 }, () => 'top')
    const targetRowIndex = leadingLines.length
    const text = [...leadingLines, targetLine].join('\n')
    const targetOffset = leadingLines.join('\n').length + 1 + prefix.length + 8
    const caretCellWidth = 8
    const mounted = mountBidiEditor(
      text,
      undefined,
      { textMetrics: { rowHeight: 24, characterWidth: caretCellWidth } },
      { height: 24, width: 40 },
    )
    try {
      expect(mounted.view.getState().mountedRows.some((row) => row.index === targetRowIndex)).toBe(
        false,
      )

      mounted.view.revealCaret(targetOffset, 'after', 'end')

      const row = mountedDocumentRow(mounted, targetRowIndex)
      const internal = Reflect.get(mounted.view, 'view') as BidiGeometryFixture['internal']
      const position = caretPosition(internal, targetOffset, 'after')?.[0]
      const viewport = internal.virtualizer.getSnapshot()
      expect(position).toBeDefined()
      const remainingWidth = viewport.scrollLeft + viewport.viewportWidth - position!.left
      // Reveal keeps a full character cell visible, rounded up to a native scroll pixel.
      expect(remainingWidth).toBeGreaterThanOrEqual(caretCellWidth)
      expect(remainingWidth).toBeLessThan(caretCellWidth + 1)
      expect(row.top + row.height - viewport.scrollTop).toBeCloseTo(viewport.viewportHeight, 0)
    } finally {
      mounted.dispose()
    }
  })

  it('keeps a browser-measured pixel goal through alternating bidi rows', () => {
    const lines = [
      BIDI_CORPUS.latin,
      BIDI_CORPUS.pureHebrew,
      BIDI_CORPUS.mixed,
      BIDI_CORPUS.nested,
      BIDI_CORPUS.tabRtl,
      BIDI_CORPUS.override,
      BIDI_CORPUS.pureArabic,
      BIDI_CORPUS.latin,
    ]
    const mounted = mountBidiEditor(
      lines.join('\n'),
      { offset: 4, affinity: 'after' },
      { rtlMoveVisually: true },
      { height: lines.length * 24 },
    )
    try {
      const rows = mounted.view.getState().mountedRows
      expect(rows).toHaveLength(lines.length)
      const goalX =
        primaryCaretLeft(mounted.container) - rows[0]!.element.getBoundingClientRect().left
      const sourceOracle = collapsedRangeOracle(rows[0]!, 4).map((rect) => rect.left)
      expect(distanceToSet(sourceOracle, goalX)).toBeLessThanOrEqual(1)
      const steps = [
        ...Array.from({ length: lines.length - 1 }, (_value, index) => ({
          command: 'cursorDown' as const,
          row: index + 1,
        })),
        ...Array.from({ length: lines.length - 1 }, (_value, index) => ({
          command: 'cursorUp' as const,
          row: lines.length - index - 2,
        })),
      ]

      for (const step of steps) {
        expect(mounted.editor.dispatchCommand(step.command)).toBe(true)
        assertVerticalCaretNearestBrowserX(mounted, rows[step.row]!, goalX)
      }
    } finally {
      mounted.dispose()
    }
  })

  it('retains the pixel goal while a short row clamps it, then recovers it', () => {
    const lines = ['abcdefghijklmnop', 'אב', BIDI_CORPUS.mixed]
    const mounted = mountBidiEditor(
      lines.join('\n'),
      { offset: 10, affinity: 'after' },
      { rtlMoveVisually: true },
      { height: lines.length * 24 },
    )
    try {
      const rows = mounted.view.getState().mountedRows
      const goalX =
        primaryCaretLeft(mounted.container) - rows[0]!.element.getBoundingClientRect().left

      expect(mounted.editor.dispatchCommand('cursorDown')).toBe(true)
      const clamped = resolvedPrimary(mounted.session)
      expect(clamped.goal).toEqual({ kind: 'horizontal', x: goalX })
      const clampedX =
        primaryCaretLeft(mounted.container) - rows[1]!.element.getBoundingClientRect().left
      expect(clampedX).toBeCloseTo(rowOracleExtent(rows[1]!).right, 0)

      expect(mounted.editor.dispatchCommand('cursorDown')).toBe(true)
      assertVerticalCaretNearestBrowserX(mounted, rows[2]!, goalX)
    } finally {
      mounted.dispose()
    }
  })

  it('keeps a vertical Shift anchor while affinity and selection paint follow the pixel goal', () => {
    const lines = [BIDI_CORPUS.latin, BIDI_CORPUS.nested, BIDI_CORPUS.mixed]
    const mounted = mountBidiEditor(
      lines.join('\n'),
      { offset: 4, affinity: 'after' },
      { rtlMoveVisually: true },
      { height: lines.length * 24 },
    )
    try {
      const rows = mounted.view.getState().mountedRows
      const goalX =
        primaryCaretLeft(mounted.container) - rows[0]!.element.getBoundingClientRect().left
      assertVerticalSelectionStep(mounted, rows[1]!, goalX, 'selectDown', 4)
      assertVerticalSelectionStep(mounted, rows[2]!, goalX, 'selectDown', 4)
      assertVerticalSelectionStep(mounted, rows[1]!, goalX, 'selectUp', 4)
    } finally {
      mounted.dispose()
    }
  })

  it('uses affinity to choose the source row at a vertical wrap seam', () => {
    const text = BIDI_CORPUS.pureHebrew.repeat(3)
    const mounted = mountBidiEditor(
      text,
      undefined,
      { rtlMoveVisually: true, wordWrap: true },
      { height: 240, width: 40 },
    )
    try {
      const rows = mounted.view.getState().mountedRows
      expect(rows.length).toBeGreaterThan(4)
      const seam = rows[1]!.endOffset
      expect(rows[2]!.startOffset).toBe(seam)
      const cases = [
        { affinity: 'before' as const, targetRow: 2 },
        { affinity: 'after' as const, targetRow: 3 },
      ]

      for (const testCase of cases) {
        mounted.session.setSelection(seam, seam, { affinity: testCase.affinity })
        const sourceRow = testCase.affinity === 'before' ? rows[1]! : rows[2]!
        const sourceOracle = collapsedRangeOracle(sourceRow, seam - sourceRow.startOffset).map(
          (rect) => rect.left,
        )
        expect(sourceOracle).toHaveLength(1)
        const goalX = sourceOracle[0]!
        expect(mounted.editor.dispatchCommand('cursorDown')).toBe(true)
        assertVerticalCaretNearestBrowserX(mounted, rows[testCase.targetRow]!, goalX)
      }
    } finally {
      mounted.dispose()
    }
  })

  it('keeps ambiguous offset and affinity fixed at vertical display edges', () => {
    const mounted = mountBidiEditor(BIDI_CORPUS.mixed, { offset: 8, affinity: 'before' })
    try {
      const row = mounted.view.getState().mountedRows[0]!
      const oracle = collapsedRangeOracle(row, 8).map((rect) => rect.left)
      expect(oracle).toHaveLength(2)
      const paintedXs: number[] = []
      const cases = [
        { affinity: 'before' as const, command: 'cursorUp' as const },
        { affinity: 'after' as const, command: 'cursorUp' as const },
        { affinity: 'before' as const, command: 'cursorDown' as const },
        { affinity: 'after' as const, command: 'cursorDown' as const },
      ]

      for (const testCase of cases) {
        mounted.session.setSelection(8, 8, { affinity: testCase.affinity })
        expect(mounted.editor.dispatchCommand(testCase.command)).toBe(true)
        expect(resolvedPrimary(mounted.session)).toMatchObject({
          affinity: testCase.affinity,
          headOffset: 8,
        })
        const paintedX =
          primaryCaretLeft(mounted.container) - row.element.getBoundingClientRect().left
        expect(distanceToSet(oracle, paintedX)).toBeLessThanOrEqual(1)
        paintedXs.push(paintedX)
      }
      expect(paintedXs[0]).toBeCloseTo(paintedXs[2]!, 1)
      expect(paintedXs[1]).toBeCloseTo(paintedXs[3]!, 1)
      expect(paintedXs[0]).not.toBeCloseTo(paintedXs[1]!, 1)
    } finally {
      mounted.dispose()
    }
  })

  it('reuses the pixel goal and affinity path for page movement', () => {
    const lines = [
      BIDI_CORPUS.latin,
      BIDI_CORPUS.pureHebrew,
      BIDI_CORPUS.pureArabic,
      BIDI_CORPUS.nested,
      BIDI_CORPUS.tabRtl,
      BIDI_CORPUS.override,
      BIDI_CORPUS.mixed,
      BIDI_CORPUS.pureHebrew,
      BIDI_CORPUS.latin,
      BIDI_CORPUS.nested,
    ]
    const mounted = mountBidiEditor(
      lines.join('\n'),
      { offset: 4, affinity: 'after' },
      { rtlMoveVisually: true },
      { height: 80 },
    )
    try {
      const rowDelta = mounted.view.pageRowDelta()
      expect(rowDelta).toBeGreaterThan(1)
      expect(rowDelta * 2).toBeLessThan(lines.length)
      const source = mountedDocumentRow(mounted, 0)
      const goalX =
        primaryCaretLeft(mounted.container) - source.element.getBoundingClientRect().left

      expect(mounted.editor.dispatchCommand('cursorPageDown')).toBe(true)
      assertVerticalCaretNearestBrowserX(mounted, mountedDocumentRow(mounted, rowDelta), goalX)
      expect(mounted.editor.dispatchCommand('cursorPageDown')).toBe(true)
      assertVerticalCaretNearestBrowserX(mounted, mountedDocumentRow(mounted, rowDelta * 2), goalX)
      expect(mounted.editor.dispatchCommand('cursorPageUp')).toBe(true)
      assertVerticalCaretNearestBrowserX(mounted, mountedDocumentRow(mounted, rowDelta), goalX)

      const anchor = resolvedPrimary(mounted.session).headOffset
      expect(mounted.editor.dispatchCommand('selectPageDown')).toBe(true)
      expect(resolvedPrimary(mounted.session).anchorOffset).toBe(anchor)
      assertVerticalCaretNearestBrowserX(mounted, mountedDocumentRow(mounted, rowDelta * 2), goalX)
    } finally {
      mounted.dispose()
    }
  })

  it('keeps vertical pixel motion independent of the horizontal visual option', () => {
    const visual = verticalResultForOption(true)
    const logical = verticalResultForOption(false)
    expect(logical).toEqual(visual)
  })

  it('keeps End as a logical vertical aim on RTL rows', () => {
    const lines = [BIDI_CORPUS.pureHebrew, BIDI_CORPUS.nested, BIDI_CORPUS.mixed]
    const mounted = mountBidiEditor(
      lines.join('\n'),
      { offset: 4, affinity: 'after' },
      { rtlMoveVisually: true },
      { height: lines.length * 24 },
    )
    try {
      const rows = mounted.view.getState().mountedRows
      expect(mounted.editor.dispatchCommand('cursorLineEnd')).toBe(true)
      expect(resolvedPrimary(mounted.session)).toMatchObject({
        headOffset: rows[0]!.endOffset,
        goal: { kind: 'lineEnd' },
      })

      for (const row of rows.slice(1)) {
        expect(mounted.editor.dispatchCommand('cursorDown')).toBe(true)
        expect(resolvedPrimary(mounted.session)).toMatchObject({
          affinity: 'before',
          headOffset: row.endOffset,
          goal: { kind: 'lineEnd' },
        })
      }
    } finally {
      mounted.dispose()
    }

    const wrapped = mountBidiEditor(
      BIDI_CORPUS.pureHebrew.repeat(2),
      { offset: 1, affinity: 'after' },
      { rtlMoveVisually: true, wordWrap: true },
      { height: 160, width: 40 },
    )
    try {
      const rows = wrapped.view.getState().mountedRows
      expect(rows.length).toBeGreaterThan(2)
      expect(wrapped.editor.dispatchCommand('cursorLineEnd')).toBe(true)
      expect(resolvedPrimary(wrapped.session)).toMatchObject({
        affinity: 'before',
        headOffset: rows[0]!.endOffset,
      })

      expect(wrapped.editor.dispatchCommand('cursorDown')).toBe(true)
      expect(resolvedPrimary(wrapped.session)).toMatchObject({
        affinity: 'before',
        headOffset: rows[1]!.endOffset,
        goal: { kind: 'lineEnd' },
      })
    } finally {
      wrapped.dispose()
    }
  })

  it('measures inline insertion width into a vertical pixel goal', () => {
    const text = 'abc\nabcdefghij'
    const mounted = mountBidiEditor(
      text,
      { offset: 3, affinity: 'after' },
      { rtlMoveVisually: true },
      { height: 48 },
    )
    try {
      const plainX = mounted.view.caretXForOffset(3, 'after')
      mounted.view.setInlineMap(
        createInlineMap(createPieceTableSnapshot(text), [
          {
            id: 'vertical-hint',
            startIndex: 1,
            endIndex: 1,
            text: 'HINT',
            insertion: true,
          },
        ]),
      )
      const rows = mounted.view.getState().mountedRows
      const goalX =
        primaryCaretLeft(mounted.container) - rows[0]!.element.getBoundingClientRect().left
      expect(goalX).toBeGreaterThan(plainX)

      expect(mounted.editor.dispatchCommand('cursorDown')).toBe(true)
      expect(resolvedPrimary(mounted.session).headOffset).toBeGreaterThan(rows[1]!.startOffset + 3)
      assertVerticalCaretNearestBrowserX(mounted, rows[1]!, goalX)
    } finally {
      mounted.dispose()
    }
  })

  it('bounds Range reads for a cold vertical move into a BiDi row', () => {
    const lines = [BIDI_CORPUS.latin, 'aא'.repeat(80)]
    const mounted = mountBidiEditor(
      lines.join('\n'),
      { offset: 4, affinity: 'after' },
      { rtlMoveVisually: true },
      { height: 48 },
    )
    try {
      const rows = mounted.view.getState().mountedRows
      const source = rows[0]!
      const target = rows[1]!
      const goalX =
        primaryCaretLeft(mounted.container) - source.element.getBoundingClientRect().left
      expect(target.geometryCache).toBeNull()
      resetRowGeometrySweepCount()
      const { moved, reads } = countEditorCommandRangeReads(mounted, 'cursorDown')

      expect(moved).toBe(true)
      expect(reads).toBeGreaterThan(0)
      expect(reads).toBeLessThanOrEqual(24)
      expect(getRowGeometrySweepCount()).toBe(0)
      expect(resolvedPrimary(mounted.session)).toMatchObject({
        goal: { kind: 'horizontal' },
        headOffset: target.startOffset + 4,
      })
      assertVerticalCaretNearestBrowserX(mounted, target, goalX)
    } finally {
      mounted.dispose()
    }
  })

  it('retires equal-length inline projection width and refusal caches', () => {
    const text = 'x'
    const mounted = mountStandaloneView(text)
    const snapshot = createPieceTableSnapshot(text)
    const measurable = 'א'.repeat(60)
    const wider = `\t${'א'.repeat(59)}`
    const oversized = `א${'ְ'.repeat(59)}`
    const project = (replacement: string) =>
      createInlineMap(snapshot, [
        { id: 'equal-length-projection', startIndex: 0, endIndex: 1, text: replacement },
      ])

    try {
      mounted.view.setInlineMap(project(measurable))
      let row = mounted.view.getState().mountedRows[0]!
      expect(isBidiMeasurementRefusalRow(mounted.internal, row)).toBe(false)
      const measuredWidth = measureRowContentWidth(mounted.internal, row)

      mounted.view.setInlineMap(project(wider))
      row = mounted.view.getState().mountedRows[0]!
      expect(row.text).toHaveLength(measurable.length)
      expect(measureRowContentWidth(mounted.internal, row)).toBeGreaterThan(measuredWidth)

      mounted.view.setInlineMap(project(oversized))
      row = mounted.view.getState().mountedRows[0]!
      expect(row.text).toHaveLength(measurable.length)
      expect(row.element.querySelector('[data-editor-bidi-measurement-refusal]')).not.toBeNull()
      expect(isBidiMeasurementRefusalRow(mounted.internal, row)).toBe(true)

      mounted.view.setInlineMap(project(measurable))
      row = mounted.view.getState().mountedRows[0]!
      expect(row.element.querySelector('[data-editor-bidi-measurement-refusal]')).toBeNull()
      expect(isBidiMeasurementRefusalRow(mounted.internal, row)).toBe(false)
    } finally {
      mounted.dispose()
    }
  })

  it('uses a deterministic goal estimate for refused geometry, then recovers the pixel x', () => {
    const refusedText = 'א'.repeat(BIDI_LINE_MEASUREMENT_CEILING + 1)
    const lines = [BIDI_CORPUS.latin, refusedText, BIDI_CORPUS.latin]
    const mounted = mountBidiEditor(
      lines.join('\n'),
      { offset: 4, affinity: 'after' },
      { rtlMoveVisually: true },
      { height: lines.length * 24 },
    )
    try {
      const rows = mounted.view.getState().mountedRows
      const goalX =
        primaryCaretLeft(mounted.container) - rows[0]!.element.getBoundingClientRect().left
      expect(
        rows[1]!.element.querySelector('[data-editor-bidi-measurement-refusal]'),
      ).not.toBeNull()

      resetRowGeometrySweepCount()
      expect(mounted.editor.dispatchCommand('cursorDown')).toBe(true)
      expect(getRowGeometrySweepCount()).toBe(0)
      expect(resolvedPrimary(mounted.session)).toMatchObject({
        headOffset: rows[1]!.startOffset + 4,
        goal: { kind: 'horizontal', x: goalX },
      })

      expect(mounted.editor.dispatchCommand('cursorDown')).toBe(true)
      assertVerticalCaretNearestBrowserX(mounted, rows[2]!, goalX)
    } finally {
      mounted.dispose()
    }
  })

  it('keeps Shift selection anchored while its head and affinity move visually', () => {
    const path = BIDI_VISUAL_PATHS.nested.right.slice(0, 8)
    const mounted = mountBidiEditor(BIDI_CORPUS.nested, path[0], {
      rtlMoveVisually: true,
    })
    let sevenAfterX: number | null = null
    try {
      for (const expected of path.slice(1)) {
        sevenAfterX = assertNestedSelectionStep(mounted, expected, sevenAfterX)
      }
    } finally {
      mounted.dispose()
    }
  })

  it('crosses hard line breaks at the destination visual edge', () => {
    const cases = [
      {
        text: 'abc\nאב',
        start: { offset: 3, affinity: 'before' as const },
        next: { offset: 6, affinity: 'before' as const },
      },
      {
        text: 'אב\nabc',
        start: { offset: 0, affinity: 'after' as const },
        next: { offset: 3, affinity: 'after' as const },
      },
    ]
    for (const testCase of cases) {
      const mounted = mountBidiEditor(testCase.text, testCase.start, { rtlMoveVisually: true })
      try {
        const firstTop = primaryCaretTop(mounted.container)
        expect(mounted.editor.dispatchCommand('cursorRight')).toBe(true)
        expect(resolvedPrimary(mounted.session)).toMatchObject({
          headOffset: testCase.next.offset,
          affinity: testCase.next.affinity,
        })
        expect(primaryCaretTop(mounted.container)).toBeGreaterThan(firstTop)

        expect(mounted.editor.dispatchCommand('cursorLeft')).toBe(true)
        expect(resolvedPrimary(mounted.session)).toMatchObject({
          headOffset: testCase.start.offset,
          affinity: testCase.start.affinity,
        })
        expect(primaryCaretTop(mounted.container)).toBeCloseTo(firstTop, 0)
      } finally {
        mounted.dispose()
      }
    }
  })

  it('skips the override control and keeps a handled document-edge no-op', () => {
    const edge = mountBidiEditor(
      BIDI_CORPUS.override,
      { offset: 4, affinity: 'after' },
      { rtlMoveVisually: true },
    )
    try {
      const left = primaryCaretLeft(edge.container)
      expect(edge.editor.dispatchCommand('cursorRight')).toBe(true)
      expect(resolvedPrimary(edge.session)).toMatchObject({ headOffset: 4, affinity: 'after' })
      expect(primaryCaretLeft(edge.container)).toBeCloseTo(left, 0)
    } finally {
      edge.dispose()
    }

    const nextLine = mountBidiEditor(
      `${BIDI_CORPUS.override}\nx`,
      { offset: 4, affinity: 'after' },
      { rtlMoveVisually: true },
    )
    try {
      const top = primaryCaretTop(nextLine.container)
      expect(nextLine.editor.dispatchCommand('cursorRight')).toBe(true)
      expect(resolvedPrimary(nextLine.session)).toMatchObject({ headOffset: 11, affinity: 'after' })
      expect(primaryCaretTop(nextLine.container)).toBeGreaterThan(top)
    } finally {
      nextLine.dispose()
    }
  })

  it('does not use invisible BiDi controls as run-direction probes', () => {
    const text = 'c\u202E1\u202C'
    const mounted = mountBidiEditor(
      text,
      { offset: 0, affinity: 'after' },
      { rtlMoveVisually: true },
    )
    try {
      const startX = primaryCaretLeft(mounted.container)
      let previousX = startX
      let furthestX = startX
      for (let step = 0; step < text.length + 2; step += 1) {
        expect(mounted.editor.dispatchCommand('cursorRight')).toBe(true)
        const currentX = primaryCaretLeft(mounted.container)
        expect(currentX).toBeGreaterThanOrEqual(previousX - 1)
        furthestX = Math.max(furthestX, currentX)
        previousX = currentX
      }
      expect(furthestX).toBeGreaterThan(startX + 1)
    } finally {
      mounted.dispose()
    }
  })

  it('uses affinity to own wrap seams and consumes the destination row first glyph', () => {
    const viewport = { height: 120, width: 40 }
    const right = mountBidiEditor(
      BIDI_CORPUS.pureHebrew,
      { offset: 0, affinity: 'after' },
      { rtlMoveVisually: true, wordWrap: true },
      viewport,
    )
    try {
      const rows = right.view.getState().mountedRows
      expect(rows.length).toBeGreaterThan(1)
      const first = rows[0]!
      const second = rows[1]!
      expect(first.endOffset).toBe(second.startOffset)

      right.view.setSelection(first.endOffset, first.endOffset, 'before')
      const beforeTop = primaryCaretTop(right.container)
      right.view.setSelection(first.endOffset, first.endOffset, 'after')
      expect(primaryCaretTop(right.container)).toBeGreaterThan(beforeTop)

      right.view.setSelection(0, 0, 'after')
      expect(right.editor.dispatchCommand('cursorRight')).toBe(true)
      expect(resolvedPrimary(right.session)).toMatchObject({
        headOffset: second.endOffset - 1,
        affinity: 'after',
      })
    } finally {
      right.dispose()
    }

    const left = mountBidiEditor(
      BIDI_CORPUS.pureHebrew,
      { offset: BIDI_CORPUS.pureHebrew.length, affinity: 'before' },
      { rtlMoveVisually: true, wordWrap: true },
      viewport,
    )
    try {
      const rows = left.view.getState().mountedRows
      const source = rows.at(-1)!
      const target = rows.at(-2)!
      expect(source.startOffset).toBe(target.endOffset)

      expect(left.editor.dispatchCommand('cursorLeft')).toBe(true)
      expect(resolvedPrimary(left.session)).toMatchObject({
        headOffset: target.startOffset + 1,
        affinity: 'before',
      })
    } finally {
      left.dispose()
    }
  })

  it('skips phantom inline text instead of mistaking its source point for a row edge', () => {
    const text = 'foobar'
    const mounted = mountBidiEditor(
      text,
      { offset: 3, affinity: 'after' },
      { rtlMoveVisually: true },
    )
    try {
      mounted.view.setInlineMap(
        createInlineMap(createPieceTableSnapshot(text), [
          {
            id: 'hint',
            startIndex: 3,
            endIndex: 3,
            text: 'HINT',
            insertion: true,
          },
        ]),
      )
      const startX = primaryCaretLeft(mounted.container)

      expect(mounted.editor.dispatchCommand('cursorRight')).toBe(true)
      expect(resolvedPrimary(mounted.session)).toMatchObject({ headOffset: 4, affinity: 'before' })
      expect(primaryCaretLeft(mounted.container)).toBeGreaterThan(startX + 1)

      expect(mounted.editor.dispatchCommand('cursorLeft')).toBe(true)
      expect(resolvedPrimary(mounted.session)).toMatchObject({ headOffset: 3, affinity: 'after' })
      expect(primaryCaretLeft(mounted.container)).toBeCloseTo(startX, 0)
    } finally {
      mounted.dispose()
    }
  })

  it('retains Tier A logical motion when the option is false and keeps Home and End logical', () => {
    const logical = mountBidiEditor(
      BIDI_CORPUS.mixed,
      { offset: 7, affinity: 'after' },
      { rtlMoveVisually: false },
    )
    try {
      expect(logical.editor.dispatchCommand('cursorRight')).toBe(true)
      assertMixedBoundaryCaret(logical, 'before')
    } finally {
      logical.dispose()
    }

    const boundaries = mountBidiEditor(
      BIDI_CORPUS.pureHebrew,
      { offset: 4, affinity: 'after' },
      { rtlMoveVisually: true },
    )
    try {
      expect(boundaries.editor.dispatchCommand('cursorLineStart')).toBe(true)
      expect(resolvedPrimary(boundaries.session).headOffset).toBe(0)
      const startX = primaryCaretLeft(boundaries.container)

      expect(boundaries.editor.dispatchCommand('cursorLineEnd')).toBe(true)
      expect(resolvedPrimary(boundaries.session).headOffset).toBe(BIDI_CORPUS.pureHebrew.length)
      expect(primaryCaretLeft(boundaries.container)).toBeLessThan(startX)
    } finally {
      boundaries.dispose()
    }
  })

  it('round-trips public setSelection affinity at an ambiguous BiDi boundary', () => {
    const mounted = mountBidiEditor(BIDI_CORPUS.mixed)
    try {
      mounted.editor.setSelection(8, 8, { affinity: 'before', reveal: false })
      assertMixedBoundaryCaret(mounted, 'before')

      mounted.editor.setSelection(8, 8, { affinity: 'after', reveal: false })
      assertMixedBoundaryCaret(mounted, 'after')
    } finally {
      mounted.dispose()
    }
  })

  it('collapses a nonempty selection logically onto the adjacent side of a BiDi boundary', () => {
    const mounted = mountBidiEditor(
      BIDI_CORPUS.mixed,
      { offset: 10, affinity: 'after' },
      { rtlMoveVisually: true },
    )
    try {
      mounted.session.setSelection(0, 8, { affinity: 'after' })
      expect(mounted.editor.dispatchCommand('cursorRight')).toBe(true)
      assertMixedBoundaryCaret(mounted, 'before')

      mounted.session.setSelection(8, 12, { affinity: 'before' })
      expect(mounted.editor.dispatchCommand('cursorLeft')).toBe(true)
      assertMixedBoundaryCaret(mounted, 'after')
    } finally {
      mounted.dispose()
    }
  })

  it('keeps word cursor and selection motion in logical document order', () => {
    const mounted = mountBidiEditor(
      BIDI_CORPUS.mixed,
      { offset: 10, affinity: 'after' },
      { rtlMoveVisually: true },
    )
    try {
      const row = mounted.view.getState().mountedRows[0]!
      assertLogicalWordCursorMoves(mounted)

      mounted.session.setSelection(10, 10, { affinity: 'after' })
      expect(mounted.editor.dispatchCommand('selectWordLeft')).toBe(true)
      expect(resolvedPrimary(mounted.session)).toMatchObject({
        affinity: 'after',
        anchorOffset: 10,
        headOffset: 8,
      })
      assertPaintedSelectionRects(row, mergedRangeOracle(row, 8, 10))

      mounted.session.setSelection(10, 10, { affinity: 'after' })
      expect(mounted.editor.dispatchCommand('selectWordRight')).toBe(true)
      expect(resolvedPrimary(mounted.session)).toMatchObject({
        affinity: 'before',
        anchorOffset: 10,
        headOffset: 13,
      })
      assertPaintedSelectionRects(row, mergedRangeOracle(row, 10, 13))
    } finally {
      mounted.dispose()
    }
  })

  it('uses the host platform default when the option is omitted', () => {
    const mounted = mountBidiEditor(BIDI_CORPUS.nested, { offset: 0, affinity: 'after' })
    try {
      expect(mounted.editor.dispatchCommand('cursorRight')).toBe(true)
      const expected = detectPlatform() === 'windows' ? 1 : 0
      expect(resolvedPrimary(mounted.session).headOffset).toBe(expected)
    } finally {
      mounted.dispose()
    }
  })

  it('uses the logical fallback when an RTL row refuses geometry', () => {
    const text = 'א'.repeat(BIDI_LINE_MEASUREMENT_CEILING + 1)
    const mounted = mountBidiEditor(
      text,
      { offset: 1, affinity: 'after' },
      { rtlMoveVisually: true },
    )
    try {
      expect(
        mounted.row.element.querySelector('[data-editor-bidi-measurement-refusal]'),
      ).not.toBeNull()
      expect(mounted.editor.dispatchCommand('cursorRight')).toBe(true)
      expect(resolvedPrimary(mounted.session)).toMatchObject({
        headOffset: 2,
        affinity: 'before',
      })
    } finally {
      mounted.dispose()
    }
  })

  it('moves mounted cursors visually and unmounted cursors through the logical fallback', () => {
    const text = [
      BIDI_CORPUS.nested,
      ...Array.from({ length: 80 }, () => BIDI_CORPUS.pureHebrew),
    ].join('\n')
    const farStart = text.lastIndexOf('\n') + 1
    const container = document.createElement('div')
    container.style.height = '24px'
    container.style.width = '600px'
    document.body.append(container)
    const session = createDocumentSession(text)
    session.setSelections([
      { anchor: 11, head: 11, affinity: 'before' },
      { anchor: farStart + 1, head: farStart + 1, affinity: 'before' },
    ])
    const editor = new Editor(container, { rtlMoveVisually: true })
    editor.attachSession(session)
    const view = Reflect.get(editor, 'view') as VirtualizedTextView
    view.setScrollMetrics(0, 24, 600)
    try {
      expect(
        view
          .getState()
          .mountedRows.some((row) => row.startOffset <= farStart && row.endOffset >= farStart + 1),
      ).toBe(false)

      expect(editor.dispatchCommand('cursorRight')).toBe(true)
      const resolved = session
        .getSelections()
        .selections.map((selection) => resolveSelection(session.getSnapshot(), selection))
      expect(resolved).toMatchObject([
        { anchorOffset: 10, headOffset: 10, affinity: 'after', collapsed: true },
        {
          anchorOffset: farStart + 2,
          headOffset: farStart + 2,
          affinity: 'before',
          collapsed: true,
        },
      ])
    } finally {
      editor.dispose()
      container.remove()
    }
  })

  it('returns to logical motion when the destination row is not mounted', () => {
    const container = document.createElement('div')
    container.style.height = '20px'
    container.style.width = '600px'
    document.body.append(container)
    const view = new VirtualizedTextView(container, { overscan: 0, rowHeight: 20 })
    view.setText(Array.from({ length: 20 }, (_value, index) => `line ${index}`).join('\n'))
    view.setScrollMetrics(0, 20, 600)
    try {
      const mounted = view.getState().mountedRows
      const source = mounted.at(-1)!
      expect(source.index).toBeLessThan(view.getState().lineCount - 1)
      expect(mounted.some((row) => row.index === source.index + 1)).toBe(false)
      expect(view.visualHorizontalTarget(source.endOffset, 'before', 'right')).toBeNull()
    } finally {
      view.dispose()
      container.remove()
    }
  })

  it('estimates a vertical target without mounting an unavailable row', () => {
    const text = `${BIDI_CORPUS.latin}\n${BIDI_CORPUS.nested}\n${BIDI_CORPUS.mixed}`
    const container = document.createElement('div')
    container.style.height = '20px'
    container.style.width = '600px'
    document.body.append(container)
    const view = new VirtualizedTextView(container, { overscan: 0, rowHeight: 20 })
    view.setText(text)
    view.setScrollMetrics(0, 20, 600)
    try {
      const source = view.getState().mountedRows.at(-1)!
      expect(source.index).toBe(0)
      const sourceOffset = source.startOffset + 4
      const goal = { kind: 'horizontal' as const, x: view.caretXForOffset(sourceOffset, 'after') }
      const target = view.verticalCaretTarget(sourceOffset, 'after', 1, goal)
      const targetStart = text.indexOf('\n') + 1

      expect(target).toEqual({ offset: targetStart + 4, affinity: 'after' })
      expect(view.getState().mountedRows.some((row) => row.index === 1)).toBe(false)
    } finally {
      view.dispose()
      container.remove()
    }
  })

  it('preserves existing affinity and assigns browser affinity to an inserted cursor', () => {
    const lines = [BIDI_CORPUS.latin, BIDI_CORPUS.nested]
    const mounted = mountBidiEditor(
      lines.join('\n'),
      { offset: 4, affinity: 'before' },
      { rtlMoveVisually: true },
      { height: lines.length * 24 },
    )
    try {
      const rows = mounted.view.getState().mountedRows
      const goalX =
        primaryCaretLeft(mounted.container) - rows[0]!.element.getBoundingClientRect().left
      expect(mounted.editor.dispatchCommand('editor.action.insertCursorBelow')).toBe(true)

      const resolved = mounted.session
        .getSelections()
        .selections.map((selection) => resolveSelection(mounted.session.getSnapshot(), selection))
      expect(resolved).toHaveLength(2)
      expect(resolved[0]).toMatchObject({ headOffset: 4, affinity: 'before' })
      const inserted = resolved[1]!
      expect(inserted.goal).toEqual({ kind: 'horizontal', x: goalX })
      const oracle = collapsedRangeOracle(rows[1]!, inserted.headOffset - rows[1]!.startOffset).map(
        (rect) => rect.left,
      )
      const closestDistance = closestBrowserBoundaryDistance(rows[1]!, goalX)
      expect(distanceToSet(oracle, goalX)).toBeCloseTo(closestDistance, 1)
      const insertedCaret = visibleCaretElements(mounted.container)[1]!
      const paintedX =
        insertedCaret.getBoundingClientRect().left - rows[1]!.element.getBoundingClientRect().left
      expect(distanceToSet(oracle, paintedX)).toBeLessThanOrEqual(1)
      expect(Math.abs(paintedX - goalX)).toBeCloseTo(closestDistance, 1)
    } finally {
      mounted.dispose()
    }
  })

  it('derives direction for single-glyph runs', () => {
    const cases = [
      {
        text: 'aא',
        expected: [
          { start: 0, end: 1, direction: 'ltr' },
          { start: 1, end: 2, direction: 'rtl' },
        ],
      },
      {
        text: 'אb',
        expected: [
          { start: 0, end: 1, direction: 'rtl' },
          { start: 1, end: 2, direction: 'ltr' },
        ],
      },
      {
        text: 'abאcd',
        expected: [
          { start: 0, end: 2, direction: 'ltr' },
          { start: 2, end: 3, direction: 'rtl' },
          { start: 3, end: 5, direction: 'ltr' },
        ],
      },
      {
        text: 'אב1גד',
        expected: [
          { start: 3, end: 5, direction: 'rtl' },
          { start: 2, end: 3, direction: 'ltr' },
          { start: 0, end: 2, direction: 'rtl' },
        ],
      },
    ] as const

    for (const testCase of cases) {
      const mounted = mountStandaloneView(testCase.text)
      try {
        const runs = bidiRunsForRow(mounted.internal, mounted.row)
        expect(localBidiRuns(mounted.row, runs)).toEqual(testCase.expected)
        assertBidiRunsAgainstBrowser(mounted.row, runs!)
      } finally {
        mounted.dispose()
      }
    }
  })

  it.each(['first', 'last'] as const)(
    'recovers engine runs when collapsed ranges expose only their %s rect',
    (keptRect) => {
      const restore = retainOneCollapsedRangeRect(keptRect)
      const mixed = mountStandaloneView(BIDI_CORPUS.mixed)
      const nested = mountStandaloneView(BIDI_CORPUS.nested)
      const override = mountStandaloneView(BIDI_CORPUS.override)
      const tabRtl = mountStandaloneView(BIDI_CORPUS.tabRtl)
      const singleton = mountStandaloneView('aאb')
      const scaledSingleton = mountStandaloneView('aאb', 4_096, 0.1)
      const nestedSingleton = mountStandaloneView('א1ב')
      const singletonOverride = mountStandaloneView('a\u202E1\u202Cz')
      const nestedEmbedding = mountStandaloneView('a\u202Bבc\u202Cz')
      const scaledNestedEmbedding = mountStandaloneView('a\u202Bבc\u202Cz', 4_096, 0.1)
      const rtlIsolate = mountStandaloneView('a\u2067bא\u2069z')
      const fsiLrm = mountStandaloneView('a\u2068 \u200Eא\u2069z')
      const widget = mountInlineWidgetView('אבגדהוז', 2, 5, 'one-rect-widget')
      const leadingRtlWidget = mountInlineWidgetView('אבגדהוז', 0, 3, 'leading-rtl-widget')
      const trailingRtlWidget = mountInlineWidgetView('אבגדהוז', 4, 7, 'trailing-rtl-widget')
      const leadingMixedWidget = mountInlineWidgetView('aאבb', 0, 1, 'leading-mixed-widget')
      const strongMixedWidget = mountInlineWidgetView('aאבb', 1, 2, 'strong-mixed-widget')
      try {
        const mixedBoundary = boundaryPositionXs(mixed.internal, mixed.row, 8)
        expect(mixedBoundary).toHaveLength(2)
        expect(boundaryPositionXs(mixed.internal, mixed.row, 12)).toHaveLength(2)
        expect(localBidiRuns(mixed.row, bidiRunsForRow(mixed.internal, mixed.row))).toEqual(
          BIDI_RUN_TRUTH.mixed,
        )
        expect(mixed.view.visualHorizontalTarget(8, 'before', 'right')).toEqual({
          offset: 11,
          affinity: 'after',
        })
        mixed.view.focusInput()
        mixed.view.setSelection(8, 8, 'before')
        assertCaretLayerPositions(mixed.container, mixed.row, mixedBoundary[0]!, mixedBoundary[1]!)

        expect(boundaryPositionXs(nested.internal, nested.row, 4)).toHaveLength(2)
        expect(boundaryPositionXs(nested.internal, nested.row, 7)).toHaveLength(2)
        expect(localBidiRuns(nested.row, bidiRunsForRow(nested.internal, nested.row))).toEqual(
          BIDI_RUN_TRUTH.nested,
        )

        expect(boundaryPositionXs(override.internal, override.row, 3)).toHaveLength(2)
        expect(
          localBidiRuns(override.row, bidiRunsForRow(override.internal, override.row)),
        ).toEqual(BIDI_RUN_TRUTH.override)

        expect(boundaryPositionXs(tabRtl.internal, tabRtl.row, 1)).toHaveLength(2)
        expect(localBidiRuns(tabRtl.row, bidiRunsForRow(tabRtl.internal, tabRtl.row))).toEqual(
          BIDI_RUN_TRUTH.tabRtl,
        )

        expect(boundaryPositionXs(singleton.internal, singleton.row, 1)).toHaveLength(2)
        expect(boundaryPositionXs(singleton.internal, singleton.row, 2)).toHaveLength(2)
        expect(
          localBidiRuns(singleton.row, bidiRunsForRow(singleton.internal, singleton.row)),
        ).toEqual([
          { start: 0, end: 1, direction: 'ltr' },
          { start: 1, end: 2, direction: 'rtl' },
          { start: 2, end: 3, direction: 'ltr' },
        ])
        expect(boundaryPositionXs(scaledSingleton.internal, scaledSingleton.row, 1)).toHaveLength(2)
        expect(boundaryPositionXs(scaledSingleton.internal, scaledSingleton.row, 2)).toHaveLength(2)
        expect(
          localBidiRuns(
            scaledSingleton.row,
            bidiRunsForRow(scaledSingleton.internal, scaledSingleton.row),
          ),
        ).toEqual([
          { start: 0, end: 1, direction: 'ltr' },
          { start: 1, end: 2, direction: 'rtl' },
          { start: 2, end: 3, direction: 'ltr' },
        ])

        expect(
          localBidiRuns(
            nestedSingleton.row,
            bidiRunsForRow(nestedSingleton.internal, nestedSingleton.row),
          ),
        ).toEqual([
          { start: 2, end: 3, direction: 'rtl' },
          { start: 1, end: 2, direction: 'ltr' },
          { start: 0, end: 1, direction: 'rtl' },
        ])

        expect(
          boundaryPositionXs(singletonOverride.internal, singletonOverride.row, 1),
        ).toHaveLength(2)
        expect(
          boundaryPositionXs(singletonOverride.internal, singletonOverride.row, 3),
        ).toHaveLength(2)
        expect(
          localBidiRuns(
            singletonOverride.row,
            bidiRunsForRow(singletonOverride.internal, singletonOverride.row),
          ),
        ).toEqual([
          { start: 0, end: 1, direction: 'ltr' },
          { start: 1, end: 3, direction: 'rtl' },
          { start: 3, end: 5, direction: 'ltr' },
        ])

        expect(boundaryPositionXs(nestedEmbedding.internal, nestedEmbedding.row, 4)).toHaveLength(2)
        expect(
          localBidiRuns(
            nestedEmbedding.row,
            bidiRunsForRow(nestedEmbedding.internal, nestedEmbedding.row),
          ),
        ).toEqual([
          { start: 0, end: 1, direction: 'ltr' },
          { start: 3, end: 4, direction: 'ltr' },
          { start: 1, end: 3, direction: 'rtl' },
          { start: 4, end: 6, direction: 'ltr' },
        ])
        expect(
          boundaryPositionXs(scaledNestedEmbedding.internal, scaledNestedEmbedding.row, 4),
        ).toHaveLength(2)
        expect(
          localBidiRuns(
            scaledNestedEmbedding.row,
            bidiRunsForRow(scaledNestedEmbedding.internal, scaledNestedEmbedding.row),
          ),
        ).toEqual([
          { start: 0, end: 1, direction: 'ltr' },
          { start: 3, end: 4, direction: 'ltr' },
          { start: 1, end: 3, direction: 'rtl' },
          { start: 4, end: 6, direction: 'ltr' },
        ])

        expect(boundaryPositionXs(rtlIsolate.internal, rtlIsolate.row, 2)).toHaveLength(2)
        expect(
          localBidiRuns(rtlIsolate.row, bidiRunsForRow(rtlIsolate.internal, rtlIsolate.row)),
        ).toEqual([
          { start: 0, end: 2, direction: 'ltr' },
          { start: 3, end: 4, direction: 'rtl' },
          { start: 2, end: 3, direction: 'ltr' },
          { start: 4, end: 6, direction: 'ltr' },
        ])
        expect(boundaryPositionXs(fsiLrm.internal, fsiLrm.row, 4)).toHaveLength(2)
        expect(localBidiRuns(fsiLrm.row, bidiRunsForRow(fsiLrm.internal, fsiLrm.row))).toEqual([
          { start: 0, end: 4, direction: 'ltr' },
          { start: 4, end: 5, direction: 'rtl' },
          { start: 5, end: 7, direction: 'ltr' },
        ])

        const widgetRow = widget.view.getState().mountedRows[0]!
        expect(localBidiRuns(widgetRow, bidiRunsForRow(widget.internal, widgetRow))).toEqual([
          { start: 0, end: 7, direction: 'rtl' },
        ])
        expect(localBidiRunsForMounted(leadingRtlWidget)).toEqual([
          { start: 0, end: 7, direction: 'rtl' },
        ])
        expect(localBidiRunsForMounted(trailingRtlWidget)).toEqual([
          { start: 0, end: 7, direction: 'rtl' },
        ])
        expect(localBidiRunsForMounted(leadingMixedWidget)).toEqual([
          { start: 0, end: 3, direction: 'rtl' },
          { start: 3, end: 4, direction: 'ltr' },
        ])
        expect(localBidiRunsForMounted(strongMixedWidget)).toEqual([
          { start: 0, end: 3, direction: 'ltr' },
          { start: 3, end: 4, direction: 'ltr' },
        ])
      } finally {
        restore()
        mixed.dispose()
        nested.dispose()
        override.dispose()
        tabRtl.dispose()
        singleton.dispose()
        scaledSingleton.dispose()
        nestedSingleton.dispose()
        singletonOverride.dispose()
        nestedEmbedding.dispose()
        scaledNestedEmbedding.dispose()
        rtlIsolate.dispose()
        fsiLrm.dispose()
        widget.dispose()
        leadingRtlWidget.dispose()
        trailingRtlWidget.dispose()
        leadingMixedWidget.dispose()
        strongMixedWidget.dispose()
      }
    },
  )

  it('derives runs through a rendered control unit', () => {
    const supplementary = mountSupplementaryBidiFixture()
    try {
      const runs = bidiRunsForRow(supplementary.controlInternal, supplementary.controlRow)
      expect(localBidiRuns(supplementary.controlRow, runs)).toEqual([
        { start: 0, end: 7, direction: 'rtl' },
      ])
      assertBidiRunsAgainstBrowser(supplementary.controlRow, runs!)
    } finally {
      supplementary.dispose()
    }
  })

  it('keeps Unicode 17 supplementary RTL boundaries aligned with the browser', () => {
    const text = `a${String.fromCodePoint(0x10d50)}b`
    const mounted = mountStandaloneView(text)
    try {
      const runs = bidiRunsForRow(mounted.internal, mounted.row)
      expect(localBidiRuns(mounted.row, runs)).toEqual([
        { start: 0, end: 1, direction: 'ltr' },
        { start: 1, end: 3, direction: 'rtl' },
        { start: 3, end: 4, direction: 'ltr' },
      ])
      assertBidiRunsAgainstBrowser(mounted.row, runs!)

      const boundary = sortedCollapsedCaretXs(mounted.row, 1)
      expect(boundary).toHaveLength(2)
      assertCaretPositionOrder(mounted, 'before', boundary, [0, 1])
      assertCaretPositionOrder(mounted, 'after', boundary, [1, 0])
    } finally {
      mounted.dispose()
    }
  })

  it('caches the engine run probe with row geometry', () => {
    const mounted = mountStandaloneView(BIDI_CORPUS.mixed)
    try {
      resetRowGeometrySweepCount()
      const results: ReturnType<typeof bidiRunsForRow>[] = []
      const coldReads = countRangeReads(() => {
        results.push(bidiRunsForRow(mounted.internal, mounted.row))
      })
      const runs = results[0]
      expect(runs).not.toBeNull()
      expect(coldReads).toBeGreaterThan(0)
      expect(coldReads).toBeLessThanOrEqual(mounted.row.text.length + 3 * runs!.length + 3)
      expect(getRowGeometrySweepCount()).toBe(0)

      const warmReads = countRangeReads(() => {
        results.push(bidiRunsForRow(mounted.internal, mounted.row))
      })
      expect(warmReads).toBe(0)
      expect(results[1]).toBe(runs)

      mounted.view.setText(BIDI_CORPUS.nested)
      const nextRow = mounted.view.getState().mountedRows[0]!
      const next = bidiRunsForRow(mounted.internal, nextRow)
      expect(next).not.toBe(runs)
      expect(localBidiRuns(nextRow, next)).toEqual(BIDI_RUN_TRUTH.nested)
    } finally {
      mounted.dispose()
    }
  })

  it('retires cached runs when a row element is recycled', () => {
    const mounted = mountRecyclingRtlView()
    try {
      const original = mounted.view.getState().mountedRows[0]!
      const element = original.element
      const runs = bidiRunsForRow(mounted.internal, original)

      mounted.view.scrollElement.scrollTop = 40 * 20
      mounted.view.setScrollMetrics(40 * 20, 20, 600)
      const recycled = mounted.view
        .getState()
        .mountedRows.find((candidate) => candidate.element === element)
      expect(recycled).toBeDefined()

      const next = bidiRunsForRow(mounted.internal, recycled!)
      expect(next).not.toBe(runs)
      expect(next?.[0]?.startOffset).toBe(recycled!.startOffset)
      expect(next?.[0]?.endOffset).toBe(recycled!.endOffset)
    } finally {
      mounted.dispose()
    }
  })

  it('keeps the alternating-run probe linear in layout reads', () => {
    const text = 'aא'.repeat(80)
    const mounted = mountStandaloneView(text)
    try {
      const results: ReturnType<typeof bidiRunsForRow>[] = []
      const reads = countRangeReads(() => {
        results.push(bidiRunsForRow(mounted.internal, mounted.row))
      })
      expect(results[0]!.length).toBeGreaterThan(text.length / 2)
      expect(reads).toBeLessThanOrEqual(text.length * 8 + 1)
    } finally {
      mounted.dispose()
    }
  })

  it.each([
    {
      name: 'embedding carrier tails',
      build: (size: number) => `a${'\u202A'.repeat(size)}b`,
    },
    {
      name: 'nested first-strong isolates',
      build: (size: number) => `a${'\u2068'.repeat(size)}b${'\u2069'.repeat(size)}z`,
    },
    {
      name: 'unmatched isolate terminators',
      build: (size: number) => `${'\u202A'.repeat(size)}${'\u2069'.repeat(size)}א`,
    },
  ])('keeps forced one-rect $name linear', ({ build }) => {
    const small = countForcedOneRectCodePointReads(build(128))
    const largeText = build(256)
    const large = countForcedOneRectCodePointReads(largeText)
    expect(large).toBeLessThanOrEqual(small * 2.5 + 20)
    expect(large).toBeLessThanOrEqual(largeText.length * 16)
  })

  it('keeps zero-rect element seam fallbacks linear in row parts', () => {
    const text = `א${'\u0085'.repeat(80)}ב`
    const mounted = mountStandaloneView(text)
    try {
      const chunk = mounted.row.chunks[0]!
      let partReads = 0
      const parts = new Proxy(chunk.parts, {
        get(target, property, receiver) {
          if (typeof property === 'string' && /^\d+$/.test(property)) partReads += 1
          return Reflect.get(target, property, receiver)
        },
      })
      expect(Reflect.set(chunk, 'parts', parts)).toBe(true)

      expect(bidiRunsForRow(mounted.internal, mounted.row)).not.toBeNull()
      expect(partReads).toBeLessThanOrEqual(parts.length * 4)
    } finally {
      mounted.dispose()
    }
  })

  it('keeps LTR and refused rows off the engine run probe', () => {
    const latin = mountStandaloneView('plain Latin')
    const cjk = mountStandaloneView('日本語')
    const refused = mountStandaloneView('א'.repeat(BIDI_LINE_MEASUREMENT_CEILING + 1))
    const refusalQuery = vi.spyOn(refused.row.element, 'querySelector')
    try {
      assertNoBidiRunReads(latin)
      assertNoBidiRunReads(cjk)
      assertNoBidiRunReads(refused)
      assertNoBidiRunReads(refused)
      expect(refusalQuery).toHaveBeenCalledTimes(1)
    } finally {
      refusalQuery.mockRestore()
      latin.dispose()
      cjk.dispose()
      refused.dispose()
    }
  })

  it('recovers a direction boundary split across adjacent text nodes', () => {
    const text = `${'x'.repeat(50)}אב`
    const mounted = mountStandaloneView(text)
    try {
      const seam = 50
      const seamParts = mounted.row.chunks[0]!.parts.filter(
        (part) => part.kind === 'text' && (part.localStart === seam || part.localEnd === seam),
      )
      expect(seamParts).toHaveLength(2)
      expect(boundaryPositionXs(mounted.internal, mounted.row, seam)).toHaveLength(2)
      expect(localBidiRuns(mounted.row, bidiRunsForRow(mounted.internal, mounted.row))).toEqual([
        { start: 0, end: seam, direction: 'ltr' },
        { start: seam, end: text.length, direction: 'rtl' },
      ])
    } finally {
      mounted.dispose()
    }
  })

  it('deduplicates a same-direction boundary split across adjacent text nodes', () => {
    const text = 'א'.repeat(52)
    const mounted = mountStandaloneView(text)
    try {
      const seam = 50
      const seamParts = mounted.row.chunks[0]!.parts.filter(
        (part) => part.kind === 'text' && (part.localStart === seam || part.localEnd === seam),
      )
      expect(seamParts).toHaveLength(2)
      expect(boundaryPositionXs(mounted.internal, mounted.row, seam)).toHaveLength(1)
      expect(localBidiRuns(mounted.row, bidiRunsForRow(mounted.internal, mounted.row))).toEqual([
        { start: 0, end: text.length, direction: 'rtl' },
      ])
    } finally {
      mounted.dispose()
    }
  })

  it('keeps grapheme clusters inside an engine run', () => {
    const text = 'aא\u05B0ב c'
    const mounted = mountStandaloneView(text)
    try {
      const runs = bidiRunsForRow(mounted.internal, mounted.row)
      expect(localBidiRuns(mounted.row, runs)).toEqual([
        { start: 0, end: 1, direction: 'ltr' },
        { start: 1, end: 4, direction: 'rtl' },
        { start: 4, end: 6, direction: 'ltr' },
      ])
      expect(runs?.some((run) => run.startOffset === 2 || run.endOffset === 2)).toBe(false)
    } finally {
      mounted.dispose()
    }
  })

  it('probes grapheme boundaries rather than UTF-16 positions', () => {
    const grapheme = 'א\u05B0\u05B1\u05B2'
    const text = grapheme.repeat(40)
    const mounted = mountStandaloneView(text)
    try {
      const results: ReturnType<typeof bidiRunsForRow>[] = []
      const reads = countRangeReads(() => {
        results.push(bidiRunsForRow(mounted.internal, mounted.row))
      })
      expect(localBidiRuns(mounted.row, results[0])).toEqual([
        { start: 0, end: text.length, direction: 'rtl' },
      ])
      expect(reads).toBeLessThan(text.length)
    } finally {
      mounted.dispose()
    }
  })

  it('maps an inline widget run back to buffer offsets', () => {
    const text = 'אבגדהוז'
    const mounted = mountStandaloneView(text)
    try {
      const before = bidiRunsForRow(mounted.internal, mounted.row)
      expect(localBidiRuns(mounted.row, before)).toEqual([
        { start: 0, end: text.length, direction: 'rtl' },
      ])
      mounted.view.setInlineMap(
        createInlineMap(createPieceTableSnapshot(text), [
          {
            id: 'visual-run-widget',
            startIndex: 2,
            endIndex: 5,
            text: 'W',
            render: (host) => {
              const box = host.ownerDocument.createElement('span')
              box.style.display = 'inline-block'
              box.style.height = '1em'
              box.style.width = '1em'
              host.append(box)
              return { dispose: () => {} }
            },
          },
        ]),
      )
      const row = mounted.view.getState().mountedRows[0]!
      expect(row.textRenderMode).toBe('widget')
      const after = bidiRunsForRow(mounted.internal, row)
      expect(after).not.toBe(before)
      expect(localBidiRuns(row, after)).toEqual([{ start: 0, end: text.length, direction: 'rtl' }])
      expect(
        after?.some(
          (run) =>
            (run.startOffset > 2 && run.startOffset < 5) ||
            (run.endOffset > 2 && run.endOffset < 5),
        ),
      ).toBe(false)
      assertBidiRunsAgainstBrowser(row, after!)
    } finally {
      mounted.dispose()
    }
  })

  it('uses each whitespace unit box rather than spanning between BiDi boundaries', () => {
    fixture!.view.setHiddenCharacters('show')
    for (const name of BIDI_CORPUS_NAMES) {
      assertWhitespaceMarkersForRow(name, fixture!.rows[name])
    }
  })

  it('takes the row content extent from one whole-row browser read', () => {
    for (const name of BIDI_CORPUS_NAMES) {
      const row = fixture!.rows[name]
      const rects = mergedRangeOracle(row, 0, row.text.length)
      const browserRight = Math.max(...rects.map((rect) => rect.left + rect.width))
      expect(measureRowContentWidth(fixture!.internal, row), name).toBeCloseTo(browserRight, 0)
    }
  })

  it('does not add Range layout reads to the pure-ASCII geometry path', () => {
    const row = fixture!.rows.latin
    const reads = countRangeReads(() => {
      for (let offset = 0; offset <= row.text.length; offset += 1) {
        offsetToX(fixture!.internal, row, row.startOffset + offset)
      }
    })
    expect(reads).toBe(0)
  })

  it('keeps non-ASCII LTR carets on the single calculated position', () => {
    const mounted = mountStandaloneView('日本語')
    try {
      const expectedX = gutterWidth(mounted.internal) + offsetToX(mounted.internal, mounted.row, 1)
      const results: ReturnType<typeof caretPosition>[] = []
      const reads = countRangeReads(() => {
        results.push(caretPosition(mounted.internal, 1, 'after'))
      })
      const positions = results[0]
      expect(reads).toBe(0)
      expect(positions).toHaveLength(1)
      expect(positions?.[0]?.left).toBeCloseTo(expectedX, 4)
    } finally {
      mounted.dispose()
    }
  })

  it('resolves control and widget boundaries through adjacent text when element ranges are empty', () => {
    const supplementary = mountSupplementaryBidiFixture()
    try {
      assertElementBoundaries(supplementary.controlInternal, supplementary.controlRow, 'control')
      assertElementBoundaries(supplementary.widgetInternal, supplementary.widgetRow, 'widget')
    } finally {
      supplementary.dispose()
    }
  })

  it('returns the browser visual rectangle list for every corpus range', () => {
    for (const name of BIDI_CORPUS_NAMES) assertAllRangesMatch(fixture!, name)
  })

  it('closes the two single-glyph range defects pinned by Milestone 2', () => {
    assertSingleGlyphRange(fixture!, 'mixed', 12, 13)
    assertSingleGlyphRange(fixture!, 'nested', 3, 4)
  })

  it('keeps disjoint visual runs separate and merges rects that only abut', () => {
    const row = fixture!.rows.nested
    const disjoint = subjectRangeSegments(fixture!, row, 2, 6)
    const abutting = subjectRangeSegments(fixture!, row, 4, 8)
    assertRectsClose(disjoint, mergedRangeOracle(row, 2, 6))
    assertRectsClose(abutting, mergedRangeOracle(row, 4, 8))
    expect(disjoint).toHaveLength(2)
    expect(disjoint[1]!.left - (disjoint[0]!.left + disjoint[0]!.width)).toBeGreaterThan(1)
    expect(abutting).toHaveLength(1)
  })

  it('paints selection spans as the browser visual rectangle list', () => {
    assertPaintedSelection(fixture!, 'mixed', 8, 12)
    assertPaintedSelection(fixture!, 'nested', 2, 6)
  })

  it('uses the visual rectangle list for the U+202E warning range', () => {
    const row = fixture!.rows.override
    const options = normalizeSuspiciousCharactersOptions(undefined)
    fixture!.view.setHiddenCharacters('show')
    const range = suspiciousCharacterRanges(row.text, options).find(
      (candidate) => candidate.start === 3,
    )
    expect(range).toBeDefined()
    const markers = [...row.element.querySelectorAll<HTMLElement>('[data-editor-hidden-character]')]
      .filter(
        (marker) => marker.dataset.editorHiddenCharacterOffset === String(row.startOffset + 3),
      )
      .map((marker) => ({
        left: Number.parseFloat(marker.style.left),
        width: Number.parseFloat(marker.style.width),
      }))
      .toSorted((left, right) => left.left - right.left)
    assertRectsClose(markers, mergedRangeOracle(row, range!.start, range!.end))
  })

  it('clamps an offset inside an inline replacement to its following boundary', () => {
    const container = document.createElement('div')
    container.style.font = '14px monospace'
    container.style.height = '20px'
    container.style.width = '600px'
    document.body.append(container)
    const text = 'אבג xyz דהו'
    const view = new VirtualizedTextView(container, { rowHeight: 20, overscan: 0 })
    view.setText(text)
    view.setScrollMetrics(0, 20, 600)
    view.setInlineMap(
      createInlineMap(createPieceTableSnapshot(text), [
        { id: 'replacement', startIndex: 4, endIndex: 7, text: 'W' },
      ]),
    )

    const internal = Reflect.get(view, 'view') as BidiGeometryFixture['internal']
    const row = view.getState().mountedRows[0]!
    expect(offsetToX(internal, row, 5)).toBe(offsetToX(internal, row, 7))
    view.dispose()
    container.remove()
  })

  it('hit-tests both visual halves of interior RTL glyphs through the engine', () => {
    for (const name of BIDI_CORPUS_NAMES) {
      if (name === 'latin') continue
      assertInteriorGlyphClicks(fixture!, name)
    }
  })

  it.each(['textOffsetFromPoint', 'textOffsetFromViewportPoint'] as const)(
    '%s matches native RTL hits without measuring discarded affinity',
    (method) => {
      const { view, rows } = fixture!
      const point = renderedGlyphPoint(rows.pureHebrew, 4, 0.75)
      const [expected] = nativeTextOffsets(view, [point])
      expect(expected).toBe(rows.pureHebrew.startOffset + 4)

      let offset: number | null = null
      const offsetReads = countRangeReads(
        () => {
          offset = view[method](point.x, point.y)
        },
        { collapsedOnly: true },
      )
      let positionOffset: number | null = null
      const positionReads = countRangeReads(
        () => {
          positionOffset = view.textPositionFromPoint(point.x, point.y)?.offset ?? null
        },
        { collapsedOnly: true },
      )

      expect(offset).toBe(expected)
      expect(positionOffset).toBe(expected)
      expect(positionReads).toBeGreaterThan(0)
      expect(offsetReads).toBe(0)
    },
  )

  it('repairs the engine hit at both visual edges of pure RTL rows', () => {
    assertRtlEdgeClicks(fixture!, 'pureHebrew')
    assertRtlEdgeClicks(fixture!, 'pureArabic')
    assertRtlEdgeClicks(fixture!, 'nested')
    assertOracleEdgeClicks(fixture!, 'tabRtl')
  })

  it('clamps an edge band before accepting the opposite edge-glyph boundary', () => {
    const row = fixture!.rows.nested
    const extent = rowOracleExtent(row)
    const advance = fixture!.view.getState().metrics.characterWidth
    const opposite = domBoundaryForOffset(row, row.endOffset - 1)
    expect(opposite).not.toBeNull()

    withCaretPositionFromPointResult(opposite!, () => {
      expect(clickRow(fixture!, row, extent.left + advance * 0.25)).toBe(row.endOffset)
    })
  })

  it('compares transformed hit points in row-local geometry space', () => {
    const mounted = mountStandaloneView(BIDI_CORPUS.nested, 4_096, 2)
    try {
      const part = mounted.row.chunks[0]!.parts.find((candidate) => candidate.kind === 'text')
      if (!part || part.kind !== 'text') throw new Error('scaled fixture did not mount text')
      const range = document.createRange()
      range.setStart(part.node, 8)
      range.setEnd(part.node, 9)
      const rect = range.getBoundingClientRect()
      const clientX = rect.left + rect.width * 0.75
      const clientY = rect.top + rect.height / 2
      const engine = document.caretPositionFromPoint(clientX, clientY)
      expect(engine).not.toBeNull()
      const expected = mounted.view.textOffsetFromDomBoundary(engine!.offsetNode, engine!.offset)
      expect(mounted.view.textOffsetFromPoint(clientX, clientY)).toBe(expected)
    } finally {
      mounted.dispose()
    }
  })

  it('pins the engine trigger to the outer edge bands of the three measured rows', () => {
    for (const name of BIDI_CORPUS_NAMES) assertEngineTriggerBand(fixture!, name)
  })

  it('extends a simulated leftward drag over the RTL glyphs it crosses', () => {
    const row = fixture!.rows.nested
    const glyphs = glyphRectOracle(row)
    const startRect = glyphs[8]!.rects[0]!
    const endRect = glyphs[10]!.rects[0]!
    const start = clickRow(fixture!, row, startRect.left + startRect.width * 0.75)
    const end = clickRow(fixture!, row, endRect.left + endRect.width * 0.25)
    expect(start).toBe(row.startOffset + 8)
    expect(end).toBe(row.startOffset + 11)

    fixture!.view.setSelection(start!, end!)
    assertPaintedSelectionRects(row, mergedRangeOracle(row, 8, 11))
  })

  it('keeps the pressed visual side when a real drag leaves an RTL run', () => {
    const mounted = mountBidiEditor(BIDI_CORPUS.mixed)
    try {
      const glyphs = glyphRectOracle(mounted.row)
      const startRect = glyphs[8]!.rects[0]!
      const endRect = glyphs[7]!.rects[0]!
      const start = rowClientPoint(mounted.row, startRect.left + startRect.width * 0.75)
      const end = rowClientPoint(mounted.row, endRect.left + endRect.width * 0.75)
      const down = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        clientX: start.x,
        clientY: start.y,
        detail: 1,
      })

      expect(mounted.view.textPositionFromPoint(start.x, start.y)).toMatchObject({
        offset: 12,
        affinity: 'after',
      })
      expect(mounted.view.textPositionFromPoint(end.x, end.y)).toMatchObject({
        offset: 8,
        affinity: 'before',
      })

      mounted.view.scrollElement.dispatchEvent(down)
      dispatchDragMouse('mousemove', end)

      expect(down.defaultPrevented).toBe(true)
      expect(resolvedPrimary(mounted.session)).toMatchObject({
        affinity: 'before',
        anchorOffset: 12,
        endOffset: 12,
        headOffset: 8,
        reversed: true,
        startOffset: 8,
      })
      assertPaintedSelectionRects(mounted.row, mergedRangeOracle(mounted.row, 8, 12))

      dispatchDragMouse('mouseup', end)
      expect(resolvedPrimary(mounted.session)).toMatchObject({
        affinity: 'before',
        anchorOffset: 12,
        endOffset: 12,
        headOffset: 8,
        reversed: true,
        startOffset: 8,
      })
    } finally {
      mounted.dispose()
    }
  })

  it('keeps a completed ambiguous drag anchor after a projection revision', () => {
    const mounted = mountBidiEditor(BIDI_CORPUS.mixed)
    try {
      const startRect = glyphRectOracle(mounted.row)[8]!.rects[0]!
      const press = rowClientPoint(mounted.row, startRect.left + startRect.width * 0.75)
      const position = mounted.view.textPositionFromPoint(press.x, press.y)
      expect(position).toMatchObject({ affinity: 'after', offset: 12 })
      const measuredAnchor = mounted.view.createBidiSelectionAnchor(position!)
      expect(measuredAnchor).toMatchObject({ insideOffset: 8, rawOffset: 12 })

      const inside = boundaryHitPoint(mounted, 9, 'after')
      const down = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        clientX: press.x,
        clientY: press.y,
        detail: 1,
      })
      mounted.view.scrollElement.dispatchEvent(down)
      dispatchDragMouse('mousemove', inside)
      dispatchDragMouse('mouseup', inside)
      expect(resolvedPrimary(mounted.session)).toMatchObject({
        anchorOffset: 8,
        headOffset: 9,
      })

      const internal = Reflect.get(mounted.view, 'view') as BidiGeometryFixture['internal']
      const revision = internal.displayProjectionRevision
      mounted.view.setInlineMap(
        createInlineMap(createPieceTableSnapshot(BIDI_CORPUS.mixed), [
          { id: 'same-text', startIndex: 0, endIndex: 1, text: 'l' },
        ]),
      )
      expect(internal.displayProjectionRevision).toBeGreaterThan(revision)

      const extend = boundaryHitPoint(mounted, 0, 'after')
      const shiftDown = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        clientX: extend.x,
        clientY: extend.y,
        detail: 1,
        shiftKey: true,
      })
      mounted.view.scrollElement.dispatchEvent(shiftDown)
      expect(resolvedPrimary(mounted.session)).toMatchObject({
        anchorOffset: 8,
        headOffset: 0,
      })
      dispatchDragMouse('mouseup', extend)
    } finally {
      mounted.dispose()
    }
  })

  it('invalidates an RTL drag anchor when its press reveals inline source', () => {
    const text = 'let x = **שלום** world'
    const mounted = mountBidiEditor(text)
    try {
      mounted.view.setInlineMap(
        createInlineMap(createPieceTableSnapshot(text), [
          { id: 'open', startIndex: 8, endIndex: 10, text: '', groupId: 'strong' },
          { id: 'close', startIndex: 14, endIndex: 16, text: '', groupId: 'strong' },
        ]),
      )
      const hiddenRow = mounted.view.getState().mountedRows[0]!
      expect(hiddenRow.text).toBe(BIDI_CORPUS.mixed)
      const press = sourceBoundaryHitPoint(mounted, hiddenRow, 14, 'after')
      const pressedPosition = mounted.view.textPositionFromPoint(press.x, press.y)
      expect(pressedPosition).toMatchObject({ affinity: 'after', offset: 14 })
      const measuredAnchor = mounted.view.createBidiSelectionAnchor(pressedPosition!)
      expect(measuredAnchor).not.toBeNull()
      expect(measuredAnchor!.insideOffset).not.toBe(measuredAnchor!.rawOffset)

      const down = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        clientX: press.x,
        clientY: press.y,
        detail: 1,
      })
      mounted.view.scrollElement.dispatchEvent(down)

      const revealedRow = mounted.view.getState().mountedRows[0]!
      expect(revealedRow.text).toBe(text)
      const revealedInternal = Reflect.get(mounted.view, 'view') as BidiGeometryFixture['internal']
      expect(revealedInternal.textRevision).toBe(measuredAnchor!.textRevision)
      expect(revealedInternal.displayProjectionRevision).toBeGreaterThan(
        measuredAnchor!.displayProjectionRevision,
      )
      const target = sourceBoundaryHitPoint(mounted, revealedRow, 12, 'after')
      dispatchDragMouse('mousemove', target)

      expect(down.defaultPrevented).toBe(true)
      expect(resolvedPrimary(mounted.session)).toMatchObject({
        affinity: 'after',
        anchorOffset: 14,
        headOffset: 12,
        reversed: true,
      })
      assertPaintedSelectionRects(revealedRow, mergedRangeOracle(revealedRow, 12, 14))

      dispatchDragMouse('mouseup', target)
      expect(resolvedPrimary(mounted.session)).toMatchObject({
        affinity: 'after',
        anchorOffset: 14,
        headOffset: 12,
        reversed: true,
      })
    } finally {
      mounted.dispose()
    }
  })

  it('collapses selected text onto the affinity returned by a real ambiguous hit', () => {
    const mounted = mountBidiEditor(BIDI_CORPUS.mixed)
    try {
      mounted.session.setSelection(7, 13, { affinity: 'after' })
      const point = boundaryHitPoint(mounted, 8, 'before')
      const down = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        clientX: point.x,
        clientY: point.y,
        detail: 1,
      })

      mounted.view.scrollElement.dispatchEvent(down)
      dispatchDragMouse('mouseup', point)

      expect(down.defaultPrevented).toBe(true)
      assertMixedBoundaryCaret(mounted, 'before')
    } finally {
      mounted.dispose()
    }
  })

  it('preserves selected-text affinity through a real move and paints its new range', () => {
    const mounted = mountBidiEditor(BIDI_CORPUS.mixed)
    try {
      mounted.session.setSelection(8, 12, { affinity: 'before' })
      const press = boundaryHitPoint(mounted, 10, 'after')
      const drop = boundaryHitPoint(mounted, 0, 'after')
      const down = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        clientX: press.x,
        clientY: press.y,
        detail: 1,
      })

      mounted.view.scrollElement.dispatchEvent(down)
      dispatchDragMouse('mousemove', drop)
      dispatchDragMouse('mouseup', drop)

      expect(down.defaultPrevented).toBe(true)
      expect(mounted.session.materializeFullText()).toBe('שלוםlet x =  world')
      expect(resolvedPrimary(mounted.session)).toMatchObject({
        affinity: 'before',
        anchorOffset: 0,
        headOffset: 4,
        reversed: false,
      })
      const row = mounted.view.getState().mountedRows[0]!
      assertPaintedSelectionRects(row, mergedRangeOracle(row, 0, 4))
      assertBoundaryCaret(mounted, row, 4, 'before')
    } finally {
      mounted.dispose()
    }
  })

  it('distinguishes embedded RTL and nested LTR drag intervals', () => {
    const mixedRow = fixture!.rows.mixed
    const nestedRow = fixture!.rows.nested
    const mixedRect = glyphRectOracle(mixedRow)[8]!.rects[0]!
    const nestedRect = glyphRectOracle(nestedRow)[4]!.rects[0]!
    const mixedPoint = rowClientPoint(mixedRow, mixedRect.left + mixedRect.width * 0.75)
    const nestedPoint = rowClientPoint(nestedRow, nestedRect.left + nestedRect.width * 0.25)
    const mixedPosition = fixture!.view.textPositionFromPoint(mixedPoint.x, mixedPoint.y)
    const nestedPosition = fixture!.view.textPositionFromPoint(nestedPoint.x, nestedPoint.y)
    expect(mixedPosition).not.toBeNull()
    expect(nestedPosition).not.toBeNull()

    const mixedAnchor = fixture!.view.createBidiSelectionAnchor(mixedPosition!)
    const nestedAnchor = fixture!.view.createBidiSelectionAnchor(nestedPosition!)
    expect(mixedAnchor).not.toBeNull()
    expect(nestedAnchor).not.toBeNull()

    expect(
      fixture!.view.resolveBidiSelectionAnchor(mixedAnchor!, {
        ...mixedPosition!,
        offset: mixedRow.startOffset + 9,
      }),
    ).toBe(mixedRow.startOffset + 8)
    expect(
      fixture!.view.resolveBidiSelectionAnchor(mixedAnchor!, {
        ...mixedPosition!,
        offset: mixedRow.startOffset + 8,
        affinity: 'before',
      }),
    ).toBe(mixedRow.startOffset + 12)
    expect(
      fixture!.view.resolveBidiSelectionAnchor(nestedAnchor!, {
        ...nestedPosition!,
        offset: nestedRow.startOffset + 5,
      }),
    ).toBe(nestedRow.startOffset + 4)
    expect(
      fixture!.view.resolveBidiSelectionAnchor(nestedAnchor!, {
        ...nestedPosition!,
        offset: nestedRow.startOffset + 4,
        affinity: 'before',
      }),
    ).toBe(nestedRow.startOffset + 7)
  })

  it('uses caretRangeFromPoint when caretPositionFromPoint is unavailable', () => {
    const row = fixture!.rows.nested
    const glyph = glyphRectOracle(row)[8]!.rects[0]!
    const samples = [glyph.left + glyph.width * 0.25, glyph.left + glyph.width * 0.75]
    const expected = samples.map((x) => clickRow(fixture!, row, x))

    withCaretPositionFromPointDisabled(() => {
      const fallback = samples.map((x) => clickRow(fixture!, row, x))
      expect(fallback).toEqual(expected)
    })
  })

  it('keeps selection, whitespace, and caret overlays transparent to caret hit testing', () => {
    const row = fixture!.rows.nested
    const glyph = glyphRectOracle(row)[8]!.rects[0]!
    const x = glyph.left + glyph.width * 0.25
    const before = clickRow(fixture!, row, x)

    fixture!.view.setHiddenCharacters('show')
    fixture!.view.setSelection(row.startOffset + 2, row.startOffset + 9)
    expect(clickRow(fixture!, row, x)).toBe(before)
  })

  it('falls back to measured geometry when a caret API reports an overlay descendant', () => {
    const row = fixture!.rows.nested
    fixture!.view.setHiddenCharacters('show')
    const marker = row.element.querySelector<HTMLElement>(
      `[data-editor-hidden-character-offset="${row.startOffset + 3}"]`,
    )
    const markerText = marker?.firstChild
    if (!marker || !markerText) throw new Error('nested whitespace marker was not mounted')

    const localX = Number.parseFloat(marker.style.left) + Number.parseFloat(marker.style.width) / 2
    const expected = clickRow(fixture!, row, localX)
    withFirstCaretPositionFromPointResult({ node: markerText, offset: 0 }, () => {
      expect(clickRow(fixture!, row, localX)).toBe(expected)
    })
  })

  it('uses measured geometry for both visual edges when caret APIs are unavailable', () => {
    withCaretHitTestingDisabled(() => assertRtlEdgeClicks(fixture!, 'pureHebrew'))
  })

  it('maps disabled-caret hit testing through an RTL inline insertion', () => {
    const text = 'אבגדהוז'
    const mounted = mountStandaloneView(text)
    try {
      mounted.view.setInlineMap(
        createInlineMap(createPieceTableSnapshot(text), [
          {
            id: 'rtl-insertion',
            startIndex: 3,
            endIndex: 3,
            text: 'רמז',
            insertion: true,
          },
        ]),
      )
      const row = mounted.view.getState().mountedRows[0]!
      expect(row.text).toBe('אבגרמזדהוז')
      const points = [renderedGlyphPoint(row, 4, 0.75), renderedGlyphPoint(row, 9, 0.75)]
      const expected = nativeTextOffsets(mounted.view, points)
      expect(expected).toEqual([3, 6])

      expect(textOffsetsWithCaretHitTestingDisabled(mounted.view, points)).toEqual(expected)
    } finally {
      mounted.dispose()
    }
  })

  it('clamps disabled-caret RTL replacement hits to the source span edges', () => {
    const text = 'אבגדהוזחט'
    const mounted = mountStandaloneView(text)
    try {
      mounted.view.setInlineMap(
        createInlineMap(createPieceTableSnapshot(text), [
          { id: 'rtl-replacement', startIndex: 3, endIndex: 6, text: 'לם' },
        ]),
      )
      const row = mounted.view.getState().mountedRows[0]!
      expect(row.text).toBe('אבגלםזחט')
      const points = [renderedGlyphPoint(row, 3, 0.25), renderedGlyphPoint(row, 4, 0.25)]
      const expected = nativeTextOffsets(mounted.view, points)
      expect(expected).toEqual([3, 6])

      resetRowGeometrySweepCount()
      expect(textOffsetsWithCaretHitTestingDisabled(mounted.view, points)).toEqual(expected)
      expect(getRowGeometrySweepCount()).toBe(0)
    } finally {
      mounted.dispose()
    }
  })

  it('does not reuse extremal offsets when a row element is recycled', () => {
    const mounted = mountRecyclingRtlView()
    try {
      withCaretHitTestingDisabled(() => assertRecycledExtremalOffset(mounted))
    } finally {
      mounted.dispose()
    }
  })

  it('measures text extent independently of selection and hidden-character overlays', () => {
    const mounted = mountStandaloneView(BIDI_CORPUS.nested)
    try {
      mounted.view.setHiddenCharacters('show')
      mounted.view.setSelection(2, 9)

      const oracle = rowOracleExtent(mounted.row)
      const painted = rowTextExtent(mounted.internal, mounted.row)
      expect(painted.left).toBeCloseTo(oracle.left, 0)
      expect(painted.right).toBeCloseTo(oracle.right, 0)

      mounted.view.clearSelection()
      mounted.view.setHiddenCharacters('hidden')
      expect(rowTextExtent(mounted.internal, mounted.row)).toEqual(painted)
    } finally {
      mounted.dispose()
    }
  })

  it('does not reach the whole-row boundary sweep on an unchunked 6,000-character RTL row', () => {
    const mounted = mountLongRtlView()
    try {
      resetRowGeometrySweepCount()
      const rect = mounted.row.element.getBoundingClientRect()
      mounted.view.textOffsetFromPoint(rect.left + 1, rect.top + rect.height / 2)
      expect(getRowGeometrySweepCount()).toBe(0)
    } finally {
      mounted.view.dispose()
      mounted.container.remove()
    }
  })

  it('refuses to window a 6,000-character RTL line and bounds its text nodes', () => {
    const text = 'א'.repeat(6_000)
    const mounted = mountStandaloneView(text)
    try {
      expect(mounted.row.textRenderMode).not.toBe('chunked')
      expect(mounted.row.chunks).toHaveLength(1)
      expect(mounted.row.chunks[0]!.localStart).toBe(0)
      expect(mounted.row.chunks[0]!.localEnd).toBe(text.length)
      expect(mounted.row.leftSpacerElement.style.width).toBe('0px')
      assertBoundedTextParts(mounted.row, text)

      const firstVisualGlyph = mergedRangeOracle(mounted.row, text.length - 1, text.length)[0]!
      const extent = rowOracleExtent(mounted.row)
      expect(firstVisualGlyph.left).toBeCloseTo(extent.left, 0)
      const point = rowClientPoint(mounted.row, extent.left)
      expect(mounted.view.textOffsetFromPoint(point.x, point.y)).toBe(mounted.row.endOffset)
    } finally {
      mounted.dispose()
    }
  })

  it('splits complex rows only at grapheme boundaries and keeps the later-node seam address', () => {
    const text = `${'א'.repeat(49)}😀${'ב'.repeat(100)}`
    const mounted = mountStandaloneView(text, text.length + 1)
    try {
      assertBoundedTextParts(mounted.row, text)
      for (const part of mounted.row.chunks[0]!.parts) assertTextPartBoundary(part)

      const seam = mounted.row.chunks[0]!.parts.find(
        (part) => part.kind === 'text' && part.localStart > 0,
      )
      expect(seam?.kind).toBe('text')
      const local = seam!.localStart
      const oracle = collapsedRangeOracle(mounted.row, local)
      expect(offsetToX(mounted.internal, mounted.row, local)).toBeCloseTo(
        Math.min(...oracle.map((rect) => rect.left)),
        0,
      )
    } finally {
      mounted.dispose()
    }
  })

  it('keeps selection geometry correct across the former RTL chunk boundary', () => {
    const text = 'א'.repeat(6_000)
    const mounted = mountStandaloneView(text)
    try {
      const start = 2_040
      const end = 2_060
      mounted.view.setSelection(start, end)
      assertPaintedSelectionRects(mounted.row, mergedRangeOracle(mounted.row, start, end))
    } finally {
      mounted.dispose()
    }
  })

  it('still chunks long ASCII and CJK controls but not a Latin bidi override', () => {
    const ascii = mountStandaloneView('x'.repeat(6_000))
    const cjk = mountStandaloneView('日'.repeat(6_000))
    const override = mountStandaloneView(`${'x'.repeat(5_000)}\u202Eabcdef`)
    try {
      expect(ascii.row.textRenderMode).toBe('chunked')
      expect(cjk.row.textRenderMode).toBe('chunked')
      expect(override.row.textRenderMode).not.toBe('chunked')
      expect(override.row.chunks).toHaveLength(1)
    } finally {
      ascii.dispose()
      cjk.dispose()
      override.dispose()
    }
  })

  it('uses an endpoint-only placeholder above the measured BiDi geometry ceiling', () => {
    const text = 'א'.repeat(BIDI_LINE_MEASUREMENT_CEILING + 1)
    const mounted = mountStandaloneView(text)
    try {
      assertEndpointPlaceholder(mounted, text, 'line-length')
      expect(mounted.row.element.textContent).not.toContain(text.slice(0, 100))
    } finally {
      mounted.dispose()
    }
  })

  it('uses the endpoint fallback when one grapheme exceeds the text-node bound', () => {
    const text = `אa${'\u0301'.repeat(6_000)}`
    const mounted = mountStandaloneView(text)
    try {
      assertEndpointPlaceholder(mounted, text, 'grapheme-length')
      expect(mounted.row.element.textContent).not.toContain('\u0301'.repeat(100))
    } finally {
      mounted.dispose()
    }
  })

  it('uses the endpoint fallback when a same-line edit creates an oversized grapheme', () => {
    const mounted = mountStandaloneView('אa')
    const inserted = '\u0301'.repeat(6_000)
    const text = `אa${inserted}`
    try {
      mounted.view.applyEdit({ from: 2, to: 2, text: inserted }, text)
      assertEndpointPlaceholder(mounted, text, 'grapheme-length')
    } finally {
      mounted.dispose()
    }
  })
})

function assertRectsClose(actual: readonly OracleRect[], expected: readonly OracleRect[]): void {
  expect(actual).toHaveLength(expected.length)
  for (let index = 0; index < actual.length; index += 1) {
    expect(actual[index]!.left).toBeCloseTo(expected[index]!.left, 0)
    expect(actual[index]!.width).toBeCloseTo(expected[index]!.width, 0)
  }
}

function defaultAfterCaretX(name: 'mixed' | 'nested', oracle: readonly OracleRect[]): number {
  const xs = oracle.map((rect) => rect.left)
  if (xs.length === 1) return xs[0]!
  return name === 'mixed' ? Math.max(...xs) : Math.min(...xs)
}

function localBidiRuns(
  row: BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']],
  runs: ReturnType<typeof bidiRunsForRow>,
): readonly { readonly start: number; readonly end: number; readonly direction: 'ltr' | 'rtl' }[] {
  expect(runs).not.toBeNull()
  return runs!.map((run) => ({
    start: run.startOffset - row.startOffset,
    end: run.endOffset - row.startOffset,
    direction: run.direction,
  }))
}

function localBidiRunsForMounted(mounted: StandaloneView): ReturnType<typeof localBidiRuns> {
  const row = mounted.view.getState().mountedRows[0]!
  return localBidiRuns(row, bidiRunsForRow(mounted.internal, row))
}

function assertBidiRunsAgainstBrowser(
  row: BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']],
  runs: NonNullable<ReturnType<typeof bidiRunsForRow>>,
): void {
  const logical = runs.toSorted((left, right) => left.startOffset - right.startOffset)
  expect(logical[0]!.startOffset).toBe(row.startOffset)
  expect(logical.at(-1)!.endOffset).toBe(row.endOffset)
  for (let index = 1; index < logical.length; index += 1) {
    expect(logical[index - 1]!.endOffset).toBe(logical[index]!.startOffset)
  }

  const visualLefts: number[] = []
  for (const run of runs) {
    const rects = mergedRangeOracle(
      row,
      run.startOffset - row.startOffset,
      run.endOffset - row.startOffset,
    )
    expect(rects).toHaveLength(1)
    visualLefts.push(rects[0]!.left)
  }
  for (let index = 1; index < visualLefts.length; index += 1) {
    expect(visualLefts[index]!).toBeGreaterThanOrEqual(visualLefts[index - 1]! - 1)
  }

  const runSplits = logical.slice(1).map((run) => run.startOffset)
  const oracleSplits: number[] = []
  for (let local = 1; local < row.text.length; local += 1) {
    if (collapsedRangeOracle(row, local).length > 1) {
      oracleSplits.push(row.startOffset + local)
    }
  }
  expect(runSplits).toEqual(oracleSplits)
}

function assertNoBidiRunReads(mounted: StandaloneView): void {
  const results: ReturnType<typeof bidiRunsForRow>[] = []
  const reads = countRangeReads(() => {
    results.push(bidiRunsForRow(mounted.internal, mounted.row))
  })
  expect(reads).toBe(0)
  expect(results[0]).toBeNull()
}

function assertCaretTruthCase(testCase: (typeof CARET_TRUTH_CASES)[number]): void {
  const mounted = mountStandaloneView(testCase.text)
  try {
    const oracle = collapsedRangeOracle(mounted.row, 1)
      .map((rect) => rect.left)
      .toSorted((left, right) => left - right)
    assertCaretPositionOrder(mounted, 'before', oracle, testCase.before)
    assertCaretPositionOrder(mounted, 'after', oracle, testCase.after)
  } finally {
    mounted.dispose()
  }
}

function assertCaretPositionOrder(
  mounted: StandaloneView,
  affinity: 'before' | 'after',
  oracle: readonly number[],
  expectedIndices: readonly number[],
): void {
  const positions = caretPosition(mounted.internal, 1, affinity)
  expect(positions).not.toBeNull()
  expect(positions).toHaveLength(expectedIndices.length)
  const gutter = gutterWidth(mounted.internal)
  for (let index = 0; index < expectedIndices.length; index += 1) {
    const position = positions![index]!
    expect(position.left - gutter).toBeCloseTo(oracle[expectedIndices[index]!]!, 0)
    expect(position.top).toBe(mounted.row.top)
    expect(position.height).toBe(mounted.row.height)
  }
}

function assertCaretLayerPositions(
  container: HTMLElement,
  row: BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']],
  primaryX: number,
  secondaryX: number,
): void {
  const carets = visibleCaretElements(container)
  expect(carets).toHaveLength(2)
  const rowRect = row.element.getBoundingClientRect()
  const primaryRect = carets[0]!.getBoundingClientRect()
  const secondaryRect = carets[1]!.getBoundingClientRect()
  expect(carets[0]!.parentElement).toBe(carets[1]!.parentElement)
  expect(carets[0]!.parentElement?.classList.contains('editor-virtualized-caret-layer')).toBe(true)
  expect(primaryRect.left - rowRect.left).toBeCloseTo(primaryX, 0)
  expect(secondaryRect.left - rowRect.left).toBeCloseTo(secondaryX, 0)
  expect(carets[1]!.classList.contains('editor-virtualized-caret-secondary')).toBe(true)
  expect(carets[1]!.classList.contains('editor-virtualized-caret-bidi-secondary')).toBe(true)
  expect(secondaryRect.top).toBeCloseTo(primaryRect.top, 0)
  expect(secondaryRect.height).toBeCloseTo(primaryRect.height * 0.85, 0)
}

function visibleCaretElements(container: HTMLElement): readonly HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.editor-virtualized-caret:not([hidden])')]
}

function assertInputAndCompositionAtPrimaryCaret(
  fixture: BidiGeometryFixture,
  offset: number,
  affinity: 'before' | 'after',
): void {
  const position = caretPosition(fixture.internal, offset, affinity)?.[0]
  expect(position).toBeDefined()
  const caret = primaryCaretElement(fixture.container).getBoundingClientRect()
  const input = fixture.view.inputElement.getBoundingClientRect()
  expect(input.left).toBeCloseTo(caret.left, 0)
  expect(input.top).toBeCloseTo(caret.top, 0)

  fixture.view.setCompositionPreedit('x')
  const preedit = fixture.container.querySelector<HTMLElement>('.editor-virtualized-composition')
  expect(preedit).not.toBeNull()
  const transform = new DOMMatrix(preedit!.style.transform)
  expect(transform.m41).toBeCloseTo(position!.left, 3)
  expect(transform.m42).toBeCloseTo(position!.top, 3)
  fixture.view.setCompositionPreedit('')
}

type BoundaryCollision = {
  readonly left: number
  readonly right: number
  readonly leftRects: number
  readonly rightRects: number
}

function boundaryCollisions(
  row: BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']],
): readonly BoundaryCollision[] {
  const positions = Array.from({ length: row.text.length + 1 }, (_, offset) => ({
    offset,
    rects: collapsedRangeOracle(row, offset),
  }))
  const collisions: BoundaryCollision[] = []
  for (let left = 0; left < positions.length; left += 1) {
    appendBoundaryCollisions(collisions, positions, left)
  }
  return collisions
}

function appendBoundaryCollisions(
  collisions: BoundaryCollision[],
  positions: readonly { readonly offset: number; readonly rects: readonly OracleRect[] }[],
  left: number,
): void {
  const leftPosition = positions[left]!
  const leftX = Math.min(...leftPosition.rects.map((rect) => rect.left))
  for (let right = left + 1; right < positions.length; right += 1) {
    const rightPosition = positions[right]!
    const rightX = Math.min(...rightPosition.rects.map((rect) => rect.left))
    if (Math.abs(leftX - rightX) >= 1) continue
    collisions.push({
      left: leftPosition.offset,
      right: rightPosition.offset,
      leftRects: leftPosition.rects.length,
      rightRects: rightPosition.rects.length,
    })
  }
}

function assertElementBoundaries(
  internal: BidiGeometryFixture['internal'],
  row: BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']],
  kind: 'control' | 'widget',
): void {
  const partIndex = row.chunks[0]!.parts.findIndex((part) => part.kind === kind)
  const parts = row.chunks[0]!.parts
  const part = parts[partIndex]
  const preceding = parts[partIndex - 1]
  const following = parts[partIndex + 1]
  if (
    !part ||
    part.kind === 'text' ||
    part.kind !== kind ||
    preceding?.kind !== 'text' ||
    following?.kind !== 'text'
  ) {
    throw new Error(`${kind} fixture did not mount between text parts`)
  }

  expect(collapsedElementBoundaryRects(part.element, 'before')).toHaveLength(0)
  const rowLeft = row.element.getBoundingClientRect().left
  const before = collapsedTextBoundaryX(preceding.node, preceding.node.length) - rowLeft
  const after = collapsedTextBoundaryX(following.node, 0) - rowLeft
  expect(offsetToX(internal, row, row.startOffset + part.localStart)).toBeCloseTo(before, 0)
  expect(offsetToX(internal, row, row.startOffset + part.localEnd)).toBeCloseTo(after, 0)
}

function assertWhitespaceMarkersForRow(
  name: keyof typeof BIDI_CORPUS,
  row: BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']],
): void {
  const glyphs = glyphRectOracle(row)
  for (let local = 0; local < row.text.length; local += 1) {
    if (row.text.charAt(local) !== ' ' && row.text.charAt(local) !== '\t') continue
    const marker = row.element.querySelector<HTMLElement>(
      `[data-editor-hidden-character-offset="${row.startOffset + local}"]`,
    )
    const glyph = glyphs[local]!.rects[0]
    expect(marker, `${name} whitespace ${local}`).not.toBeNull()
    expect(glyph).toBeDefined()
    expect(Number.parseFloat(marker!.style.left)).toBeCloseTo(glyph!.left, 0)
    expect(Number.parseFloat(marker!.style.width)).toBeCloseTo(glyph!.width, 0)
    expect(Number.parseFloat(marker!.style.width)).toBeLessThanOrEqual(glyph!.width + 1)
  }
}

function collapsedElementBoundaryRects(
  element: HTMLElement,
  side: 'before' | 'after',
): readonly DOMRect[] {
  const parent = element.parentNode
  if (!parent) throw new Error('element fixture is detached')
  const index = Array.prototype.indexOf.call(parent.childNodes, element) as number
  const range = element.ownerDocument.createRange()
  range.setStart(parent, index + (side === 'after' ? 1 : 0))
  range.collapse(true)
  return Array.from(range.getClientRects())
}

function collapsedTextBoundaryX(node: Text, offset: number): number {
  const range = node.ownerDocument.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  const rects = Array.from(range.getClientRects())
  if (rects.length === 0) throw new Error('adjacent text boundary did not produce a rect')
  return Math.min(...rects.map((rect) => rect.left))
}

function assertAllRangesMatch(fixture: BidiGeometryFixture, name: keyof typeof BIDI_CORPUS): void {
  const row = fixture.rows[name]
  for (let start = 0; start < row.text.length; start += 1) {
    assertRangesStartingAt(fixture, row, start)
  }
}

function assertRangesStartingAt(
  fixture: BidiGeometryFixture,
  row: BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']],
  start: number,
): void {
  for (let end = start + 1; end <= row.text.length; end += 1) {
    const actual = subjectRangeSegments(fixture, row, start, end)
    const expected = mergedRangeOracle(row, start, end)
    expect(actual, `${row.text} [${start}, ${end})`).toHaveLength(expected.length)
    assertRectsClose(actual, expected)
  }
}

function assertSingleGlyphRange(
  fixture: BidiGeometryFixture,
  name: 'mixed' | 'nested',
  start: number,
  end: number,
): void {
  const row = fixture.rows[name]
  const actual = subjectRangeSegments(fixture, row, start, end)[0]
  const oracle = mergedRangeOracle(row, start, end)[0]
  expect(actual).toBeDefined()
  expect(oracle).toBeDefined()
  expect(actual!.left).toBeCloseTo(oracle!.left, 0)
  expect(actual!.width).toBeCloseTo(oracle!.width, 0)
  expect(actual!.width).toBeCloseTo(glyphRectOracle(row)[start]!.rects[0]!.width, 0)
}

function assertPaintedSelection(
  fixture: BidiGeometryFixture,
  name: 'mixed' | 'nested',
  start: number,
  end: number,
): void {
  const row = fixture.rows[name]
  fixture.view.setSelection(row.startOffset + start, row.startOffset + end)
  assertPaintedSelectionRects(row, mergedRangeOracle(row, start, end))
}

function assertPaintedSelectionRects(
  row: BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']],
  expected: readonly OracleRect[],
): void {
  const painted = [
    ...row.element.querySelectorAll<HTMLElement>('.editor-virtualized-selection-range'),
  ]
    .map((element) => ({
      left: Number.parseFloat(element.style.left),
      width: Number.parseFloat(element.style.width),
    }))
    .toSorted((left, right) => left.left - right.left)
  assertRectsClose(painted, expected)
}

function countRangeReads(
  run: () => void,
  options: { readonly collapsedOnly?: boolean } = {},
): number {
  const clientRects = Range.prototype.getClientRects
  const boundingRect = Range.prototype.getBoundingClientRect
  let reads = 0
  Range.prototype.getClientRects = function countedClientRects(this: Range) {
    if (!options.collapsedOnly || this.collapsed) reads += 1
    return clientRects.call(this)
  }
  Range.prototype.getBoundingClientRect = function countedBoundingRect(this: Range) {
    if (!options.collapsedOnly || this.collapsed) reads += 1
    return boundingRect.call(this)
  }
  try {
    run()
  } finally {
    Range.prototype.getClientRects = clientRects
    Range.prototype.getBoundingClientRect = boundingRect
  }
  return reads
}

function countForcedOneRectCodePointReads(text: string): number {
  const restoreRects = retainOneCollapsedRangeRect('first')
  const mounted = mountStandaloneView(text)
  const codePointAt = String.prototype.codePointAt
  let reads = 0
  String.prototype.codePointAt = function countedCodePointAt(this: string, index: number) {
    reads += 1
    return codePointAt.call(this, index)
  }
  try {
    expect(bidiRunsForRow(mounted.internal, mounted.row)).not.toBeNull()
  } finally {
    String.prototype.codePointAt = codePointAt
    restoreRects()
    mounted.dispose()
  }
  return reads
}

function retainOneCollapsedRangeRect(kept: 'first' | 'last'): () => void {
  const getClientRects = Range.prototype.getClientRects
  Range.prototype.getClientRects = function oneCollapsedRangeRect(this: Range) {
    const rects = getClientRects.call(this)
    if (!this.collapsed || rects.length <= 1) return rects

    const index = kept === 'first' ? 0 : rects.length - 1
    const rect = rects.item(index)
    return rect ? oneRectList(rect) : rects
  }
  return () => {
    Range.prototype.getClientRects = getClientRects
  }
}

function oneRectList(rect: DOMRect): DOMRectList {
  const list = [rect] as unknown as DOMRectList & DOMRect[]
  list.item = (index: number) => list[index] ?? null
  return list
}

function countEditorCommandRangeReads(
  mounted: ReturnType<typeof mountBidiEditor>,
  command: Parameters<Editor['dispatchCommand']>[0],
): { readonly moved: boolean; readonly reads: number } {
  let moved = false
  const reads = countRangeReads(() => {
    moved = mounted.editor.dispatchCommand(command)
  })
  return { moved, reads }
}

function assertLogicalWordCursorMoves(mounted: ReturnType<typeof mountBidiEditor>): void {
  const cursorCases = [
    { command: 'cursorWordRight' as const, source: 6, affinity: 'before' as const },
    { command: 'cursorWordPartRight' as const, source: 6, affinity: 'before' as const },
    { command: 'cursorWordLeft' as const, source: 10, affinity: 'after' as const },
    { command: 'cursorWordPartLeft' as const, source: 10, affinity: 'after' as const },
  ]

  for (const testCase of cursorCases) {
    const sourceAffinity = testCase.affinity === 'before' ? 'after' : 'before'
    mounted.session.setSelection(testCase.source, testCase.source, { affinity: sourceAffinity })
    expect(mounted.editor.dispatchCommand(testCase.command)).toBe(true)
    assertMixedBoundaryCaret(mounted, testCase.affinity)
  }
}

function sortedCollapsedCaretXs(
  row: BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']],
  localOffset: number,
): readonly number[] {
  return collapsedRangeOracle(row, localOffset)
    .map((rect) => rect.left)
    .toSorted((left, right) => left - right)
}

const BOUNDARY_TWINS = new Map<string, ReadonlyMap<number, number>>([
  [
    'mixed',
    new Map([
      [8, 12],
      [12, 8],
    ]),
  ],
  [
    'nested',
    new Map([
      [4, 7],
      [7, 4],
    ]),
  ],
  [
    'tabRtl',
    new Map([
      [1, 8],
      [8, 1],
    ]),
  ],
  [
    'override',
    new Map([
      [3, 10],
      [10, 3],
    ]),
  ],
])

function assertInteriorGlyphClicks(
  fixture: BidiGeometryFixture,
  name: keyof typeof BIDI_CORPUS,
): void {
  const row = fixture.rows[name]
  const extent = rowOracleExtent(row)
  const advance = fixture.view.getState().metrics.characterWidth
  for (const glyph of glyphRectOracle(row)) {
    const rect = glyph.rects[0]
    if (!rect || rect.width <= 2) continue
    if (rect.left < extent.left + advance / 2 + 1) continue
    if (rect.left + rect.width > extent.right - advance / 2 - 1) continue
    assertGlyphQuarterClicks(fixture, name, glyph.index, rect)
  }
}

function assertGlyphQuarterClicks(
  fixture: BidiGeometryFixture,
  name: keyof typeof BIDI_CORPUS,
  index: number,
  rect: OracleRect,
): void {
  const row = fixture.rows[name]
  const startXs = collapsedRangeOracle(row, index).map((candidate) => candidate.left)
  const endXs = collapsedRangeOracle(row, index + 1).map((candidate) => candidate.left)
  const startOnLeft = distanceToSet(startXs, rect.left) <= distanceToSet(endXs, rect.left)
  const expectedLeft = row.startOffset + (startOnLeft ? index : index + 1)
  const expectedRight = row.startOffset + (startOnLeft ? index + 1 : index)
  const actualLeft = clickRow(fixture, row, rect.left + rect.width * 0.25)
  const actualRight = clickRow(fixture, row, rect.left + rect.width * 0.75)
  expectOffsetOrTwin(name, actualLeft, expectedLeft, row.startOffset)
  expectOffsetOrTwin(name, actualRight, expectedRight, row.startOffset)
}

function expectOffsetOrTwin(
  name: keyof typeof BIDI_CORPUS,
  actual: number | null,
  expected: number,
  rowStart: number,
): void {
  const localExpected = expected - rowStart
  const twin = BOUNDARY_TWINS.get(name)?.get(localExpected)
  const allowed = twin === undefined ? [expected] : [expected, rowStart + twin]
  expect(allowed, `${name} expected local ${localExpected}, got ${actual}`).toContain(actual)
}

function assertRtlEdgeClicks(
  fixture: BidiGeometryFixture,
  name: 'pureHebrew' | 'pureArabic' | 'nested',
): void {
  const row = fixture.rows[name]
  const extent = rowOracleExtent(row)
  const advance = fixture.view.getState().metrics.characterWidth
  const left = clickRow(fixture, row, extent.left + advance * 0.25)
  const right = clickRow(fixture, row, extent.right - advance * 0.25)
  expect(left).toBe(row.endOffset)
  expect(right).toBe(row.startOffset)
  expect(offsetToX(fixture.internal, row, left!)).toBeCloseTo(extent.left, 0)
  expect(offsetToX(fixture.internal, row, right!)).toBeCloseTo(extent.right, 0)
}

function assertEngineTriggerBand(
  fixture: BidiGeometryFixture,
  name: keyof typeof BIDI_CORPUS,
): void {
  const row = fixture.rows[name]
  const extent = rowOracleExtent(row)
  const advance = fixture.view.getState().metrics.characterWidth
  let farHits = 0
  for (let x = extent.left; x <= extent.right; x += 0.25) {
    const engine = engineClickRow(fixture, row, x)
    if (engine === null) continue
    const positions = boundaryPositionXs(fixture.internal, row, engine)
    const followingWidth = unitRectForOffset(fixture.internal, row, engine)?.width ?? 0
    const precedingWidth = unitRectForOffset(fixture.internal, row, engine - 1)?.width ?? 0
    if (distanceToSet(positions, x) <= Math.max(advance, followingWidth, precedingWidth)) continue
    farHits += 1
    expect(triggerExpectedFor(name), `${name} fired at ${x}`).toBe(true)
    expect(Math.min(x - extent.left, extent.right - x)).toBeLessThanOrEqual(advance / 2 + 1)
  }

  expect(farHits > 0).toBe(triggerExpectedFor(name))
}

function triggerExpectedFor(name: keyof typeof BIDI_CORPUS): boolean {
  return name === 'pureHebrew' || name === 'pureArabic' || name === 'nested' || name === 'tabRtl'
}

function assertOracleEdgeClicks(
  fixture: BidiGeometryFixture,
  name: keyof typeof BIDI_CORPUS,
): void {
  const row = fixture.rows[name]
  const extent = rowOracleExtent(row)
  const advance = fixture.view.getState().metrics.characterWidth
  const expectedLeft = oracleExtremalOffset(row, extent.left)
  const expectedRight = oracleExtremalOffset(row, extent.right)
  expect(clickRow(fixture, row, extent.left + advance * 0.25)).toBe(expectedLeft)
  expect(clickRow(fixture, row, extent.right - advance * 0.25)).toBe(expectedRight)
}

function oracleExtremalOffset(
  row: BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']],
  edge: number,
): number {
  for (let local = 0; local <= row.text.length; local += 1) {
    const positions = collapsedRangeOracle(row, local)
    if (positions.some((rect) => Math.abs(rect.left - edge) <= 1)) return row.startOffset + local
  }
  throw new Error(`no boundary at visual edge ${edge}`)
}

function clickRow(
  fixture: BidiGeometryFixture,
  row: BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']],
  localX: number,
): number | null {
  const point = rowClientPoint(row, localX)
  return fixture.view.textOffsetFromPoint(point.x, point.y)
}

function engineClickRow(
  fixture: BidiGeometryFixture,
  row: BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']],
  localX: number,
): number | null {
  const point = rowClientPoint(row, localX)
  const position = document.caretPositionFromPoint(point.x, point.y)
  if (!position) return null
  return fixture.view.textOffsetFromDomBoundary(position.offsetNode, position.offset)
}

function rowClientPoint(
  row: BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']],
  localX: number,
): { readonly x: number; readonly y: number } {
  const rect = row.element.getBoundingClientRect()
  const scale = row.element.offsetWidth > 0 ? rect.width / row.element.offsetWidth : 1
  return { x: rect.left + localX * scale, y: rect.top + rect.height / 2 }
}

function renderedGlyphPoint(
  row: BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']],
  localIndex: number,
  fraction: number,
): { readonly x: number; readonly y: number } {
  const part = row.chunks
    .flatMap((chunk) => chunk.parts)
    .find(
      (candidate) =>
        candidate.kind === 'text' &&
        candidate.localStart <= localIndex &&
        candidate.localEnd >= localIndex + 1,
    )
  if (!part || part.kind !== 'text') throw new Error(`glyph ${localIndex} has no text part`)

  const range = row.element.ownerDocument.createRange()
  range.setStart(part.node, localIndex - part.localStart)
  range.setEnd(part.node, localIndex + 1 - part.localStart)
  const rect = range.getBoundingClientRect()
  return {
    x: rect.left + rect.width * fraction,
    y: rect.top + rect.height / 2,
  }
}

function nativeTextOffsets(
  view: VirtualizedTextView,
  points: readonly { readonly x: number; readonly y: number }[],
): readonly (number | null)[] {
  return points.map((point) => {
    const position = document.caretPositionFromPoint(point.x, point.y)
    if (!position) return null
    return view.textOffsetFromDomBoundary(position.offsetNode, position.offset)
  })
}

function textOffsetsAtPoints(
  view: VirtualizedTextView,
  points: readonly { readonly x: number; readonly y: number }[],
): readonly (number | null)[] {
  return points.map((point) => view.textOffsetFromPoint(point.x, point.y))
}

function caretStates(
  values: readonly (readonly [number, 'before' | 'after'])[],
): readonly CaretState[] {
  return values.map(([offset, affinity]) => ({ offset, affinity }))
}

function simpleLtrVisualPath(length: number): VisualCaretPath {
  return {
    right: [
      { offset: 0, affinity: 'after' },
      ...Array.from({ length }, (_value, index) => ({
        offset: index + 1,
        affinity: 'before' as const,
      })),
    ],
    left: [
      { offset: length, affinity: 'before' },
      ...Array.from({ length }, (_value, index) => ({
        offset: length - index - 1,
        affinity: 'after' as const,
      })),
    ],
  }
}

function simpleRtlVisualPath(length: number): VisualCaretPath {
  return {
    right: [
      { offset: length, affinity: 'before' },
      ...Array.from({ length }, (_value, index) => ({
        offset: length - index - 1,
        affinity: 'after' as const,
      })),
    ],
    left: [
      { offset: 0, affinity: 'after' },
      ...Array.from({ length }, (_value, index) => ({
        offset: index + 1,
        affinity: 'before' as const,
      })),
    ],
  }
}

function assertVisualCaretPath(
  name: (typeof BIDI_CORPUS_NAMES)[number],
  direction: 'left' | 'right',
  path: readonly CaretState[],
): void {
  const initial = path[0]
  expect(initial).toBeDefined()
  const mounted = mountBidiEditor(BIDI_CORPUS[name], initial, { rtlMoveVisually: true })
  try {
    let previousX = primaryCaretLeft(mounted.container)
    for (const expected of path.slice(1)) {
      expect(
        mounted.editor.dispatchCommand(direction === 'left' ? 'cursorLeft' : 'cursorRight'),
      ).toBe(true)
      expect(resolvedPrimary(mounted.session), `${name} ${direction}`).toMatchObject({
        headOffset: expected.offset,
        affinity: expected.affinity,
      })

      const x = primaryCaretLeft(mounted.container)
      expectCaretAdvanced(name, direction, previousX, x)
      previousX = x
    }
  } finally {
    mounted.dispose()
  }
}

function expectCaretAdvanced(
  name: (typeof BIDI_CORPUS_NAMES)[number],
  direction: 'left' | 'right',
  previousX: number,
  x: number,
): void {
  if (direction === 'left') {
    expect(x, `${name} Left`).toBeLessThan(previousX - 1)
    return
  }
  expect(x, `${name} Right`).toBeGreaterThan(previousX + 1)
}

function assertNestedSelectionStep(
  mounted: ReturnType<typeof mountBidiEditor>,
  expected: CaretState,
  sevenAfterX: number | null,
): number | null {
  expect(mounted.editor.dispatchCommand('selectRight')).toBe(true)
  expect(resolvedPrimary(mounted.session)).toMatchObject({
    anchorOffset: 11,
    headOffset: expected.offset,
    affinity: expected.affinity,
  })
  if (expected.offset !== 7) return sevenAfterX

  assertPaintedSelectionRects(mounted.row, mergedRangeOracle(mounted.row, 7, 11))
  const x = primaryCaretLeft(mounted.container)
  if (expected.affinity === 'after') return x

  expect(sevenAfterX).not.toBeNull()
  expect(Math.abs(x - sevenAfterX!)).toBeGreaterThan(1)
  return sevenAfterX
}

function primaryCaretLeft(container: HTMLElement): number {
  return primaryCaretElement(container).getBoundingClientRect().left
}

function primaryCaretTop(container: HTMLElement): number {
  return new DOMMatrix(primaryCaretElement(container).style.transform).m42
}

function assertMixedBoundaryCaret(
  mounted: ReturnType<typeof mountBidiEditor>,
  affinity: 'before' | 'after',
): void {
  const positions = collapsedRangeOracle(mounted.row, 8)
    .map((rect) => rect.left)
    .toSorted((left, right) => left - right)
  expect(positions).toHaveLength(2)
  const expectedX = affinity === 'before' ? positions[0]! : positions[1]!
  expect(resolvedPrimary(mounted.session)).toMatchObject({
    collapsed: true,
    headOffset: mounted.row.startOffset + 8,
    affinity,
  })

  const rowLeft = mounted.row.element.getBoundingClientRect().left
  expect(primaryCaretLeft(mounted.container) - rowLeft).toBeCloseTo(expectedX, 0)
}

function boundaryHitPoint(
  mounted: ReturnType<typeof mountBidiEditor>,
  localOffset: number,
  affinity: 'before' | 'after',
): { readonly x: number; readonly y: number } {
  const row = mounted.view.getState().mountedRows[0]!
  const localXs = collapsedRangeOracle(row, localOffset).flatMap((rect) =>
    [-0.5, -0.25, 0, 0.25, 0.5].map((delta) => rect.left + delta),
  )
  for (const localX of localXs) {
    const point = rowClientPoint(row, localX)
    const position = mounted.view.textPositionFromPoint(point.x, point.y)
    if (position?.offset !== row.startOffset + localOffset) continue
    if (position.affinity !== affinity) continue
    return point
  }
  throw new Error(`no ${affinity} hit for local offset ${localOffset}`)
}

function sourceBoundaryHitPoint(
  mounted: ReturnType<typeof mountBidiEditor>,
  row: BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']],
  offset: number,
  affinity: 'before' | 'after',
): { readonly x: number; readonly y: number } {
  const internal = Reflect.get(mounted.view, 'view') as BidiGeometryFixture['internal']
  const localXs = boundaryPositionXs(internal, row, offset).flatMap((x) =>
    [-0.5, -0.25, 0, 0.25, 0.5].map((delta) => x + delta),
  )
  for (const localX of localXs) {
    const point = rowClientPoint(row, localX)
    const position = mounted.view.textPositionFromPoint(point.x, point.y)
    if (position?.offset !== offset) continue
    if (position.affinity !== affinity) continue
    return point
  }
  throw new Error(`no ${affinity} hit for source offset ${offset}`)
}

function assertBoundaryCaret(
  mounted: ReturnType<typeof mountBidiEditor>,
  row: BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']],
  localOffset: number,
  affinity: 'before' | 'after',
): void {
  const positions = collapsedRangeOracle(row, localOffset)
    .map((rect) => rect.left)
    .toSorted((left, right) => left - right)
  expect(positions).toHaveLength(2)
  const expectedX = affinity === 'before' ? positions[0]! : positions[1]!
  const rowLeft = row.element.getBoundingClientRect().left
  expect(primaryCaretLeft(mounted.container) - rowLeft).toBeCloseTo(expectedX, 0)
}

function assertVerticalCaretNearestBrowserX(
  mounted: ReturnType<typeof mountBidiEditor>,
  row: BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']],
  goalX: number,
): void {
  const resolved = resolvedPrimary(mounted.session)
  expect(resolved.headOffset).toBeGreaterThanOrEqual(row.startOffset)
  expect(resolved.headOffset).toBeLessThanOrEqual(row.endOffset)
  const oracle = collapsedRangeOracle(row, resolved.headOffset - row.startOffset).map(
    (rect) => rect.left,
  )
  const closestDistance = closestBrowserBoundaryDistance(row, goalX)
  expect(distanceToSet(oracle, goalX)).toBeCloseTo(closestDistance, 1)

  const paintedX = primaryCaretLeft(mounted.container) - row.element.getBoundingClientRect().left
  expect(distanceToSet(oracle, paintedX)).toBeLessThanOrEqual(1)
  expect(Math.abs(paintedX - goalX)).toBeCloseTo(closestDistance, 1)
  expect(resolved.goal).toMatchObject({ kind: 'horizontal', x: goalX })
}

function closestBrowserBoundaryDistance(
  row: BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']],
  goalX: number,
): number {
  let closest = Number.POSITIVE_INFINITY
  for (let offset = 0; offset <= row.text.length; offset += 1) {
    const oracle = collapsedRangeOracle(row, offset).map((rect) => rect.left)
    closest = Math.min(closest, distanceToSet(oracle, goalX))
  }
  return closest
}

function assertVerticalSelectionStep(
  mounted: ReturnType<typeof mountBidiEditor>,
  row: BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']],
  goalX: number,
  command: 'selectDown' | 'selectUp',
  anchorOffset: number,
): void {
  expect(mounted.editor.dispatchCommand(command)).toBe(true)
  expect(resolvedPrimary(mounted.session).anchorOffset).toBe(anchorOffset)
  assertVerticalCaretNearestBrowserX(mounted, row, goalX)

  const head = resolvedPrimary(mounted.session).headOffset - row.startOffset
  assertPaintedSelectionRects(row, mergedRangeOracle(row, 0, head))
}

function mountedDocumentRow(
  mounted: ReturnType<typeof mountBidiEditor>,
  index: number,
): BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']] {
  const row = mounted.view.getState().mountedRows.find((candidate) => candidate.index === index)
  expect(row).toBeDefined()
  return row!
}

function verticalResultForOption(rtlMoveVisually: boolean): {
  readonly affinity: 'before' | 'after'
  readonly goal: ReturnType<typeof resolvedPrimary>['goal']
  readonly headOffset: number
} {
  const lines = [BIDI_CORPUS.latin, BIDI_CORPUS.nested]
  const mounted = mountBidiEditor(
    lines.join('\n'),
    { offset: 4, affinity: 'after' },
    { rtlMoveVisually },
    { height: lines.length * 24 },
  )
  try {
    const source = mounted.view.getState().mountedRows[0]!
    const goalX = primaryCaretLeft(mounted.container) - source.element.getBoundingClientRect().left
    expect(mounted.editor.dispatchCommand('cursorDown')).toBe(true)
    const target = mounted.view.getState().mountedRows[1]!
    assertVerticalCaretNearestBrowserX(mounted, target, goalX)
    const resolved = resolvedPrimary(mounted.session)
    return { affinity: resolved.affinity, goal: resolved.goal, headOffset: resolved.headOffset }
  } finally {
    mounted.dispose()
  }
}

function primaryCaretElement(container: HTMLElement): HTMLElement {
  const caret = visibleCaretElements(container)[0]
  expect(caret).toBeDefined()
  return caret!
}

function mountBidiEditor(
  text: string,
  selection?: { readonly offset: number; readonly affinity: 'before' | 'after' },
  options: EditorOptions = {},
  viewport: { readonly height?: number; readonly width?: number } = {},
) {
  const height = viewport.height ?? 24
  const width = viewport.width ?? 600
  const container = document.createElement('div')
  container.style.display = 'flex'
  container.style.height = `${height}px`
  container.style.width = `${width}px`
  document.body.append(container)

  const session = createDocumentSession(text)
  if (selection) {
    session.setSelection(selection.offset, selection.offset, { affinity: selection.affinity })
  }
  const editor = new Editor(container, options)
  editor.attachSession(session)
  const view = Reflect.get(editor, 'view') as VirtualizedTextView
  view.setScrollMetrics(0, height, width)
  view.focusInput()
  const row = view.getState().mountedRows[0]
  expect(row).toBeDefined()

  return {
    container,
    editor,
    row: row!,
    session,
    view,
    dispose: () => {
      editor.dispose()
      container.remove()
    },
  }
}

function dispatchDragMouse(
  type: 'mousemove' | 'mouseup',
  point: { readonly x: number; readonly y: number },
): void {
  document.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: type === 'mousemove' ? 1 : 0,
      clientX: point.x,
      clientY: point.y,
    }),
  )
}

function resolvedPrimary(session: ReturnType<typeof createDocumentSession>) {
  const selection = session.getSelections().selections[0]
  expect(selection).toBeDefined()
  return resolveSelection(session.getSnapshot(), selection!)
}

function rowOracleExtent(row: BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']]): {
  readonly left: number
  readonly right: number
} {
  const rects = mergedRangeOracle(row, 0, row.text.length)
  return {
    left: Math.min(...rects.map((rect) => rect.left)),
    right: Math.max(...rects.map((rect) => rect.left + rect.width)),
  }
}

function distanceToSet(xs: readonly number[], target: number): number {
  return Math.min(...xs.map((x) => Math.abs(x - target)))
}

function withCaretPositionFromPointDisabled(run: () => void): void {
  const own = Object.getOwnPropertyDescriptor(document, 'caretPositionFromPoint')
  Object.defineProperty(document, 'caretPositionFromPoint', {
    configurable: true,
    value: undefined,
  })
  try {
    run()
  } finally {
    if (own) Object.defineProperty(document, 'caretPositionFromPoint', own)
    else delete (document as { caretPositionFromPoint?: unknown }).caretPositionFromPoint
  }
}

function withCaretHitTestingDisabled<T>(run: () => T): T {
  const position = Object.getOwnPropertyDescriptor(document, 'caretPositionFromPoint')
  const range = Object.getOwnPropertyDescriptor(document, 'caretRangeFromPoint')
  Object.defineProperty(document, 'caretPositionFromPoint', {
    configurable: true,
    value: undefined,
  })
  Object.defineProperty(document, 'caretRangeFromPoint', {
    configurable: true,
    value: undefined,
  })
  try {
    return run()
  } finally {
    restoreDocumentProperty('caretPositionFromPoint', position)
    restoreDocumentProperty('caretRangeFromPoint', range)
  }
}

function textOffsetsWithCaretHitTestingDisabled(
  view: VirtualizedTextView,
  points: Parameters<typeof textOffsetsAtPoints>[1],
): ReturnType<typeof textOffsetsAtPoints> {
  return withCaretHitTestingDisabled(() => textOffsetsAtPoints(view, points))
}

function restoreDocumentProperty(name: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(document, name, descriptor)
    return
  }

  delete (document as unknown as Record<string, unknown>)[name]
}

function withCaretPositionFromPointResult(
  result: { readonly node: Node; readonly offset: number },
  run: () => void,
): void {
  const own = Object.getOwnPropertyDescriptor(document, 'caretPositionFromPoint')
  Object.defineProperty(document, 'caretPositionFromPoint', {
    configurable: true,
    value: () => ({ offsetNode: result.node, offset: result.offset }),
  })
  try {
    run()
  } finally {
    if (own) Object.defineProperty(document, 'caretPositionFromPoint', own)
    else delete (document as { caretPositionFromPoint?: unknown }).caretPositionFromPoint
  }
}

function withFirstCaretPositionFromPointResult(
  result: { readonly node: Node; readonly offset: number },
  run: () => void,
): void {
  const own = Object.getOwnPropertyDescriptor(document, 'caretPositionFromPoint')
  const caretPositionFromPoint = document.caretPositionFromPoint.bind(document)
  let first = true
  Object.defineProperty(document, 'caretPositionFromPoint', {
    configurable: true,
    value: (x: number, y: number) => {
      if (!first) return caretPositionFromPoint(x, y)

      first = false
      return { offsetNode: result.node, offset: result.offset }
    },
  })
  try {
    run()
  } finally {
    restoreDocumentProperty('caretPositionFromPoint', own)
  }
}

function mountLongRtlView(): {
  readonly container: HTMLElement
  readonly view: VirtualizedTextView
  readonly row: BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']]
} {
  const container = document.createElement('div')
  container.style.font = '14px monospace'
  container.style.height = '20px'
  container.style.width = '600px'
  document.body.append(container)
  const view = new VirtualizedTextView(container, {
    rowHeight: 20,
    overscan: 0,
    longLineChunkThreshold: 7_000,
  })
  view.setText('א'.repeat(6_000))
  view.setScrollMetrics(0, 20, 600)
  return { container, view, row: view.getState().mountedRows[0]! }
}

type StandaloneView = {
  readonly container: HTMLElement
  readonly view: VirtualizedTextView
  readonly internal: BidiGeometryFixture['internal']
  readonly row: BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']]
  dispose(): void
}

function mountInlineWidgetView(
  text: string,
  startIndex: number,
  endIndex: number,
  id: string,
): StandaloneView {
  const mounted = mountStandaloneView(text)
  mounted.view.setInlineMap(
    createInlineMap(createPieceTableSnapshot(text), [
      {
        id,
        startIndex,
        endIndex,
        text: 'W',
        render: (host) => {
          const box = host.ownerDocument.createElement('span')
          box.style.display = 'inline-block'
          box.style.height = '1em'
          box.style.width = '1em'
          host.append(box)
          return { dispose: () => {} }
        },
      },
    ]),
  )
  return mounted
}

function mountRecyclingRtlView(): StandaloneView {
  const lines = Array.from({ length: 80 }, () => BIDI_CORPUS.pureHebrew)
  return mountStandaloneView(lines.join('\n'))
}

function assertRecycledExtremalOffset(mounted: StandaloneView): void {
  const original = mounted.view.getState().mountedRows[0]!
  const element = original.element
  clickRowAtVisualLeft(mounted.view, original)

  mounted.view.scrollElement.scrollTop = 40 * 20
  mounted.view.setScrollMetrics(40 * 20, 20, 600)
  const recycled = mounted.view
    .getState()
    .mountedRows.find((candidate) => candidate.element === element)
  if (!recycled) throw new Error('RTL row element was not recycled')

  expect(clickRowAtVisualLeft(mounted.view, recycled)).toBe(recycled.endOffset)
}

function clickRowAtVisualLeft(
  view: VirtualizedTextView,
  row: BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']],
): number | null {
  const extent = rowOracleExtent(row)
  const point = rowClientPoint(row, extent.left + view.getState().metrics.characterWidth * 0.25)
  const viewport = view.scrollElement.getBoundingClientRect()
  return view.textOffsetFromPoint(point.x, viewport.top + 10)
}

function mountStandaloneView(text: string, threshold = 4_096, scale = 1): StandaloneView {
  const container = document.createElement('div')
  container.style.font = '14px monospace'
  container.style.height = '20px'
  container.style.width = '600px'
  if (scale !== 1) {
    container.style.transformOrigin = '0 0'
    container.style.transform = `scale(${scale})`
  }
  document.body.append(container)
  const view = new VirtualizedTextView(container, {
    rowHeight: 20,
    overscan: 0,
    longLineChunkThreshold: threshold,
  })
  view.setText(text)
  view.setScrollMetrics(0, 20, 600)
  return {
    container,
    view,
    internal: Reflect.get(view, 'view') as BidiGeometryFixture['internal'],
    row: view.getState().mountedRows[0]!,
    dispose: () => {
      view.dispose()
      container.remove()
    },
  }
}

function assertEndpointPlaceholder(
  mounted: StandaloneView,
  text: string,
  refusal: 'line-length' | 'grapheme-length',
): void {
  const placeholder = mounted.row.element.querySelector<HTMLElement>(
    '[data-editor-bidi-line-length]',
  )
  expect(mounted.row.textRenderMode).toBe('widget')
  expect(mounted.row.chunks).toHaveLength(1)
  expect(mounted.row.chunks[0]!.parts).toHaveLength(2)
  expect(mounted.row.chunks[0]!.parts.every((part) => part.kind === 'widget')).toBe(true)
  expect(placeholder?.dataset.editorBidiLineLength).toBe(String(text.length))
  expect(placeholder?.dataset.editorBidiMeasurementRefusal).toBe(refusal)
  expect(placeholder?.querySelectorAll('[data-editor-bidi-endpoint]')).toHaveLength(2)

  const rect = placeholder!.getBoundingClientRect()
  const y = rect.top + rect.height / 2
  expect(mounted.view.textOffsetFromPoint(rect.left + 1, y)).toBe(0)
  expect(mounted.view.textOffsetFromPoint(rect.right - 1, y)).toBe(text.length)
}

function assertBoundedTextParts(
  row: BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']],
  text: string,
): void {
  const parts = row.chunks[0]!.parts.filter((part) => part.kind === 'text')
  expect(parts.length).toBeGreaterThan(1)
  expect(parts.map((part) => part.node.data).join('')).toBe(text)
  for (const part of parts) expect(part.node.length).toBeLessThanOrEqual(50)
}

function assertTextPartBoundary(
  part: BidiGeometryFixture['rows'][keyof BidiGeometryFixture['rows']]['chunks'][number]['parts'][number],
): void {
  if (part.kind !== 'text' || part.node.length === 0) return
  const first = part.node.data.charCodeAt(0)
  const last = part.node.data.charCodeAt(part.node.length - 1)
  expect(first < 0xdc00 || first > 0xdfff).toBe(true)
  expect(last < 0xd800 || last > 0xdbff).toBe(true)
  expect(/^\p{Mark}/u.test(part.node.data)).toBe(false)
}
