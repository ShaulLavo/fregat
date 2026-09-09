import { healthDescriptorSchema } from '@workspace/contracts'
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
