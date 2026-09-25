import { confirmedEnvironmentId, confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'
import { fixtureEnvironmentId } from '../../../../test/factories/chat'
import { healthDescriptorSchema, ORCHESTRATION_WS_PROTOCOL_VERSION } from '@workspace/contracts'
import { afterEach, beforeEach } from 'vitest'
import * as v from 'valibot'

import { activeServerOrigin, getClient, setActiveServerOrigin } from '@/lib/client'
import { selectServerConnection } from '@workspace/client-core/environments/state/store'
import { resetServerConnectionStore, useEnvironmentsStore } from '@/lib/environments/state/store'
import { selectServerProtocolSkew } from '@workspace/client-core/environments/utils/connection'
import { orchestrationServerConfig } from '@workspace/client-core/test/orchestration-server-config'
import { expect, test } from '../../../../test/fixtures'

const originA = 'http://localhost:3301'
const originB = 'http://localhost:3302'
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
})

test('activation publishes the new origin and client together', () => {
  const previousClient = getClient()
  const observed: { storeOrigin: string; clientOrigin: string; changedClient: boolean }[] = []
  const unsubscribe = useEnvironmentsStore.subscribe((state) => {
    observed.push({
      storeOrigin: state.activeOrigin,
      clientOrigin: activeServerOrigin(),
      changedClient: getClient() !== previousClient,
    })
  })

  useEnvironmentsStore.getState().activate(originB)
  unsubscribe()

  expect(observed).toEqual([{ storeOrigin: originB, clientOrigin: originB, changedClient: true }])
  expect(useEnvironmentsStore.getState().entries[originB]).toMatchObject({
    origin: originB,
    kind: 'origin',
  })
})

test('tracks accepted generations independently by origin', () => {
  const { recordHandshake } = useEnvironmentsStore.getState()
  recordHandshake(originA, orchestrationServerConfig())
  recordHandshake(originA, orchestrationServerConfig())
  recordHandshake(originB, orchestrationServerConfig({ environmentId: fixtureEnvironmentId(2) }))
  expect(selectServerConnection(useEnvironmentsStore.getState(), originA).generation).toBe(1)

  recordHandshake(originA, orchestrationServerConfig({ serverInstanceId: 'server-2' }))

  const state = useEnvironmentsStore.getState()
  expect(selectServerConnection(state, originA).generation).toBe(2)
  expect(selectServerConnection(state, originB).generation).toBe(1)
  expect(
    selectServerProtocolSkew(
      selectServerConnection(state, originA),
      ORCHESTRATION_WS_PROTOCOL_VERSION,
    ),
  ).toBe(false)
  expect(
    selectServerProtocolSkew(
      selectServerConnection(state, originB),
      ORCHESTRATION_WS_PROTOCOL_VERSION,
    ),
  ).toBe(false)
  expect(
    selectServerProtocolSkew({ protocolVersion: null }, ORCHESTRATION_WS_PROTOCOL_VERSION),
  ).toBe(false)
  expect(
    selectServerProtocolSkew({ protocolVersion: 999 }, ORCHESTRATION_WS_PROTOCOL_VERSION),
  ).toBe(true)
})

test('rejects incompatible handshake and descriptor protocols before trusting their metadata', async ({
  client,
}) => {
  const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  const { recordDescriptor, recordHandshake } = useEnvironmentsStore.getState()
  recordDescriptor(originA, descriptor)
  const entry = useEnvironmentsStore.getState().entries[originA]

  expect(() =>
    recordHandshake(
      originA,
      orchestrationServerConfig({
        environmentId: descriptor.environmentId,
        protocolVersion: 999,
      }),
    ),
  ).toThrow(expect.objectContaining({ code: 'ENVIRONMENT_PROTOCOL_MISMATCH', statusCode: 403 }))
  expect(selectServerConnection(useEnvironmentsStore.getState(), originA)).toMatchObject({
    phase: 'protocol-mismatch',
    expected: ORCHESTRATION_WS_PROTOCOL_VERSION,
    received: 999,
    generation: 0,
    protocolVersion: null,
    serverInstanceId: null,
  })
  expect(() =>
    recordDescriptor(originA, { ...descriptor, label: 'incompatible', protocolVersion: 999 }),
  ).toThrow(expect.objectContaining({ code: 'ENVIRONMENT_PROTOCOL_MISMATCH', statusCode: 403 }))
  expect(useEnvironmentsStore.getState().entries[originA]).toBe(entry)

  recordDescriptor(originA, descriptor)
  expect(selectServerConnection(useEnvironmentsStore.getState(), originA)).toEqual({
    phase: 'disconnected',
    generation: 0,
    protocolVersion: null,
    serverInstanceId: null,
    slowRequestCount: 0,
  })
  recordHandshake(originA, orchestrationServerConfig({ environmentId: descriptor.environmentId }))
  expect(selectServerConnection(useEnvironmentsStore.getState(), originA)).toMatchObject({
    phase: 'connected',
    generation: 1,
  })
})

test('refuses handshake identity drift without applying the replacement config', () => {
  const { recordHandshake } = useEnvironmentsStore.getState()
  recordHandshake(originA, orchestrationServerConfig())

  expect(() =>
    recordHandshake(
      originA,
      orchestrationServerConfig({
        environmentId: fixtureEnvironmentId(3),
        serverInstanceId: 'replacement-process',
        protocolVersion: 999,
      }),
    ),
  ).toThrow(expect.objectContaining({ code: 'ENVIRONMENT_IDENTITY_DRIFT', statusCode: 403 }))

  const state = useEnvironmentsStore.getState()
  expect(state.entries[originA]?.environmentId).toBe(fixtureEnvironmentId(1))
  expect(selectServerConnection(state, originA)).toEqual({
    phase: 'identity-drift',
    expected: fixtureEnvironmentId(1),
    received: fixtureEnvironmentId(3),
    generation: 1,
    protocolVersion: ORCHESTRATION_WS_PROTOCOL_VERSION,
    serverInstanceId: 'server-1',
    slowRequestCount: 0,
  })
})

test('a compatible descriptor clears refusals without changing accepted process metadata', async ({
  client,
}) => {
  const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  const config = orchestrationServerConfig({ environmentId: descriptor.environmentId })
  const { recordDescriptor, recordHandshake } = useEnvironmentsStore.getState()
  recordDescriptor(originA, descriptor)
  recordHandshake(originA, config)
  const accepted = selectServerConnection(useEnvironmentsStore.getState(), originA)

  for (const { phase, invalid } of [
    { phase: 'identity-drift', invalid: { environmentId: fixtureEnvironmentId(3) } },
    { phase: 'protocol-mismatch', invalid: { protocolVersion: 999 } },
  ]) {
    expect(() => recordDescriptor(originA, { ...descriptor, ...invalid })).toThrow()
    expect(selectServerConnection(useEnvironmentsStore.getState(), originA).phase).toBe(phase)
    recordDescriptor(originA, descriptor)
    expect(selectServerConnection(useEnvironmentsStore.getState(), originA)).toEqual({
      ...accepted,
      phase: 'disconnected',
    })
    recordHandshake(originA, config)
    expect(selectServerConnection(useEnvironmentsStore.getState(), originA)).toEqual(accepted)
  }
})

test('learns descriptor identity from the real server and rejects conflicting handshakes or descriptors', async ({
  client,
}) => {
  const response = await client.health.get()
  const descriptor = v.parse(healthDescriptorSchema, response.data)
  const { recordDescriptor, recordHandshake } = useEnvironmentsStore.getState()
  recordDescriptor(originA, descriptor)
  recordHandshake(originA, orchestrationServerConfig({ environmentId: descriptor.environmentId }))

  expect(useEnvironmentsStore.getState().entries[originA]).toMatchObject({
    environmentId: descriptor.environmentId,
    label: descriptor.label,
  })
  expect(() =>
    recordDescriptor(originA, {
      ...descriptor,
      environmentId: fixtureEnvironmentId(3),
      label: 'wrong machine',
    }),
  ).toThrow(expect.objectContaining({ code: 'ENVIRONMENT_IDENTITY_DRIFT' }))
  expect(useEnvironmentsStore.getState().entries[originA]?.label).toBe(descriptor.label)
  expect(() =>
    recordHandshake(originA, orchestrationServerConfig({ environmentId: fixtureEnvironmentId(4) })),
  ).toThrow(expect.objectContaining({ code: 'ENVIRONMENT_IDENTITY_DRIFT' }))
})

test('counts slow requests by origin and clears only a restarted server', () => {
  const { clearSlowRequest, markSlowRequest, recordHandshake } = useEnvironmentsStore.getState()
  recordHandshake(originA, orchestrationServerConfig())
  recordHandshake(originB, orchestrationServerConfig({ environmentId: fixtureEnvironmentId(2) }))
  markSlowRequest(originA, 'request-1')
  markSlowRequest(originA, 'request-1')
  markSlowRequest(originA, 'request-2')
  markSlowRequest(originB, 'request-1')
  clearSlowRequest(originA, 'request-never-slow')
  clearSlowRequest(originA, 'request-1')
  expect(selectServerConnection(useEnvironmentsStore.getState(), originA).slowRequestCount).toBe(1)
  expect(selectServerConnection(useEnvironmentsStore.getState(), originB).slowRequestCount).toBe(1)

  recordHandshake(originA, orchestrationServerConfig({ serverInstanceId: 'server-2' }))
  clearSlowRequest(originA, 'request-2')
  expect(selectServerConnection(useEnvironmentsStore.getState(), originA).slowRequestCount).toBe(0)
  expect(selectServerConnection(useEnvironmentsStore.getState(), originB).slowRequestCount).toBe(1)
  resetServerConnectionStore(originB)
  expect(selectServerConnection(useEnvironmentsStore.getState(), originB).slowRequestCount).toBe(0)
})

test('refused origins cannot route scoped actions using their previously accepted identity', () => {
  const { recordHandshake } = useEnvironmentsStore.getState()
  const config = orchestrationServerConfig()
  recordHandshake(originA, config)
  expect(confirmedEnvironmentOrigin(config.environmentId)).toBe(originA)
  expect(confirmedEnvironmentId(originA)).toBe(config.environmentId)
  expect(() =>
    recordHandshake(originA, { ...config, environmentId: fixtureEnvironmentId(5) }),
  ).toThrow()
  expect(() => confirmedEnvironmentOrigin(config.environmentId)).toThrow(
    'different environment identity',
  )
  expect(() => confirmedEnvironmentId(originA)).toThrow('different environment identity')
  recordHandshake(originA, config)
  expect(() => recordHandshake(originA, { ...config, protocolVersion: 999 })).toThrow()
  expect(() => confirmedEnvironmentOrigin(config.environmentId)).toThrow('incompatible protocol')
})
