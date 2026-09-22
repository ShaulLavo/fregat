import { beforeEach, onTestFinished } from 'vitest'
import { DEFAULT_SETTING_VALUES } from '@workspace/contracts'
import { inProcessOrchestrationSocketFactory } from '@workspace/client-core/test/in-process-orchestration-socket'
import { createChatTransport } from '@/features/chat/transport/create-chat-transport'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { writeBootMirror } from '@/lib/settings-boot-mirror'
import { currentRailEnvironments } from '@/features/chat-mode/state/rail-environments'
import { createEnvironmentConnections } from '@/state/environment-connections'
import { readConnectedMachines } from '@/state/connected-machines'
import { waitFor } from '@testing-library/react'
import { expect, test } from '../../../test/fixtures'
import {
  createFederationHarness,
  registerFederatedProject,
} from '../../../test/factories/federation'
import { transportFor } from '@/features/chat/state/active-transports'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { clientForQueryClient, queryClientFor } from '@/lib/environments/state/query-clients'
import {
  activeServerOrigin,
  getClient,
  setActiveServerOrigin,
  setClient,
  serverEndpoint,
} from '@/lib/client'

beforeEach(() => localStorage.clear())

test('renaming a connected machine preserves its transport and updates its rail label', async ({
  server,
}) => {
  const h = await createFederationHarness(server)
  await waitFor(() => expect(transportFor(h.descriptorB.environmentId)?.closed).toBe(false))
  const transport = transportFor(h.descriptorB.environmentId)
  h.connections.configureMachines({
    remote: { kind: 'origin', url: h.originB, label: 'Renamed machine' },
  })
  expect(transportFor(h.descriptorB.environmentId)).toBe(transport)
  expect(useEnvironmentsStore.getState().entries[h.originB]?.label).toBe('Renamed machine')
})

test('editing a disconnected machine keeps it idle without reconnecting', async ({ server }) => {
  const h = await createFederationHarness(server)
  await h.connections.disconnectMachine('remote')
  expect(
    h.connections.store.getState().machines.find((entry) => entry.name === 'remote')?.phase,
  ).toBe('idle')
  h.connections.configureMachines({ remote: { kind: 'origin', url: 'http://localhost:37967' } })
  await Promise.resolve()
  expect(
    h.connections.store.getState().machines.find((entry) => entry.name === 'remote')?.phase,
  ).toBe('idle')
  expect(readConnectedMachines()).not.toContain('remote')
})

test('editing an endpoint retains its expected identity and cannot turn a primary alias failure into a primary outage', async ({
  server,
}) => {
  const h = await createFederationHarness(server)
  await h.connections.connectMachine('alias')
  const primaryTransport = transportFor(h.descriptorA.environmentId)
  h.connections.configureMachines({
    remote: { kind: 'origin', url: h.originB },
    alias: { kind: 'origin', url: h.originB },
  })
  await waitFor(() =>
    expect(
      h.connections.store.getState().machines.find((machine) => machine.name === 'alias')?.phase,
    ).toBe('identity-drift'),
  )
  expect(
    h.connections.store.getState().machines.find((machine) => machine.name === 'alias')
      ?.environmentId,
  ).toBe(h.descriptorA.environmentId)
  expect(useEnvironmentsStore.getState().entries[h.originA]?.phase).toBe('live')
  expect(transportFor(h.descriptorA.environmentId)).toBe(primaryTransport)
})

test('replacing a confirmed endpoint keeps its existing QueryClient and retained editor runtime', async ({
  server,
}) => {
  const h = await createFederationHarness(server)
  const alias = 'http://localhost:37903'
  const previousOrigin = activeServerOrigin()
  const previousClient = getClient()
  setActiveServerOrigin(alias)
  setClient(h.clientB)
  setActiveServerOrigin(previousOrigin)
  setClient(previousClient)
  h.application.activateEnvironment(h.originB)
  const editor = h.application.getSnapshot().editor
  const queryClient = queryClientFor(h.originB)
  const client = clientForQueryClient(queryClient)
  const previousTransport = transportFor(h.descriptorB.environmentId)
  h.connections.configureMachines({ remote: { kind: 'origin', url: alias } })
  await waitFor(() =>
    expect(
      h.connections.store.getState().machines.find((machine) => machine.name === 'remote')?.phase,
    ).toBe('live'),
  )
  expect(serverEndpoint(h.originB)).toBe(alias)
  expect(queryClientFor(h.originB)).toBe(queryClient)
  expect(clientForQueryClient(queryClient)).toBe(client)
  expect(h.application.getSnapshot().editor).toBe(editor)
  expect(transportFor(h.descriptorB.environmentId)).not.toBe(previousTransport)
  expect(previousTransport?.closed).toBe(true)
})

test('authoritative removal drops a remembered machine, and only an explicit re-add reconnects it', async ({
  server,
}) => {
  const h = await createFederationHarness(server)
  const project = await registerFederatedProject(h.serverB, h.clientB, 'B')
  await waitFor(() =>
    expect(
      useChatProjectionStore.getState().slices[h.descriptorB.environmentId]?.projectIds,
    ).toContain(project.projectId),
  )
  h.connections.stop()
  useChatProjectionStore.getState().dropEnvironment(h.descriptorB.environmentId)
  const config = { remote: { kind: 'origin', url: h.originB } } as const
  writeBootMirror({ ...DEFAULT_SETTING_VALUES, 'environments.machines': config })
  onTestFinished(() => writeBootMirror(DEFAULT_SETTING_VALUES))
  const created: string[] = []
  const restored = createEnvironmentConnections({
    createTransport: (origin) => {
      created.push(origin)
      const owner = origin === h.originA ? h.serverA : h.serverB
      return createChatTransport(origin, {
        createSocket: inProcessOrchestrationSocketFactory({
          app: owner.app,
          clientOrigin: owner.origin,
        }),
      })
    },
  })
  onTestFinished(() => restored.stop())
  expect(readConnectedMachines()).toEqual(['remote'])
  // Remembered, but not yet answered: the rail lists a machine once its socket
  // delivers a projection, never from anything restored off disk.
  expect(
    currentRailEnvironments().some(
      (environment) => environment.environmentId === h.descriptorB.environmentId,
    ),
  ).toBe(false)
  restored.configureMachines({})
  expect(readConnectedMachines()).toEqual([])
  expect(restored.store.getState().machines).toEqual([])
  expect(
    currentRailEnvironments().some(
      (environment) => environment.environmentId === h.descriptorB.environmentId,
    ),
  ).toBe(false)
  restored.start()
  window.dispatchEvent(new Event('focus'))
  await waitFor(() => expect(transportFor(h.descriptorA.environmentId)?.closed).toBe(false))
  expect(created).not.toContain(h.originB)
  restored.configureMachines(config)
  expect(readConnectedMachines()).toEqual([])
  expect(
    currentRailEnvironments().some(
      (environment) => environment.environmentId === h.descriptorB.environmentId,
    ),
  ).toBe(false)
  await restored.connectMachine('remote')
  await waitFor(() => expect(restored.store.getState().machines[0]?.phase).toBe('live'))
  expect(created).toContain(h.originB)
  expect(
    currentRailEnvironments().some(
      (environment) => environment.environmentId === h.descriptorB.environmentId,
    ),
  ).toBe(true)
})

test('a missing boot mirror keeps desired names pending until a configured settings projection arrives', async ({
  server,
}) => {
  const h = await createFederationHarness(server)
  const project = await registerFederatedProject(h.serverB, h.clientB, 'B')
  await waitFor(() =>
    expect(
      useChatProjectionStore.getState().slices[h.descriptorB.environmentId]?.projectIds,
    ).toContain(project.projectId),
  )
  h.connections.stop()
  useChatProjectionStore.getState().dropEnvironment(h.descriptorB.environmentId)
  writeBootMirror(DEFAULT_SETTING_VALUES)
  const restored = createEnvironmentConnections()
  onTestFinished(() => restored.stop())
  expect(restored.store.getState().machines).toEqual([])
  expect(readConnectedMachines()).toEqual(['remote'])
  expect(
    currentRailEnvironments().some(
      (environment) => environment.environmentId === h.descriptorB.environmentId,
    ),
  ).toBe(false)
  restored.configureMachines({ remote: { kind: 'origin', url: h.originB } })
  expect(readConnectedMachines()).toEqual(['remote'])
  // Configured is not connected: the transport is still closed, so the rail stays empty of it.
  expect(
    currentRailEnvironments().some(
      (environment) => environment.environmentId === h.descriptorB.environmentId,
    ),
  ).toBe(false)
  expect(transportFor(h.descriptorB.environmentId)?.closed).toBe(true)
})
