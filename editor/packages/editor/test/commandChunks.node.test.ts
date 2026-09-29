import { describe, expect, it } from 'vitest'

import { createStringTextSnapshot, type TextReadSnapshot } from '../src/documentTextSnapshot'
import { trimTrailingWhitespaceAction } from '../src/editor/editActions'
import {
  findAllExactOccurrences,
  findNextExactOccurrenceFromRange,
  occurrenceQueryForSelection,
  type ExactOccurrenceRange,
  type OccurrenceScanWindows,
} from '../src/editor/occurrences'
import { documentSelectionEditForCommand } from '../src/editor/reindent'
import { CURSOR_PAGE, TextCursor } from '../src/editor/textCursor'
import { createDocumentSession } from '../src/public/document'
import { SelectionGoal, type ResolvedSelection } from '../src/selections'
import type { TextEdit } from '../src/tokens'
import { isWholeWordRange, wordRangeAtOffset } from '../src/textRanges'
import { readAll } from './factories/snapshotText'

/**
 * Occurrence search, trim and reindent read a piece table in windows and pages. Over a document split
 * every few units, with windows as narrow as its pieces, they answer exactly as one string does.
 */

const PIECE = 5
// Windows one piece wide, so a window seam is a piece seam too.
const WINDOWS: OccurrenceScanWindows = { first: PIECE, max: PIECE }
// Windows that double from under a piece to past several, then hold at the cap.
const GROWING: OccurrenceScanWindows = { first: 2, max: 16 }

describe('occurrence search across chunk seams', () => {
  // Every `ab` sits across a seam: its `a` ends one piece and its `b` is the next.
  const text = `zzz a${'b z a'.repeat(40)}b`
  const source = fragmentedSnapshot(text, PIECE)
  const matches = findAllOverString(text, 'ab')

  it('builds a document where every query straddles two pieces', () => {
    expect(readAll(source)).toBe(text)
    expect(matches).toHaveLength(41)
    const seams = new Set(pieceSeams(source))
    for (const match of matches) expect(seams.has(match.start + 1)).toBe(true)
  })

  it('selects every match', () => {
    expect(findAllExactOccurrences(source, 'ab', WINDOWS)).toEqual(matches)
  })

  it.each([false, true])('finds the next match and wraps once, whole word %s', (wholeWord) => {
    for (const [index, match] of matches.entries()) {
      const next = matches[(index + 1) % matches.length]
      const found = findNextExactOccurrenceFromRange(
        source,
        'ab',
        [match],
        match,
        wholeWord,
        WINDOWS,
      )
      expect({ index, found }).toEqual({ index, found: next })
    }
  })
})

describe('whole-word checks at chunk edges', () => {
  // Neighbours that decide a boundary: a letter, an astral letter, an emoji, and a combining run
  // whose cluster starts with a letter further back than a window reaches.
  const segments = [
    'ab xab abx',
    '𝒳ab ab𝒳',
    '😀ab ab😀',
    `x${'\u0301'.repeat(20)}ab ab${'\u0301'.repeat(3)}`,
    'e\u0301ab\nab\n\nab',
    '🇺🇸ab🇺🇸 ab',
  ]
  // Each segment at every offset from a seam, so every neighbour lands on both sides of one.
  const text = segments.flatMap((segment) => shifts(segment)).join(' ')
  const queries = ['ab', 'a', 'b', 'ab ab', '𝒳', '😀ab', '\u0301ab', 'ab\n']

  it.each([1, 2, PIECE])('answers as one string does over pieces of %i', (stride) => {
    const source = fragmentedSnapshot(text, stride)
    for (const query of queries) {
      const all = findAllOverString(text, query)
      expect({ query, all: findAllExactOccurrences(source, query, WINDOWS) }).toEqual({
        query,
        all,
      })
      for (const range of [
        ...all,
        { start: 0, end: 0 },
        { start: text.length, end: text.length },
      ]) {
        expectNextMatches(source, text, query, range)
      }
    }
  })

  it('answers the same while its windows grow to the cap', () => {
    const source = fragmentedSnapshot(text, 3)
    for (const query of queries) {
      const all = findAllOverString(text, query)
      expect({ query, all: findAllExactOccurrences(source, query, GROWING) }).toEqual({
        query,
        all,
      })
      for (const range of [...all, { start: 0, end: 0 }]) {
        expectNextMatches(source, text, query, range, GROWING)
      }
    }
  })

  it('reads the word at every caret from its row', () => {
    const source = fragmentedSnapshot(text, 2)
    for (let offset = 0; offset <= text.length; offset += 1) {
      const range = wordRangeAtOffset(text, offset)
      const expected =
        range.start === range.end ? null : { query: text.slice(range.start, range.end), range }
      const actual = occurrenceQueryForSelection(source, caret(offset))
      expect({ offset, actual }).toEqual({ offset, actual: expected })
    }
  })
})

describe('trim trailing whitespace across chunk seams', () => {
  const random = seededRandom(55)
  const units = ['a', ' ', '\t', '\n', '😀', ' ', ' ']
  const documents = Array.from({ length: 40 }, () =>
    Array.from({ length: 120 }, () => units[Math.floor(random() * units.length)]).join(''),
  )

  it.each([1, 2, 3, PIECE])('edits what a scan of one string edits, pieces of %i', (stride) => {
    for (const text of documents) {
      const actual = trimTrailingWhitespaceAction(fragmentedSnapshot(text, stride)).edits
      expect({ text, actual }).toEqual({ text, actual: trimOverString(text) })
    }
  })
})

describe('reindent across page seams', () => {
  const block = [
    'function f() {',
    'if (a) {',
    "const s = `{ '",
    '  not code {`',
    '/* {',
    ' still comment */',
    'b(\'{\', "}") // {',
    '}',
    '}',
    '',
  ].join('\n')
  const options = { languageId: 'typescript', tabSize: 2 }

  function reindent(text: string, source: TextReadSnapshot): readonly TextEdit[] {
    const everything = { collapsed: false, endOffset: text.length, startOffset: 0 }
    return documentSelectionEditForCommand('editor.action.reindentlines', source, [everything], {
      ...options,
    }).edits
  }

  // The block after a comment row `pad` units long, and its edits moved back to the block's start.
  function blockEdits(pad: number, source = (text: string) => createStringTextSnapshot(text)) {
    const head = `// ${'x'.repeat(pad)}\n`
    const text = head + block
    return reindent(text, source(text)).map((edit) => ({
      ...edit,
      from: edit.from - head.length,
      to: edit.to - head.length,
    }))
  }

  it('gives the same edits wherever a page seam cuts a delimiter', () => {
    const expected = blockEdits(4)
    expect(expected.length).toBeGreaterThan(3)
    // Slides every delimiter in the block across the first page seam.
    const first = CURSOR_PAGE - 4 - block.length
    for (let pad = first; pad <= CURSOR_PAGE; pad += 1) {
      expect({ pad, edits: blockEdits(pad) }).toEqual({ pad, edits: expected })
    }
  })

  it('reads a fragmented piece table the way it reads one string', () => {
    const text = `${block}${block.replaceAll('\n', '\n  ')}`.repeat(3)
    const whole = reindent(text, createStringTextSnapshot(text))
    expect(reindent(text, fragmentedSnapshot(text, 3))).toEqual(whole)

    const selected = [{ collapsed: false, endOffset: 120, startOffset: 40 }]
    const command = 'editor.action.reindentselectedlines'
    expect(
      documentSelectionEditForCommand(command, fragmentedSnapshot(text, 3), selected, options),
    ).toEqual(
      documentSelectionEditForCommand(command, createStringTextSnapshot(text), selected, options),
    )
  })
})

describe('text cursor across page seams', () => {
  const tokens = ['/*', '*/', '\n', "'", 'abc']
  const text = Array.from({ length: 3 * CURSOR_PAGE }, (_, index) =>
    index % 7 === 0 ? '\n' : 'x',
  ).join('')
  // Each token written across each seam, at each split.
  let seeded = text
  for (const seam of [CURSOR_PAGE, 2 * CURSOR_PAGE]) {
    seeded = `${seeded.slice(0, seam - 1)}abc${seeded.slice(seam + 2)}`
    seeded = `${seeded.slice(0, seam - 20)}/*${seeded.slice(seam - 18)}`
    seeded = `${seeded.slice(0, seam + 30)}*/${seeded.slice(seam + 32)}`
  }
  const cursor = new TextCursor(createStringTextSnapshot(seeded))

  it('searches and reads the way one string does', () => {
    for (const seam of [CURSOR_PAGE, 2 * CURSOR_PAGE]) {
      for (let from = seam - 40; from <= seam + 40; from += 1) {
        for (const token of tokens) {
          expect({ from, token, at: cursor.indexOf(token, from) }).toEqual({
            from,
            token,
            at: seeded.indexOf(token, from),
          })
          expect(cursor.startsWith(token, from)).toBe(seeded.startsWith(token, from))
        }
        expect(cursor.slice(from, from + 50)).toBe(seeded.slice(from, from + 50))
        expect(cursor.search(/[/*']/g, from, seam + 100)).toBe(firstOf(seeded, from, seam + 100))
      }
    }
  })
})

/** The string path the commands replaced: `indexOf` over the document as one string. */
function findAllOverString(text: string, query: string): ExactOccurrenceRange[] {
  const ranges: ExactOccurrenceRange[] = []
  let index = text.indexOf(query)
  while (index !== -1) {
    ranges.push({ start: index, end: index + query.length })
    index = text.indexOf(query, index + query.length)
  }
  return ranges
}

function findNextOverString(
  text: string,
  query: string,
  selected: readonly ExactOccurrenceRange[],
  range: ExactOccurrenceRange,
  wholeWord: boolean,
): ExactOccurrenceRange | null {
  const accepts = (candidate: ExactOccurrenceRange) =>
    !selected.some((other) => other.start < candidate.end && candidate.start < other.end) &&
    (!wholeWord || isWholeWordRange(text, candidate))
  const candidates = [range.end, 0].flatMap((from, pass) => {
    const found: ExactOccurrenceRange[] = []
    const end = pass === 0 ? text.length : range.end
    for (let index = text.indexOf(query, from); index !== -1 && index < end;) {
      found.push({ start: index, end: index + query.length })
      index = text.indexOf(query, index + 1)
    }
    return found
  })
  return candidates.find(accepts) ?? null
}

function expectNextMatches(
  source: TextReadSnapshot,
  text: string,
  query: string,
  range: ExactOccurrenceRange,
  windows = WINDOWS,
): void {
  for (const wholeWord of [false, true]) {
    for (const selected of [[], [range]]) {
      const expected = findNextOverString(text, query, selected, range, wholeWord)
      const actual = findNextExactOccurrenceFromRange(
        source,
        query,
        selected,
        range,
        wholeWord,
        windows,
      )
      expect({ query, range, wholeWord, selected, actual }).toEqual({
        query,
        range,
        wholeWord,
        selected,
        actual: expected,
      })
    }
  }
}

function trimOverString(text: string): readonly TextEdit[] {
  const edits: TextEdit[] = []
  for (let start = 0; start <= text.length;) {
    const lineBreak = text.indexOf('\n', start)
    const end = lineBreak === -1 ? text.length : lineBreak
    const trimmedEnd = start + text.slice(start, end).replace(/[ \t]+$/, '').length
    if (trimmedEnd < end) edits.push({ from: trimmedEnd, text: '', to: end })
    start = end + 1
  }
  return edits
}

function firstOf(text: string, from: number, to: number): number {
  for (let index = from; index < to; index += 1) {
    if ("/*'".includes(text[index]!)) return index
  }
  return -1
}

function shifts(segment: string): readonly string[] {
  return Array.from({ length: PIECE }, (_, shift) => `${'.'.repeat(shift)}${segment}`)
}

/**
 * Each unit at a multiple of `stride` rewritten as itself, which ends a piece on either side of it.
 * The table keeps a surrogate pair whole, so a pair is rewritten together.
 */
function fragmentedSnapshot(text: string, stride: number): TextReadSnapshot {
  const session = createDocumentSession(text)
  for (let from = stride; from < text.length; from += stride) {
    if (isPairTail(text, from)) continue
    const to = isPairTail(text, from + 1) ? from + 2 : from + 1
    session.applyEdits([{ from, to, text: text.slice(from, to) }])
  }
  const source = session.getTextSnapshot()
  expect(readAll(source)).toBe(text)
  return source
}

function isPairTail(text: string, offset: number): boolean {
  const unit = text.charCodeAt(offset)
  return unit >= 0xdc00 && unit <= 0xdfff && /[\ud800-\udbff]/.test(text[offset - 1] ?? '')
}

function pieceSeams(source: TextReadSnapshot): readonly number[] {
  const seams: number[] = []
  source.forEachTextChunk((_text, _start, end) => seams.push(end))
  return seams.slice(0, -1)
}

function caret(offset: number): ResolvedSelection {
  return {
    affinity: 'after',
    anchorOffset: offset,
    collapsed: true,
    endOffset: offset,
    goal: SelectionGoal.none(),
    headOffset: offset,
    id: `sel:${offset}`,
    reversed: false,
    startOffset: offset,
  } as ResolvedSelection
}

function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return state / 2_147_483_648
  }
}
