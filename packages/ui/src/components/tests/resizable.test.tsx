import { expect, test } from 'vitest'

import { readPersistedResizableLayout } from '@workspace/ui/components/resizable'

test('rejects a persisted array layout', () => {
  expect(readLayout([50, 50])).toBeNull()
})

test('restores a persisted keyed layout', () => {
  expect(readLayout({ first: 40, second: 60 })).toEqual({ first: 40, second: 60 })
})

function readLayout(layout: unknown) {
  const values = new Map([
    ['platform.resizable-layout.test', JSON.stringify({ version: 1, layout })],
  ])

  return readPersistedResizableLayout('test', {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  })
}
