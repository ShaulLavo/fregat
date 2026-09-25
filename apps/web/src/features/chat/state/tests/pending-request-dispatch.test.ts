import { MutationObserver } from '@tanstack/react-query'
import {
  approvalRequestIdSchema,
  orchestrationSessionDetailSnapshotSchema,
} from '@workspace/contracts'
import { createApprovalRespondCommand } from '@workspace/client-core/chat/commands'
import * as v from 'valibot'
import { test, expect } from '../../../../../test/fixtures'
import { createTestQueryClient } from '../../../../../test/render'
import { sessionShell, TEST_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import { unsupportedChatTransport } from '../../../../../test/factories/chat-transport'
import { pendingRequestMutationOptions } from '../pending-request-dispatch'
import { useChatProjectionStore } from '../chat-projection-store'

const session = sessionShell()
const requestId = v.parse(approvalRequestIdSchema, 'req-sync')
const input = {
  command: createApprovalRespondCommand({ requestId, sessionId: session.id, decision: 'accept' }),
  context: {},
  requestId,
}
const snapshot = v.parse(orchestrationSessionDetailSnapshotSchema, {
  session: { ...session, messages: [], activities: [], deletedAt: null, deletion: null },
  snapshotSequence: 2,
  proposedPlans: [],
  checkpoints: [],
})

test('response mutation stays pending until the delayed projection snapshot has settled', async () => {
  const detail = Promise.withResolvers<typeof snapshot>()
  const replayStarted = Promise.withResolvers<void>()
  const transport = unsupportedChatTransport({
    dispatchCommand: async () => ({ deduped: false, sequence: 2, result: null }),
    replayEvents: async () => {
      replayStarted.resolve()
      return { events: [] }
    },
    sessionDetailSnapshot: () => detail.promise,
  })
  const client = createTestQueryClient()
  const observer = new MutationObserver(
    client,
    pendingRequestMutationOptions(transport, session.id),
  )
  const unsubscribe = observer.subscribe(() => {})
  let finished = false
  const result = observer.mutate(input).then(() => {
    finished = true
  })
  await replayStarted.promise
  await new Promise((resolve) => setTimeout(resolve, 0))
  try {
    expect(finished).toBe(false)
    expect(observer.getCurrentResult().status).toBe('pending')
  } finally {
    detail.resolve(snapshot)
    await result
    unsubscribe()
  }
  expect(
    useChatProjectionStore.getState().slices[TEST_ENVIRONMENT_ID]?.sessionDetailSequenceById[
      session.id
    ],
  ).toBe(2)
  client.clear()
})

test('a response reports synchronization failure if neither transport read succeeds', async () => {
  const transport = unsupportedChatTransport({
    dispatchCommand: async () => ({ deduped: false, sequence: 2, result: null }),
  })
  const client = createTestQueryClient()
  const observer = new MutationObserver(
    client,
    pendingRequestMutationOptions(transport, session.id),
  )
  await expect(observer.mutate(input)).rejects.toMatchObject({
    code: 'chat.PROJECTION_SYNC_FAILED',
  })
  expect(observer.getCurrentResult().status).toBe('error')
  client.clear()
})
