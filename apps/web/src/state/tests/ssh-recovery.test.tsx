import { onTestFinished } from 'vitest'
import { waitFor } from '@testing-library/react'
import { healthDescriptorSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { transportFor } from '@/features/chat/state/active-transports'
import { serverEndpoint, primaryServerOrigin } from '@/lib/client'
import { clientForQueryClient, queryClientFor } from '@/lib/environments/state/query-clients'
import { saveSettings } from '@/features/settings/utils/api'
import { createFederationHarness } from '../../../test/factories/federation'
import { fakeSsh } from '../../../../server/test/factories/ssh'
import { createInProcessClient } from '../../../test/client'
import { makeTestServer } from '../../../test/server'
import { expect, test } from '../../../test/fixtures'

test.for([37902, 37903])(
  'browser SSH recovery keeps its proxy endpoint when the backend forward moves to port %i',
  async (recoveryPort) => {
    const serverB = await makeTestServer({ filesystemWatch: false, persistentDatabase: true })
    const descriptor = v.parse(
      healthDescriptorSchema,
      (await createInProcessClient(serverB).health.get()).data,
    )
    const boundary = await fakeSsh({ descriptor })
    let localPort = 37902
    let launched = () => {}
    const primaryServer = await makeTestServer({
      filesystemWatch: false,
      machines: {
        spawn: (command) => {
          if (command.at(-1)?.includes('await withLeaseLock(launch);')) launched()
          return boundary.spawn(command)
        },
        fetcher: boundary.fetcher,
        localPort: async () => localPort,
      },
    })
    onTestFinished(() => primaryServer.cleanup())
    const h = await createFederationHarness(primaryServer, serverB)
    launched = () => h.restoreConnection(h.originB)
    const machine = { kind: 'ssh', target: 'localhost' } as const
    await saveSettings(
      {
        mutationId: 'configure-ssh',
        target: 'user',
        operations: [{ kind: 'machine.set', name: 'remote', machine }],
      },
      h.clientA,
    )
    h.connections.configureMachines({ remote: machine })
    await waitFor(() => expect(h.connections.store.getState().machines[0]?.phase).toBe('live'))
    const endpoint = `${primaryServerOrigin()}/machines/remote/proxy`
    expect(h.connections.store.getState().machines[0]?.endpoint).toBe(endpoint)
    const primary = transportFor(h.descriptorA.environmentId)
    const remote = transportFor(h.descriptorB.environmentId)
    h.application.activateEnvironment(h.originB)
    const editor = h.application.getSnapshot().editor
    const queryClient = queryClientFor(h.originB)
    const client = clientForQueryClient(queryClient)
    const forwards = boundary.forwardChildren.length
    boundary.crashServer()
    localPort = recoveryPort
    h.cutConnection(h.originB)
    await waitFor(() => expect(boundary.forwardChildren.length).toBeGreaterThan(forwards))
    await waitFor(() => expect(h.connections.store.getState().machines[0]?.phase).toBe('live'))
    expect(serverEndpoint(h.originB)).toBe(endpoint)
    expect(queryClientFor(h.originB)).toBe(queryClient)
    expect(clientForQueryClient(queryClient)).toBe(client)
    expect(h.application.getSnapshot().editor).toBe(editor)
    expect(transportFor(h.descriptorB.environmentId)).toBe(remote)
    expect(transportFor(h.descriptorA.environmentId)).toBe(primary)
    expect(primary?.closed).toBe(false)
  },
)
