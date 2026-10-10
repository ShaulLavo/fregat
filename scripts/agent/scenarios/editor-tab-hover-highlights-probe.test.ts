import { expect, test } from 'vitest'
import {
  sourceTokenPaintWindow,
  tokenPaintMismatch,
  tokenPaintHandoff,
  type TokenPaintReference,
  type TokenPaintObservation,
} from './editor-tab-hover-highlights-probe'

const source = 'const text = 1\nconst next = 2\nconst last = 3'
const style = {
  color: 'rgb(1, 2, 3)',
  backgroundColor: 'rgba(0, 0, 0, 0)',
  textDecoration: 'none',
  textDecorationColor: 'rgb(1, 2, 3)',
  textDecorationStyle: 'solid',
  textDecorationThickness: 'auto',
}
const reference: TokenPaintReference = {
  identity: {
    document: 'fixture.ts',
    revision: 3,
    configuration: 'typescript|dark-plus',
    paintedGeneration: 'unknown',
  },
  source,
  expected: 'colored',
  runs: [0, 15, 30].flatMap((start) => [
    { start, end: start + 5, text: 'const', style },
    { start: start + 13, end: start + 14, text: source.slice(start + 13, start + 14), style },
  ]),
}
const complete: TokenPaintObservation = {
  at: 0,
  identity: reference.identity,
  window: { start: 0, end: 3 },
  rows: [
    { start: 0, end: 14, text: 'const text = 1', mapping: 'source', presentation: 'live' },
    { start: 15, end: 29, text: 'const next = 2', mapping: 'source', presentation: 'live' },
    { start: 30, end: 44, text: 'const last = 3', mapping: 'source', presentation: 'live' },
  ],
  runs: reference.runs,
}

test('accepts all independently expected source rows, offsets and painted styles', () => {
  expect(tokenPaintMismatch(complete, reference)).toBeNull()
  expect(
    tokenPaintMismatch({ ...complete, rows: complete.rows.toReversed() }, reference),
  ).toBeNull()
  expect(
    tokenPaintMismatch(
      {
        ...complete,
        window: { start: 2, end: 3 },
        rows: complete.rows.slice(2),
        runs: complete.runs.filter((run) => run.start >= 30),
      },
      reference,
    ),
  ).toBeNull()
})

test('rejects one colored range while the remaining token install is delayed', () => {
  expect(tokenPaintMismatch({ ...complete, runs: complete.runs.slice(0, 1) }, reference)).toBe(
    'token offsets or styles',
  )
})

test('rejects both truncated copies using calibrated full-source and stale-controller windows', () => {
  const geometryWindow = { start: 0, end: Math.ceil(60 / 20) }
  // The production-source probe calibrates these fixtures without importing core into scripts' erasable syntax boundary.
  const fullWindow = { start: 0, end: 3 }
  const staleWindow = { start: 0, end: 1 }
  expect(fullWindow).toEqual({ start: 0, end: 3 })
  expect(staleWindow).toEqual({ start: 0, end: 1 })
  const window = sourceTokenPaintWindow({ source: reference.source, geometryWindow })
  expect(window).toEqual(fullWindow)
  expect(tokenPaintMismatch({ ...complete, window }, reference)).toBeNull()
  const truncated = {
    ...complete,
    window: staleWindow,
    rows: complete.rows.slice(0, 1),
    runs: complete.runs.slice(0, 2),
  }
  for (const frame of [truncated, { ...truncated }])
    expect(tokenPaintMismatch({ ...frame, window }, reference)).toBe('source rows')
  expect(
    sourceTokenPaintWindow({ source: reference.source, geometryWindow: { start: 0, end: 6 } }),
  ).toEqual(fullWindow)
  expect(sourceTokenPaintWindow({ source: reference.source, geometryWindow: null })).toBeNull()
})

test('rejects stale revision, configuration and document independently of identical paint', () => {
  for (const identity of [
    { ...complete.identity, revision: 2 },
    { ...complete.identity, configuration: 'typescript|light-plus' },
    { ...complete.identity, document: 'other.ts' },
    { ...complete.identity, document: null },
  ])
    expect(tokenPaintMismatch({ ...complete, identity }, reference)).toBe('identity')
  expect(complete.identity.paintedGeneration).toBe('unknown')
})

test('rejects empty, wrong-source, partial, truncated and equally partial split frames', () => {
  const partial = { ...complete, runs: complete.runs.slice(0, 2) }
  const truncated = {
    ...complete,
    rows: complete.rows.slice(0, 1),
    runs: complete.runs.slice(0, 2),
  }
  for (const frame of [partial, { ...partial }, truncated, { ...truncated }])
    expect(tokenPaintMismatch(frame, reference)).not.toBeNull()
  expect(tokenPaintMismatch({ ...complete, rows: [], runs: [] }, reference)).toBe('coverage')
  expect(tokenPaintMismatch({ ...complete, window: null }, reference)).toBe('coverage')
  expect(
    tokenPaintMismatch(
      { ...complete, rows: [{ ...complete.rows[0]!, text: 'OTHER_FILE', mapping: 'unmapped' }] },
      reference,
    ),
  ).toBe('coverage')
  expect(tokenPaintMismatch(truncated, reference)).toBe('source rows')
})

test('compares every changed painted decoration property and extra token range', () => {
  const run = complete.runs[0]!
  const changes = [
    { ...run, start: 1 },
    { ...run, style: { ...style, color: 'red' } },
    { ...run, style: { ...style, backgroundColor: 'black' } },
    { ...run, style: { ...style, textDecoration: 'underline' } },
    { ...run, style: { ...style, textDecorationColor: 'red' } },
    { ...run, style: { ...style, textDecorationStyle: 'wavy' } },
    { ...run, style: { ...style, textDecorationThickness: '3px' } },
  ]
  for (const changed of changes)
    expect(
      tokenPaintMismatch(
        { ...complete, runs: [changed].concat(complete.runs.slice(1)) },
        reference,
      ),
    ).toBe('token offsets or styles')
  expect(
    tokenPaintMismatch(
      { ...complete, runs: complete.runs.concat([{ ...run, start: 6, end: 10, text: 'text' }]) },
      reference,
    ),
  ).toBe('token offsets or styles')
})

test('requires explicit expected-plain admission for complete token-free paint', () => {
  const plainReference: TokenPaintReference = { ...reference, expected: 'plain', runs: [] }
  const plain = { ...complete, runs: [] }
  expect(tokenPaintMismatch(plain, { ...plainReference, expected: 'colored' })).toBe(
    'uncalibrated reference',
  )
  expect(tokenPaintMismatch(plain, plainReference)).toBeNull()
  expect(tokenPaintMismatch({ ...plain, rows: plain.rows.slice(0, 1) }, plainReference)).toBe(
    'source rows',
  )
  expect(tokenPaintMismatch(complete, plainReference)).toBe('token offsets or styles')
  expect(tokenPaintMismatch(plain, { ...reference, expected: 'plain' })).toBe(
    'unexpected reference tokens',
  )
})

test('preserves every raw handoff frame and qualifies activation without target text or tokens', () => {
  const held: TokenPaintReference = {
    ...reference,
    identity: { ...reference.identity, document: 'held.ts' },
    source: 'const held = 1',
    runs: reference.runs.slice(0, 2),
  }
  const old: TokenPaintObservation = {
    ...complete,
    identity: held.identity,
    window: { start: 0, end: 1 },
    rows: [{ start: 0, end: 14, text: held.source, mapping: 'source', presentation: 'live' }],
    runs: held.runs,
  }
  const empty = { ...complete, rows: [], runs: [] }
  const wrong = { ...complete, identity: { ...complete.identity, document: 'other.ts' } }
  const unknown = { ...complete, identity: { ...complete.identity, document: null } }
  const raw = [old, empty, wrong, unknown, complete, old]
  const samples = tokenPaintHandoff(raw, held, reference)
  expect(samples.map(({ frame }) => frame)).toEqual(raw)
  expect(samples.map(({ subject }) => subject)).toEqual([
    'old-held',
    'requested',
    'wrong-source',
    'unknown',
    'requested',
    'wrong-source',
  ])
  expect(samples.map(({ mismatch }) => mismatch)).toEqual([
    null,
    'coverage',
    'activation identity',
    'activation identity',
    null,
    'activation identity',
  ])
})

test('labels saved presentation as an acceptance gap', () => {
  const saved = {
    ...complete,
    rows: complete.rows.map((row) => ({ ...row, presentation: 'saved' as const })),
  }
  expect(tokenPaintMismatch(saved, reference)).toBe('unsupported saved presentation')
})
