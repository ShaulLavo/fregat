import { describe, expect, it } from 'vitest'

import { createStringTextSnapshot, type TextReadSnapshot } from '../src/documentTextSnapshot'
import {
  editActionForCommand,
  type EditorBoundedEditActionCommandId,
} from '../src/editor/editActions'
import { createLineMap, type LineGeometry } from '../src/editor/lineMap'
import { SelectionGoal, type ResolvedSelection } from '../src/selections'
import type { TextEdit } from '../src/tokens'

/** Rows the map read and rows it did not, before and after the edits a line command makes. */

const ROWS = Array.from({ length: 30 }, (_, row) =>
  row % 7 === 3 ? '' : `row ${row} `.repeat((row % 4) + 1),
)

const DOCUMENTS = {
  'ending in a break': `${ROWS.join('\n')}\n`,
  'ending in text': ROWS.join('\n'),
}

// Row starts, so each selection is a caret at the start of the row it names.
const SELECTION_ROWS: Readonly<Record<string, readonly number[]>> = {
  'rows far apart': [2, 14, 27],
  'rows read together': [5, 7],
  'the first and last rows': [0, 29, 30],
  'no selection': [],
}

const COMMANDS: readonly EditorBoundedEditActionCommandId[] = [
  'editor.action.copyLinesUpAction',
  'editor.action.copyLinesDownAction',
  'editor.action.moveLinesUpAction',
  'editor.action.moveLinesDownAction',
  'editor.action.insertLineBefore',
  'editor.action.insertLineAfter',
]

describe.each(Object.entries(DOCUMENTS))('a line map over a document %s', (_name, text) => {
  const source = createStringTextSnapshot(text)

  it.each(Object.entries(SELECTION_ROWS))('answers as the snapshot does, %s', (_rows, rows) => {
    const map = createLineMap(source, caretsAtRows(source, rows))

    expectSameGeometry(map, source)
    for (let start = 0; start <= text.length; start += 3) {
      expect(map.slice(start, start + 17)).toBe(text.slice(start, start + 17))
    }
  })

  it.each(Object.entries(SELECTION_ROWS))('answers after the edits, %s', (_rows, rows) => {
    const selections = caretsAtRows(source, rows)
    const map = createLineMap(source, selections)

    for (const command of COMMANDS) {
      const { edits } = editActionForCommand(command, source, selections)
      const edited = createStringTextSnapshot(applyEdits(text, edits))
      expectSameGeometry(map.afterEdits(edits), edited)
    }
  })
})

function expectSameGeometry(map: LineGeometry, expected: TextReadSnapshot): void {
  const lastRow = expected.lineCount - 1
  expect({ length: map.length, lastRow: map.lastRow }).toEqual({ length: expected.length, lastRow })

  for (let row = -1; row <= lastRow + 1; row += 1) {
    const clamped = Math.min(Math.max(row, 0), lastRow)
    const start = expected.lineStart(clamped)
    const fullEnd = row < lastRow ? expected.lineStart(row + 1) : expected.length
    expect({ row, start: map.lineStart(row) }).toEqual({ row, start })
    expect({ row, fullEnd: map.lineFullEnd(row) }).toEqual({ row, fullEnd })
    expect({ row, end: map.lineEnd(row) }).toEqual({
      row,
      end: row < lastRow ? fullEnd - 1 : fullEnd,
    })
  }

  for (let offset = -1; offset <= expected.length + 1; offset += 1) {
    const row = expected.lineAt(Math.min(Math.max(offset, 0), expected.length))
    expect({ offset, row: map.rowAtOffset(offset) }).toEqual({ offset, row })
  }
}

function caretsAtRows(source: TextReadSnapshot, rows: readonly number[]): ResolvedSelection[] {
  return rows.map((row) => {
    const offset = source.lineStart(Math.min(row, source.lineCount - 1))
    return {
      affinity: 'after',
      anchorOffset: offset,
      collapsed: true,
      endOffset: offset,
      goal: SelectionGoal.none(),
      headOffset: offset,
      id: `caret:${row}`,
      reversed: false,
      startOffset: offset,
    } as ResolvedSelection
  })
}

function applyEdits(text: string, edits: readonly TextEdit[]): string {
  let next = text
  for (const edit of edits.toSorted(
    (left, right) => right.from - left.from || right.to - left.to,
  )) {
    next = `${next.slice(0, edit.from)}${edit.text}${next.slice(edit.to)}`
  }
  return next
}
