import assert from 'node:assert/strict'
import { expect, test } from 'vitest'
import { verifyPublicCounters, type CountRow } from './ghostty-x6-public-counters.ts'

function matrix(): CountRow[] {
  const operations = [
    'public-create',
    'cold-public-open',
    'cold-public-first-use',
    'public-use-fresh',
    'public-dispose',
    'public-api-key',
    'public-api-text',
    'public-api-paste',
    'public-dom-key',
    'public-dom-text',
    'public-dom-paste',
    'public-dom-composition',
    'public-write',
    'public-write-frame',
    'public-geometry',
    'public-use-same',
    'public-dispose-same',
    'public-own-key-churn',
    'positive-input-pass',
    'positive-input-claim',
    'positive-frame-geometry',
    'positive-native-events',
    'positive-input-error',
    'positive-host-error-event',
    'positive-dispose',
    'positive-links',
    'positive-command-exclusive-rollback',
    'negative-public-osc-capability',
  ]
  return operations.flatMap((operation) => {
    const counts =
      operation === 'public-create' || operation === 'cold-public-open'
        ? [0, 1, 100, 1_000]
        : [0, 100, 1_000]
    return counts.map((inert): CountRow => ({
      operation,
      inert,
      counts: { owned: operation === 'public-create' ? 5 + (inert > 0 ? 3 : 0) + 2 * inert : 5 },
      setupCalls: operation === 'public-create' ? inert : 0,
      contributionFactories: operation === 'public-create' ? inert : 0,
      freshIdentities: inert,
      otherInstalledInert: inert,
      inputCalls: 7,
      nativeDataCalls: operation === 'positive-input-claim' ? 0 : 7,
      cleanupCalls: 1,
      errorCalls: 1,
      observerCalls: 0,
      extensionErrorCalls: operation === 'positive-host-error-event' ? 1 : 0,
      frameCalls: 1,
      providerCalls: 1,
      geometryColumns: 80,
      focused: true,
      events: {
        data: 1,
        frame: 1,
        title: 1,
        bell: 1,
        appearance: 1,
        resize: 1,
        selection: 1,
        scroll: 1,
      },
    }))
  })
}

function replace(
  rows: readonly CountRow[],
  operation: string,
  inert: number,
  patch: Partial<CountRow>,
): CountRow[] {
  assert(rows.some((row) => row.operation === operation && row.inert === inert))
  return rows.map((row) =>
    row.operation === operation && row.inert === inert ? { ...row, ...patch } : row,
  )
}

test('accepts the complete affine matrix with observable controls', () => {
  const result = verifyPublicCounters(matrix())
  expect(result.rows).toBe(86)
  expect(result.affine.owned).toEqual({ core: 5, fixedActivation: 3, perAttachment: 2 })
})

test('rejects missing operations, missing arms and duplicate arms', () => {
  const rows = matrix()
  expect(() =>
    verifyPublicCounters(rows.filter((row) => row.operation !== 'positive-links')),
  ).toThrow()
  expect(() => verifyPublicCounters(rows.slice(1))).toThrow()
  expect(() => verifyPublicCounters([...rows, rows[0]!])).toThrow()
})

test('rejects empty counters, nonaffine creation and installed-count steady work', () => {
  const rows = matrix()
  expect(() => verifyPublicCounters(replace(rows, 'public-create', 0, { counts: {} }))).toThrow()
  expect(() =>
    verifyPublicCounters(replace(rows, 'public-create', 1_000, { counts: { owned: 2_009 } })),
  ).toThrow()
  expect(() =>
    verifyPublicCounters(replace(rows, 'public-write', 1_000, { counts: { owned: 6 } })),
  ).toThrow()
  expect(() =>
    verifyPublicCounters(replace(rows, 'public-dispose', 100, { otherInstalledInert: 101 })),
  ).toThrow()
})

test('rejects unobservable positives and missing-capability rollback failures', () => {
  const rows = matrix()
  const failures: readonly [string, Partial<CountRow>][] = [
    ['positive-links', { providerCalls: 0 }],
    ['positive-links', { focused: false }],
    ['positive-frame-geometry', { frameCalls: 0 }],
    ['positive-native-events', { events: {} }],
    ['positive-input-pass', { nativeDataCalls: 0 }],
    ['positive-input-claim', { nativeDataCalls: 1 }],
    ['positive-input-error', { extensionErrorCalls: 1 }],
    ['positive-host-error-event', { extensionErrorCalls: 0 }],
    ['positive-command-exclusive-rollback', { cleanupCalls: 0 }],
    ['negative-public-osc-capability', { observerCalls: 1 }],
  ]
  for (const [operation, patch] of failures)
    expect(() => verifyPublicCounters(replace(rows, operation, 100, patch))).toThrow()
})
