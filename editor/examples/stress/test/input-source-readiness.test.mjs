import { expect, test } from 'vitest'
import { waitForConsumerSource } from '../input-scenarios.mjs'

test('awaits an asynchronous false browser receipt before accepting the current source', async () => {
  let reads = 0
  const page = {
    async evaluate() {
      reads++
      return { sessions: [{ current: reads > 1, answered: true }], minimaps: [] }
    },
  }
  const receipt = await waitForConsumerSource(page)
  expect(receipt.sessions[0].current).toBe(true)
  expect(reads).toBe(2)
})

test('returns the accepted receipt without an extra browser read', async () => {
  let reads = 0
  const expected = {
    sessions: [{ current: true, answered: true }],
    minimaps: [{ current: false, renderedAfterSource: true }],
  }
  const page = {
    async evaluate() {
      reads++
      return expected
    },
  }
  expect(await waitForConsumerSource(page, true)).toBe(expected)
  expect(reads).toBe(1)
})
