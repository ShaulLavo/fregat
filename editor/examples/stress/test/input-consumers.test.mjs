import { expect, test } from 'vitest'
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
