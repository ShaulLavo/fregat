import { afterEach, beforeEach, vi } from 'vitest'
import { healthDescriptorSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { inProcessOrchestrationSocketFactory } from '@workspace/client-core/test/in-process-orchestration-socket'
import { orchestrationServerConfig } from '@workspace/client-core/test/orchestration-server-config'
import { rpcClientFixture } from '../../../../../../packages/client-core/test/rpc-client'
import { subscribeWorkspaceReconnect } from '@/features/workspace/state/reconnect-subscription'
import { startWorkspaceEventStreams } from '@/features/workspace/state/event-streams'
import { createCuttableEventsClient } from '../../../../test/client'
import { activeServerOrigin, setActiveServerOrigin } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { expect, test } from '../../../../test/fixtures'

const origin = 'http://workspace-reconnect.test'
const otherOrigin = 'http://other-workspace.test'
let initialState = useEnvironmentsStore.getState()
let initialOrigin = activeServerOrigin()

beforeEach(() => {
  initialState = useEnvironmentsStore.getState()
  initialOrigin = activeServerOrigin()
  useEnvironmentsStore.getState().resetConnections()
})

afterEach(() => {
  useEnvironmentsStore.setState(initialState, true)
  setActiveServerOrigin(initialOrigin)
})

test('a first real handshake wakes outage-time subscribers and later reconnects reach retained subscribers', async ({
  client,
  server,
}) => {
  const createSocket = inProcessOrchestrationSocketFactory({
    app: server.app,
    clientOrigin: server.origin,
  })
  const sockets: ReturnType<typeof createSocket>[] = []
  const fixture = rpcClientFixture({
    origin,
    environments: useEnvironmentsStore,
    createSocket: (address) => {
      const socket = createSocket(address)
      sockets.push(socket)
      return socket
    },
  })
  let initiatingResumes = 0
  let retainedResumes = 0
  const stopInitiating = subscribeWorkspaceReconnect(origin, () => initiatingResumes++)
  const stopRetained = subscribeWorkspaceReconnect(origin, () => retainedResumes++)

  try {
    // Both watches may have given up while this origin was down; only an accepted handshake wakes them.
    useEnvironmentsStore
      .getState()
      .restoreDescriptor(origin, v.parse(healthDescriptorSchema, (await client.health.get()).data))
    useEnvironmentsStore.getState().setPhase(origin, 'live')
    expect([initiatingResumes, retainedResumes]).toEqual([0, 0])
    await fixture.client.ready()
    expect([initiatingResumes, retainedResumes]).toEqual([1, 1])

    useEnvironmentsStore.getState().activate(otherOrigin)
    sockets[0]!.serverClose({ code: 1012, wasClean: true })
    expect([initiatingResumes, retainedResumes]).toEqual([1, 1])
    await fixture.client.ready()
    expect([initiatingResumes, retainedResumes]).toEqual([2, 2])

    stopInitiating()
    sockets[1]!.serverClose({ code: 1012, wasClean: true })
    await fixture.client.ready()
    expect([initiatingResumes, retainedResumes]).toEqual([2, 3])
  } finally {
    stopInitiating()
    stopRetained()
    fixture.client.close()
  }
})

test('a watch exhausted before its first handshake resumes on the real origin connection', async ({
  server,
}) => {
  let offline = true
  const transport = createCuttableEventsClient(server, (request) => {
    if (offline && new URL(request.url).pathname === '/fs/events')
      return new Response(null, { status: 503 })
    return undefined
  })
  let readyCount = 0
  let errorCount = 0
  const streams = startWorkspaceEventStreams({
    client: transport.client,
    rootPath: '',
    onMessage: (message) => {
      if (message.type === 'ready') readyCount++
    },
    onFilesReady: () => {},
    onError: () => errorCount++,
    onInterrupted: () => {},
  })
  const unsubscribe = subscribeWorkspaceReconnect(origin, () => streams.resume())
  const createSocket = inProcessOrchestrationSocketFactory({
    app: server.app,
    clientOrigin: server.origin,
  })
  const sockets: ReturnType<typeof createSocket>[] = []
  const fixture = rpcClientFixture({
    origin,
    environments: useEnvironmentsStore,
    createSocket: (address) => {
      const socket = createSocket(address)
      sockets.push(socket)
      return socket
    },
  })

  try {
    await vi.waitFor(() => expect(errorCount).toBe(1), { timeout: 12_000 })
    expect(readyCount).toBe(0)
    offline = false
    await fixture.client.ready()
    await vi.waitFor(() => expect(readyCount).toBe(1))
    expect(errorCount).toBe(1)
  } finally {
    unsubscribe()
    streams.close()
    fixture.client.close()
  }
}, 15_000)

test('ignores other origins and repeated handshakes, and observes origin replacement and connection resets', () => {
  const { activate, markDisconnected, recordHandshake, resetConnections, setPhase } =
    useEnvironmentsStore.getState()
  recordHandshake(origin, orchestrationServerConfig())
  let resumes = 0
  const unsubscribe = subscribeWorkspaceReconnect(origin, () => resumes++)

  try {
    expect(resumes).toBe(0)
    activate(otherOrigin)
    recordHandshake(otherOrigin, orchestrationServerConfig())
    markDisconnected(otherOrigin)
    recordHandshake(otherOrigin, orchestrationServerConfig({ serverInstanceId: 'other-2' }))
    setPhase(origin, 'reconnecting')
    setPhase(origin, 'live')
    recordHandshake(origin, orchestrationServerConfig())
    expect(resumes).toBe(0)

    recordHandshake(origin, orchestrationServerConfig({ serverInstanceId: 'server-2' }))
    expect(resumes).toBe(1)
    markDisconnected(origin)
    expect(resumes).toBe(1)
    recordHandshake(origin, orchestrationServerConfig({ serverInstanceId: 'server-2' }))
    expect(resumes).toBe(2)
    resetConnections(origin)
    expect(resumes).toBe(2)
    recordHandshake(origin, orchestrationServerConfig({ serverInstanceId: 'server-2' }))
    expect(resumes).toBe(3)
  } finally {
    unsubscribe()
  }
})
