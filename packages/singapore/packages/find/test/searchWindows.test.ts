import { describe, expect, it } from 'vitest'
import {
  createDocumentTextSnapshot,
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
  isWholeWordRange,
} from '@singapore-editor/core/document'
import {
  countMatches,
  escapeRegExpCharacters,
  FIND_REPLACE_ALL_LIMIT,
  FIND_WINDOW_UNITS,
  findMatches,
  findNextMatchFrom,
  findPreviousMatchFrom,
  findTextSourceFromSnapshot,
  type FindQuery,
  type FindTextSource,
} from '../src/search'
import type { FindRangeTuple } from './findHarness'

type OracleQuery = FindQuery & { readonly crossesLines: boolean }

const ALPHABET = ['a', 'a', 'b', 'A', ' ', ' ', '\n', '\n', '\r', '_', '😀', 'İ']

const QUERIES: readonly OracleQuery[] = [
  literal('ab'),
  literal('aa'),
  literal('aba'),
  literal('ab', { wholeWord: true }),
  literal('a', { wholeWord: true }),
  literal('Ab', { matchCase: false }),
  literal('😀'),
  literal('a\nb', { crossesLines: true }),
  literal('a\na', { crossesLines: true }),
  literal('\n', { crossesLines: true }),
  literal('\n\n', { crossesLines: true }),
  literal('a\na', { crossesLines: true, wholeWord: true }),
  literal('A\nA', { crossesLines: true, matchCase: false }),
  regex('a+b'),
  regex('^a'),
  regex('b$'),
  regex('^$'),
  regex('a*'),
  regex('\\bab\\b'),
  regex('(?<=a)b(?!b)'),
  regex('(?<!a)a', { wholeWord: true }),
  regex('[ab]+', { matchCase: false }),
  regex('.'),
  regex('a\\nb', { crossesLines: true }),
  regex('a\\s+b', { crossesLines: true }),
  regex('[^a]+$', { crossesLines: true }),
]

function literal(searchString: string, options: Partial<OracleQuery> = {}): OracleQuery {
  return {
    searchString,
    isRegex: false,
    matchCase: true,
    wholeWord: false,
    crossesLines: false,
    ...options,
  }
}

function regex(searchString: string, options: Partial<OracleQuery> = {}): OracleQuery {
  return { ...literal(searchString, options), isRegex: true }
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function randomText(random: () => number, length: number): string {
  let text = ''
  while (text.length < length) text += ALPHABET[Math.floor(random() * ALPHABET.length)] ?? ''
  return text
}

// The search as it was before windows: one haystack per line for a query that
// cannot hold a break, the whole text under the multiline flag for one that can.
function oracle(text: string, query: OracleQuery): readonly FindRangeTuple[] {
  if (query.crossesLines) return haystackMatches(text, 0, query, 'm')

  const found: FindRangeTuple[] = []
  let lineStart = 0
  for (const line of text.split('\n')) {
    found.push(...haystackMatches(line, lineStart, query, ''))
    lineStart += line.length + 1
  }
  return found
}

function haystackMatches(
  haystack: string,
  base: number,
  query: OracleQuery,
  extraFlags: string,
): readonly FindRangeTuple[] {
  const pattern = query.isRegex ? query.searchString : escapeRegExpCharacters(query.searchString)
  const matcher = new RegExp(pattern, `gu${query.matchCase ? '' : 'i'}${extraFlags}`)
  const found: FindRangeTuple[] = []
  for (const match of haystack.matchAll(matcher)) {
    const range = { start: match.index, end: match.index + match[0].length }
    if (query.wholeWord && !isWholeWordRange(haystack, range)) continue

    found.push([base + range.start, base + range.end])
  }
  return found
}

function listed(source: FindTextSource, query: FindQuery): readonly FindRangeTuple[] {
  return findMatches(source, query, null, false, FIND_REPLACE_ALL_LIMIT).map((match) => [
    match.start,
    match.end,
  ])
}

function fragmentedSource(text: string, random: () => number): FindTextSource {
  let table = createPieceTableSnapshot(text)
  for (let edit = 0; edit < 400; edit += 1) {
    const offset = Math.floor(random() * table.length)
    table =
      edit % 3 === 0
        ? deleteFromPieceTable(table, offset, 1 + Math.floor(random() * 3))
        : insertIntoPieceTable(table, offset, randomText(random, 1 + Math.floor(random() * 5)))
  }
  return findTextSourceFromSnapshot(createDocumentTextSnapshot(table))
}

describe('windowed search against the line-at-a-time oracle', () => {
  // Long enough that every query crosses several window seams, at seams that
  // land somewhere different for each seed.
  const LENGTH = FIND_WINDOW_UNITS * 3 + 1_000

  it.each([1, 2, 3])('lists what the oracle lists over an edited document, seed %i', (seed) => {
    const random = seededRandom(seed)
    const source = fragmentedSource(randomText(random, LENGTH), random)
    const text = source.readRange(0, source.length)

    for (const query of QUERIES) {
      const expected = oracle(text, query)
      // Catches a match lost or doubled at a window seam, and a window whose cut
      // end let `$`, `\b` or the whole-word check answer for the wrong character.
      expect(listed(source, query), JSON.stringify(query)).toEqual(expected)
      expect(countMatches(source, query), JSON.stringify(query)).toBe(expected.length)
    }
  })

  it('steps to the match the oracle names from any offset, in both directions', () => {
    const random = seededRandom(7)
    const source = fragmentedSource(randomText(random, LENGTH), random)
    const text = source.readRange(0, source.length)

    for (const query of QUERIES) {
      const expected = oracle(text, query)
      for (let probe = 0; probe < 12; probe += 1) {
        const offset = Math.floor(random() * (text.length + 1))
        const next = expected.find(([start]) => start >= offset) ?? expected[0]
        const previous = expected.findLast(([, end]) => end <= offset) ?? expected.at(-1)
        const label = `${JSON.stringify(query)} at ${offset}`

        expect(tuple(findNextMatchFrom(source, query, offset)), label).toEqual(next)
        expect(tuple(findPreviousMatchFrom(source, query, offset)), label).toEqual(previous)
      }
    }
  })

  it('keeps one non-overlap phase for a self-overlapping literal across window seams', () => {
    // 'a\na' overlaps itself by one line. A scan restarted at an overlap's first
    // line would pick the other of two candidates there, and every match after
    // it would shift with it; the lead-in moves which phase each seam lands on.
    for (const leadIn of ['', 'a\n', 'b\na\n', 'a\na\n']) {
      const text = leadIn + 'a\n'.repeat(FIND_WINDOW_UNITS)
      const source = findTextSourceFromSnapshot(
        createDocumentTextSnapshot(createPieceTableSnapshot(text)),
      )
      const query = literal('a\na', { crossesLines: true })

      expect(listed(source, query)).toEqual(oracle(text, query))
    }
  })

  it('counts past the listing cap inside a scope without listing', () => {
    const text = 'ab\n'.repeat(30_000)
    const source = findTextSourceFromSnapshot(
      createDocumentTextSnapshot(createPieceTableSnapshot(text)),
    )
    const scope = [{ start: 3, end: text.length - 4 }]

    expect(countMatches(source, literal('ab'), scope)).toBe(29_998)
    expect(findMatches(source, literal('ab'), scope)).toHaveLength(19_999)
  })
})

function tuple(match: { start: number; end: number } | null): FindRangeTuple | undefined {
  return match ? [match.start, match.end] : undefined
}
