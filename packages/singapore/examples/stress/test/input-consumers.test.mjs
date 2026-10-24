import { expect, test, vi } from 'vitest'
import {
  analysisLimitCodeUnits,
  inputConsumerConfiguration,
  minimapLimitCodeUnits,
} from '../input-configurations.mjs'
import * as consumers from '../src/inputConsumers.ts'

test.each(['disabled', 'tree-sitter', 'shiki', 'platform'])(
  '%s retained owners follow analysis-tier crossings in both directions',
  async (id) => {
    const ordinary = consumers.createInputConsumers(id, 'ordinary', 100)
    const paused = consumers.inputConsumersForFixture(
      ordinary,
      'short-lines',
      analysisLimitCodeUnits + 1,
    )
    expect(paused).not.toBe(ordinary)
    expect(paused.configuration).toEqual(
      inputConsumerConfiguration(id, 'short-lines', analysisLimitCodeUnits + 1),
    )
    expect(paused.plugins).toHaveLength(id === 'platform' ? 3 : 0)
    expect(
      consumers.inputConsumersForFixture(paused, 'long-line', analysisLimitCodeUnits + 2),
    ).toBe(paused)
    const resumed = consumers.inputConsumersForFixture(paused, 'ordinary', 100)
    expect(resumed).not.toBe(paused)
    expect(resumed.configuration).toEqual(ordinary.configuration)
    expect(resumed.plugins.map((plugin) => plugin.name)).toEqual(
      ordinary.plugins.map((plugin) => plugin.name),
    )
    await Promise.all([ordinary.dispose(), paused.dispose(), resumed.dispose()])
  },
)

test('retained minimap owners follow their independent size tier', async () => {
  const enabled = consumers.createInputConsumers(
    'minimap',
    'short-lines',
    analysisLimitCodeUnits + 1,
  )
  const paused = consumers.inputConsumersForFixture(enabled, 'long-line', minimapLimitCodeUnits + 1)
  expect(paused).not.toBe(enabled)
  expect(paused.configuration.minimap).toBe(false)
  expect(paused.plugins).toEqual([])
  const resumed = consumers.inputConsumersForFixture(paused, 'ordinary', 100)
  expect(resumed.configuration.minimap).toBe(true)
  expect(resumed.plugins.length).toBeGreaterThan(0)
  await Promise.all([enabled.dispose(), paused.dispose(), resumed.dispose()])
})

test('same-tier fixture changes retain their consumer owners', async () => {
  const owner = consumers.createInputConsumers('platform', 'ordinary', 100)
  expect(consumers.inputConsumersForFixture(owner, 'short-lines', analysisLimitCodeUnits)).toBe(
    owner,
  )
  expect(
    consumers.inputConsumersForFixture(null, 'short-lines', analysisLimitCodeUnits + 1),
  ).toBeNull()
  await owner.dispose()
})

test.each([
  ['render', { latestRender: 395, renderAfterSource: 34 }],
  ['source', {}],
])('minimap waits for a follow-up %s after initial acceptance', async (_, transition) => {
  vi.useFakeTimers()
  const worker = {
    terminated: false,
    minimap: true,
    sourceUpdates: 33,
    renderAfterSource: 33,
    latestRender: 393,
    acceptedRender: 393,
  }
  vi.stubGlobal('__inputWorkerProof', [worker])
  const owner = consumers.createInputConsumers('minimap', 'short-lines', 1_000_000)
  let completed = false
  const settled = owner.settle([]).then((result) => {
    completed = true
    return result
  })
  setTimeout(() => Object.assign(worker, { sourceUpdates: 34 }, transition), 20)
  setTimeout(() => Object.assign(worker, { latestRender: 395, renderAfterSource: 34 }), 80)
  setTimeout(() => Object.assign(worker, { acceptedRender: 395 }), 100)
  try {
    await vi.advanceTimersByTimeAsync(50)
    expect(completed).toBe(false)
    await vi.advanceTimersByTimeAsync(150)
    expect(completed).toBe(true)
    await settled
    expect(worker.acceptedRender).toBe(worker.latestRender)
    expect(worker.renderAfterSource).toBe(worker.sourceUpdates)
  } finally {
    await vi.runAllTimersAsync()
    await owner.dispose()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  }
})

test.each(['native', 'disabled'])('%s readiness does not read minimap receipts', async (id) => {
  vi.useFakeTimers()
  vi.stubGlobal('__inputWorkerProof', [
    {
      terminated: false,
      minimap: true,
      get latestRender() {
        return expect.unreachable('Unexpected minimap receipt read')
      },
    },
  ])
  const owner = consumers.createInputConsumers(id, 'short-lines', 1_000_000)
  const settled = owner.settle([])
  try {
    await vi.advanceTimersByTimeAsync(50)
    await expect(settled).resolves.toMatchObject({ configuration: { minimap: false } })
  } finally {
    await vi.runAllTimersAsync()
    await owner.dispose()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  }
})

test('disabled consumers finish without a follow-up timer', async () => {
  vi.useFakeTimers()
  const owner = consumers.createInputConsumers('disabled', 'ordinary', 100)
  try {
    await expect(owner.settle([])).resolves.toMatchObject({ configuration: { id: 'disabled' } })
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    await owner.dispose()
    vi.useRealTimers()
  }
})
