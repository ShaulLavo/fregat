import { parseAddressIntent } from '@/features/address/utils/intent'
import { healthDescriptorSchema, DEFAULT_SETTING_VALUES } from '@workspace/contracts'
import * as v from 'valibot'
import { createEnvironmentEntry } from '@workspace/client-core/environments/utils/connection'
import {
  createInitialChatProjectionState,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import {
  chatProjectionCacheFromState,
  recordEnvironmentCacheBinding,
  writeChatProjectionCache,
} from '@/features/chat/state/chat-projection-cache'
import { fetchOrchestrationShellSnapshotHttp } from '@/features/chat/transport/orchestration-http-snapshots'
import { primaryServerOrigin, activeServerOrigin, setActiveServerOrigin } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { assertEnvironmentWritable } from '@/lib/environments/state/availability'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { transportFor, closeChatTransports } from '@/features/chat/state/active-transports'
import { writeBootMirror } from '@/features/settings/utils/boot-mirror'
import { createBootRuntime } from '@/state/bootstrap-runtime'
import { currentRailEnvironments } from '@/features/chat-mode/state/rail-environments'
import { sessionRailModel } from '@workspace/client-core/chat/rail/model'
import { createInProcessClient } from '../../../../test/client'
import { registerFederatedProject } from '../../../../test/factories/federation'
import { expect, test } from '../../../../test/fixtures'
import { makeTestServer } from '../../../../test/server'

test('cached primary and remote slices paint before sockets, and cached protocol versions cannot prevent startup', async ({
  client,
  server,
}) => {
  const second = await makeTestServer({ filesystemWatch: false })
  const clientB = createInProcessClient(second)
  const primary = primaryServerOrigin()
  const remote = 'http://localhost:37933'
  const descriptorA = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  const descriptorB = v.parse(healthDescriptorSchema, (await clientB.health.get()).data)
  const previous = useEnvironmentsStore.getState()
  const previousProjection = useChatProjectionStore.getState()
  const previousOrigin = activeServerOrigin()
  const oldDescriptor = { ...descriptorA, protocolVersion: descriptorA.protocolVersion + 1 }
  await registerFederatedProject(server, client, 'cached A')
  await registerFederatedProject(second, clientB, 'cached B')
  useChatProjectionStore.getState().resetChatProjection()
  useChatProjectionStore
    .getState()
    .syncShellSnapshot(descriptorA.environmentId, await fetchOrchestrationShellSnapshotHttp(client))
  useChatProjectionStore
    .getState()
    .syncShellSnapshot(
      descriptorB.environmentId,
      await fetchOrchestrationShellSnapshotHttp(clientB),
    )
  const cached = chatProjectionCacheFromState(useChatProjectionStore.getState())
  writeChatProjectionCache(environmentScopedStorage(descriptorA.environmentId), cached)
  writeChatProjectionCache(environmentScopedStorage(descriptorB.environmentId), cached)
  recordEnvironmentCacheBinding(environmentScopedStorage(descriptorA.environmentId), {
    names: ['local'],
    origin: primary,
    descriptor: oldDescriptor,
  })
  recordEnvironmentCacheBinding(environmentScopedStorage(descriptorB.environmentId), {
    names: ['remote'],
    origin: remote,
    descriptor: descriptorB,
  })
  localStorage.setItem('platform.environments.connected.v1', JSON.stringify(['remote']))
  writeBootMirror({
    ...DEFAULT_SETTING_VALUES,
    'environments.machines': { remote: { kind: 'origin', url: remote } },
  })
  useChatProjectionStore.setState(createInitialChatProjectionState())
  useEnvironmentsStore.setState({
    activeOrigin: primary,
    entries: { [primary]: createEnvironmentEntry(primary, primary) },
    connectionByOrigin: {},
  })
  setActiveServerOrigin(primary)
  const application = createBootRuntime(oldDescriptor, parseAddressIntent('/'), true)
  try {
    const model = sessionRailModel({ environments: currentRailEnvironments() })
    expect(model.projects).toHaveLength(1)
    expect(model.sessions).toHaveLength(2)
    expect(model.sessions.every((session) => session.stale)).toBe(true)
    expect(transportFor(descriptorA.environmentId)?.closed).toBe(true)
    expect(transportFor(descriptorB.environmentId)?.closed).toBe(true)
    expect(application.connections.store.getState().machines[0]?.environmentId).toBe(
      descriptorB.environmentId,
    )
    expect(() => createBootRuntime(descriptorB, parseAddressIntent('/'), true)).toThrow(
      'cached machine identity conflicts',
    )
    expect(primaryQueryClient().getQueryData(['environment-descriptor'])).toEqual(oldDescriptor)
    expect(useEnvironmentsStore.getState().entries[primary]?.environmentId).toBe(
      descriptorA.environmentId,
    )
    useEnvironmentsStore.getState().recordDescriptor(primary, descriptorA)
    expect(useEnvironmentsStore.getState().entries[primary]?.descriptor?.protocolVersion).toBe(
      descriptorA.protocolVersion,
    )
    await application.connections.disconnectMachine('remote')
    expect(application.connections.store.getState().machines[0]?.phase).toBe('idle')
    expect(useEnvironmentsStore.getState().entries[remote]?.connectedAt).toBeNull()
    expect(() => assertEnvironmentWritable(remote)).toThrow(
      expect.objectContaining({ code: 'environment.MACHINE_UNAVAILABLE' }),
    )
  } finally {
    application.dispose()
    closeChatTransports()
    useEnvironmentsStore.setState(previous, true)
    useChatProjectionStore.setState(previousProjection, true)
    setActiveServerOrigin(previousOrigin)
    localStorage.clear()
    await second.cleanup()
  }
})
