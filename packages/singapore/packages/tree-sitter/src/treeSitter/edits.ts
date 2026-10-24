import type { TextEdit, TextReadSnapshot } from '@singapore-editor/core/document'
import type { TreeSitterInputEdit } from './types'

export function createTreeSitterInputEdits(
  read: TextReadSnapshot,
  edits: readonly TextEdit[],
): TreeSitterInputEdit[] {
  return edits
    .toSorted((left, right) => right.from - left.from || right.to - left.to)
    .map((edit) => {
      const startPosition = pointAt(read, edit.from)
      return {
        startIndex: edit.from,
        oldEndIndex: edit.to,
        newEndIndex: edit.from + edit.text.length,
        startPosition,
        oldEndPosition: pointAt(read, edit.to),
        newEndPosition: insertedEndPosition(startPosition, edit.text),
      }
    })
}

function pointAt(read: TextReadSnapshot, offset: number): TreeSitterInputEdit['startPosition'] {
  const row = read.lineAt(offset)
  return { row, column: offset - read.lineStart(row) }
}

function insertedEndPosition(
  start: TreeSitterInputEdit['startPosition'],
  text: string,
): TreeSitterInputEdit['newEndPosition'] {
  let lines = 0
  let lastBreak = -1
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    lines++
    lastBreak = index
  }
  return {
    row: start.row + lines,
    column: lines === 0 ? start.column + text.length : text.length - lastBreak - 1,
  }
}
