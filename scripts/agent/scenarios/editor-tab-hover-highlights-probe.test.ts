import { expect, test } from 'vitest'
import { tokenPaintMismatch, type TokenPaintObservation } from './editor-tab-hover-highlights-probe'

const reference: TokenPaintObservation = {
  at: 0,
  identity: { document: 'fixture.ts', revision: 3, configuration: 'typescript|dark-plus' },
  rows: [{ start: 0, end: 14, text: 'const text = 1', mapping: 'source', presentation: 'live' }],
  runs: [
    {
      start: 0,
      end: 5,
      text: 'const',
      style: { color: 'blue', backgroundColor: 'transparent', textDecoration: 'none' },
    },
    {
      start: 13,
      end: 14,
      text: '1',
      style: { color: 'green', backgroundColor: 'transparent', textDecoration: 'none' },
    },
  ],
}

test('accepts all expected visible source offsets and painted styles', () => {
  expect(tokenPaintMismatch(reference, reference)).toBeNull()
})

test('rejects one colored range while the remaining token install is delayed', () => {
  expect(tokenPaintMismatch({ ...reference, runs: reference.runs.slice(0, 1) }, reference)).toBe(
    'token offsets or styles',
  )
})

test('rejects stale revision and configuration independently of identical paint', () => {
  for (const identity of [
    { ...reference.identity, revision: 2 },
    { ...reference.identity, configuration: 'typescript|light-plus' },
    { ...reference.identity, document: 'other.ts' },
  ])
    expect(tokenPaintMismatch({ ...reference, identity }, reference)).toBe('identity')
})

test('rejects incorrect source coverage, token offsets, and supported style fields', () => {
  const run = reference.runs[0]!
  const changes = [
    { ...run, start: 1 },
    { ...run, style: { ...run.style, color: 'red' } },
    { ...run, style: { ...run.style, backgroundColor: 'black' } },
    { ...run, style: { ...run.style, textDecoration: 'underline' } },
  ]
  for (const changed of changes)
    expect(
      tokenPaintMismatch({ ...reference, runs: [changed, ...reference.runs.slice(1)] }, reference),
    ).toBe('token offsets or styles')
  expect(tokenPaintMismatch({ ...reference, rows: [] }, reference)).toBe('coverage')
  expect(
    tokenPaintMismatch(
      { ...reference, rows: [{ ...reference.rows[0]!, mapping: 'unmapped' }] },
      reference,
    ),
  ).toBe('coverage')
})

test('requires an explicit plain expectation for a completed token-free frame', () => {
  const plain = { ...reference, runs: [] }
  expect(tokenPaintMismatch(plain, plain)).toBe('uncalibrated reference')
  expect(tokenPaintMismatch(plain, plain, 'plain')).toBeNull()
  expect(tokenPaintMismatch(reference, plain, 'plain')).toBe('token offsets or styles')
})
