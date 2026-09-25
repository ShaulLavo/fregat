import { fixtureEnvironmentId } from '../../../../test/factories/chat'
import { QueryClient } from '@tanstack/react-query'
import { healthDescriptorSchema } from '@workspace/contracts'
import { afterEach, beforeEach } from 'vitest'
import * as v from 'valibot'

import { activeServerOrigin, setActiveServerOrigin } from '@/lib/client'
import {
  clientForQueryClient,
  originForQueryClient,
  queryClientFor,
  registerEnvironmentQueryClient,
} from '@/lib/environments/state/query-clients'
import { installServerRestartInvalidation } from '@/lib/environments/state/server-restart-invalidation'
import { resetServerConnectionStore, useEnvironmentsStore } from '@/lib/environments/state/store'
import { fileSystemKeys } from '@/lib/query-keys'
import { createInProcessClient } from '../../../../test/client'
import { orchestrationServerConfig } from '@workspace/client-core/test/orchestration-server-config'
import { expect, test } from '../../../../test/fixtures'
import { makeTestServer } from '../../../../test/server'

const originA = 'http://localhost:3401'
const originB = 'http://localhost:3402'
let initialState = useEnvironmentsStore.getState()
let initialOrigin = activeServerOrigin()

beforeEach(() => {
  initialState = useEnvironmentsStore.getState()
  initialOrigin = activeServerOrigin()
})

afterEach(() => {
  resetServerConnectionStore()
  useEnvironmentsStore.setState(initialState, true)
  setActiveServerOrigin(initialOrigin)
  queryClientFor(originA).clear()
  queryClientFor(originB).clear()
})

test('uses separate caches with the existing query options and file eviction policy', async () => {
  const first = queryClientFor(originA)
  const second = queryClientFor(originB)
  expect(queryClientFor(originA)).toBe(first)
  expect(second).not.toBe(first)
  expect(first.getDefaultOptions().queries).toEqual({
    gcTime: 300_000,
    retry: 1,
    staleTime: 10_000,
  })

  for (let index = 0; index < 65; index += 1) {
    first.setQueryData(
      fileSystemKeys.fileSnapshot(`file-${index}.txt`),
      { content: String(index) },
      { updatedAt: index + 1 },
    )
  }
  await Promise.resolve()

  expect(first.getQueryCache().getAll()).toHaveLength(64)
  expect(first.getQueryData(fileSystemKeys.fileSnapshot('file-0.txt'))).toBeUndefined()
  expect(second.getQueryCache().getAll()).toHaveLength(0)
})

test('invalidates only the restarted origin and does not invalidate on switches or same-process reconnects', () => {
  const first = queryClientFor(originA)
  const second = queryClientFor(originB)
  const { activate, recordHandshake } = useEnvironmentsStore.getState()
  const key = ['same-path']
  first.setQueryData(key, 'machine-a')
  second.setQueryData(key, 'machine-b')
  recordHandshake(originA, orchestrationServerConfig())
  recordHandshake(originB, orchestrationServerConfig({ environmentId: fixtureEnvironmentId(2) }))
  recordHandshake(originA, orchestrationServerConfig())
  activate(originB)
  expect(first.getQueryState(key)?.isInvalidated).toBe(false)
  expect(second.getQueryState(key)?.isInvalidated).toBe(false)

  recordHandshake(originA, orchestrationServerConfig({ serverInstanceId: 'server-2' }))

  expect(first.getQueryState(key)?.isInvalidated).toBe(true)
  expect(second.getQueryState(key)?.isInvalidated).toBe(false)
  expect(first.getQueryData(key)).toBe('machine-a')
  expect(second.getQueryData(key)).toBe('machine-b')
})

test('observes restarts even when the subscription starts after the first handshake', () => {
  const { recordHandshake } = useEnvironmentsStore.getState()
  recordHandshake(originA, orchestrationServerConfig())
  const cache = new QueryClient()
  cache.setQueryData(['already-connected'], 'cached')
  const uninstall = installServerRestartInvalidation(cache, originA)

  recordHandshake(originA, orchestrationServerConfig({ serverInstanceId: 'server-2' }))

  expect(cache.getQueryState(['already-connected'])?.isInvalidated).toBe(true)
  uninstall()
  cache.clear()
})

test('pins refetches to their owning real server after the active environment switches', async ({
  client,
}) => {
  const secondServer = await makeTestServer({ filesystemWatch: false })
  const first = new QueryClient()
  const second = new QueryClient()
  registerEnvironmentQueryClient(first, originA, client)
  registerEnvironmentQueryClient(second, originB, createInProcessClient(secondServer))

  try {
    let firstServerReads = 0
    const initial = await first.query({
      queryKey: ['health'],
      queryFn: async ({ client: queryClient }) => {
        firstServerReads += 1
        return v.parse(
          healthDescriptorSchema,
          (await clientForQueryClient(queryClient).health.get()).data,
        )
      },
    })
    useEnvironmentsStore.getState().activate(originB)
    await first.invalidateQueries({ refetchType: 'all' })
    const resultA = v.parse(healthDescriptorSchema, first.getQueryData(['health']))
    const resultB = await second.query({
      queryKey: ['health'],
      queryFn: async ({ client: queryClient }) =>
        v.parse(
          healthDescriptorSchema,
          (await clientForQueryClient(queryClient).health.get()).data,
        ),
    })

    expect(resultA.environmentId).toBe(initial.environmentId)
    expect(firstServerReads).toBe(2)
    expect(resultB.environmentId).not.toBe(initial.environmentId)
    expect(originForQueryClient(first)).toBe(originA)
    expect(originForQueryClient(second)).toBe(originB)
  } finally {
    first.clear()
    second.clear()
    setActiveServerOrigin(initialOrigin)
    await secondServer.cleanup()
  }
})

test('refuses unowned query clients and changes to an existing owner origin', async ({
  client,
}) => {
  const cache = new QueryClient()
  expect(() => clientForQueryClient(cache)).toThrow(
    expect.objectContaining({ code: 'QUERY_CLIENT_OWNER_MISSING' }),
  )
  expect(() => originForQueryClient(cache)).toThrow(
    expect.objectContaining({ code: 'QUERY_CLIENT_OWNER_MISSING' }),
  )
  registerEnvironmentQueryClient(cache, originA, client)
  registerEnvironmentQueryClient(cache, originA, client)

  expect(() => registerEnvironmentQueryClient(cache, originB, client)).toThrow(
    expect.objectContaining({ code: 'QUERY_CLIENT_OWNER_CONFLICT' }),
  )
  expect(clientForQueryClient(cache)).toBe(client)
  expect(originForQueryClient(cache)).toBe(originA)
})

test('replaces the transport for the same origin while retaining its cached state', async ({
  client,
  server,
}) => {
  const cache = new QueryClient()
  registerEnvironmentQueryClient(cache, originA, client)
  cache.setQueryData(['saved'], 'cached state')
  const replacement = createInProcessClient(server)
  registerEnvironmentQueryClient(cache, originA, replacement)
  expect(clientForQueryClient(cache)).toBe(replacement)
  expect(originForQueryClient(cache)).toBe(originA)
  expect(cache.getQueryData(['saved'])).toBe('cached state')
  expect((await clientForQueryClient(cache).health.get()).status).toBe(200)
})
