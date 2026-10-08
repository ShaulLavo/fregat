import { expect, test } from 'vitest'

import { settle } from './source-location-helper'

test('direct assertion', () => {
  expect(null).not.toBeNull()
})

test('poll in async helper', async () => {
  await settle(async () => {
    await expect.poll(() => null, { timeout: 1000 }).not.toBeNull()
  })
})
