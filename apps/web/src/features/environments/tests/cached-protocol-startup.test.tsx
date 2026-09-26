import { waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import * as v from 'valibot'
import { healthDescriptorSchema, ORCHESTRATION_WS_PROTOCOL_VERSION } from '@workspace/contracts'
import { createEnvironmentClient } from '@workspace/client-core/transport/client'
import { inProcessOrchestrationSocketFactory } from '@workspace/client-core/test/in-process-orchestration-socket'
import { createEnvironmentEntry } from '@workspace/client-core/environments/utils/connection'
import { recordEnvironmentCacheBinding } from '@/lib/environments/state/binding-cache'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { primaryServerOrigin } from '@/lib/client'
import { assertEnvironmentWritable } from '@/lib/environments/state/availability'
import { transportFor, closeChatTransports } from '@/features/chat/state/active-transports'
import { environmentQueryKeys } from '@/features/environments/utils/query-keys'
import { createBootstrap } from '@/state/bootstrap'
import { createTestNavigation } from '../../../../test/factories/navigation'
import { installTestClient } from '../../../../test/factories/client-binding'
import { directInProcessFetcher } from '../../../../test/client'
import { expect, test } from '../../../../test/fixtures'

const currentProtocol = ORCHESTRATION_WS_PROTOCOL_VERSION
const previousProtocol = currentProtocol - 1

for (const compatible of [true, false]) {
  test(`warm startup waits for fresh health and ${compatible ? 'accepts the upgraded server over an older cache' : 'rejects an older server despite a compatible cache'}`, async ({
    server,
    client,
  }) => {
    const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
    const cached = {
      ...descriptor,
      protocolVersion: compatible ? previousProtocol : currentProtocol,
    }
    const fresh = {
      ...descriptor,
      protocolVersion: compatible ? currentProtocol : previousProtocol,
    }
    const origin = primaryServerOrigin()
    const previous = useEnvironmentsStore.getState()
    useEnvironmentsStore.setState({
      activeOrigin: origin,
      entries: { [origin]: createEnvironmentEntry(origin, origin) },
      connectionByOrigin: {},
    })
    recordEnvironmentCacheBinding(environmentScopedStorage(cached.environmentId), {
      names: ['local'],
      origin,
      descriptor: cached,
    })
    const health = Promise.withResolvers<void>()
    let probes = 0
    const directFetch = directInProcessFetcher(server)
    const fetcher = (async (input, init) => {
      const request = new Request(input, init)
      if (new URL(request.url).pathname !== '/health') return directFetch(request)
      probes += 1
      await health.promise
      return Response.json(fresh)
    }) as typeof fetch
    const restoreClient = installTestClient(
      createEnvironmentClient({ origin: server.origin, fetcher }),
    )
    const sockets = vi.fn(
      inProcessOrchestrationSocketFactory({ app: server.app, clientOrigin: server.origin }),
    )
    vi.stubGlobal('WebSocket', function (address: string) {
      return sockets(address)
    })
    const navigation = createTestNavigation()
    const boot = createBootstrap(navigation)
    const application = boot.getState().application!
    try {
      expect(application).not.toBeNull()
      expect(() => application.connections.start()).not.toThrow()
      boot.start()
      await waitFor(() => expect(probes).toBeGreaterThan(0))
      expect(sockets).not.toHaveBeenCalled()
      expect(transportFor(cached.environmentId)?.closed).toBe(true)
      expect(primaryQueryClient().getQueryData(environmentQueryKeys.descriptor)).toBeUndefined()
      expect(() => assertEnvironmentWritable(origin)).toThrow()
      expect(useEnvironmentsStore.getState().entries[origin]?.phase).toBe('connecting')
      application.connections.stop()
      boot.stop()
      boot.start()
      application.connections.start()
      expect(boot.getState().application).toBe(application)
      expect(sockets).not.toHaveBeenCalled()
      health.resolve()
      if (compatible) {
        await waitFor(() =>
          expect(useEnvironmentsStore.getState().entries[origin]?.phase).toBe('live'),
        )
        expect(boot.getState().application).toBe(application)
        expect(boot.getState().error).toBeNull()
        expect(primaryQueryClient().getQueryData(environmentQueryKeys.descriptor)).toEqual(fresh)
        expect(useEnvironmentsStore.getState().entries[origin]?.descriptor).toEqual(fresh)
        expect(() => assertEnvironmentWritable(origin)).not.toThrow()
        expect(sockets).toHaveBeenCalledTimes(1)
      } else {
        await waitFor(() =>
          expect(boot.getState().error).toContain(`speaks protocol ${previousProtocol}`),
        )
        expect(boot.getState().application).toBeNull()
        expect(sockets).not.toHaveBeenCalled()
        expect(() => assertEnvironmentWritable(origin)).toThrow()
        expect(primaryQueryClient().getQueryData(environmentQueryKeys.descriptor)).toBeUndefined()
      }
    } finally {
      health.resolve()
      boot.dispose()
      navigation.dispose()
      closeChatTransports()
      vi.unstubAllGlobals()
      restoreClient()
      useEnvironmentsStore.setState(previous, true)
      localStorage.clear()
    }
  })
}
