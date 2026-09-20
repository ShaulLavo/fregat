import { QueryClient } from '@tanstack/react-query'
import { scopedSessionKey, environmentIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { observeSessionSearch } from '@/features/chat-mode/state/observe-session-search'
import {
  useSessionSearchStore,
  type SessionSearchResult,
} from '@/features/chat-mode/state/session-search-store'
import { registerEnvironmentQueryClient } from '@/lib/environments/state/query-clients'
import { makeTestServer } from '../../../../../test/server'
import { createInProcessClient, createObservedInProcessClient } from '../../../../../test/client'
import { seedSearchSession } from '../../../../../test/factories/session-search'
import { TEST_ENVIRONMENT_ID, TEST_SESSION_ID } from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'

const remoteId = v.parse(environmentIdSchema, 'e0000000-0000-4000-8000-000000000099')
const localOrigin = 'http://local-search.test'
const remoteOrigin = 'http://remote-search.test'

test('each owner uses its real server and identical session IDs stay isolated', async ({
  client,
  server,
}) => {
  const remote = await makeTestServer({ environmentId: remoteId })
  const first = new QueryClient()
  const second = new QueryClient()
  const owners = [
    { environmentId: TEST_ENVIRONMENT_ID, origin: localOrigin, label: 'Local', connected: true },
    { environmentId: remoteId, origin: remoteOrigin, label: 'Remote', connected: true },
  ]
  let stop = () => {}
  try {
    const remoteClient = createInProcessClient(remote)
    await seedSearchSession(client, server.root, TEST_SESSION_ID, 'shared localneedle')
    await seedSearchSession(remoteClient, remote.root, TEST_SESSION_ID, 'shared remoteneedle')
    registerEnvironmentQueryClient(first, localOrigin, client)
    registerEnvironmentQueryClient(second, remoteOrigin, remoteClient)
    let latest: SessionSearchResult | undefined
    const resolve = (origin: string) => (origin === localOrigin ? first : second)
    stop = observeSessionSearch({
      query: 'remoteneedle',
      owners,
      queryClientForOrigin: resolve,
      publish: (result) => {
        latest = result
      },
    })
    await expect.poll(() => latest?.searching).toBe(false)
    expect(Object.keys(latest!.matchBySessionKey)).toEqual([
      scopedSessionKey({ environmentId: remoteId, sessionId: TEST_SESSION_ID }),
    ])
    stop()
    stop = observeSessionSearch({
      query: 'shared',
      owners,
      queryClientForOrigin: resolve,
      publish: (result) => {
        latest = result
      },
    })
    await expect.poll(() => latest?.searching).toBe(false)
    expect(Object.keys(latest!.matchBySessionKey)).toHaveLength(2)
    stop()
    stop = observeSessionSearch({
      query: 'shared',
      owners: owners.map((owner) => ({ ...owner, connected: owner.environmentId !== remoteId })),
      queryClientForOrigin: resolve,
      publish: (result) => {
        latest = result
      },
    })
    await expect.poll(() => latest?.searching).toBe(false)
    expect(Object.keys(latest!.matchBySessionKey)).toEqual([
      scopedSessionKey({ environmentId: TEST_ENVIRONMENT_ID, sessionId: TEST_SESSION_ID }),
    ])
    expect(latest?.unavailable).toEqual(['Remote'])
  } finally {
    stop()
    first.clear()
    second.clear()
    await remote.cleanup()
  }
})

test('a delayed old scan cannot replace the current query generation', async ({
  server,
  client,
}) => {
  await seedSearchSession(client, server.root, TEST_SESSION_ID, 'oldneedle')
  const release = Promise.withResolvers<void>()
  let scans = 0
  const delayed = createObservedInProcessClient(server, async (request) => {
    if (!request.url.endsWith('/orchestration/session-search')) return
    scans += 1
    if (scans === 1) await release.promise
  })
  const queryClient = new QueryClient()
  registerEnvironmentQueryClient(queryClient, localOrigin, delayed)
  const owners = [
    { environmentId: TEST_ENVIRONMENT_ID, origin: localOrigin, label: 'Local', connected: true },
  ]
  const store = useSessionSearchStore.getState()
  const oldGeneration = store.begin('oldneedle', true)
  const stopOld = observeSessionSearch({
    query: 'oldneedle',
    owners,
    queryClientForOrigin: () => queryClient,
    publish: (result) => store.publish(oldGeneration, result),
  })
  let stopNew = () => {}
  try {
    await expect.poll(() => scans).toBe(1)
    const generation = store.begin('newneedle', true)
    stopNew = observeSessionSearch({
      query: 'newneedle',
      owners,
      queryClientForOrigin: () => queryClient,
      publish: (result) => store.publish(generation, result),
    })
    await expect.poll(() => useSessionSearchStore.getState().searching).toBe(false)
    release.resolve()
    await expect.poll(() => queryClient.isFetching()).toBe(0)
    expect(useSessionSearchStore.getState().matchedQuery).toBe('newneedle')
    expect(Object.keys(useSessionSearchStore.getState().matchBySessionKey)).toHaveLength(0)
  } finally {
    release.resolve()
    stopOld()
    stopNew()
    queryClient.clear()
    store.begin('', false)
  }
})
