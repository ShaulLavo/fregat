import assert from 'node:assert/strict'

export interface CountRow {
  readonly operation: string
  readonly inert: number
  readonly counts: Record<string, number>
  readonly setupCalls: number
  readonly contributionFactories: number
  readonly freshIdentities?: number
  readonly otherInstalledInert?: number
  readonly inputCalls?: number
  readonly nativeDataCalls?: number
  readonly cleanupCalls?: number
  readonly observerCalls?: number
  readonly frameCalls?: number
  readonly providerCalls?: number
  readonly errorCalls?: number
  readonly extensionErrorCalls?: number
  readonly events?: Record<string, number>
  readonly focused?: boolean
  readonly geometryColumns?: number
}

export function verifyPublicCounters(rows: readonly CountRow[]) {
  const steady = [
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
  ]
  const required = [
    'public-create',
    'cold-public-open',
    'cold-public-first-use',
    ...steady,
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
  assert.deepEqual([...new Set(rows.map((row) => row.operation))].sort(), required.sort())
  for (const operation of required) {
    const counts = rows
      .filter((row) => row.operation === operation)
      .map((row) => row.inert)
      .sort((a, b) => a - b)
    const expected =
      operation === 'public-create' || operation === 'cold-public-open'
        ? [0, 1, 100, 1_000]
        : [0, 100, 1_000]
    assert.deepEqual(counts, expected, `Complete unique public matrix arms: ${operation}`)
  }
  for (const row of rows) {
    assert(Object.keys(row.counts).length > 0, `Observable source counts: ${row.operation}`)
    for (const value of Object.values(row.counts)) assert(Number.isSafeInteger(value) && value > 0)
  }
  const creation = rows.filter((row) => row.operation === 'public-create')
  assert.equal(creation.length, 4)
  for (const row of creation) {
    assert.equal(row.setupCalls, row.inert)
    assert.equal(row.contributionFactories, row.inert)
    assert.equal(row.freshIdentities, row.inert)
  }
  const byCount = new Map(creation.map((row) => [row.inert, row.counts]))
  const keys = new Set(creation.flatMap((row) => Object.keys(row.counts)))
  const affine: Record<string, { core: number; fixedActivation: number; perAttachment: number }> =
    {}
  for (const site of keys) {
    const core = byCount.get(0)?.[site] ?? 0
    const one = byCount.get(1)?.[site] ?? 0
    const hundred = byCount.get(100)?.[site] ?? 0
    const thousand = byCount.get(1_000)?.[site] ?? 0
    const perAttachment = (hundred - one) / 99
    assert(Number.isInteger(perAttachment), site)
    assert.equal(thousand - one, 999 * perAttachment, site)
    affine[site] = { core, fixedActivation: one - core - perAttachment, perAttachment }
  }
  const operations = [...new Set(rows.map((row) => row.operation))].filter(
    (operation) =>
      operation !== 'public-create' &&
      operation !== 'cold-public-open' &&
      operation !== 'cold-public-first-use',
  )
  for (const operation of operations) {
    const selected = rows.filter((row) => row.operation === operation)
    assert.equal(selected.length, 3, operation)
    for (const row of selected) assert.deepEqual(row.counts, selected[0]!.counts, operation)
  }
  for (const row of rows.filter((row) => row.operation.startsWith('public-dispose')))
    assert.equal(row.otherInstalledInert, row.inert)
  for (const operation of ['positive-input-pass', 'positive-input-claim']) {
    for (const row of rows.filter((row) => row.operation === operation)) {
      assert.equal(row.inputCalls, 7)
      assert.equal(row.nativeDataCalls, operation === 'positive-input-pass' ? 7 : 0)
    }
  }
  for (const row of rows.filter((row) => row.operation === 'positive-dispose'))
    assert.equal(row.cleanupCalls, 1)
  for (const row of rows.filter((row) => row.operation === 'positive-frame-geometry')) {
    assert((row.frameCalls ?? 0) > 0)
    assert.equal(row.geometryColumns, 80)
  }
  for (const row of rows.filter((row) => row.operation === 'positive-native-events')) {
    for (const event of [
      'data',
      'frame',
      'title',
      'bell',
      'appearance',
      'resize',
      'selection',
      'scroll',
    ])
      assert((row.events?.[event] ?? 0) > 0, `Observable ${event} event`)
  }
  for (const row of rows.filter((row) => row.operation === 'positive-input-error')) {
    assert.equal(row.errorCalls, 1)
    assert.equal(row.extensionErrorCalls, 0)
  }
  for (const row of rows.filter((row) => row.operation === 'positive-host-error-event')) {
    assert.equal(row.errorCalls, 1)
    assert.equal(row.extensionErrorCalls, 1)
  }
  for (const row of rows.filter((row) => row.operation === 'positive-links')) {
    assert((row.providerCalls ?? 0) > 0)
    assert.equal(row.focused, true)
  }
  for (const row of rows.filter((row) => row.operation === 'positive-command-exclusive-rollback')) {
    assert.equal(row.cleanupCalls, 1)
    assert.equal(row.errorCalls, 1)
  }
  for (const row of rows.filter((row) => row.operation === 'negative-public-osc-capability')) {
    assert.equal(row.cleanupCalls, 1)
    assert.equal(row.errorCalls, 1)
    assert.equal(row.observerCalls, 0)
  }
  return {
    passed: true,
    rows: rows.length,
    operations,
    affine,
    coldOpen: rows.filter((row) => row.operation === 'cold-public-open'),
    coldFirstUse: rows.filter((row) => row.operation === 'cold-public-first-use'),
    sourceScope: 'Exact source evaluation counts, not realized allocation counts',
    customOscPositive: 'PENDING — nonblocking',
  }
}
