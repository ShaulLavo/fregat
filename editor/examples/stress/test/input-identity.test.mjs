import { expect, test } from 'vitest'
import { inputSourceIdentity } from '../input-identity.mjs'

const measurementPaths = [
  'src/inputLatency.ts',
  'input-paired.mjs',
  'input-budgets.json',
  'input-scenarios.mjs',
  'input-source-current.mjs',
  'input-pair-stopping.mjs',
  'src/fixtures.ts',
  'input-runtime.mjs',
  'paired.mjs',
  'src/inputReadiness.ts',
  'input-worker-proof.mjs',
  'input-worker-proof.d.mts',
  'input-product-tree.mjs',
  'input-configurations.mjs',
  'src/browser.ts',
  'src/input-output.ts',
  'input-identity.mjs',
  'unknown-source.ts',
]

test.each(measurementPaths)('%s is conservatively measurement-hashed', (path) => {
  const sources = [{ path: `examples/stress/${path}`, bytes: 'before' }]
  const before = inputSourceIdentity(sources, 'external')
  const after = inputSourceIdentity([{ ...sources[0], bytes: 'after' }], 'external')
  expect(before.measurementHash).not.toBe(after.measurementHash)
  expect(before.validationHash).toBe(after.validationHash)
  expect(before.measurementFiles).toEqual([sources[0].path])
})

test('only postcapture output predicates remain validation-hashed', () => {
  const sources = [{ path: 'examples/stress/input-output.mjs', bytes: 'before' }]
  const before = inputSourceIdentity(sources, 'external')
  const after = inputSourceIdentity([{ ...sources[0], bytes: 'after' }], 'external')
  expect(after.measurementHash).toBe(before.measurementHash)
  expect(after.validationHash).not.toBe(before.validationHash)
  expect(after.validationFiles).toEqual(['examples/stress/input-output.mjs'])
})

test('external bytes invalidate controls and source ordering is stable', () => {
  const sources = [
    { path: 'paired.mjs', bytes: 'runner' },
    { path: 'input-output.mjs', bytes: 'assertions' },
  ]
  const identity = inputSourceIdentity(sources, 'external')
  expect(inputSourceIdentity([...sources].reverse(), 'external')).toEqual(identity)
  expect(inputSourceIdentity(sources, 'changed external').measurementHash).not.toBe(
    identity.measurementHash,
  )
})

test('runner and browser launch identities invalidate measurement controls', () => {
  const sources = [{ path: 'paired.mjs', bytes: 'launch' }]
  const launch = {
    runner: 'v26.7.0',
    browser: { engine: 'chromium', version: 'before', headless: true },
  }
  const before = inputSourceIdentity(sources, 'external', launch)
  for (const changed of [
    { ...launch, runner: 'new runtime' },
    { ...launch, browser: { ...launch.browser, version: 'after' } },
  ]) {
    const after = inputSourceIdentity(sources, 'external', changed)
    expect(after.measurementHash).not.toBe(before.measurementHash)
    expect(after.validationHash).toBe(before.validationHash)
  }
})
