import { writeFile } from 'node:fs/promises'
import { test, expect } from '../../../test/fixtures'
import { createControlledInProcessTransport } from '../../../test/client'
import { createEnvironmentClient } from '@workspace/client-core/transport/client'
import { createSearchWorkbench } from '@/search/state/workbench'
import { searchQuery } from '@/search/utils/results'

const options = {
  query: 'needle',
  include: '*.txt',
  exclude: '',
  regex: false,
  caseSensitive: false,
  wholeWord: false,
}

test('streams real file matches with include filters and separates empty from pending', async ({
  server,
  client,
}) => {
  await writeFile(`${server.root}/match.txt`, 'a needle lives here\n')
  await writeFile(`${server.root}/skip.md`, 'needle\n')
  const store = createSearchWorkbench(client)
  try {
    const pending = store.search(searchQuery('', options))
    expect(store.getSnapshot().kind).toBe('loading')
    await pending
    expect(store.getSnapshot(), JSON.stringify(store.getSnapshot())).toMatchObject({
      kind: 'ready',
    })
    expect(store.getSnapshot().matches.map((match) => match.path)).toEqual(['match.txt'])
    expect(store.getSnapshot().matches[0]?.line).toBe(1)
    await store.search(searchQuery('', { ...options, query: 'absent' }))
    expect(store.getSnapshot(), JSON.stringify(store.getSnapshot())).toMatchObject({
      kind: 'ready',
      matches: [],
    })
  } finally {
    store.dispose()
  }
})

test('a cancelled old search cannot overwrite the new query', async ({ server }) => {
  await writeFile(`${server.root}/match.txt`, 'needle\nsecond\n')
  const transport = createControlledInProcessTransport(server)
  const client = createEnvironmentClient({
    origin: server.origin,
    headers: () => ({ origin: server.clientOrigin }),
    fetcher: transport.fetcher,
  })
  const store = createSearchWorkbench(client)
  const gate = transport.pauseNextRequest('/fs/search/events')
  try {
    const first = store.search(searchQuery('', options))
    await gate.reached
    await store.search(searchQuery('', { ...options, query: 'second' }))
    gate.release()
    await first
    expect(store.getSnapshot().matches[0]?.preview).toContain('second')
    expect(store.getSnapshot(), JSON.stringify(store.getSnapshot())).toMatchObject({
      kind: 'ready',
    })
  } finally {
    gate.release()
    store.dispose()
  }
})
