import { orchestrationLatestTurnSchema, turnIdSchema, messageIdSchema } from '@workspace/contracts'
import * as v from 'valibot'

import { expect, test } from '../../../../../test/fixtures'
import { chatMessage, sessionShell } from '../../../../../test/factories/chat'
import { chatActiveResponseTurnIds } from '@/features/chat/utils/active-response'
import {
  chatMessageTimelineMetadata,
  resolveAssistantMessageChromeState,
} from '@/features/chat/utils/message-metadata'

test('withholds earlier provider turn metadata while the same response continues', () => {
  const latestTurn = v.parse(orchestrationLatestTurnSchema, sessionShell().latestTurn)
  const prior = chatMessage({
    id: v.parse(messageIdSchema, 'earlier-commentary'),
    turnId: v.parse(turnIdSchema, 'provider-before-restart'),
    createdAt: '2026-05-28T00:00:01.000Z',
    streaming: false,
  })
  const messages = [chatMessage({ role: 'user' }), prior]
  const activeResponseTurnIds = chatActiveResponseTurnIds({ messages, entries: [], latestTurn })
  const metadata = chatMessageTimelineMetadata({ messages, latestTurn, activeResponseTurnIds }).get(
    prior.id,
  )

  expect(metadata).toMatchObject({ assistantTurnInProgress: true, assistantStreaming: false })
  expect(
    resolveAssistantMessageChromeState({
      showCopyButton: metadata?.showAssistantCopyButton ?? false,
      streaming: metadata?.assistantTurnInProgress ?? false,
      text: prior.text,
    }),
  ).toMatchObject({ copyVisible: false, metaVisible: false })
})

test('restores earlier response metadata after a user starts another response', () => {
  const latestTurn = v.parse(orchestrationLatestTurnSchema, sessionShell().latestTurn)
  const prior = chatMessage({
    id: v.parse(messageIdSchema, 'prior-answer'),
    turnId: v.parse(turnIdSchema, 'prior-turn'),
  })
  const messages = [prior, chatMessage({ role: 'user', createdAt: '2026-05-28T00:00:01.000Z' })]
  const metadata = chatMessageTimelineMetadata({ messages, latestTurn }).get(prior.id)

  expect(metadata).toMatchObject({ assistantTurnInProgress: false, showAssistantCopyButton: true })
  expect(
    resolveAssistantMessageChromeState({
      showCopyButton: metadata?.showAssistantCopyButton ?? false,
      streaming: metadata?.assistantTurnInProgress ?? true,
      text: prior.text,
    }),
  ).toMatchObject({ copyVisible: true, metaVisible: true })
})

test('Carry on preserves the previous answer incomplete marker after a new turn starts', () => {
  const latestTurn = v.parse(orchestrationLatestTurnSchema, sessionShell().latestTurn)
  const previous = {
    ...latestTurn,
    turnId: v.parse(turnIdSchema, 'stopped-turn'),
    state: 'interrupted' as const,
    endReason: 'user-stop' as const,
    completedAt: '2026-05-28T00:00:01.000Z',
  }
  const answer = chatMessage({ turnId: previous.turnId, streaming: false })
  const input = { messages: [answer], latestTurn, turns: { [previous.turnId]: previous } }
  expect(chatMessageTimelineMetadata(input).get(answer.id)?.incomplete).toBe(true)
})
