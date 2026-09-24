import { environmentQueryKeys } from '@/features/environments/utils/query-keys'
import { parseAddressIntent } from '@/features/address/utils/intent'
import { healthDescriptorSchema, DEFAULT_SETTING_VALUES } from '@workspace/contracts'
import * as v from 'valibot'
import { createEnvironmentEntry } from '@workspace/client-core/environments/utils/connection'
import {
  createInitialChatProjectionState,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { recordEnvironmentCacheBinding } from '@/lib/environments/state/binding-cache'
import { primaryServerOrigin, activeServerOrigin, setActiveServerOrigin } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { assertEnvironmentWritable } from '@/lib/environments/state/availability'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { transportFor, closeChatTransports } from '@/features/chat/state/active-transports'
import { writeBootMirror } from '@/lib/settings-boot-mirror'
import { createBootRuntime } from '@/state/bootstrap-runtime'
import { createBootstrap } from '@/state/bootstrap'
import { createTestNavigation } from '../../../../test/factories/navigation'
import { currentRailEnvironments } from '@/features/chat-mode/state/rail-environments'
import { createInProcessClient } from '../../../../test/client'
import { expect, test } from '../../../../test/fixtures'
import { makeTestServer } from '../../../../test/server'

test('warm bootstrap exists before mount and effect replay retains the same runtime', async ({
  client,
}) => {
  const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  const origin = primaryServerOrigin()
  const previous = useEnvironmentsStore.getState()
  recordEnvironmentCacheBinding(environmentScopedStorage(descriptor.environmentId), {
    names: ['local'],
    origin,
    descriptor,
  })
  const navigation = createTestNavigation()
  const boot = createBootstrap(navigation)
  const application = boot.getState().application
  try {
    expect(application).not.toBeNull()
    expect(() => assertEnvironmentWritable(origin)).toThrow()
    boot.start()
    boot.start()
    boot.stop()
    boot.start()
    await Promise.resolve()
    expect(boot.getState().application).toBe(application)
    expect(application?.getEnvironment(descriptor.environmentId)).toBeDefined()
    boot.stop()
    await Promise.resolve()
    expect(application?.getEnvironment(descriptor.environmentId)).toBeUndefined()
  } finally {
    boot.dispose()
    navigation.dispose()
    useEnvironmentsStore.setState(previous, true)
    localStorage.clear()
  }
})

test('cached bindings start primary and remote before sockets without painting stale projections, and cached protocol versions cannot prevent startup', async ({
  client,
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
    // Projections are server answers, never persisted: the rail waits for each socket.
    expect(currentRailEnvironments()).toEqual([])
    expect(transportFor(descriptorA.environmentId)?.closed).toBe(true)
    expect(transportFor(descriptorB.environmentId)?.closed).toBe(true)
    expect(application.connections.store.getState().machines[0]?.environmentId).toBe(
      descriptorB.environmentId,
    )
    expect(() => createBootRuntime(descriptorB, parseAddressIntent('/'), true)).toThrow(
      'cached machine identity conflicts',
    )
    expect(primaryQueryClient().getQueryData(environmentQueryKeys.descriptor)).toEqual(
      oldDescriptor,
    )
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
