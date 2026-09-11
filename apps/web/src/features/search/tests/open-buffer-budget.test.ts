import { expect, test } from '../../../../test/fixtures'

import { OpenBufferSearchProvider } from '@/features/search/utils/providers'

const QUERY = {
  includeContent: true,
  limit: 1,
  path: 'repo',
  query: 'needle',
}

test('stops reading buffers once the result budget is filled', async () => {
  let laterBufferReads = 0
  const provider = new OpenBufferSearchProvider([
    { path: 'repo/a.ts', text: 'needle' },
    {
      path: 'repo/b.ts',
      get text() {
        laterBufferReads += 1
        return 'needle'
      },
    },
  ])

  const events = await Array.fromAsync(provider.search(QUERY))

  expect(events).toHaveLength(2)
  expect(events.at(-1)).toMatchObject({ count: 1, truncated: true, type: 'done' })
  expect(laterBufferReads).toBe(0)
})

test('does not read buffer text with an empty budget', async () => {
  let reads = 0
  const provider = new OpenBufferSearchProvider([
    {
      path: 'repo/a.ts',
      get text() {
        reads += 1
        return 'needle'
      },
    },
  ])

  const events = await Array.fromAsync(provider.search({ ...QUERY, limit: 0 }))

  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({ count: 0, truncated: true, type: 'done' })
  expect(reads).toBe(0)
})

test('honors cancellation between matches in the same buffer', async () => {
  const controller = new AbortController()
  const provider = new OpenBufferSearchProvider([
    { path: 'repo/a.ts', text: 'needle needle\nneedle' },
  ])
  const events = provider.search({ ...QUERY, limit: 10 }, controller.signal)

  expect((await events.next()).value).toMatchObject({ type: 'match' })
  controller.abort()
  expect((await events.next()).done).toBe(true)
})

test('preserves line numbers across CRLF, CR, LF, and empty lines', async () => {
  const provider = new OpenBufferSearchProvider([
    { path: 'repo/a.ts', text: '\r\nneedle\r\rneedle\nneedle\r\n' },
  ])

  const events = await Array.fromAsync(provider.search({ ...QUERY, limit: 10 }))
  const matches = events.filter((event) => event.type === 'match')

  expect(matches.map((event) => event.match.line)).toEqual([2, 4, 5])
  expect(events.at(-1)).toMatchObject({ count: 3, truncated: false, type: 'done' })
})

test('shares the remaining result budget across lines and buffers', async () => {
  const provider = new OpenBufferSearchProvider([
    { path: 'repo/a.ts', text: 'needle' },
    { path: 'repo/b.ts', text: 'needle\nneedle needle needle' },
  ])

  const events = await Array.fromAsync(provider.search({ ...QUERY, limit: 4 }))
  const matches = events.filter((event) => event.type === 'match')

  expect(matches.map(({ match }) => [match.path, match.line, match.column])).toEqual([
    ['repo/a.ts', 1, 1],
    ['repo/b.ts', 1, 1],
    ['repo/b.ts', 2, 1],
    ['repo/b.ts', 2, 8],
  ])
  expect(events.at(-1)).toMatchObject({ count: 4, truncated: true, type: 'done' })
})
