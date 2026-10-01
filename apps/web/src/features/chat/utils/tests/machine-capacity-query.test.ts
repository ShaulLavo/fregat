import { QueryClient } from '@tanstack/react-query'
import { test, expect } from '../../../../../test/fixtures'
import { makeTestServer } from '../../../../../test/server'
import { createInProcessClient } from '../../../../../test/client'
import { readHostResources } from '../../../../../../server/src/machines/resources'
import { hostResources, lazyCpuSamples } from '../../../../../test/factories/host-resources'
import { fixtureEnvironmentId } from '../../../../../test/factories/chat'
import {
  registerEnvironmentQueryClient,
  queryClientFor,
} from '@/lib/environments/state/query-clients'
import { machineCapacityQueryOptions } from '../machine-capacity-query'

test('capacity reads route to their own fixture server and separate equal project IDs', async () => {
  const first = await makeTestServer({
    environmentId: fixtureEnvironmentId(11),
    machines: { resources: async () => hostResources({ cpuCount: 2 }) },
  })
  const second = await makeTestServer({
    environmentId: fixtureEnvironmentId(12),
    machines: { resources: async () => hostResources({ cpuCount: 8 }) },
  })
  const origins = ['http://fixture-capacity-one.test', 'http://fixture-capacity-two.test'] as const
  try {
    registerEnvironmentQueryClient(
      queryClientFor(origins[0]),
      origins[0],
      createInProcessClient(first),
    )
    registerEnvironmentQueryClient(
      queryClientFor(origins[1]),
      origins[1],
      createInProcessClient(second),
    )
    const cache = new QueryClient()
    const a = machineCapacityQueryOptions(fixtureEnvironmentId(11), origins[0])
    const b = machineCapacityQueryOptions(fixtureEnvironmentId(12), origins[1])
    expect((await cache.query(a)).cpuCount).toBe(2)
    expect((await cache.query(b)).cpuCount).toBe(8)
    expect(cache.getQueryData(a.queryKey)).not.toBe(cache.getQueryData(b.queryKey))
    cache.clear()
  } finally {
    await first.cleanup()
    await second.cleanup()
  }
})

test('the authenticated resource route returns current capacity', async ({ client }) => {
  const result = await client.machines.resources.get()
  expect(result.error).toBeNull()
  expect(result.data!.cpuCount).toBeGreaterThan(0)
  expect(result.data!.totalMemoryBytes).toBeGreaterThan(0)
})

test('CPU counters are materialized before the sampling wait', async () => {
  const resources = await readHostResources(lazyCpuSamples())
  expect(resources.cpuUtilization).toBe(0.25)
})
