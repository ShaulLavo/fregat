import { expect, test } from 'vitest'
import { waitForConsumerSource } from '../input-scenarios.mjs'

test('awaits an asynchronous false browser receipt before accepting the current source', async () => {
  let reads = 0
  const page = {
    async evaluate() {
      reads++
      return reads > 1
    },
  }
  await waitForConsumerSource(page)
  expect(reads).toBe(2)
})
