import { describe, expect, it } from 'vitest'

import { formattingChangesText, formattingOptions, prepareFormattingEdits } from '../src/formatting'
import { REDIFF_LENGTH_LIMIT } from '../src/minimalEdits'
import { textDocument } from './snapshotDocument'

const edit = (
  startLine: number,
  startChar: number,
  endLine: number,
  endChar: number,
  newText: string,
) => ({
  newText,
  range: {
    end: { character: endChar, line: endLine },
    start: { character: startChar, line: startLine },
  },
})

/** The shape a document formatter actually answers with: the whole file, rewritten. */
const wholeDocument = (text: string, newText: string) => {
  const lines = text.split('\n')
  return edit(0, 0, lines.length - 1, lines[lines.length - 1]?.length ?? 0, newText)
}

const linesWhere = (count: number, changed: (line: number) => boolean) =>
  Array.from({ length: count }, (_, line) =>
    changed(line) ? `LINE ${line}` : `line ${line}`,
  ).join('\n')

const prepare = (text: string, edits: Parameters<typeof prepareFormattingEdits>[1]) =>
  prepareFormattingEdits(textDocument(text), edits)

const changesText = (text: string, edits: Parameters<typeof formattingChangesText>[1]) =>
  formattingChangesText(textDocument(text).textSnapshot, edits)

describe('prepareFormattingEdits', () => {
  it('converts positions to offsets', () => {
    const result = prepare('const a=1', [edit(0, 7, 0, 8, ' = ')])

    expect(result).toEqual([{ from: 7, text: ' = ', to: 8 }])
  })

  it('has nothing to do for an empty or absent result', () => {
    expect(prepare('a', [])).toEqual([])
    expect(prepare('a', null)).toEqual([])
  })

  // The batch applicator rejects overlaps outright, so a formatter returning a whole-document edit
  // alongside a nested one must not be handed both.
  it('drops an edit nested inside another', () => {
    const result = prepare('abcdef', [edit(0, 0, 0, 6, 'XYZ'), edit(0, 2, 0, 3, 'q')])

    expect(result).toEqual([{ from: 0, text: 'XYZ', to: 6 }])
  })

  it('returns edits in descending order so they apply without shifting each other', () => {
    const result = prepare('ab\ncd', [edit(0, 0, 0, 1, 'A'), edit(1, 0, 1, 1, 'C')])

    expect(result.map((entry) => entry.from)).toEqual([3, 0])
  })

  it('rewrites only the line a whole-document reply changes', () => {
    const text = 'const a = 1\nconst b=2\nconst c = 3\n'

    const result = prepare(text, [wholeDocument(text, 'const a = 1\nconst b = 2\nconst c = 3\n')])

    expect(result).toEqual([{ from: 19, text: ' = ', to: 20 }])
  })

  it('emits one edit per changed region rather than one spanning them', () => {
    const text = 'a\nb\nc\nd\ne\n'

    const result = prepare(text, [wholeDocument(text, 'a\nB\nc\nd\nE\n')])

    expect(result).toEqual([
      { from: 8, text: 'E', to: 9 },
      { from: 2, text: 'B', to: 3 },
    ])
  })

  // Two fragments that meet can cancel each other out, which is invisible while they are compared
  // apart: the first deletes the character the second puts back.
  it('joins edits that meet before comparing them', () => {
    const result = prepare('ab', [edit(0, 0, 0, 1, ''), edit(0, 1, 0, 2, 'ab')])

    expect(result).toEqual([])
  })

  it('drops an edit that rewrites text to what it already is', () => {
    const result = prepare('a=1\nb=2\n', [edit(0, 0, 0, 3, 'a=1'), edit(1, 0, 1, 3, 'b = 2')])

    expect(result).toEqual([{ from: 5, text: ' = ', to: 6 }])
  })

  it('leaves a surrogate pair whole when narrowing to the difference', () => {
    const text = 'const a = "\u{1F600}"\n'

    const result = prepare(text, [wholeDocument(text, 'const a = "\u{1F601}"\n')])

    expect(result).toEqual([{ from: 11, text: '\u{1F601}', to: 13 }])
  })

  it('re-diffs up to the size limit and applies anything past it whole', () => {
    const filler = 'a'.repeat(REDIFF_LENGTH_LIMIT - 2)
    const within = `x${filler}`
    const beyond = `x${filler}aa`

    expect(prepare(within, [wholeDocument(within, `X${filler}`)])).toEqual([
      { from: 0, text: 'X', to: 1 },
    ])
    expect(prepare(beyond, [wholeDocument(beyond, `X${filler}aa`)])).toEqual([
      { from: 0, text: `X${filler}aa`, to: beyond.length },
    ])
  })

  // Joining neighbours past the size limit would trade two comparable edits for one that is only
  // large enough to be skipped, so a formatter answering line by line keeps its minimization.
  it('leaves neighbours apart when joining them would exceed the size limit', () => {
    const untouched = 'a'.repeat(REDIFF_LENGTH_LIMIT * 0.6)
    const rewritten = 'b'.repeat(REDIFF_LENGTH_LIMIT * 0.6)
    const text = `${untouched}\n${rewritten}`

    const result = prepare(text, [
      edit(0, 0, 1, 0, `${untouched}\n`),
      edit(1, 0, 1, rewritten.length, `B${rewritten.slice(1)}`),
    ])

    expect(result).toEqual([{ from: untouched.length + 1, text: 'B', to: untouched.length + 2 }])
  })

  // Alignment work grows with how far apart the two texts are, so a reply that differs almost
  // everywhere is applied whole instead of being taken apart.
  it('gives up on an alignment with too many separate differences', () => {
    const alternating = (count: number) => {
      const text = linesWhere(count, () => false)
      return prepare(text, [
        wholeDocument(
          text,
          linesWhere(count, (line) => line % 2 === 1),
        ),
      ])
    }

    expect(alternating(100)).toHaveLength(50)
    expect(alternating(1000)).toHaveLength(1)
  })
})

describe('formattingChangesText', () => {
  it('is false when every edit rewrites text to what it already is', () => {
    expect(changesText('a = 1', [{ from: 0, text: 'a', to: 1 }])).toBe(false)
  })

  it('is true when any edit changes something', () => {
    expect(changesText('a=1', [{ from: 1, text: ' = ', to: 2 }])).toBe(true)
  })
})

describe('formattingOptions', () => {
  it('passes the editor tab size through', () => {
    expect(formattingOptions(4)).toEqual({ insertSpaces: true, tabSize: 4 })
  })

  it('never asks for a zero-width tab', () => {
    expect(formattingOptions(0).tabSize).toBe(1)
  })
})
