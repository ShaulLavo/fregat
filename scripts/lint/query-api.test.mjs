import { expect, test } from 'vitest'
import { deprecatedQueryAccesses } from './query-api.mjs'

test.each([
  'client.fetchQuery(options)',
  'client?.prefetchQuery?.(options)',
  'client["ensureQueryData"](options)',
  'const read = client.fetchInfiniteQuery.bind(client); read(options)',
  'const { prefetchInfiniteQuery: warm } = client; warm(options)',
  '({ ["ensureInfiniteQueryData"]: read } = client)',
])('rejects deprecated access: %s', (source) => {
  expect(deprecatedQueryAccesses(source)).toHaveLength(1)
})

test('permits current calls, declarations and prose naming deprecated methods', () => {
  const source = `
    // Migrate fetchQuery to query.
    const methods = ['fetchQuery', 'prefetchQuery'];
    client.query(options); client.infiniteQuery(options);
    const unrelated = { fetchQuery() { return 'example'; } };
  `
  expect(deprecatedQueryAccesses(source)).toEqual([])
})
