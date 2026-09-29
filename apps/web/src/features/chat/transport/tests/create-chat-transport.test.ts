import { healthDescriptorSchema } from '@workspace/contracts'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import {
  DEFAULT_PROVIDER_INSTANCE_ID,
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  commandIdSchema,
  sessionIdSchema,
} from '@workspace/contracts'
import * as v from 'valibot'
import { deferredSnapshotClient } from '../../../../../test/factories/deferred-snapshot-client'
import { createChatTransport } from '@/features/chat/transport/create-chat-transport'
import { activeServerOrigin, getClient, setActiveServerOrigin, setClient } from '@/lib/client'
import { expect, test } from '../../../../../test/fixtures'
import { makeTestServer } from '../../../../../test/server'
import { createInProcessClient } from '../../../../../test/client'
import { inProcessOrchestrationSocketFactory } from '@workspace/client-core/test/in-process-orchestration-socket'

const SESSION_ID = v.parse(sessionIdSchema, '0c9faaac-3e76-560c-a0e0-1adfa868c5c6')

test('two transports dispatch and read snapshots from their owning servers after an active switch', async () => {
  const serverA = await makeTestServer({ filesystemWatch: false })
  const serverB = await makeTestServer({ filesystemWatch: false })
  const previousOrigin = activeServerOrigin()
  const previousClient = getClient()
  const originA = 'http://localhost:39001'
  const originB = 'http://localhost:39002'
  setActiveServerOrigin(originA)
  setClient(createInProcessClient(serverA))
  setActiveServerOrigin(originB)
  setClient(createInProcessClient(serverB))
  useEnvironmentsStore
    .getState()
    .recordDescriptor(
      originA,
      v.parse(healthDescriptorSchema, (await createInProcessClient(serverA).health.get()).data),
    )
  useEnvironmentsStore
    .getState()
    .recordDescriptor(
      originB,
      v.parse(healthDescriptorSchema, (await createInProcessClient(serverB).health.get()).data),
    )
  const transportA = createChatTransport(originA, {
    createSocket: inProcessOrchestrationSocketFactory({
      app: serverA.app,
      clientOrigin: serverA.origin,
    }),
  })
  const transportB = createChatTransport(originB, {
    createSocket: inProcessOrchestrationSocketFactory({
      app: serverB.app,
      clientOrigin: serverB.origin,
    }),
  })

  try {
    for (const [transport, title, rootPath] of [
      [transportA, 'A', serverA.root],
      [transportB, 'B', serverB.root],
    ] as const) {
      const registration = await transport.dispatchCommand({
        commandId: v.parse(commandIdSchema, `project-${title}`),
        defaultModelSelection: null,
        title,
        type: 'project.create',
        workspaceRoot: rootPath,
      })
      await transport.dispatchCommand({
        commandId: v.parse(commandIdSchema, `session-${title}`),
        sessionId: SESSION_ID,
        worktreeTarget: { kind: 'current', worktreeId: registration.result!.worktreeId },
        title,
        type: 'session.create',
        modelSelection: { model: 'mock-model', providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID },
        interactionMode: DEFAULT_INTERACTION_MODE,
        runtimeMode: DEFAULT_RUNTIME_MODE,
      })
    }
    expect(activeServerOrigin()).toBe(originB)
    expect((await transportA.sessionDetailSnapshot(SESSION_ID)).session.title).toBe('A')
    expect((await transportB.sessionDetailSnapshot(SESSION_ID)).session.title).toBe('B')
    const deferred = deferredSnapshotClient(serverA)
    setActiveServerOrigin(originA)
    setClient(deferred.client)
    const closingTransport = createChatTransport(originA)
    const snapshot = closingTransport.sessionDetailSnapshot(SESSION_ID)
    await deferred.started
    closingTransport.close()
    deferred.release()
    await expect(snapshot).rejects.toMatchObject({ code: 'ORCHESTRATION_RPC_CLOSED' })
    const refusedSnapshot = deferredSnapshotClient(serverA)
    setClient(refusedSnapshot.client)
    const refusedTransport = createChatTransport(originA)
    const pendingSnapshot = refusedTransport.sessionDetailSnapshot(SESSION_ID)
    await refusedSnapshot.started
    const descriptorB = v.parse(
      healthDescriptorSchema,
      (await createInProcessClient(serverB).health.get()).data,
    )
    expect(() => useEnvironmentsStore.getState().recordDescriptor(originA, descriptorB)).toThrow()
    refusedSnapshot.release()
    await expect(pendingSnapshot).rejects.toMatchObject({ code: 'ENVIRONMENT_IDENTITY_DRIFT' })
    refusedTransport.close()
    useEnvironmentsStore
      .getState()
      .recordDescriptor(
        originA,
        v.parse(healthDescriptorSchema, (await createInProcessClient(serverA).health.get()).data),
      )
    setActiveServerOrigin(originB)
    const iterator = transportA.shellStream()[Symbol.asyncIterator]()
    expect((await iterator.next()).done).toBe(false)
    transportA.close()
    await expect(iterator.next()).rejects.toMatchObject({ code: 'ORCHESTRATION_RPC_CLOSED' })
    await expect(transportA.sessionDetailSnapshot(SESSION_ID)).rejects.toMatchObject({
      code: 'ORCHESTRATION_RPC_CLOSED',
    })
    expect(() => transportA.retainSessionDetail(SESSION_ID)).toThrow(
      'The chat connection is closed.',
    )
  } finally {
    transportA.close()
    transportB.close()
    setActiveServerOrigin(previousOrigin)
    setClient(previousClient)
    await Promise.all([serverA.cleanup(), serverB.cleanup()])
  }
})
