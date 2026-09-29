import { describe, expect, it, vi } from 'vitest'

import { nextGraphemeBoundary, previousGraphemeBoundary } from '../src/graphemes'
import type { EditorCommandId } from '../src/editor/commands'
import {
  createNavigationLineReader,
  navigationTargetForCommand,
} from '../src/editor/navigationTargets'
import { createDocumentTextSnapshot } from '../src/documentTextSnapshot'
import { createPieceTableSnapshot } from '@singapore-editor/textbuffer'
import { materializePieceTableFullText } from '../src/public/document'
import {
  createAnchorSelection,
  createSelectionSet,
  type ResolvedSelection,
} from '../src/selections'

const readCounter = vi.hoisted(() => ({ characters: 0 }))

vi.mock('@singapore-editor/textbuffer/internal/reads', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@singapore-editor/textbuffer/internal/reads')>()
  return {
    ...actual,
    readPieceTableTextRange: (...args: Parameters<typeof actual.readPieceTableTextRange>) => {
      const value = actual.readPieceTableTextRange(...args)
      readCounter.characters += value.length
      return value
    },
  }
})

const { backspaceSelections } = await import('../src/documentSelectionEdits')

const ZWJ = '\u200d'
const FAMILY = `\u{1F468}${ZWJ}\u{1F469}${ZWJ}\u{1F467}`
const THUMBS_UP_TONED = '\u{1F44D}\u{1F3FD}'
const ACCENTED_E = 'e\u0301'
const KEYCAP_ONE = '1\ufe0f\u20e3'
const HANGUL_JAMO = '\u1100\u1161\u11a8'
const FLAG_JP = '\u{1F1EF}\u{1F1F5}'
const DEVANAGARI_KSHI = '\u0915\u094d\u0937\u093f'
/** A prepending mark: it joins the character that follows it, not the one before. */
const ARABIC_NUMBER_SIGN = '\u0600'

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Every offset `Intl.Segmenter` considers a cluster edge, ascending. */
function referenceBoundaries(text: string): number[] {
  const boundaries = [0]
  for (const { index, segment } of segmenter.segment(text)) boundaries.push(index + segment.length)
  return boundaries
}

function caret(offset: number): ResolvedSelection {
  return {
    id: `caret:${offset}`,
    startOffset: offset,
    endOffset: offset,
    anchorOffset: offset,
    headOffset: offset,
    reversed: false,
    collapsed: true,
    goal: { kind: 'none' },
    affinity: 'after',
    liveness: 'live',
    startLiveness: 'live',
    endLiveness: 'live',
  }
}

/** Runs a caret command the way the input controller does, and reports where the caret lands. */
function move(text: string, command: EditorCommandId, offset: number): number {
  const snapshot = createPieceTableSnapshot(text)
  const target = navigationTargetForCommand({
    command,
    resolved: caret(offset),
    readLine: createNavigationLineReader(snapshot, createDocumentTextSnapshot(snapshot)),
    documentLength: snapshot.length,
    rtlMoveVisually: false,
    view: {
      caretXForOffset: (value) => value,
      offsetAtLineBoundary: (value) => value,
      offsetByDisplayRows: (value) => value,
      pageRowDelta: () => 1,
      verticalCaretTarget: (value, affinity) => ({ offset: value, affinity }),
      visualHorizontalTarget: () => null,
    },
  })

  return target?.offset ?? offset
}

/** Backspaces once from `offset` and reports the document that is left. */
function backspace(text: string, offset: number, tabSize?: number): string {
  const snapshot = createPieceTableSnapshot(text)
  const set = createSelectionSet([createAnchorSelection(snapshot, offset)])
  return materializePieceTableFullText(backspaceSelections(snapshot, set, tabSize).snapshot)
}

describe('grapheme boundaries', () => {
  const samples = [
    'plain ascii',
    ACCENTED_E,
    FAMILY,
    THUMBS_UP_TONED,
    KEYCAP_ONE,
    HANGUL_JAMO,
    FLAG_JP,
    DEVANAGARI_KSHI,
    `a${ARABIC_NUMBER_SIGN}b`,
    `x${FAMILY}\t${ACCENTED_E}${FLAG_JP} ${HANGUL_JAMO}y`,
  ]

  it.each(samples)('agrees with Intl.Segmenter walking %j backwards and forwards', (text) => {
    const boundaries = referenceBoundaries(text)

    for (const [position, boundary] of boundaries.entries()) {
      expect(previousGraphemeBoundary(text, boundary)).toBe(boundaries[Math.max(0, position - 1)])
      expect(nextGraphemeBoundary(text, boundary)).toBe(
        boundaries[Math.min(boundaries.length - 1, position + 1)],
      )
    }
  })

  it('holds at both ends of the text', () => {
    expect(previousGraphemeBoundary(FAMILY, 0)).toBe(0)
    expect(nextGraphemeBoundary(FAMILY, FAMILY.length)).toBe(FAMILY.length)
  })
})

describe('caret motion over clusters', () => {
  it('steps a whole family emoji and returns to where it started', () => {
    const text = `a${FAMILY}b`
    const end = 1 + FAMILY.length

    expect(move(text, 'cursorLeft', end)).toBe(1)
    expect(move(text, 'cursorRight', 1)).toBe(end)
  })

  it('steps a skin-tone modifier with the hand it belongs to', () => {
    const text = `a${THUMBS_UP_TONED}b`

    expect(move(text, 'cursorLeft', 1 + THUMBS_UP_TONED.length)).toBe(1)
  })

  it('does not park between a letter and its combining accent', () => {
    expect(move(`a${ACCENTED_E}b`, 'cursorLeft', 3)).toBe(1)
  })
})

describe('backspace over clusters', () => {
  it('takes one member off a joined family rather than the whole cluster', () => {
    expect(backspace(FAMILY, FAMILY.length)).toBe(`\u{1F468}${ZWJ}\u{1F469}`)
  })

  it('takes the skin tone with the hand instead of half a surrogate pair', () => {
    expect(backspace(`a${THUMBS_UP_TONED}`, 1 + THUMBS_UP_TONED.length)).toBe('a')
  })

  it('takes the enclosing keycap with the digit it encloses', () => {
    expect(backspace(`a${KEYCAP_ONE}`, 1 + KEYCAP_ONE.length)).toBe('a')
  })

  /** The move assertion pins the disagreement: motion steps the pair, delete splits it. */
  it('takes only the combining accent the caret would have stepped over whole', () => {
    const text = `a${ACCENTED_E}`

    expect(move(text, 'cursorLeft', text.length)).toBe(1)
    expect(backspace(text, text.length)).toBe('ae')
  })

  it('leaves no lone surrogate behind an astral character', () => {
    expect(backspace('a\u{1D11E}b', 3)).toBe('ab')
  })
})

describe('backspace inside indentation', () => {
  it('takes back one tab stop rather than one space', () => {
    expect(backspace('        foo', 8, 4)).toBe('    foo')
  })

  it('lands on the tab stop a partial indent overshot', () => {
    expect(backspace('      foo', 6, 4)).toBe('    foo')
  })

  it('takes one character where the previous tab stop is one character away', () => {
    expect(backspace('     foo', 5, 4)).toBe('    foo')
  })

  it('counts the columns a tab already covered', () => {
    expect(backspace('\t  foo', 3, 4)).toBe('\tfoo')
  })

  it('leaves alignment padding between words alone', () => {
    expect(backspace('foo     bar', 8, 4)).toBe('foo    bar')
  })

  it('leaves the indentation alone once the caret is past it', () => {
    expect(backspace('    foo', 7, 4)).toBe('    fo')
  })
})

describe('backspace reads', () => {
  it('costs the same however long the document is', () => {
    const short = charactersReadForBackspace(20)
    const long = charactersReadForBackspace(20_000)

    expect(long).toBeGreaterThan(0)
    expect(long).toBe(short)
  })
})

/** Characters pulled out of the buffer while one backspace at the end of the document resolves. */
function charactersReadForBackspace(lineCount: number): number {
  const text = Array.from({ length: lineCount }, () => 'const alpha = beta').join('\n')
  const snapshot = createPieceTableSnapshot(text)
  const set = createSelectionSet([createAnchorSelection(snapshot, snapshot.length)])

  readCounter.characters = 0
  backspaceSelections(snapshot, set)
  return readCounter.characters
}

describe('clusters longer than one search window', () => {
  // Two people, each with a skin tone, joined: twelve UTF-16 units, which is
  // more than the search opens with. A window that lands inside it hands the
  // segmenter a head that is not a cluster start.
  const HANDSHAKE = '\u{1F9D1}\u{1F3FD}‍\u{1F91D}‍\u{1F9D1}\u{1F3FF}'
  const FLAGS = '\u{1F1FA}\u{1F1F8}\u{1F1FA}\u{1F1F8}\u{1F1FA}'

  it('steps back over one the same way it stepped forward over it', () => {
    const text = `hi ${HANDSHAKE} x`
    const start = 3
    const end = start + HANDSHAKE.length

    expect(nextGraphemeBoundary(text, start)).toBe(end)
    expect(previousGraphemeBoundary(text, end)).toBe(start)
  })

  it('walks a run of flags back to where walking forward put it', () => {
    const forward: number[] = []
    for (let offset = 0; offset < FLAGS.length;) {
      offset = nextGraphemeBoundary(FLAGS, offset)
      forward.push(offset)
    }

    const backward: number[] = []
    for (let offset = FLAGS.length; offset > 0;) {
      offset = previousGraphemeBoundary(FLAGS, offset)
      backward.push(offset)
    }

    expect(backward.toReversed()).toEqual([0, ...forward.slice(0, -1)])
  })

  it('keeps a combining mark with the character it marks', () => {
    // U+0300 sits exactly on the boundary of the solo-character fast path.
    const text = `àb`

    expect(previousGraphemeBoundary(text, 2)).toBe(0)
    expect(nextGraphemeBoundary(text, 0)).toBe(2)
  })
})
