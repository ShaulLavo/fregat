import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStringTextSnapshot } from '@singapore-editor/core/document'
import {
  FIND_MATCHES_LIMIT,
  findNextMatchFrom,
  findPreviousMatchFrom,
  findMatches,
  type FindMatch,
  type FindQuery,
  type FindTextSource,
} from '../src/search'
import {
  assertFindState,
  findTest,
  findTextSource,
  type FindHarness,
  type FindRangeTuple,
} from './findHarness'

// One line per match, so a cursor placed past the cap sits on a line the painted
// set stops short of — the only place the two navigation paths can disagree.
const CAPPED_LINE = 'foo\n'
const CAPPED_TEXT = CAPPED_LINE.repeat(FIND_MATCHES_LIMIT + 2)
const CAPPED_LINE_WIDTH = CAPPED_LINE.length

// Short enough that no gap in a typing run can reach the deferral, so only its
// ceiling can let the re-search through.
const KEYSTROKE_GAP_MS = 90

const REPLACE_FILLER = 'head\n'.repeat(200)

// The cursor stays where the case put it while the query is typed: every
// keystroke re-searches, and one that moved the cursor would walk it off the
// line the case is about before the first press.
const CAPPED_OPTIONS = { seedSearchStringFromSelection: 'never', cursorMoveOnType: false } as const

describe('find navigation past the paint cap', () => {
  findTest(
    'reads the document once for a query that matches nothing',
    { text: 'alpha\nbravo\ncharlie', options: { seedSearchStringFromSelection: 'never' } },
    (harness) => {
      harness.openFind()
      harness.typeSearch('zul')
      const before = harness.documentReads().length
      harness.typeSearch('u')

      // The listing already says there is nothing to land on. Asking navigation
      // anyway is a scan ahead and a wrapped scan more, on every keystroke.
      expect(harness.documentReads().length - before).toBe(1)
      assertFindState(harness, {
        matches: [],
        current: null,
        selection: [0, 0],
        count: 'No results',
      })
    },
  )

  findTest(
    'reaches the next match rather than the top of the document',
    {
      text: CAPPED_TEXT,
      // One match past the last painted one, so every entry in the painted set
      // sits behind the cursor.
      selection: cappedMatchStart(FIND_MATCHES_LIMIT),
      options: CAPPED_OPTIONS,
    },
    (harness) => {
      harness.openFind()
      harness.typeSearch('foo')
      harness.pressEnter()
      assertFindState(harness, {
        matches: FIND_MATCHES_LIMIT,
        current: cappedMatch(FIND_MATCHES_LIMIT),
        selection: cappedMatch(FIND_MATCHES_LIMIT),
        // Numbered and totalled past the cap: only the painting stops there.
        count: `${FIND_MATCHES_LIMIT + 1} of ${FIND_MATCHES_LIMIT + 2}`,
      })

      harness.pressEnter()
      assertFindState(harness, {
        matches: FIND_MATCHES_LIMIT,
        current: cappedMatch(FIND_MATCHES_LIMIT + 1),
        selection: cappedMatch(FIND_MATCHES_LIMIT + 1),
        count: `${FIND_MATCHES_LIMIT + 2} of ${FIND_MATCHES_LIMIT + 2}`,
      })

      // Backwards from there is the match just crossed, not the last painted one:
      // the cap is where the highlights stop, not where the document does.
      harness.pressShiftEnter()
      assertFindState(harness, {
        matches: FIND_MATCHES_LIMIT,
        current: cappedMatch(FIND_MATCHES_LIMIT),
        selection: cappedMatch(FIND_MATCHES_LIMIT),
        count: `${FIND_MATCHES_LIMIT + 1} of ${FIND_MATCHES_LIMIT + 2}`,
      })

      // Onto the last match in the document, and then off the end of it.
      harness.pressEnter()
      harness.pressEnter()
      assertFindState(harness, {
        matches: FIND_MATCHES_LIMIT,
        current: cappedMatch(0),
        selection: cappedMatch(0),
        count: `1 of ${FIND_MATCHES_LIMIT + 2}`,
      })
    },
  )

  findTest(
    'still stops at the last match when looping is off',
    {
      text: CAPPED_TEXT,
      selection: cappedMatchStart(FIND_MATCHES_LIMIT),
      options: { ...CAPPED_OPTIONS, loop: false },
    },
    (harness) => {
      harness.openFind()
      harness.typeSearch('foo')
      harness.pressEnter()
      harness.pressEnter()
      assertFindState(harness, {
        matches: FIND_MATCHES_LIMIT,
        current: cappedMatch(FIND_MATCHES_LIMIT + 1),
        selection: cappedMatch(FIND_MATCHES_LIMIT + 1),
        count: `${FIND_MATCHES_LIMIT + 2} of ${FIND_MATCHES_LIMIT + 2}`,
      })

      // Nothing ahead and nothing to wrap to, so the last match is where this
      // stays rather than being answered from the top of the document.
      harness.pressEnter()
      assertFindState(harness, {
        matches: FIND_MATCHES_LIMIT,
        current: cappedMatch(FIND_MATCHES_LIMIT + 1),
        selection: cappedMatch(FIND_MATCHES_LIMIT + 1),
        count: `${FIND_MATCHES_LIMIT + 2} of ${FIND_MATCHES_LIMIT + 2}`,
      })
    },
  )
})

describe('find replace one', () => {
  findTest(
    'replaces with capture groups without enumerating the document for them',
    {
      // Filler first and the only match last, so a scan that starts at the
      // cursor never reads the first line while a listing has to.
      text: `${REPLACE_FILLER}f00 tail`,
      selection: REPLACE_FILLER.length,
      options: { seedSearchStringFromSelection: 'never' },
    },
    (harness) => {
      const match: FindRangeTuple = [REPLACE_FILLER.length, REPLACE_FILLER.length + 3]
      harness.openFindReplace()
      harness.clickRegex()
      harness.typeSearch('f(0+)')
      harness.typeReplacement('[$1]')
      assertFindState(harness, {
        matches: [match],
        current: match,
        selection: match,
        count: '1 of 1',
        toggles: ['regex'],
      })

      const scansBefore = countLeadingScans(harness)
      harness.pressReplaceEnter()

      // One scan, for what the edit left behind. A second means the capture
      // groups were recovered by listing the whole document with a capture array
      // allocated for every match in it.
      expect(countLeadingScans(harness) - scansBefore).toBe(1)
      assertFindState(harness, {
        matches: [],
        current: null,
        selection: [match[0] + 4, match[0] + 4],
        count: 'No results',
        text: `${REPLACE_FILLER}[00] tail`,
      })
    },
  )

  findTest(
    'replaces a whole match rather than the tail of the one the caret sits inside',
    {
      text: 'alpha beta',
      selection: 2,
      options: { seedSearchStringFromSelection: 'never', cursorMoveOnType: false },
    },
    (harness) => {
      harness.openFindReplace()
      harness.clickRegex()
      harness.typeSearch('\\w+')
      harness.typeReplacement('X')
      assertFindState(harness, {
        matches: [
          [0, 5],
          [6, 10],
        ],
        current: null,
        selection: [2, 2],
        count: '? of 2',
        toggles: ['regex'],
      })

      // The caret is inside the first painted match, which nothing moves it off:
      // a selection-kind update is not a re-search. What Replace selects has to
      // be one of the two ranges the reader is being shown.
      harness.pressReplaceEnter()
      assertFindState(harness, {
        matches: [
          [0, 5],
          [6, 10],
        ],
        current: [6, 10],
        selection: [6, 10],
        count: '2 of 2',
        text: 'alpha beta',
      })

      harness.pressReplaceEnter()
      assertFindState(harness, {
        matches: [
          [0, 5],
          [6, 7],
        ],
        current: [0, 5],
        selection: [0, 5],
        count: '1 of 2',
        text: 'alpha X',
      })
    },
  )

  findTest(
    'selects the match the cursor is only in front of, and replaces it on the next press',
    {
      text: 'foo foo',
      selection: 4,
      options: { seedSearchStringFromSelection: 'never', cursorMoveOnType: false },
    },
    (harness) => {
      harness.openFindReplace()
      harness.typeSearch('foo')
      harness.typeReplacement('bar')

      // The one match the scan from the cursor found is not what is selected, so
      // this press is the one that gets there.
      harness.pressReplaceEnter()
      assertFindState(harness, {
        matches: [
          [0, 3],
          [4, 7],
        ],
        current: [4, 7],
        selection: [4, 7],
        count: '2 of 2',
        text: 'foo foo',
      })

      harness.pressReplaceEnter()
      assertFindState(harness, {
        matches: [[0, 3]],
        current: [0, 3],
        selection: [0, 3],
        count: '1 of 1',
        text: 'foo bar',
      })
    },
  )
})

describe('find across a document swap', () => {
  findTest(
    'drops a scope taken from the document that was closed',
    {
      text: 'head\nfoo mid\ntail\n',
      selection: [5, 12],
      options: { seedSearchStringFromSelection: 'never' },
    },
    (harness) => {
      harness.openFind()
      harness.clickScope()
      harness.typeSearch('foo')
      assertFindState(harness, {
        matches: [[5, 8]],
        current: [5, 8],
        selection: [5, 8],
        scope: [[5, 12]],
        count: '1 of 1',
        toggles: ['inSelection'],
      })

      harness.openDocument('foo aaa\nbbb foo\nccc foo\n')

      // The ranges the scope was held by belong to the buffer that just went
      // away. Resolved against the one that replaced it they land on text the
      // user never marked, so the search that used to be confined to a selection
      // is now confined to a region nobody drew — and Replace All would rewrite
      // inside it.
      assertFindState(harness, {
        matches: [
          [0, 3],
          [12, 15],
          [20, 23],
        ],
        current: null,
        selection: [0, 0],
        scope: null,
        count: '? of 3',
        toggles: [],
      })
    },
  )
})

describe('find deferred re-search', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  findTest(
    'holds the painted matches on their own text until the re-search lands',
    { text: 'foo one\nfoo two', options: { seedSearchStringFromSelection: 'never' } },
    (harness) => {
      harness.openFind()
      harness.typeSearch('foo')
      assertFindState(harness, {
        matches: [
          [0, 3],
          [8, 11],
        ],
        current: [0, 3],
        selection: [0, 3],
        count: '1 of 2',
      })

      harness.typeInDocument(4, 'foo ')

      // Both painted matches are still the two that were found, and both are
      // still on the text they were found in — the second one has been carried
      // along by the four characters inserted in front of it. The match the
      // insertion just created is not painted yet, because nothing has searched
      // for it: that is what the deferral costs, and all it costs.
      assertFindState(harness, {
        matches: [
          [0, 3],
          [12, 15],
        ],
        current: null,
        selection: [8, 8],
        count: '? of 2',
        text: 'foo foo one\nfoo two',
      })

      vi.runOnlyPendingTimers()
      assertFindState(harness, {
        matches: [
          [0, 3],
          [4, 7],
          [12, 15],
        ],
        current: null,
        selection: [8, 8],
        count: '? of 3',
        text: 'foo foo one\nfoo two',
      })
    },
  )

  findTest(
    'still re-searches inside a typing run that never pauses',
    { text: 'foo one\nfoo two', options: { seedSearchStringFromSelection: 'never' } },
    (harness) => {
      harness.openFind()
      harness.typeSearch('foo')

      // Ten keystrokes, no two of them a debounce apart: waiting for quiet alone
      // would still be waiting at the end of this, with the match the first
      // three keystrokes wrote nowhere to be seen.
      let caret = 'foo one\nfoo two'.length
      for (const character of 'fooxxxxxxx') {
        harness.typeInDocument(caret, character)
        caret += character.length
        vi.advanceTimersByTime(KEYSTROKE_GAP_MS)
      }

      assertFindState(harness, {
        matches: [
          [0, 3],
          [8, 11],
          [15, 18],
        ],
        current: null,
        selection: [25, 25],
        count: '? of 3',
        text: 'foo one\nfoo twofooxxxxxxx',
      })
    },
  )
})

describe('find match search from an offset', () => {
  it('answers a query that consumes the break it would have stopped at', () => {
    const source = stringSource('a\nb a\nb')
    const crossing = plainQuery('a\nb')

    // Nothing here can be answered a line at a time, in either direction: the
    // match is the break.
    expect(range(findNextMatchFrom(source, crossing, 1))).toEqual([4, 7])
    expect(range(findPreviousMatchFrom(source, crossing, 7))).toEqual([4, 7])
    expect(range(findPreviousMatchFrom(source, crossing, 4))).toEqual([0, 3])
  })

  it('answers with a match the listing holds, not one begun at the cursor', () => {
    const source = stringSource('alpha beta')
    const words: FindQuery = {
      searchString: '\\w+',
      isRegex: true,
      matchCase: true,
      wholeWord: false,
    }

    // A caret inside a painted match is a state the reader can sit in. Scanning
    // from it lets a greedy pattern start a fresh match there, and 'pha' is in
    // nobody's match set — least of all the one being painted, which is what a
    // Replace then rewrites away from.
    expect(findMatches(source, words).map(range)).toEqual([
      [0, 5],
      [6, 10],
    ])
    expect(range(findNextMatchFrom(source, words, 2))).toEqual([6, 10])
  })

  it('answers an anchored pattern the cursor sits past the start of', () => {
    const source = stringSource('alpha beta')
    const anchored: FindQuery = {
      searchString: '^\\w+',
      isRegex: true,
      matchCase: true,
      wholeWord: false,
    }

    // Resumed at the cursor, `^` can no longer match where it does, so the one
    // match in the text is answered with nothing at all rather than by wrapping
    // onto it.
    expect(range(findNextMatchFrom(source, anchored, 2))).toEqual([0, 5])
  })

  it('reads no further back than the line the cursor is on', () => {
    const lines = Array.from({ length: 400 }, (_, row) => `row ${row} alpha`)
    const text = lines.join('\n')
    const cursor = text.indexOf('row 300')
    const reads: FindRangeTuple[] = []

    expect(
      range(findNextMatchFrom(recordingSource(text, reads), plainQuery('alpha'), cursor)),
    ).toEqual([cursor + 8, cursor + 13])
    // Whole lines rather than a slice cut at the cursor, but only lines from the
    // cursor's own onward: the 300 in front of it are not what the press asked
    // about.
    expect(reads).toEqual([[cursor, text.length]])
  })

  it('answers only from the ranges it was given', () => {
    const source = stringSource('foo foo foo')
    const query = plainQuery('foo')
    const scope = [{ start: 4, end: 11 }]

    expect(range(findNextMatchFrom(source, query, 0, scope))).toEqual([4, 7])
    expect(range(findPreviousMatchFrom(source, query, 11, scope))).toEqual([8, 11])
    // A cursor in the gap between two ranges belongs to neither, so each
    // direction skips past the range it has already left.
    const split = [
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ]
    expect(range(findNextMatchFrom(source, query, 5, split))).toEqual([8, 11])
    expect(range(findPreviousMatchFrom(source, query, 5, split))).toEqual([0, 3])
  })

  it('escapes zero-width matches and wraps in both directions', () => {
    const source = stringSource('one\ntwo\nthree')
    const anchored: FindQuery = {
      searchString: '^',
      isRegex: true,
      matchCase: true,
      wholeWord: false,
    }
    const escaping = { escapeEmptyMatchAtOffset: true }

    for (const { offset, next, previous } of [
      { offset: 0, next: 4, previous: 8 },
      { offset: 4, next: 8, previous: 0 },
      { offset: 8, next: 0, previous: 4 },
    ]) {
      expect(range(findNextMatchFrom(source, anchored, offset, null, escaping))).toEqual([
        next,
        next,
      ])
      expect(range(findPreviousMatchFrom(source, anchored, offset, null, escaping))).toEqual([
        previous,
        previous,
      ])
    }

    // With nowhere to wrap to, the pattern parked on the cursor is not an answer.
    expect(findNextMatchFrom(source, anchored, 8, null, { ...escaping, loop: false })).toBeNull()
    expect(
      findPreviousMatchFrom(source, anchored, 0, null, { ...escaping, loop: false }),
    ).toBeNull()
  })
})

function stringSource(text: string): FindTextSource {
  return findTextSource(createStringTextSnapshot(text))
}

function plainQuery(searchString: string): FindQuery {
  return { searchString, isRegex: false, matchCase: true, wholeWord: false }
}

// What a scan asked the document for: a match on its own reads the same however
// much text was walked to reach it.
function recordingSource(text: string, reads: FindRangeTuple[]): FindTextSource {
  const recorded = stringSource(text)
  return {
    length: recorded.length,
    readRange: (start, end) => {
      reads.push([start, end])
      return recorded.readRange(start, end)
    },
    lineStartsView: recorded.lineStartsView,
  }
}

function range(match: FindMatch | null): FindRangeTuple | null {
  return match ? [match.start, match.end] : null
}

function cappedMatchStart(index: number): number {
  return index * CAPPED_LINE_WIDTH
}

function cappedMatch(index: number): FindRangeTuple {
  const start = cappedMatchStart(index)
  return [start, start + CAPPED_LINE_WIDTH - 1]
}

// Reads of the first line, which a scan starting further down only makes if it
// went back to the top to list the whole document.
function countLeadingScans(harness: FindHarness): number {
  return harness.documentReads().filter(([start]) => start === 0).length
}
