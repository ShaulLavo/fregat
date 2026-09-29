import { describe, expect, it } from 'vitest'

import { createStringTextSnapshot, type TextReadSnapshot } from '../src/documentTextSnapshot'
import {
  editActionForCommand,
  type EditorBoundedEditActionCommandId,
} from '../src/editor/editActions'
import { createDocumentSession } from '../src/public/document'
import { SelectionGoal, type ResolvedSelection } from '../src/selections'
import {
  nextCodePointOffset,
  nextWordOffset,
  nextWordPartOffset,
  nextWordStartOffset,
  previousCodePointOffset,
  previousWordEndOffset,
  previousWordOffset,
  previousWordPartOffset,
} from '../src/textRanges'
import { readAll } from './factories/snapshotText'

/**
 * Line and word actions read bounded ranges of a piece table. Over a document split into a piece
 * every few units, with selections on each side of every seam, they answer exactly as they do over
 * one string.
 */

const COMMANDS: readonly EditorBoundedEditActionCommandId[] = [
  'deleteWordLeft',
  'deleteWordRight',
  'deleteWordPartLeft',
  'deleteWordPartRight',
  'editor.action.commentLine',
  'editor.action.blockComment',
  'editor.action.indentLines',
  'editor.action.outdentLines',
  'editor.action.deleteLines',
  'editor.action.copyLinesUpAction',
  'editor.action.copyLinesDownAction',
  'editor.action.moveLinesUpAction',
  'editor.action.moveLinesDownAction',
  'editor.action.insertLineBefore',
  'editor.action.insertLineAfter',
  'editor.action.sortLinesAscending',
  'editor.action.sortLinesDescending',
  'editor.action.joinLines',
  'editor.action.duplicateSelection',
  'editor.action.transformToUppercase',
  'editor.action.transformToLowercase',
  'editor.action.transformToTitlecase',
]

const LINES = [
  'function alpha() {',
  '  // noted',
  '',
  '\treturn betaGamma(1, 2)',
  '  /* block */ x',
  '}',
  'zeta😀 𝒳y',
  '    last line  ',
]

describe('line and word actions across piece seams', () => {
  const text = LINES.join('\n').repeat(2)
  const fragmented = fragmentedSnapshot(text, 5)
  const whole = createStringTextSnapshot(text)
  const seams = pieceSeams(fragmented)

  it('reads a document split at every few units', () => {
    expect(readAll(fragmented)).toBe(text)
    expect(seams.length).toBeGreaterThan(text.length / 6)
  })

  it.each(COMMANDS)('%s answers as it does over one string', (command) => {
    for (const selections of selectionsAroundSeams(seams, text.length)) {
      const options = { languageId: 'typescript', tabSize: 2 }
      const expected = editActionForCommand(command, whole, selections, options)
      const actual = editActionForCommand(command, fragmented, selections, options)
      expect({ selections, actual }).toEqual({ selections, actual: expected })
    }
  })
})

describe('word deletes on a row longer than the window read around the caret', () => {
  const row = [
    'lead words, ',
    'a'.repeat(10_000),
    ' '.repeat(9_000),
    'camelCaseHTTPWord_snake'.repeat(400),
    ', ',
    'e\u0301'.repeat(2_500),
    ' 😀😀 𝒳𝒳 ',
    '🇺🇸'.repeat(1_500),
    ' tail',
  ].join('')
  const text = `before\n${row}\nafter`
  const source = fragmentedSnapshot(text, 997)
  const carets = caretsAcross(7, 7 + row.length)

  it.each([
    ['deleteWordLeft', 'left', 'word'],
    ['deleteWordRight', 'right', 'word'],
    ['deleteWordPartLeft', 'left', 'wordPart'],
    ['deleteWordPartRight', 'right', 'wordPart'],
  ] as const)(
    '%s deletes what a scan of the whole text finds',
    (command, direction, granularity) => {
      for (const caret of carets) {
        const range = wordDeleteOverWholeText(text, caret, direction, granularity)
        const expected =
          range.start === range.end ? [] : [{ from: range.start, text: '', to: range.end }]
        const actual = editActionForCommand(command, source, [selection(caret)]).edits
        expect({ caret, actual }).toEqual({ caret, actual: expected })
      }
    },
  )
})

/** The string path the actions replaced: every scan over the document as one string. */
function wordDeleteOverWholeText(
  text: string,
  head: number,
  direction: 'left' | 'right',
  granularity: 'word' | 'wordPart',
): { readonly start: number; readonly end: number } {
  if (direction === 'left') {
    const wordStart = previousWordOffset(text, head)
    const boundary =
      granularity === 'word'
        ? wordStart
        : Math.max(wordStart, previousWordPartOffset(text, head), previousWordEndOffset(text, head))
    return { start: boundary === head ? previousCodePointOffset(text, head) : boundary, end: head }
  }

  const wordEnd = nextWordOffset(text, head)
  const boundary =
    granularity === 'word'
      ? wordEnd
      : Math.min(wordEnd, nextWordPartOffset(text, head), nextWordStartOffset(text, head))
  return { start: head, end: boundary === head ? nextCodePointOffset(text, head) : boundary }
}

/** Each unit at a multiple of `stride` rewritten as itself, which ends a piece on either side of it. */
function fragmentedSnapshot(text: string, stride: number): TextReadSnapshot {
  const session = createDocumentSession(text)
  for (let from = stride; from < text.length; from += stride) {
    session.applyEdits([{ from, to: from + 1, text: text[from]! }])
  }
  return session.getTextSnapshot()
}

function pieceSeams(source: TextReadSnapshot): readonly number[] {
  const seams: number[] = []
  source.forEachTextChunk((_text, _start, end) => seams.push(end))
  return seams.slice(0, -1)
}

/**
 * Carets on and beside each seam, ranges across it, and seams paired a couple of rows apart, where
 * their rows are read together, and far enough apart to be read separately.
 */
function selectionsAroundSeams(seams: readonly number[], length: number): ResolvedSelection[][] {
  const cases: ResolvedSelection[][] = []
  for (const [index, seam] of seams.entries()) {
    const after = Math.min(length, seam + 3)
    const before = Math.max(0, seam - 3)
    const near = seams[index + 7] ?? length
    const far = seams[index + 40] ?? length
    cases.push([selection(seam)], [selection(Math.max(0, seam - 1))])
    cases.push([selection(before, after)], [selection(before, after, true)])
    cases.push([selection(seam), selection(near)], [selection(before, seam), selection(near)])
    cases.push(
      [selection(seam), selection(far)],
      [selection(before, after), selection(far, length)],
    )
  }
  return cases
}

function caretsAcross(start: number, end: number): readonly number[] {
  const carets: number[] = []
  for (let offset = start; offset <= end; offset += 2_003) carets.push(offset)
  return [...carets, start, end, start + 12 + 4_000, start + 12 + 9_999, start + 12 + 10_000]
}

function selection(start: number, end = start, reversed = false): ResolvedSelection {
  return {
    affinity: 'after',
    anchorOffset: reversed ? end : start,
    collapsed: start === end,
    endOffset: end,
    goal: SelectionGoal.none(),
    headOffset: reversed ? start : end,
    id: `sel:${start}:${end}`,
    reversed,
    startOffset: start,
  } as ResolvedSelection
}
