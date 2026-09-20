import { waitFor } from '@testing-library/react'
import { scopedSessionKey } from '@workspace/contracts'
import {
  createSessionArchiveCommand,
  createSessionLifecycleCommand,
} from '@workspace/client-core/chat/commands'
import { sessionRailModel } from '@workspace/client-core/chat/rail/model'
import { currentRailEnvironments } from '@/features/chat-mode/state/rail-environments'
import { reorderRailSession } from '@/features/chat-mode/state/rail-order-commands'
import { railOrderOverrides } from '@/features/chat-mode/state/rail-order-intents'
import {
  createFederationHarness,
  registerFederatedProject,
} from '../../../../../test/factories/federation'
import { expect, test } from '../../../../../test/fixtures'

test('a later owner rejection preserves the first canonical key and withdraws every unconfirmed preview', async ({
  server,
}) => {
  const h = await createFederationHarness(server)
  const local = await registerFederatedProject(h.serverA, h.clientA, 'local-drop')
  const remote = await registerFederatedProject(h.serverB, h.clientB, 'remote-drop')
  await h.clientA.orchestration.commands.post(
    createSessionLifecycleCommand(local.sessionId, { type: 'pin' }),
  )
  await h.clientB.orchestration.commands.post(
    createSessionLifecycleCommand(remote.sessionId, { type: 'pin' }),
  )
  await waitFor(() =>
    expect(
      sessionRailModel({ environments: currentRailEnvironments() }).sessions.filter(
        (row) => row.placement === 'pinned',
      ),
    ).toHaveLength(2),
  )
  const localKey = scopedSessionKey({
    environmentId: h.descriptorA.environmentId,
    sessionId: local.sessionId,
  })
  const remoteKey = scopedSessionKey({
    environmentId: h.descriptorB.environmentId,
    sessionId: remote.sessionId,
  })
  const model = sessionRailModel({ environments: currentRailEnvironments() })
  // Moving the local row to the first position writes it before its remote neighbor.
  expect(model.sessions[1]?.key).toBe(localKey)
  const socket = h.sockets.get(h.originB)!.at(-1)!
  const deliver = socket.deliver.bind(socket)
  socket.deliver = (message) => {
    if (
      typeof message === 'object' &&
      message &&
      'kind' in message &&
      message.kind === 'subscription.next'
    )
      return
    deliver(message)
  }
  await h.clientB.orchestration.commands.post(
    createSessionArchiveCommand({ sessionId: remote.sessionId }),
  )
  try {
    const outcome = await reorderRailSession({ activeId: localKey, overId: remoteKey })
    expect(outcome?.ok).toBe(false)
    expect(
      (await h.clientA.orchestration['shell-snapshot'].get()).data!.sessions[0]!.pinOrderKey,
    ).not.toBeNull()
    expect(
      (await h.clientB.orchestration['shell-snapshot'].get()).data!.sessions[0]!.pinOrderKey,
    ).toBeNull()
    expect(railOrderOverrides().sessionLifecycleByKey).toEqual({})
  } finally {
    socket.deliver = deliver
  }
})
