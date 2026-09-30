import type {
  Change,
  Edit,
  EditFixture,
  Fixture,
  FixtureBase,
  ProfileName,
  Query,
  Random,
  Retained,
} from './contracts.ts'
import { consume, sha256 } from './support.ts'

export const profiles = {
  smoke: {
    rows: 100,
    edits: 48,
    queries: 64,
    paste: 4096,
    pastes: 3,
    versions: 8,
    densityAnchors: 32,
    densityEdits: 24,
    samples: 1,
    warmups: 0,
  },
  standard: {
    rows: 10000,
    edits: 1500,
    queries: 3000,
    paste: 262144,
    pastes: 16,
    versions: 64,
    densityAnchors: 500,
    densityEdits: 300,
    samples: 9,
    warmups: 2,
  },
}

export function randomSource(seed: number) {
  let state = seed >>> 0
  return (limit: number) => {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Invalid random limit')
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state % limit
  }
}

export function safeBoundary(text: string, offset: number) {
  const before = text.charCodeAt(offset - 1)
  const after = text.charCodeAt(offset)
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
    ? offset - 1
    : offset
}

export function normalizeInput(text: string) {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  return body.replace(/\r\n|[\r\u2028\u2029]/g, '\n')
}

export function applyOracle(text: string, operation: Change) {
  const edits = operation.kind === 'batch' ? operation.edits : [operation]
  for (const edit of edits.toSorted((a, b) => b.from - a.from || b.to - a.to)) {
    text = text.slice(0, edit.from) + edit.text + text.slice(edit.to)
  }
  return text
}

export function indexLines(text: string) {
  const starts = [0]
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) starts.push(at + 1)
  return starts
}

export function oraclePoint(starts: number[], offset: number) {
  let low = 0
  let high = starts.length
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (starts[middle] <= offset) low = middle
    else high = middle
  }
  return { row: low, column: offset - starts[low] }
}

export function oracleQuery(text: string, starts: number[], operation: Query) {
  if (operation.kind === 'line') {
    const start = starts[operation.row]
    const end = operation.row + 1 < starts.length ? starts[operation.row + 1] - 1 : text.length
    return text.slice(start, end)
  }
  if (operation.kind === 'range') return text.slice(operation.from, operation.to)
  if (operation.kind === 'offset') return oraclePoint(starts, operation.offset)
  if (operation.kind === 'point') return starts[operation.point.row] + operation.point.column
  if (operation.kind === 'full') return text
  throw new Error('Unknown query')
}

const unicodeTokens = ['x', '\n', 'hello ', '😀', 'שלום', 'e\u0301', '\t', '中']

function editFixture(
  name: string,
  initial: string,
  count: number,
  random: Random,
  style: string,
  versions: number,
  tokens = unicodeTokens,
): EditFixture {
  let text = initial
  let cursor = safeBoundary(text, Math.floor(text.length / 2))
  const operations = []
  const retained = []
  const retainEvery = Math.max(1, Math.ceil(count / versions))
  for (let index = 0; index < count; index += 1) {
    if (index % retainEvery === 0) retained.push({ before: index, sha256: sha256(text) })
    let operation: Change
    if (style === 'batch') {
      const offsets = new Set<number>()
      while (offsets.size < 8) offsets.add(safeBoundary(text, random(text.length + 1)))
      operation = {
        kind: 'batch',
        edits: Array.from(offsets, (from) => ({
          from,
          to: from,
          text: tokens[random(tokens.length)],
        })),
      }
    } else {
      const from = style === 'typing' ? cursor : safeBoundary(text, random(text.length + 1))
      const to =
        style === 'typing' || style === 'insert'
          ? from
          : safeBoundary(text, Math.min(text.length, from + random(25)))
      const inserted = style === 'churn' && random(3) === 0 ? '' : tokens[random(tokens.length)]
      operation = { kind: 'edit', from, to, text: inserted }
      cursor = from + inserted.length
    }
    text = applyOracle(text, operation)
    operations.push(operation)
  }
  return {
    name,
    mode: 'edit',
    category: 'shared',
    initial,
    setup: [],
    operations,
    expected: text,
    retained,
  }
}

// An editor converts the caret to a line and column after every keystroke, so
// the tail chunk's line index is consulted while it is still a fresh
// concatenation. Typing alone never reads that chunk.
function typingWithLookupsFixture(name: string, source: EditFixture): Fixture {
  const operations: (Change | Query)[] = []
  let cursor = 0
  for (const operation of source.operations) {
    operations.push(operation)
    if (operation.kind !== 'edit')
      throw new TypeError('Typing fixture must contain primitive edits')
    cursor = operation.from + operation.text.length
    operations.push({ kind: 'offset', offset: cursor })
  }
  return { ...source, name, operations }
}

function queryFixture(
  name: string,
  source: EditFixture,
  count: number,
  random: Random,
  kind: string,
): Fixture {
  const text = source.expected
  const starts = indexLines(text)
  const operations: Query[] = []
  let expectedDigest = 2166136261
  for (let index = 0; index < count; index += 1) {
    const offset = random(text.length + 1)
    let operation: Query
    if (kind === 'line' || kind === 'sequential-line') {
      operation = {
        kind: 'line',
        row: kind === 'line' ? random(starts.length) : index % starts.length,
      }
    } else if (kind === 'range') {
      operation = { kind, from: offset, to: Math.min(text.length, offset + 128 + random(256)) }
    } else if (kind === 'offset') operation = { kind, offset }
    else if (kind === 'point') operation = { kind, point: oraclePoint(starts, offset) }
    else operation = { kind: 'full' }
    expectedDigest = consume(oracleQuery(text, starts, operation), expectedDigest)
    operations.push(operation)
  }
  return {
    name,
    mode: 'query',
    category: 'shared',
    initial: source.initial,
    setup: source.operations,
    operations,
    expected: text,
    expectedDigest,
  }
}

// One edit on each of many branches from the same root. The store forks once
// per branch that is not the first to append after the root; the first one
// continues the root's log in place.
function branchFixture(name: string, source: EditFixture, count: number, random: Random): Fixture {
  const text = source.expected
  const tokens = ['x', '\n', 'hello ', '😀']
  const operations: { kind: 'branch'; edit: Edit }[] = []
  let expectedDigest = 2166136261
  for (let index = 0; index < count; index += 1) {
    const from = safeBoundary(text, random(text.length + 1))
    const edit: Edit = { kind: 'edit', from, to: from, text: tokens[random(tokens.length)] }
    operations.push({ kind: 'branch', edit })
    expectedDigest = consume(edit.text, consume(text.length + edit.text.length, expectedDigest))
  }
  return {
    name,
    mode: 'branches',
    category: 'singapore-only',
    initial: source.initial,
    setup: source.operations,
    operations,
    expected: text,
    expectedDigest,
  }
}

// The unit a live anchor holds on to: the one before it under left bias, the
// one after it under right bias. An edit that spares it moves the anchor by
// plain string arithmetic, which is the whole oracle.
const heldUnit = (anchor: { bias: string; offset: number }) =>
  anchor.bias === 'left' ? anchor.offset - 1 : anchor.offset

// Many live anchors, all resolved after every edit, as decorations are. Edits
// never delete a held unit, so every anchor stays live and its offset is
// decided by the string model alone, not by the library's gap rules.
function anchorDensityFixture(
  name: string,
  initial: string,
  anchorCount: number,
  editCount: number,
  random: Random,
): Fixture {
  let text = initial
  const tokens = unicodeTokens
  const anchors: { offset: number; bias: 'left' | 'right' }[] = Array.from(
    { length: anchorCount },
    (_, index) => ({
      offset: safeBoundary(text, 1 + random(text.length - 2)),
      bias: index % 2 ? 'right' : 'left',
    }),
  )
  const live = anchors.map((anchor) => ({ ...anchor }))
  const operations = []
  let expectedDigest = 2166136261
  for (let index = 0; index < editCount; index += 1) {
    const from = safeBoundary(text, 1 + random(text.length - 2))
    const end = safeBoundary(text, Math.min(text.length - 1, from + random(25)))
    const spares = live.every((anchor) => heldUnit(anchor) < from || heldUnit(anchor) >= end)
    const to = spares ? end : from
    const inserted = to > from && random(3) === 0 ? '' : tokens[random(tokens.length)]
    const operation: Edit = { kind: 'edit', from, to, text: inserted }
    for (const anchor of live) {
      if (heldUnit(anchor) >= to) anchor.offset += inserted.length - (to - from)
      expectedDigest = consume(anchor.offset, consume(1, expectedDigest))
    }
    text = applyOracle(text, operation)
    operations.push(operation)
  }
  return {
    name,
    mode: 'anchor-density',
    category: 'singapore-only',
    initial,
    setup: [],
    operations,
    expected: text,
    anchors,
    expectedOffsets: live.map((anchor) => anchor.offset),
    expectedDigest,
  }
}

export function makeFixtures(profileName: ProfileName, seed = 20260916): Fixture[] {
  const config = profiles[profileName]
  if (!config) throw new Error(`Unknown profile: ${profileName}`)
  const random = randomSource(seed)
  const line = 'const value = "שלום 😀 e\u0301 中"; // text\n'
  const initial = line.repeat(config.rows)
  const edits = (name: string, style: string, count = config.edits) =>
    editFixture(name, initial, count, random, style, config.versions)
  const churn = edits('mixed-edit-churn', 'churn')
  const typing = edits('sequential-typing', 'typing')
  const longText = 'abcdef😀'.repeat(config.rows * 16)
  const load = (name: string, text: string): Fixture => ({
    name,
    mode: 'load',
    category: 'shared',
    initial: text,
    setup: [],
    operations: [],
    expected: text,
  })
  const result: Fixture[] = [
    load('load-short-lines', initial.repeat(4)),
    load('load-long-line', longText),
    typing,
    typingWithLookupsFixture('typing-with-lookups', typing),
    edits('random-insertions', 'insert'),
    edits('random-replacements', 'replace'),
    edits('eight-cursor-batches', 'batch', Math.max(1, Math.floor(config.edits / 8))),
    churn,
  ]
  const paste = 'paste 😀\n'.repeat(Math.ceil(config.paste / 9))
  const pasteOperations: Edit[] = []
  for (let index = 0; index < config.pastes; index += 1) {
    const from = safeBoundary(initial, random(initial.length + 1))
    pasteOperations.push({ kind: 'edit', from, to: from, text: paste })
    pasteOperations.push({ kind: 'edit', from, to: from + paste.length, text: '' })
  }
  result.push({
    name: 'large-paste-delete',
    mode: 'edit',
    category: 'shared',
    initial,
    setup: [],
    operations: pasteOperations,
    expected: initial,
  })
  for (const [name, kind, count] of [
    ['lines-sequential-after-churn', 'sequential-line', config.queries],
    ['lines-random-after-churn', 'line', config.queries],
    ['ranges-after-churn', 'range', config.queries],
    ['offset-to-position', 'offset', config.queries],
    ['position-to-offset', 'point', config.queries],
    ['full-read-after-churn', 'full', profileName === 'smoke' ? 2 : 12],
  ] satisfies [string, string, number][])
    result.push(queryFixture(name, churn, count, random, kind))
  result.push(
    Object.assign({}, churn, {
      name: 'persistent-history',
      mode: 'history',
      category: 'singapore-only',
    }),
  )
  result.push(branchFixture('branch-edits', churn, config.versions, random))
  const anchorOffsets = Array.from({ length: Math.min(128, config.queries) }, () =>
    safeBoundary(initial, random(initial.length + 1)),
  )
  result.push({
    name: 'anchor-resolution-after-churn',
    mode: 'anchors',
    category: 'singapore-only',
    initial,
    setup: churn.operations,
    expected: churn.expected,
    anchorOffsets,
    operations: Array.from({ length: config.queries }, (_, index) => ({
      kind: 'anchor',
      index: index % anchorOffsets.length,
    })),
  })
  // Last, so the fixtures above keep the random stream they always had.
  result.push(
    anchorDensityFixture(
      'anchor-density',
      initial,
      config.densityAnchors,
      config.densityEdits,
      random,
    ),
  )
  // A document that never held a surrogate: no edit of it looks for a cut pair.
  const asciiLine = 'const value = "hello world"; // text\n'
  const asciiTokens = ['x', '\n', 'hello ', 'ok', 'abcd', 'e', '\t', 'z']
  result.push(
    editFixture(
      'ascii-replacements',
      asciiLine.repeat(config.rows),
      config.edits,
      random,
      'replace',
      config.versions,
      asciiTokens,
    ),
  )
  return result
}
