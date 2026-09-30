import { expect, test } from 'vitest'
import { hasCodexBackgroundTerminals } from '../codex-background-terminals'

test('a repeated cursor preserves uncertain background work', async () => {
  const calls: unknown[] = []
  expect(
    await hasCodexBackgroundTerminals({
      threadId: 'thread',
      deadline: Date.now() + 8_000,
      read: async (params) => {
        calls.push(params)
        return { data: [], nextCursor: 'same' }
      },
    }),
  ).toBe(true)
  expect(calls).toEqual([
    { threadId: 'thread', cursor: undefined },
    { threadId: 'thread', cursor: 'same' },
  ])
})

test('an exhausted check budget preserves the runtime without querying', async () => {
  let reads = 0
  expect(
    await hasCodexBackgroundTerminals({
      threadId: 'thread',
      deadline: Date.now() - 1,
      read: async () => {
        reads++
        return { data: [] }
      },
    }),
  ).toBe(true)
  expect(reads).toBe(0)
})
