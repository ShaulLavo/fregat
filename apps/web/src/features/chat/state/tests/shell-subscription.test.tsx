import { healthDescriptorSchema, orchestrationWsServerMessageSchema } from '@workspace/contracts'
import { inProcessOrchestrationSocketFactory } from '@workspace/client-core/test/in-process-orchestration-socket'
import * as v from 'valibot'

import { expect, test } from '../../../../../test/fixtures'
import { activeServerOrigin } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { createChatTransport } from '@/features/chat/transport/create-chat-transport'
import { createWorkspaceProjectCommand } from '@workspace/client-core/chat/commands'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import {
  subscribeChatShell,
  type ChatShellSubscriptionState,
} from '@/features/chat/state/shell-subscription'

test('marks a caught-up real shell stream live without changing its projection', async ({
  server,
  client,
}) => {
  const origin = activeServerOrigin()
  useEnvironmentsStore
    .getState()
    .recordDescriptor(origin, v.parse(healthDescriptorSchema, (await client.health.get()).data))
  const transport = createChatTransport(origin, {
    createSocket: inProcessOrchestrationSocketFactory({
      app: server.app,
      clientOrigin: server.origin,
    }),
  })
  const states: ChatShellSubscriptionState[] = []
  let stop = () => {}

  try {
    await transport.dispatchCommand(createWorkspaceProjectCommand({ rootPath: server.root }))
    for await (const item of transport.shellStream()) {
      useChatProjectionStore.getState().applyShellStreamItem(transport.environmentId, item)
      break
    }
    const before = useChatProjectionStore.getState()

    stop = subscribeChatShell(transport, (state) => states.push(state))

    await expect.poll(() => states.at(-1)?.phase).toBe('live')
    expect(useChatProjectionStore.getState()).toBe(before)
  } finally {
    stop()
    transport.close()
    useChatProjectionStore.getState().resetChatProjection()
  }
})

for (const mode of ['snapshot', 'replay'] as const)
  test(`holds ${mode} history offline until the real synchronized frame`, async ({
    server,
    client,
  }) => {
    const origin = activeServerOrigin()
    useEnvironmentsStore
      .getState()
      .recordDescriptor(origin, v.parse(healthDescriptorSchema, (await client.health.get()).data))
    const createSocket = inProcessOrchestrationSocketFactory({
      app: server.app,
      clientOrigin: server.origin,
    })
    const held: (() => void)[] = []
    let hold = false
    const transport = createChatTransport(origin, {
      createSocket: (url) => {
        const socket = createSocket(url)
        const deliver = socket.deliver.bind(socket)
        socket.deliver = (message) => {
          const frame = v.parse(orchestrationWsServerMessageSchema, message)
          if (hold && frame.kind === 'subscription.next' && frame.item.kind === 'synchronized') {
            held.push(() => deliver(message))
            return
          }
          deliver(message)
        }
        return socket
      },
    })
    const states: ChatShellSubscriptionState[] = []
    let stop = () => {}
    try {
      if (mode === 'replay') {
        for await (const item of transport.shellStream()) {
          useChatProjectionStore.getState().applyShellStreamItem(transport.environmentId, item)
          break
        }
      }
      await transport.dispatchCommand(createWorkspaceProjectCommand({ rootPath: server.root }))
      hold = true
      stop = subscribeChatShell(transport, (state) => states.push(state))
      await expect.poll(() => held.length).toBeGreaterThan(0)
      await expect
        .poll(
          () =>
            useChatProjectionStore.getState().slices[transport.environmentId]?.projectIds.length,
        )
        .toBe(1)
      expect(states.some((state) => state.phase === 'live')).toBe(false)
      for (const deliver of held.splice(0)) deliver()
      await expect.poll(() => states.at(-1)?.phase).toBe('live')
    } finally {
      stop()
      transport.close()
      useChatProjectionStore.getState().resetChatProjection()
    }
  })
