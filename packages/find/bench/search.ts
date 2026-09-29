import {
  createDocumentTextSnapshot,
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
  type PieceTableSnapshot,
  type TextSnapshot,
} from '@singapore-editor/core/document'
import { generateFixture } from '../../../examples/stress/src/fixtures'
import {
  FIND_MATCHES_LIMIT,
  FIND_REPLACE_ALL_LIMIT,
  findMatches,
  findNextMatchFrom,
  findPreviousMatchFrom,
  findTextSourceFromSnapshot,
  type FindQuery,
  type FindTextSource,
} from '../src/search'

type Document = { readonly id: string; readonly snapshot: TextSnapshot }
type Case = { readonly id: string; readonly query: FindQuery }
type Reads = { calls: number; units: number; fullRange: number }

const FRAGMENT_EDITS = 20_000
const MIN_SAMPLE_MS = 400
const MIN_ITERATIONS = 5
const WARMUPS = 2

const literal = (searchString: string, matchCase: boolean, wholeWord = false): FindQuery => ({
  searchString,
  isRegex: false,
  matchCase,
  wholeWord,
})
const regex = (searchString: string): FindQuery => ({
  searchString,
  isRegex: true,
  matchCase: true,
  wholeWord: false,
})

const CASES: readonly Case[] = [
  { id: 'literal sparse, match case', query: literal('needle', true) },
  { id: 'literal sparse, ignore case', query: literal('needle', false) },
  { id: 'literal absent', query: literal('zzqqzz', true) },
  { id: 'literal dense', query: literal('const', true) },
  { id: 'literal whole word', query: literal('value', true, true) },
  { id: 'literal caseless digits', query: literal('= 42', false) },
  { id: 'literal multiline', query: literal(';\nconst needle', true) },
  { id: 'regex line-safe', query: regex('needle\\d+') },
  { id: 'regex line-crossing', query: regex('needle[^;]*;') },
]

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

// Small edits spread over the whole document, the shape a long session leaves.
function fragment(table: PieceTableSnapshot, edits: number): PieceTableSnapshot {
  const random = seededRandom(8)
  let next = table
  for (let index = 0; index < edits; index += 1) {
    const offset = Math.floor(random() * next.length)
    next =
      index % 3 === 0
        ? deleteFromPieceTable(next, offset, 1 + Math.floor(random() * 4))
        : insertIntoPieceTable(next, offset, 'edit'.slice(0, 1 + Math.floor(random() * 4)))
  }
  return next
}

function documents(): readonly Document[] {
  const short = createPieceTableSnapshot(generateFixture('short-lines'))
  return [
    { id: 'ordinary (200 lines)', snapshot: snapshotOf(generateFixture('ordinary')) },
    { id: 'short-lines (500k lines)', snapshot: createDocumentTextSnapshot(short) },
    {
      id: `short-lines, ${FRAGMENT_EDITS} edits`,
      snapshot: createDocumentTextSnapshot(fragment(short, FRAGMENT_EDITS)),
    },
    { id: 'long-line (1 MiB line)', snapshot: snapshotOf(generateFixture('long-line')) },
    { id: 'unicode', snapshot: snapshotOf(generateFixture('unicode')) },
  ]
}

function snapshotOf(text: string): TextSnapshot {
  return createDocumentTextSnapshot(createPieceTableSnapshot(text))
}

function countingSource(snapshot: TextSnapshot, reads: Reads): FindTextSource {
  const source = findTextSourceFromSnapshot(snapshot)
  return {
    ...source,
    readRange: (start, end) => {
      reads.calls += 1
      reads.units += end - start
      if (start === 0 && end === snapshot.length) reads.fullRange += 1
      return source.readRange(start, end)
    },
  }
}

function time(run: () => number): { readonly ms: number; readonly count: number } {
  let count = 0
  for (let index = 0; index < WARMUPS; index += 1) count = run()
  const samples: number[] = []
  const began = performance.now()
  while (samples.length < MIN_ITERATIONS || performance.now() - began < MIN_SAMPLE_MS) {
    const start = performance.now()
    count = run()
    samples.push(performance.now() - start)
  }
  samples.sort((left, right) => left - right)
  return { ms: samples[samples.length >> 1] ?? 0, count }
}

const limitArgument = process.argv.includes('--uncapped')
  ? FIND_REPLACE_ALL_LIMIT
  : FIND_MATCHES_LIMIT + 1
const rows: Record<string, string | number>[] = []
for (const document of documents()) {
  for (const entry of CASES) {
    const reads: Reads = { calls: 0, units: 0, fullRange: 0 }
    const counted = countingSource(document.snapshot, reads)
    const matches = findMatches(counted, entry.query, null, false, limitArgument).length
    const source = findTextSourceFromSnapshot(document.snapshot)
    const timed = time(() => findMatches(source, entry.query, null, false, limitArgument).length)
    rows.push({
      document: document.id,
      query: entry.id,
      ms: Number(timed.ms.toFixed(3)),
      matches,
      reads: reads.calls,
      unitsRead: reads.units,
      fullRangeReads: reads.fullRange,
    })
  }
}

// Navigation with nothing left to find is the worst case: the scan runs the whole
// document before it can answer.
const NAVIGATION: readonly Case[] = [
  { id: 'next, literal absent', query: literal('zzqqzz', true) },
  { id: 'next, regex absent', query: regex('zzqq\\d+') },
]
for (const document of documents().slice(1, 3)) {
  const source = findTextSourceFromSnapshot(document.snapshot)
  for (const entry of NAVIGATION) {
    const forward = time(() => (findNextMatchFrom(source, entry.query, 0) ? 1 : 0))
    const backward = time(() => (findPreviousMatchFrom(source, entry.query, source.length) ? 1 : 0))
    rows.push({ document: document.id, query: entry.id, ms: Number(forward.ms.toFixed(3)) })
    rows.push({
      document: document.id,
      query: entry.id.replace('next', 'previous'),
      ms: Number(backward.ms.toFixed(3)),
    })
  }
}

if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2))
else console.table(rows)
