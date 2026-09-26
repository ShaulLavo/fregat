import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { onTestFinished } from 'vitest'
import {
  healthDescriptorSchema,
  commandIdSchema,
  sessionIdSchema,
  DEFAULT_PROVIDER_INSTANCE_ID,
} from '@workspace/contracts'
import * as v from 'valibot'
import { inProcessOrchestrationSocketFactory } from '@workspace/client-core/test/in-process-orchestration-socket'
import { FakeOrchestrationSocket } from '@workspace/client-core/test/orchestration-socket'
import { createEnvironmentEntry } from '@workspace/client-core/environments/utils/connection'
import { createChatTransport } from '@/features/chat/transport/create-chat-transport'
import { createEnvironmentConnections } from '@/state/environment-connections'
import { createApplicationRuntime } from '@/state/application-runtime'
import { readWorkspaceCache } from '@/features/workspace/state/cache'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import {
  primaryServerOrigin,
  activeServerOrigin,
  getClient,
  setClient,
  setActiveServerOrigin,
} from '@/lib/client'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { createProjectRegistrationCommand } from '@workspace/client-core/chat/registration'
import { installTestClient } from './client-binding'
import { createInProcessClient } from '../client'
import { makeTestServer, type TestServer } from '../server'
import { runGit } from './git'

export async function createFederationHarness(serverA: TestServer, remote?: TestServer) {
  const serverB =
    remote ?? (await makeTestServer({ filesystemWatch: false, persistentDatabase: true }))
  const previousState = useEnvironmentsStore.getState()
  const previousProjection = useChatProjectionStore.getState()
  const previousOrigin = activeServerOrigin()
  const previousClient = getClient()
  const originA = primaryServerOrigin()
  const originB = 'http://localhost:37902'
  const clientA = createInProcessClient(serverA)
  const clientB = createInProcessClient(serverB)
  setActiveServerOrigin(originB)
  const restoreClientB = installTestClient(clientB)
  setActiveServerOrigin(originA)
  const restoreClientA = installTestClient(clientA)
  const descriptorA = v.parse(healthDescriptorSchema, (await clientA.health.get()).data)
  const descriptorB = v.parse(healthDescriptorSchema, (await clientB.health.get()).data)
  useEnvironmentsStore.setState({
    activeOrigin: originA,
    entries: { [originA]: createEnvironmentEntry(originA, originA) },
    connectionByOrigin: {},
  })
  useEnvironmentsStore.getState().recordDescriptor(originA, descriptorA)
  useChatProjectionStore.getState().resetChatProjection()
  const application = createApplicationRuntime({
    workspaceCache: readWorkspaceCache(environmentScopedStorage(descriptorA.environmentId)),
    preparation: {
      appliedThemeContentHash: null,
      appliedThemeId: null,
      selectedThemeId: 'dark-plus',
      syntaxHighlightingEnabled: false,
      tabSize: 4,
    },
  })
  const sockets = new Map<string, FakeOrchestrationSocket[]>()
  const unavailable = new Set<string>()
  const connections = createEnvironmentConnections({
    createTransport: (origin) =>
      createChatTransport(origin, {
        createSocket: () => {
          const owner = origin === originA ? serverA : serverB
          const socket = unavailable.has(origin)
            ? new FakeOrchestrationSocket()
            : inProcessOrchestrationSocketFactory({ app: owner.app, clientOrigin: owner.origin })(
                '',
              )
          sockets.set(origin, [...(sockets.get(origin) ?? []), socket])
          if (unavailable.has(origin))
            setTimeout(() => socket.serverClose({ code: 1006, wasClean: false }), 0)
          return socket
        },
      }),
  })
  connections.configureMachines({
    remote: { kind: 'origin', url: originB, label: 'Remote fixture' },
    alias: { kind: 'origin', url: originA, label: 'Local alias' },
  })
  connections.start()
  await connections.connectMachine('remote')
  onTestFinished(async () => {
    connections.stop()
    application.dispose()
    restoreClientB()
    restoreClientA()
    useEnvironmentsStore.setState(previousState, true)
    useChatProjectionStore.setState(previousProjection, true)
    setActiveServerOrigin(previousOrigin)
    setClient(previousClient)
    localStorage.removeItem('platform.environments.connected.v1')
    await serverB.cleanup()
  })
  return {
    application,
    connections,
    serverA,
    serverB,
    clientA,
    clientB,
    originA,
    originB,
    descriptorA,
    descriptorB,
    sockets,
    cutConnection(origin: string) {
      unavailable.add(origin)
      for (const socket of sockets.get(origin) ?? [])
        socket.serverClose({ code: 1006, wasClean: false })
    },
    restoreConnection(origin: string) {
      unavailable.delete(origin)
      window.dispatchEvent(new Event('online'))
    },
  }
}

export async function registerFederatedProject(
  server: TestServer,
  client: ReturnType<typeof createInProcessClient>,
  suffix: string,
  requestedSessionId?: import('@workspace/contracts').SessionId,
) {
  const path = join(server.root, 'repo')
  await mkdir(path)
  runGit(path, ['init', '-b', 'main'], { cwdMode: 'option' })
  runGit(path, ['remote', 'add', 'origin', 'https://example.com/federated/fixture.git'], {
    cwdMode: 'option',
  })
  await writeFile(join(path, 'shared.txt'), suffix)
  const response = await client.orchestration.commands.post(
    createProjectRegistrationCommand({ workspaceRoot: 'repo', title: 'Shared project' }),
  )
  const result = response.data!.result!
  const sessionId = requestedSessionId ?? v.parse(sessionIdSchema, crypto.randomUUID())
  await client.orchestration.commands.post({
    type: 'session.create',
    commandId: v.parse(commandIdSchema, `federation-session-${suffix}`),
    sessionId,
    worktreeTarget: { kind: 'current', worktreeId: result.worktreeId! },
    title: `Session ${suffix}`,
    runtimeMode: 'approval-required',
    interactionMode: 'default',
    modelSelection: { model: 'mock-model', providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID },
  })
  return { ...result, sessionId }
}
