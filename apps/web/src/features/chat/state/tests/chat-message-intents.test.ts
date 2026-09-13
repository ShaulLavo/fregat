import { TEST_ENVIRONMENT_ID as FIXTURE_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import {
  commandIdSchema,
  messageIdSchema,
  sessionIdSchema,
  type OrchestrationMessage,
} from '@workspace/contracts'
import * as v from 'valibot'

import {
  chatMessageIntents,
  createOptimisticMessagesForSessionSelector,
  resetChatMessageIntents,
} from '../chat-message-intents'
import { expect, test } from '../../../../../test/fixtures'

const SESSION_ID = v.parse(sessionIdSchema, '699e96c9-490f-5be0-af68-9fbe44bfdb2c')
const COMMAND_ID = v.parse(commandIdSchema, 'command-echoed')

test('the session selector keeps its identity while the queue is unchanged and hides acknowledged intents', () => {
  resetChatMessageIntents()
  const select = createOptimisticMessagesForSessionSelector({
    environmentId: FIXTURE_ENVIRONMENT_ID,
    sessionId: SESSION_ID,
  })
  const empty = select(chatMessageIntents.getState())
  expect(empty).toEqual([])
  expect(select(chatMessageIntents.getState())).toBe(empty)

  const { intent } = chatMessageIntents.submit({
    environmentId: FIXTURE_ENVIRONMENT_ID,
    commandId: COMMAND_ID,
    message: optimisticMessage(),
  })
  const pending = select(chatMessageIntents.getState())
  expect(pending).toMatchObject([{ id: 'message-echoed', optimistic: true, commandId: COMMAND_ID }])
  expect(select(chatMessageIntents.getState())).toBe(pending)

  chatMessageIntents.settleTransport(intent.intentId)
  chatMessageIntents.acknowledge(intent.intentId)
  expect(select(chatMessageIntents.getState())).toBe(empty)
  resetChatMessageIntents()
})

test('a failed send leaves no pending message on the timeline', () => {
  resetChatMessageIntents()
  const select = createOptimisticMessagesForSessionSelector({
    environmentId: FIXTURE_ENVIRONMENT_ID,
    sessionId: SESSION_ID,
  })
  const { intent } = chatMessageIntents.submit({
    environmentId: FIXTURE_ENVIRONMENT_ID,
    commandId: COMMAND_ID,
    message: optimisticMessage(),
  })
  chatMessageIntents.fail(intent.intentId, new Error('offline'))
  expect(select(chatMessageIntents.getState())).toHaveLength(0)
  expect(chatMessageIntents.getState().failed).toHaveLength(1)
  resetChatMessageIntents()
})

function optimisticMessage() {
  return {
    attachments: [],
    createdAt: '2026-05-24T12:00:00.000Z',
    id: v.parse(messageIdSchema, 'message-echoed'),
    role: 'user',
    streaming: false,
    text: 'hello',
    sessionId: SESSION_ID,
    turnId: null,
    updatedAt: '2026-05-24T12:00:00.000Z',
  } satisfies OrchestrationMessage
}
