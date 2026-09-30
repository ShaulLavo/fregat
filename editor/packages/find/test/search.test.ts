import { describe, expect, it, vi } from 'vitest'
import { createStringTextSnapshot } from '@singapore-editor/core/document'
import { parseReplaceString } from '../src/replacePattern'
import {
  FIND_MATCHES_LIMIT,
  FIND_WINDOW_UNITS,
  findMatches,
  findQueryPlan,
  findPreviousMatchFrom,
  findNextMatchFrom,
  type FindMatch,
  type FindQuery,
  type FindTextSource,
} from '../src/search'
import type { EditorFindWidgetState } from '../src/findController'
import { EditorFindWidget } from '../src/findWidget'
import {
  assertFindState,
  chunkedTextSnapshot,
  findTest,
  findTextSource,
  type FindRangeTuple,
} from './findHarness'

describe('editor search', () => {
  it('finds plain matches with case and whole-word options', () => {
    expect(
      findMatches(source('foo Foo food foo'), {
        searchString: 'foo',
        isRegex: false,
        matchCase: false,
        wholeWord: true,
      }).map(({ start, end }) => ({ start, end })),
    ).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 13, end: 16 },
    ])

    expect(
      findMatches(source('foo Foo'), {
        searchString: 'foo',
        isRegex: false,
        matchCase: true,
        wholeWord: false,
      }).map(({ start, end }) => ({ start, end })),
    ).toEqual([{ start: 0, end: 3 }])
  })

  it('uses shared unicode word boundaries', () => {
    expect(
      findMatches(source('café cafe café_2'), {
        searchString: 'café',
        isRegex: false,
        matchCase: true,
        wholeWord: true,
      }).map(({ start, end }) => ({ start, end })),
    ).toEqual([{ start: 0, end: 4 }])
  })

  it('finds regex, multiline, invalid-regex, zero-length, and limited matches', () => {
    const regexMatches = findMatches(
      source('one\ntwo\nthree'),
      { searchString: '^t\\w+', isRegex: true, matchCase: true, wholeWord: false },
      null,
      true,
    )
    expect(
      regexMatches.map(({ start, end, matches }) => ({ start, end, match: matches?.[0] })),
    ).toEqual([
      { start: 4, end: 7, match: 'two' },
      { start: 8, end: 13, match: 'three' },
    ])

    expect(
      findMatches(source('abc'), {
        searchString: '(',
        isRegex: true,
        matchCase: true,
        wholeWord: false,
      }),
    ).toEqual([])

    expect(
      findMatches(source('ab'), {
        searchString: '',
        isRegex: false,
        matchCase: true,
        wholeWord: false,
      }),
    ).toEqual([])

    expect(
      findMatches(
        source('aaa'),
        { searchString: 'a', isRegex: false, matchCase: true, wholeWord: false },
        null,
        false,
        2,
      ),
    ).toHaveLength(2)

    expect(
      findMatches(source('ab'), {
        searchString: '(?=)',
        isRegex: true,
        matchCase: true,
        wholeWord: false,
      }),
    ).toHaveLength(3)
  })

  it('still answers a pattern the unicode grammar refuses to compile', () => {
    // Unicode mode is stricter than the grammar these patterns were written
    // against: an identity escape of a character that needs no escaping, a
    // brace or bracket standing for itself, a legacy back-reference. Every one
    // of them is what a user gets from escaping a search by hand, and every one
    // of them compiles without the flag — so refusing them means answering "No
    // results" for text that is plainly there, with nothing on screen saying the
    // pattern was rejected rather than unmatched.
    for (const [pattern, text] of [
      ['\\-', 'a-b'],
      ['a\\ b', 'a b'],
      ['\\<div\\>', '<div>'],
      ['x{', 'x{'],
      ['}', '}'],
      [']', ']'],
      ['a{,3}', 'a{,3}'],
    ] as const) {
      expect(ranges(findMatches(source(text), regexQuery(pattern)))).not.toEqual([])
    }

    // The flag is still what a pattern that needs it gets: a property escape
    // means nothing without it, and a surrogate pair is one character under it.
    expect(ranges(findMatches(source('a1'), regexQuery('\\p{Nd}')))).toEqual([[1, 2]])
    expect(ranges(findMatches(source('a😀b'), regexQuery('.')))).toEqual([
      [0, 1],
      [1, 3],
      [3, 4],
    ])
  })

  it('anchors ^ and $ to the line a per-line haystack was cut from', () => {
    const text = 'alpha\nbravo\nalpha'

    // The pair is what makes a per-line search safe: the anchors mean the line's
    // own ends only while the break stays out of the haystack.
    expect(ranges(findMatches(source(text), regexQuery('alpha$')))).toEqual([
      [0, 5],
      [12, 17],
    ])
    expect(ranges(findMatches(source(text), regexQuery('^bravo')))).toEqual([[6, 11]])
  })

  it('still matches case-insensitively without folding', () => {
    const matches = findMatches(source('Foo foo FOO'), {
      searchString: 'foo',
      isRegex: false,
      matchCase: false,
      wholeWord: false,
    })

    expect(matches.map((match) => match.start)).toEqual([0, 4, 8])
  })

  it('keeps the plain-text path for caseless queries', () => {
    const matches = findMatches(source('a1b1c'), {
      searchString: '1',
      isRegex: false,
      matchCase: false,
      wholeWord: false,
    })

    expect(matches.map((match) => match.start)).toEqual([1, 3])
  })

  it('reports case-insensitive matches at unfolded offsets', () => {
    // Folding is not length-preserving: 'İ' (U+0130) lowercases to two code
    // units while 'ẞ' (U+1E9E) lowercases to one, so an index taken from a
    // folded copy runs ahead of the original text by one per 'İ' already seen.
    const text = 'aİstanbul ẞtraße stanbul'
    const matches = findMatches(source(text), {
      searchString: 'stanbul',
      isRegex: false,
      matchCase: false,
      wholeWord: false,
    })

    expect(matches.map(({ start, end }) => ({ start, end }))).toEqual([
      { start: 2, end: 9 },
      { start: 17, end: 24 },
    ])
    for (const match of matches) {
      expect(text.slice(match.start, match.end).toLowerCase()).toBe('stanbul')
    }
  })

  it('escapes a zero-width match parked on the navigation offset', () => {
    const text = 'one\ntwo\nthree'
    const anchoredMatches = findMatches(source(text), regexQuery('^'))

    expect(anchoredMatches.map((match) => match.start)).toEqual([0, 4, 8])
    expect(navigate(findNextMatchFrom, text, '^', 4)?.start).toBe(8)
    expect(navigate(findPreviousMatchFrom, text, '^', 4)?.start).toBe(0)

    const lookaheadMatches = findMatches(source('ab ab'), regexQuery('(?=b)'))

    expect(lookaheadMatches.map((match) => match.start)).toEqual([1, 4])
    expect(navigate(findNextMatchFrom, 'ab ab', '(?=b)', 1)?.start).toBe(4)
    expect(navigate(findPreviousMatchFrom, 'ab ab', '(?=b)', 4)?.start).toBe(1)
  })

  it('navigates past empty matches beside multiline matches', () => {
    const matches = findMatches(source('a,b\nc,d'), regexQuery('[^,]*'))

    expect(matches.map(({ start, end }) => [start, end])).toEqual([
      [0, 1],
      [1, 1],
      [2, 5],
      [5, 5],
      [6, 7],
      [7, 7],
    ])
    expect(navigate(findNextMatchFrom, 'a,b\nc,d', '[^,]*', 1)?.start).toBe(2)
    expect(navigate(findPreviousMatchFrom, 'a,b\nc,d', '[^,]*', 1)?.start).toBe(0)
  })

  it('keeps loop semantics while escaping', () => {
    const text = 'one\ntwo\nthree'

    expect(navigate(findNextMatchFrom, text, '^', 8, false)).toBeNull()
    expect(navigate(findPreviousMatchFrom, text, '^', 0, false)).toBeNull()
    expect(navigate(findNextMatchFrom, text, '^', 8)?.start).toBe(0)
    expect(navigate(findPreviousMatchFrom, text, '^', 0)?.start).toBe(8)

    // A non-empty match on the offset is where the user asked to be; escaping
    // is only ever for the zero-width case.
    expect(navigate(findNextMatchFrom, text, 't\\w+', 4)?.start).toBe(4)
  })

  it('parses replacement patterns and preserve-case replacements', () => {
    const pattern = parseReplaceString('[$&]-$1-$$-\\n-\\u$2')

    expect(pattern.buildReplaceString(['ab', 'a', 'b'])).toBe('[ab]-a-$-\n-B')
    expect(parseReplaceString('bar').buildReplaceString(['FOO'], true)).toBe('BAR')
    expect(parseReplaceString('bar-baz').buildReplaceString(['foo-qux'], true)).toBe('bar-baz')
    expect(parseReplaceString('bar_baz').buildReplaceString(['FOO_QUX'], true)).toBe('BAR_BAZ')
  })
})

describe('editor search reads', () => {
  it('reads whole lines in bounded windows for a query that cannot cross a break', () => {
    const line = 'alpha bravo charlie delta echo'
    const lines = Array.from({ length: 10_000 }, () => line)
    const text = lines.join('\n')
    const reads: FindRangeTuple[] = []

    const matches = findMatches(recordingSource(text, reads), plainQuery('alpha'))

    expect(matches).toHaveLength(lines.length)
    // Several reads, none of them the document, each one cut at line ends so no
    // match is ever split across two of them.
    expect(reads.length).toBeGreaterThan(1)
    for (const [start, end] of reads) {
      expect(end - start).toBeLessThanOrEqual(FIND_WINDOW_UNITS + line.length)
      expect(start % (line.length + 1)).toBe(0)
      expect((end + 1) % (line.length + 1)).toBe(0)
    }
  })

  it('gives an anchored pattern one line at a time out of each window', () => {
    const reads: FindRangeTuple[] = []
    const text = 'alpha\nbravo alpha\nalpha'

    // Under the multiline flag `$` would also stand before a carriage return.
    expect(ranges(findMatches(recordingSource(text, reads), regexQuery('^alpha$')))).toEqual([
      [0, 5],
      [18, 23],
    ])
    expect(ranges(findMatches(source('alpha\r\nalpha'), regexQuery('alpha$')))).toEqual([[7, 12]])
    expect(reads).toEqual([[0, text.length]])
  })

  it('reads only the lines a scope covers', () => {
    const lines = Array.from({ length: 500 }, (_, row) => `row ${row} alpha`)
    const text = lines.join('\n')
    const scopeStart = text.indexOf('row 200')
    const scopeEnd = scopeStart + lines[200]!.length + 1 + lines[201]!.length
    const reads: FindRangeTuple[] = []

    const matches = findMatches(recordingSource(text, reads), plainQuery('alpha'), [
      { start: scopeStart, end: scopeEnd },
    ])

    expect(ranges(matches)).toEqual([
      [scopeStart + 8, scopeStart + 13],
      [scopeEnd - 5, scopeEnd],
    ])
    // One read of the two lines, and none of the 500 around them.
    expect(reads).toEqual([[scopeStart, scopeEnd]])
  })

  it('reads a line-bounded window for a query that can cross a break', () => {
    const reads: FindRangeTuple[] = []

    const matches = findMatches(recordingSource('a,b\nc,d\ne,f', reads), regexQuery('[^,]*'), [
      { start: 0, end: 5 },
    ])

    // The break is match material here, so the window has to hold it — and it is
    // read out to the end of the line it stops on, or the anchors would answer
    // for a cut that is no line end. What is kept is still only the scope.
    expect(ranges(matches)).toEqual([
      [0, 1],
      [1, 1],
      [2, 5],
      [5, 5],
    ])
    expect(reads).toEqual([[0, 7]])
  })

  it('finds a match no single chunk of the buffer holds', () => {
    const text = 'one\ntwo needle three\nfour'
    const snapshot = chunkedTextSnapshot(text)
    const boundaries: number[] = []
    snapshot.forEachTextChunk((_chunk, start) => {
      boundaries.push(start)
    })

    // The one thing a search has to be able to assume about a buffer it never
    // materializes: a range it asks for arrives assembled, however the buffer
    // happens to hold it. Nothing else a source exposes carries chunk positions,
    // so this is where a reader that handed back one chunk would be caught —
    // running every other case over a second chunking could not catch it.
    expect(boundaries.some((start) => start > 8 && start < 14)).toBe(true)
    expect(ranges(findMatches(findTextSource(snapshot), plainQuery('needle')))).toEqual([[8, 14]])
  })
})

describe('editor find controller', () => {
  findTest(
    'walks off a zero-width match instead of re-selecting it',
    { text: 'one\ntwo\nthree', options: { seedSearchStringFromSelection: 'never' } },
    (harness) => {
      // Repeated at every step on purpose: navigating an anchor pattern must
      // move the current match without disturbing the painted set.
      const lineStarts: readonly FindRangeTuple[] = [
        [0, 0],
        [4, 4],
        [8, 8],
      ]

      harness.openFind()
      harness.clickRegex()
      harness.typeSearch('^')
      assertFindState(harness, {
        matches: lineStarts,
        current: [0, 0],
        selection: [0, 0],
        count: '1 of 3',
        toggles: ['regex'],
      })

      harness.pressEnter()
      assertFindState(harness, {
        matches: lineStarts,
        current: [4, 4],
        selection: [4, 4],
        count: '2 of 3',
      })

      harness.pressEnter()
      assertFindState(harness, {
        matches: lineStarts,
        current: [8, 8],
        selection: [8, 8],
        count: '3 of 3',
      })

      harness.pressShiftEnter()
      assertFindState(harness, {
        matches: lineStarts,
        current: [4, 4],
        selection: [4, 4],
        count: '2 of 3',
      })
    },
  )

  findTest(
    'escapes regex metacharacters when seeding from the selection',
    { text: 'call foo(bar) now', selection: [5, 13] },
    (harness) => {
      harness.toggleRegex()
      harness.openFind()

      assertFindState(harness, {
        matches: [[5, 13]],
        current: [5, 13],
        selection: [5, 13],
        count: '1 of 1',
        searchString: 'foo\\(bar\\)',
        toggles: ['regex'],
      })
    },
  )

  findTest(
    'seeds the word under a caret that sits on a later line',
    { text: 'alpha beta\ngamma delta epsilon', selection: 12 },
    (harness) => {
      harness.openFind()

      // The caret's own line is the only text the word scan is given, so a scan
      // handed a document offset would report a word from further along it.
      assertFindState(harness, {
        matches: [[11, 16]],
        current: null,
        selection: [12, 12],
        count: '? of 1',
        searchString: 'gamma',
      })
    },
  )

  findTest(
    'refuses to seed from an oversized selection',
    { text: 'x'.repeat(600_000), selection: [0, 600_000] },
    (harness) => {
      harness.openFind()

      assertFindState(harness, {
        matches: [],
        current: null,
        selection: [0, 600_000],
        count: 'No results',
        searchString: '',
      })
    },
  )

  findTest(
    'confines matches to the scope and paints it',
    {
      text: 'foo one\nfoo two\nfoo three',
      selection: [0, 15],
      options: { seedSearchStringFromSelection: 'never' },
    },
    (harness) => {
      harness.openFind()
      harness.clickScope()
      harness.typeSearch('foo')

      assertFindState(harness, {
        matches: [
          [0, 3],
          [8, 11],
        ],
        current: [0, 3],
        selection: [0, 3],
        scope: [[0, 15]],
        count: '1 of 2',
        toggles: ['inSelection'],
      })
    },
  )

  findTest(
    'holds the scope through a replace and keeps Replace All inside it',
    {
      text: 'foo one\nfoo two foo\nfoo three',
      selection: [8, 19],
      options: { seedSearchStringFromSelection: 'never' },
    },
    (harness) => {
      harness.openFindReplace()
      harness.clickScope()
      harness.typeSearch('foo')
      harness.typeReplacement('bar!')
      assertFindState(harness, {
        matches: [
          [8, 11],
          [16, 19],
        ],
        current: [8, 11],
        selection: [8, 11],
        scope: [[8, 19]],
        count: '1 of 2',
      })

      harness.pressReplaceEnter()
      // The caret now sits on the replacement rather than on the region the
      // scope was marked from, and the scope has grown by the character the
      // replacement added.
      assertFindState(harness, {
        matches: [[17, 20]],
        current: [17, 20],
        selection: [17, 20],
        scope: [[8, 20]],
        count: '1 of 1',
        text: 'foo one\nbar! two foo\nfoo three',
      })

      harness.clickReplaceAll()
      // The lines either side of the scope still read as they did: a scope that
      // had widened to the document would have taken them too.
      assertFindState(harness, {
        matches: [],
        current: null,
        selection: [17, 20],
        scope: [[8, 21]],
        count: 'No results',
        text: 'foo one\nbar! two bar!\nfoo three',
      })
    },
  )

  findTest(
    'drops a scope whose text is gone instead of searching the whole document',
    {
      text: 'bbb bbb bbb',
      selection: [4, 7],
      options: { seedSearchStringFromSelection: 'never' },
    },
    (harness) => {
      harness.openFindReplace()
      harness.clickScope()
      harness.typeSearch('bbb')
      assertFindState(harness, {
        matches: [[4, 7]],
        current: [4, 7],
        selection: [4, 7],
        scope: [[4, 7]],
        count: '1 of 1',
      })

      // Replacing the only match with nothing leaves the scope holding no text
      // at all — the one state an offset pair cannot tell apart from having no
      // scope, and the one where guessing wrong empties the document.
      harness.pressReplaceEnter()
      assertFindState(harness, {
        matches: [],
        current: null,
        selection: [4, 4],
        scope: [],
        count: 'No results',
        text: 'bbb  bbb',
      })

      harness.clickReplaceAll()
      assertFindState(harness, {
        matches: [],
        current: null,
        selection: [4, 4],
        scope: [],
        count: 'No results',
        text: 'bbb  bbb',
      })
    },
  )

  findTest(
    'replaces the match under the cursor and re-searches what is left',
    { text: 'foo foo foo', options: { seedSearchStringFromSelection: 'never' } },
    (harness) => {
      harness.openFindReplace()
      harness.typeSearch('foo')
      harness.typeReplacement('bar')
      assertFindState(harness, {
        matches: [
          [0, 3],
          [4, 7],
          [8, 11],
        ],
        current: [8, 11],
        selection: [8, 11],
        count: '3 of 3',
      })

      harness.pressReplaceEnter()
      assertFindState(harness, {
        matches: [
          [0, 3],
          [4, 7],
        ],
        current: [0, 3],
        selection: [0, 3],
        count: '1 of 2',
        text: 'foo foo bar',
      })
    },
  )

  findTest(
    'keeps the current match reversed and on its chosen visual side when selecting all matches',
    {
      text: 'foo foo',
      selection: { anchor: 7, head: 4, affinity: 'before' },
    },
    (harness) => {
      harness.openFind()

      expect(harness.selectAllMatches()).toBe(true)
      expect(harness.state().selectionDetails).toEqual([
        { anchor: 7, head: 4, affinity: 'before' },
        { anchor: 0, head: 3, affinity: 'after' },
      ])
    },
  )

  findTest(
    'selects every match, not just the painted ones',
    {
      text: 'a'.repeat(FIND_MATCHES_LIMIT + 2),
      options: { seedSearchStringFromSelection: 'never' },
    },
    (harness) => {
      harness.openFind()
      harness.typeSearch('a')
      assertFindState(harness, {
        matches: FIND_MATCHES_LIMIT,
        current: [0, 1],
        selection: [0, 1],
        count: `1 of ${FIND_MATCHES_LIMIT + 2}`,
      })

      expect(harness.selectAllMatches()).toBe(true)
      assertFindState(harness, {
        matches: FIND_MATCHES_LIMIT,
        current: [0, 1],
        selection: [0, 1],
        count: `1 of ${FIND_MATCHES_LIMIT + 2}`,
        selectionCount: FIND_MATCHES_LIMIT + 2,
      })
    },
  )

  findTest(
    'replaces every match, not just the painted ones',
    {
      text: 'a'.repeat(FIND_MATCHES_LIMIT + 2),
      options: { seedSearchStringFromSelection: 'never' },
    },
    (harness) => {
      harness.openFindReplace()
      harness.typeSearch('a')
      harness.typeReplacement('b')
      assertFindState(harness, {
        matches: FIND_MATCHES_LIMIT,
        current: [0, 1],
        selection: [0, 1],
        count: `1 of ${FIND_MATCHES_LIMIT + 2}`,
      })

      harness.clickReplaceAll()
      // Stopping at the paint cap would leave a tail of untouched matches
      // behind, which is the silent half-replacement this guards against.
      assertFindState(harness, {
        matches: [],
        current: null,
        selection: [0, 1],
        count: 'No results',
        text: 'b'.repeat(FIND_MATCHES_LIMIT + 2),
      })
    },
  )

  findTest(
    'counts a result set that stops exactly at the cap as complete',
    { text: 'a'.repeat(FIND_MATCHES_LIMIT), options: { seedSearchStringFromSelection: 'never' } },
    (harness) => {
      harness.openFind()
      harness.typeSearch('a')

      assertFindState(harness, {
        matches: FIND_MATCHES_LIMIT,
        current: [0, 1],
        selection: [0, 1],
        count: `1 of ${FIND_MATCHES_LIMIT}`,
      })
    },
  )
})

describe('editor find widget', () => {
  it('shows an exact count and says when only the painting stopped', () => {
    const container = document.createElement('div')
    const widget = new EditorFindWidget(container, container, widgetOptions())

    widget.update(widgetState({ matchesPosition: 2, matchesCount: 3 }))
    expect(countElement(container)?.textContent).toBe('2 of 3')
    expect(countElement(container)?.title).toBe('2 of 3')

    widget.update(
      widgetState({
        matchesPosition: 30_000,
        matchesCount: 500_000,
        highlightsTruncated: true,
      }),
    )
    expect(countElement(container)?.textContent).toBe('30000 of 500000')
    expect(countElement(container)?.title).toContain(`first ${FIND_MATCHES_LIMIT} results`)
    expect(countElement(container)?.title).toContain('entire text')

    widget.dispose()
  })
})

function regexQuery(searchString: string): FindQuery {
  return { searchString, isRegex: true, matchCase: true, wholeWord: false }
}

function plainQuery(searchString: string): FindQuery {
  return { searchString, isRegex: false, matchCase: true, wholeWord: false }
}

function source(text: string): FindTextSource {
  return findTextSource(createStringTextSnapshot(text))
}

// Records what a search asked the document for, which is the whole point of the
// source: a match set alone cannot tell a per-line read from a full copy.
function recordingSource(text: string, reads: FindRangeTuple[]): FindTextSource {
  const recorded = source(text)
  return {
    length: recorded.length,
    readRange: (start, end) => {
      reads.push([start, end])
      return recorded.readRange(start, end)
    },
    lineStartsView: recorded.lineStartsView,
  }
}

function ranges(matches: readonly FindMatch[]): readonly FindRangeTuple[] {
  return matches.map((match) => [match.start, match.end])
}

function widgetState(overrides: Partial<EditorFindWidgetState> = {}): EditorFindWidgetState {
  return {
    searchString: 'a',
    replaceString: '',
    isRegex: false,
    matchCase: false,
    wholeWord: false,
    preserveCase: false,
    revealed: true,
    replaceRevealed: false,
    inSelection: false,
    matchesCount: 0,
    matchesPosition: 0,
    highlightsTruncated: false,
    ...overrides,
  }
}

function widgetOptions() {
  return {
    onSearchInput: vi.fn(),
    onReplaceInput: vi.fn(),
    onToggleReplace: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onClose: vi.fn(),
    onToggleCase: vi.fn(),
    onToggleWholeWord: vi.fn(),
    onToggleRegex: vi.fn(),
    onToggleScope: vi.fn(),
    onTogglePreserveCase: vi.fn(),
    onReplaceOne: vi.fn(),
    onReplaceAll: vi.fn(),
  }
}

function countElement(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('.editor-find-count')
}

describe('searching text a line at a time', () => {
  function source(text: string): FindTextSource {
    return findTextSource(createStringTextSnapshot(text))
  }

  function found(text: string, query: FindQuery): readonly FindRangeTuple[] {
    return findMatches(source(text), query).map((match) => [match.start, match.end])
  }

  function regex(searchString: string): FindQuery {
    return { searchString, isRegex: true, matchCase: true, wholeWord: false }
  }

  it('answers a pattern whose break-matching construct nobody enumerated', () => {
    // Deciding by listing the constructs that CAN hold a break means one nobody
    // thought of answers "no results" for text that is plainly there.
    for (const pattern of ['a[\\s\\S]b', 'a\\u000ab', 'a\\x0ab', 'a[^x]b']) {
      expect(found('a\nb', regex(pattern))).toEqual([[0, 3]])
    }
  })

  it('answers a group that turns a break-free construct into a break-matching one', () => {
    // A group's opener can change what the characters inside it mean, so one that
    // is not a plain bundle is exactly the construct nobody enumerated.
    for (const pattern of ['(?s:a.b)', '(?s-i:a.b)', '(?is:a.b)', '(?s:a.)b']) {
      expect(found('a\nb', regex(pattern))).toEqual([[0, 3]])
    }
  })

  it('still windows a pattern whose groups only bundle', () => {
    expect(found('alpha\nbravo', regex('(?<!x)(?:al)(?=pha)(?<middle>p)(ha)'))).toEqual([[0, 5]])
    expect(findQueryPlan(regex('(?<!x)(?:al)(?=pha)(?<middle>p)(ha)'))).toEqual({ kind: 'lines' })
  })

  it('names how each query is read, and why one is read whole', () => {
    expect(findQueryPlan(regex('[a-z]+'))).toEqual({ kind: 'lines' })
    expect(findQueryPlan(regex('^[a-z]+'))).toEqual({ kind: 'anchored-lines' })
    expect(findQueryPlan(regex('[$^]+\\$'))).toEqual({ kind: 'lines' })
    expect(findQueryPlan(plainQuery('a\nb\nc'))).toEqual({ kind: 'literal-lines', lineBreaks: 2 })
    expect(findQueryPlan(regex('a\\sb'))).toEqual({
      kind: 'range',
      reason: 'pattern-may-match-line-break',
    })
    expect(findQueryPlan(regex('('))).toBeNull()
  })

  it('walks back to the nearest match, not to the last one a paint budget allowed', () => {
    const text = 'a'.repeat(FIND_MATCHES_LIMIT + 2)

    // Every match in a listing that stopped at the cap sits far behind a cursor
    // at the end of the document.
    expect(findPreviousMatchFrom(source(text), plainQuery('a'), text.length, null, {})?.start).toBe(
      text.length - 1,
    )
  })

  it('reports text two overlapping scopes share only once', () => {
    // Scopes are followed through edits, and an edit across the seam between two
    // leaves them overlapping.
    expect(
      findMatches(source('aaaa'), plainQuery('a'), [
        { start: 0, end: 3 },
        { start: 2, end: 4 },
      ]).map((match) => match.start),
    ).toEqual([0, 1, 2, 3])
  })
})

function navigate(
  find: typeof findNextMatchFrom,
  text: string,
  pattern: string,
  offset: number,
  loop = true,
): FindMatch | null {
  return find(source(text), regexQuery(pattern), offset, null, {
    loop,
    escapeEmptyMatchAtOffset: true,
  })
}
