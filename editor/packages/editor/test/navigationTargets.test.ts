import { describe, expect, it, vi } from 'vitest'

import { createDocumentTextSnapshot, type TextSnapshot } from '../src/documentTextSnapshot'
import type { EditorCommandId } from '../src/editor/commands'
import {
  createNavigationLineReader,
  defaultRtlMoveVisually,
  navigationTargetForCommand,
  verticalMoveGoal,
  type NavigationTarget,
} from '../src/editor/navigationTargets'
import { createPieceTableSnapshot } from '@singapore-editor/textbuffer'
import { SelectionGoal, type ResolvedSelection, type SelectionAffinity } from '../src/selections'
import { lineRangeAtOffset, wordSeparatorsForLanguage } from '../src/textRanges'

/** A resolved selection over [anchor, head]; collapsed when they match. */
function selection(
  anchor: number,
  head = anchor,
  goal: SelectionGoal = SelectionGoal.none(),
  affinity: SelectionAffinity = 'after',
): ResolvedSelection {
  return {
    id: `sel:${anchor}:${head}`,
    startOffset: Math.min(anchor, head),
    endOffset: Math.max(anchor, head),
    anchorOffset: anchor,
    headOffset: head,
    reversed: head < anchor,
    collapsed: anchor === head,
    goal,
    affinity,
    liveness: 'live',
    startLiveness: 'live',
    endLiveness: 'live',
  }
}

/** A view over unwrapped rows, where a display row and a buffer line are the same thing. */
function createTestView(text: string) {
  const characterWidth = 10
  const lineStarts = [0, ...[...text].flatMap((char, index) => (char === '\n' ? [index + 1] : []))]
  const rowForOffset = (offset: number) => lineStarts.findLastIndex((start) => start <= offset)
  const offsetByDisplayRows = (offset: number, rowDelta: number, goalColumn: number) => {
    const row = Math.min(Math.max(rowForOffset(offset) + rowDelta, 0), lineStarts.length - 1)
    const start = lineStarts[row] ?? 0
    return start + Math.min(goalColumn, lineRangeAtOffset(text, start).end - start)
  }

  return {
    offsetAtLineBoundary: (offset: number, boundary: 'start' | 'end') => {
      const range = lineRangeAtOffset(text, offset)
      return boundary === 'start' ? range.start : range.end
    },
    caretXForOffset: (offset: number) =>
      (offset - lineRangeAtOffset(text, offset).start) * characterWidth,
    offsetByDisplayRows,
    pageRowDelta: () => 10,
    verticalCaretTarget: (
      offset: number,
      _affinity: SelectionAffinity,
      rowDelta: number,
      goal: Exclude<SelectionGoal, { readonly kind: 'none' }>,
    ) => {
      const column = goal.kind === 'lineEnd' ? Number.MAX_SAFE_INTEGER : goal.x / characterWidth
      const target = offsetByDisplayRows(offset, rowDelta, column)
      const end = lineRangeAtOffset(text, target).end
      return { offset: target, affinity: target >= end ? ('before' as const) : ('after' as const) }
    },
    visualHorizontalTarget: (
      _offset: number,
      _affinity: SelectionAffinity,
      _direction: 'left' | 'right',
    ): { readonly offset: number; readonly affinity: SelectionAffinity } | null => null,
  }
}

/** A view that soft-wraps every buffer line into display rows of a fixed width. */
function createWrappedTestView(text: string, rowWidth: number) {
  return {
    ...createTestView(text),
    offsetAtLineBoundary: (offset: number, boundary: 'start' | 'end') => {
      const line = lineRangeAtOffset(text, offset)
      const rowStart = line.start + Math.floor((offset - line.start) / rowWidth) * rowWidth
      return boundary === 'start' ? rowStart : Math.min(rowStart + rowWidth, line.end)
    },
  }
}

function targets(
  text: string,
  view = createTestView(text),
  rtlMoveVisually = false,
  nonCaretRows: ReadonlySet<number> = new Set(),
) {
  const snapshot = createPieceTableSnapshot(text)
  const nonCaretOffset = (offset: number) =>
    nonCaretRows.has(text.slice(0, offset).split('\n').length - 1)

  return (
    command: EditorCommandId,
    resolved: ResolvedSelection,
    wordSeparators?: string,
  ): NavigationTarget | null =>
    navigationTargetForCommand({
      command,
      resolved,
      readLine: createNavigationLineReader(snapshot, createDocumentTextSnapshot(snapshot)),
      documentLength: snapshot.length,
      rtlMoveVisually,
      wordSeparators,
      view,
      nonCaretOffset,
    })
}

/** Runs several selections through one command, which is what shares a single line reader. */
function targetsForSelections(text: string) {
  const snapshot = createPieceTableSnapshot(text)
  const view = createTestView(text)
  const readLine = createNavigationLineReader(snapshot, createDocumentTextSnapshot(snapshot))

  return (command: EditorCommandId, resolvedSelections: readonly ResolvedSelection[]) =>
    resolvedSelections.map(
      (resolved) =>
        navigationTargetForCommand({
          command,
          resolved,
          readLine,
          documentLength: snapshot.length,
          rtlMoveVisually: false,
          view,
        })?.offset ?? null,
    )
}

const MEASURED_LINE = 'const alpha = beta'

/** Characters pulled out of the buffer while one caret move is resolved. */
function charactersReadForCaretMove(lineCount: number): number {
  const text = Array.from({ length: lineCount }, () => MEASURED_LINE).join('\n')
  const snapshot = createPieceTableSnapshot(text)
  const source = createDocumentTextSnapshot(snapshot)
  let charactersRead = 0
  const counted: TextSnapshot = {
    length: source.length,
    lineCount: source.lineCount,
    lineStart: (line) => source.lineStart(line),
    lineRange: (line) => source.lineRange(line),
    lineAt: (offset) => source.lineAt(offset),
    readRange: (start, end) => {
      const value = source.readRange(start, end)
      charactersRead += value.length
      return value
    },
    materializeFullText: () => {
      const value = source.materializeFullText()
      charactersRead += value.length
      return value
    },
    forEachTextChunk: (visit) => source.forEachTextChunk(visit),
  }

  navigationTargetForCommand({
    command: 'cursorRight',
    resolved: selection(Math.floor(text.length / 2)),
    readLine: createNavigationLineReader(snapshot, counted),
    documentLength: snapshot.length,
    rtlMoveVisually: false,
    view: createTestView(text),
  })

  return charactersRead
}

describe('navigation reads', () => {
  it('costs one line per caret move however long the document is', () => {
    const short = charactersReadForCaretMove(20)
    const long = charactersReadForCaretMove(20_000)

    expect(long).toBe(short)
    expect(long).toBeLessThanOrEqual(MEASURED_LINE.length)
  })

  it('gives a caret at the start of a line the line it is on, not the one that ends there', () => {
    const move = targetsForSelections('alpha beta\ngamma delta')

    expect(move('cursorWordRight', [selection(10), selection(11)])).toEqual([10, 17])
  })
})

describe('word navigation', () => {
  const text = 'alpha beta\ngamma delta'

  it('stops at the end of a line rather than continuing onto the next', () => {
    const move = targets(text)

    expect(move('cursorWordRight', selection(10))?.offset).toBe(10)
    expect(move('cursorWordLeft', selection(11))?.offset).toBe(11)
  })

  it('still steps over the line break one character at a time', () => {
    const move = targets(text)

    expect(move('cursorRight', selection(10))).toMatchObject({ offset: 11, affinity: 'before' })
    expect(move('cursorLeft', selection(11))).toMatchObject({ offset: 10, affinity: 'after' })
  })

  it('stays put at either end of the document rather than stepping past it', () => {
    const move = targets(text)

    expect(move('cursorLeft', selection(0))).toMatchObject({ offset: 0, affinity: 'after' })
    expect(move('cursorRight', selection(text.length))).toMatchObject({
      offset: text.length,
      affinity: 'before',
    })
  })

  it('follows the separator set the language declares', () => {
    const move = targets('--brand-color: red')

    expect(move('cursorWordRight', selection(0))?.offset).toBe(2)
    expect(move('cursorWordRight', selection(0), wordSeparatorsForLanguage('css'))?.offset).toBe(13)
  })

  it('stays in logical document order when character-step motion is visual', () => {
    const bidiText = 'let x = שלום world'
    const visualHorizontalTarget = vi.fn(() => ({ offset: 0, affinity: 'after' as const }))
    const view = {
      ...createTestView(bidiText),
      visualHorizontalTarget,
    }
    const move = targets(bidiText, view, true)
    const logicalMove = targets(bidiText)
    const cases = [
      { command: 'cursorWordLeft' as const, extend: false, source: 10, affinity: 'after' },
      { command: 'cursorWordRight' as const, extend: false, source: 6, affinity: 'before' },
      { command: 'selectWordLeft' as const, extend: true, source: 10, affinity: 'after' },
      { command: 'selectWordRight' as const, extend: true, source: 6, affinity: 'before' },
      { command: 'cursorWordPartLeft' as const, extend: false, source: 10, affinity: 'after' },
      { command: 'cursorWordPartRight' as const, extend: false, source: 6, affinity: 'before' },
      { command: 'cursorWordPartLeftSelect' as const, extend: true, source: 10, affinity: 'after' },
      {
        command: 'cursorWordPartRightSelect' as const,
        extend: true,
        source: 6,
        affinity: 'before',
      },
    ]

    for (const testCase of cases) {
      const sourceAffinity = testCase.affinity === 'before' ? 'after' : 'before'
      const origin = selection(
        testCase.source,
        testCase.source,
        SelectionGoal.none(),
        sourceAffinity,
      )
      const target = move(testCase.command, origin)
      expect(target).toEqual(logicalMove(testCase.command, origin))
      expect(target).toMatchObject({
        affinity: testCase.affinity,
        extend: testCase.extend,
        offset: 8,
      })
    }
    expect(visualHorizontalTarget).not.toHaveBeenCalled()
  })
})

describe('visual horizontal navigation', () => {
  it('defaults to visual motion on macOS and Linux but not Windows', () => {
    expect(defaultRtlMoveVisually('mac')).toBe(true)
    expect(defaultRtlMoveVisually('linux')).toBe(true)
    expect(defaultRtlMoveVisually('windows')).toBe(false)
  })

  it('carries the view target and affinity for cursor and selection commands', () => {
    const calls: { offset: number; affinity: SelectionAffinity; direction: string }[] = []
    const view = {
      ...createTestView('אבג'),
      visualHorizontalTarget: (
        offset: number,
        affinity: SelectionAffinity,
        direction: 'left' | 'right',
      ) => {
        calls.push({ offset, affinity, direction })
        return { offset: 2, affinity: 'before' as const }
      },
    }
    const move = targets('אבג', view, true)

    for (const command of ['cursorLeft', 'selectLeft'] as const) {
      expect(move(command, selection(1, 1, SelectionGoal.none(), 'before'))).toMatchObject({
        offset: 2,
        affinity: 'before',
        extend: command === 'selectLeft',
      })
    }
    for (const command of ['cursorRight', 'selectRight'] as const) {
      expect(move(command, selection(1, 1, SelectionGoal.none(), 'before'))).toMatchObject({
        offset: 2,
        affinity: 'before',
        extend: command === 'selectRight',
      })
    }

    expect(calls).toEqual([
      { offset: 1, affinity: 'before', direction: 'left' },
      { offset: 1, affinity: 'before', direction: 'left' },
      { offset: 1, affinity: 'before', direction: 'right' },
      { offset: 1, affinity: 'before', direction: 'right' },
    ])
  })

  it('keeps the logical path exact when visual motion is disabled or unavailable', () => {
    const disabledView = {
      ...createTestView('אבג'),
      visualHorizontalTarget: () => {
        throw new TypeError('visual motion must stay disabled')
      },
    }
    const disabled = targets('אבג', disabledView, false)
    expect(disabled('cursorRight', selection(1))).toEqual({
      offset: 2,
      affinity: 'before',
      extend: false,
      timingName: 'input.cursorRight',
    })

    const unavailable = targets('אבג', createTestView('אבג'), true)
    expect(unavailable('cursorLeft', selection(2))).toEqual({
      offset: 1,
      affinity: 'after',
      extend: false,
      timingName: 'input.cursorLeft',
    })
  })

  it('collapses a nonempty selection logically and leaves Home and End unchanged', () => {
    let calls = 0
    const view = {
      ...createTestView('אבגדה'),
      visualHorizontalTarget: () => {
        calls += 1
        return { offset: 4, affinity: 'before' as const }
      },
    }
    const move = targets('אבגדה', view, true)

    expect(move('cursorLeft', selection(1, 3))).toMatchObject({ offset: 1, affinity: 'after' })
    expect(move('cursorRight', selection(1, 3))).toMatchObject({ offset: 3, affinity: 'before' })
    expect(move('cursorLineStart', selection(2))?.offset).toBe(0)
    expect(move('cursorLineEnd', selection(2))?.offset).toBe(5)
    expect(calls).toBe(0)
  })

  it('preserves directional affinity when a fold remaps a logical target', () => {
    const text = 'abc'
    const base = createTestView(text)
    const view = {
      ...base,
      offsetAtLineBoundary: (offset: number, boundary: 'start' | 'end') => {
        if (offset === 1 && boundary === 'end') return 0
        return base.offsetAtLineBoundary(offset, boundary)
      },
      offsetByDisplayRows: () => text.length,
    }
    const move = targets(text, view)

    expect(move('cursorRight', selection(0))).toMatchObject({
      offset: text.length,
      affinity: 'before',
    })
    expect(move('cursorLeft', selection(2))).toMatchObject({ offset: 0, affinity: 'after' })
  })
})

describe('word-part navigation', () => {
  it('lands on the next word rather than running through to its far end', () => {
    const move = targets('foo bar\nbaz')

    expect(move('cursorWordPartRight', selection(3))?.offset).toBe(4)
    expect(move('cursorWordPartLeft', selection(4))?.offset).toBe(3)
  })

  it('cannot leave the line the caret is on', () => {
    const move = targets('foo bar\nbaz')

    expect(move('cursorWordPartRight', selection(7))?.offset).toBe(7)
    expect(move('cursorWordPartLeft', selection(8))?.offset).toBe(8)
  })

  it('still stops inside an identifier, which word motion would step over', () => {
    const move = targets('parseHTTPResponse')

    expect(move('cursorWordPartRight', selection(0))?.offset).toBe(5)
    expect(move('cursorWordPartLeft', selection(17))?.offset).toBe(9)
  })

  it('stops on an operator instead of running back to the word in front of it', () => {
    const move = targets('x = y')

    expect(move('cursorWordPartLeft', selection(3))?.offset).toBe(2)
  })
})

describe('rows a contribution keeps the caret off', () => {
  // Row 1 is a separator whose label is buffer text.
  const text = 'one\n--sep--\nthree\nfour'
  const separator = new Set([1])

  it('steps a vertical move over the row and keeps its column', () => {
    const move = targets(text, undefined, false, separator)

    expect(move('cursorDown', selection(1))?.offset).toBe(13)
    expect(move('cursorUp', selection(13))?.offset).toBe(1)
  })

  it('enters the next row from its near edge on a horizontal move', () => {
    const move = targets(text, undefined, false, separator)

    expect(move('cursorRight', selection(3))?.offset).toBe(12)
    expect(move('cursorLeft', selection(12))?.offset).toBe(3)
  })

  it('extends a selection past the row with the head beyond it', () => {
    const move = targets(text, undefined, false, separator)

    expect(move('selectDown', selection(1))).toMatchObject({ offset: 13, extend: true })
  })

  it('turns back when nothing lies beyond the row in the move direction', () => {
    const leading = '--sep--\none'
    const move = targets(leading, undefined, false, new Set([0]))

    expect(move('cursorDocumentStart', selection(10))?.offset).toBe(8)
    expect(move('cursorUp', selection(9))?.offset).toBe(9)
  })

  it('leaves every move alone when no row is marked', () => {
    const move = targets(text)

    expect(move('cursorDown', selection(1))?.offset).toBe(5)
  })
})

describe('vertical navigation', () => {
  const text = 'one\ntwo\nthree\nfour'

  it('measures one fractional pixel goal and reuses it for arrows and pages', () => {
    const caretXForOffset = vi.fn(() => 37.25)
    const verticalCaretTarget = vi.fn(
      (
        _offset: number,
        _affinity: SelectionAffinity,
        _rowDelta: number,
        _goal: Exclude<SelectionGoal, { readonly kind: 'none' }>,
      ) => ({ offset: 8, affinity: 'before' as const }),
    )
    const view = { ...createTestView(text), caretXForOffset, verticalCaretTarget }
    const move = targets(text, view)

    const first = move('cursorDown', selection(1, 1, SelectionGoal.none(), 'before'))
    expect(first).toMatchObject({
      offset: 8,
      affinity: 'before',
      goal: { kind: 'horizontal', x: 37.25 },
    })
    const second = move(
      'cursorPageDown',
      selection(first!.offset, first!.offset, first!.goal, first!.affinity),
    )
    expect(second).toMatchObject({
      offset: 8,
      affinity: 'before',
      goal: { kind: 'horizontal', x: 37.25 },
    })
    expect(caretXForOffset).toHaveBeenCalledOnce()
    expect(caretXForOffset).toHaveBeenCalledWith(1, 'before')
    expect(verticalCaretTarget.mock.calls.map((call) => call[3])).toEqual([
      { kind: 'horizontal', x: 37.25 },
      { kind: 'horizontal', x: 37.25 },
    ])
  })

  it('keeps line-end distinct from a pixel aim', () => {
    const view = createTestView(text)
    const goal = verticalMoveGoal(SelectionGoal.lineEnd(), 3, 'before', view)
    expect(goal).toEqual({ kind: 'lineEnd' })
  })

  it('uses inside affinities when a vertical move leaves a nonempty selection', () => {
    const origins: { readonly affinity: SelectionAffinity; readonly offset: number }[] = []
    const view = {
      ...createTestView(text),
      verticalCaretTarget: (
        offset: number,
        affinity: SelectionAffinity,
        _rowDelta: number,
        _goal: Exclude<SelectionGoal, { readonly kind: 'none' }>,
      ) => {
        origins.push({ affinity, offset })
        return { offset, affinity }
      },
    }
    const move = targets(text, view)

    move('cursorDown', selection(9, 4, SelectionGoal.none(), 'after'))
    move('cursorUp', selection(4, 9, SelectionGoal.none(), 'before'))
    expect(origins).toEqual([
      { offset: 9, affinity: 'before' },
      { offset: 4, affinity: 'after' },
    ])
  })

  it('leaves a selection from the edge it is heading towards', () => {
    const move = targets(text)

    expect(move('cursorDown', selection(9, 4))?.offset).toBe(15)
    expect(move('cursorUp', selection(4, 9))?.offset).toBe(0)
  })

  it('keeps pivoting on the head while extending', () => {
    const move = targets(text)

    expect(move('selectDown', selection(9, 4))?.offset).toBe(8)
    expect(move('selectUp', selection(4, 9))?.offset).toBe(5)
  })
})

describe('line boundary navigation', () => {
  it('uses the inside affinity at each document boundary', () => {
    const move = targets('plain')

    for (const command of ['cursorDocumentStart', 'selectDocumentStart'] as const) {
      expect(move(command, selection(3))).toMatchObject({ offset: 0, affinity: 'after' })
    }
    for (const command of ['cursorDocumentEnd', 'selectDocumentEnd'] as const) {
      expect(move(command, selection(3))).toMatchObject({ offset: 5, affinity: 'before' })
    }
  })

  it('escalates Home from the first non-blank character to the margin', () => {
    const move = targets('    indented')

    expect(move('cursorLineStart', selection(8))?.offset).toBe(4)
    expect(move('cursorLineStart', selection(4))?.offset).toBe(0)
    expect(move('cursorLineStart', selection(0))?.offset).toBe(4)
  })

  it('has nothing to escalate to on a line with no indentation', () => {
    expect(targets('plain')('cursorLineStart', selection(3))?.offset).toBe(0)
    expect(targets('    ')('cursorLineStart', selection(4))?.offset).toBe(0)
  })

  it('stops Home at the start of a wrapped row, which carries no indentation of its own', () => {
    const text = '    indented line that wraps'
    const move = targets(text, createWrappedTestView(text, 12))

    expect(move('cursorLineStart', selection(14))?.offset).toBe(12)
  })

  it('holds the line end as the caret moves down past a shorter line', () => {
    const move = targets('longer line here\nab\nanother long line')
    const end = move('cursorLineEnd', selection(0))
    expect(end).toMatchObject({
      affinity: 'before',
      offset: 16,
      goal: { kind: 'lineEnd' },
    })

    const short = move('cursorDown', selection(16, 16, end?.goal))
    expect(short).toMatchObject({ offset: 19, goal: { kind: 'lineEnd' } })

    expect(move('cursorDown', selection(19, 19, short?.goal))?.offset).toBe(37)
  })

  it('uses the inside affinity at each line boundary', () => {
    const move = targets('plain')

    expect(move('cursorLineStart', selection(3))).toMatchObject({
      affinity: 'after',
      offset: 0,
    })
    expect(move('cursorLineEnd', selection(3))).toMatchObject({
      affinity: 'before',
      offset: 5,
    })
  })
})
