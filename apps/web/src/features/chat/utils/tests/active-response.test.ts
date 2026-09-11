import { orchestrationLatestTurnSchema, turnIdSchema } from '@workspace/contracts'
import * as v from 'valibot'

import { expect, test } from '../../../../../test/fixtures'
import { chatMessage, sessionShell } from '../../../../../test/factories/chat'
import { workLogEntry } from '../../../../../test/factories/work-log'
import { chatActiveResponseTurnIds } from '@/features/chat/utils/active-response'

test('keeps provider turns beneath one prompt active across a restart, including tool-only turns', () => {
  const latestTurn = v.parse(orchestrationLatestTurnSchema, sessionShell().latestTurn)
  const priorTurn = v.parse(turnIdSchema, 'provider-before-restart')
  const toolTurn = v.parse(turnIdSchema, 'provider-tool-only')
  const messages = [
    chatMessage({ role: 'user', createdAt: '2026-05-28T00:00:00.000Z' }),
    chatMessage({ turnId: priorTurn, createdAt: '2026-05-28T00:00:01.000Z' }),
    chatMessage({ turnId: latestTurn.turnId, createdAt: '2026-05-28T00:00:03.000Z' }),
  ]
  const entries = [workLogEntry({ turnId: toolTurn, createdAt: '2026-05-28T00:00:02.000Z' })]

  expect([...chatActiveResponseTurnIds({ messages, entries, latestTurn })]).toEqual([
    latestTurn.turnId,
    priorTurn,
    toolTurn,
  ])
})

test('a new prompt excludes older messages even when it shares their timestamp', () => {
  const latestTurn = v.parse(orchestrationLatestTurnSchema, sessionShell().latestTurn)
  const priorTurn = v.parse(turnIdSchema, 'older-response')
  const messages = [
    chatMessage({ turnId: priorTurn }),
    chatMessage({ role: 'user' }),
    chatMessage({ turnId: latestTurn.turnId, createdAt: '2026-05-28T00:00:01.000Z' }),
  ]

  expect([...chatActiveResponseTurnIds({ messages, entries: [], latestTurn })]).toEqual([
    latestTurn.turnId,
  ])
})

test('does not pull undelimited loaded history into the current response', () => {
  const latestTurn = v.parse(orchestrationLatestTurnSchema, sessionShell().latestTurn)
  const messages = [chatMessage({ turnId: v.parse(turnIdSchema, 'older-response') })]

  expect([...chatActiveResponseTurnIds({ messages, entries: [], latestTurn })]).toEqual([
    latestTurn.turnId,
  ])
})

test('does not resurrect an old activity-only turn at the new prompt timestamp', () => {
  const latestTurn = v.parse(orchestrationLatestTurnSchema, sessionShell().latestTurn)
  const priorTurn = v.parse(turnIdSchema, 'older-activity-only-turn')
  const prompt = chatMessage({ role: 'user' })
  const messages = [prompt]
  const entries = [
    workLogEntry({ turnId: priorTurn, createdAt: prompt.createdAt }),
    workLogEntry({ turnId: latestTurn.turnId, createdAt: prompt.createdAt }),
  ]

  expect([...chatActiveResponseTurnIds({ messages, entries, latestTurn })]).toEqual([
    latestTurn.turnId,
  ])
})

test.each(['completed', 'error', 'interrupted'] as const)(
  'settling a response as %s clears its active turns',
  (state) => {
    const latestTurn = v.parse(orchestrationLatestTurnSchema, sessionShell().latestTurn)
    const messages = [chatMessage({ role: 'user' }), chatMessage({ turnId: latestTurn.turnId })]

    expect(
      chatActiveResponseTurnIds({
        messages,
        entries: [],
        latestTurn: {
          ...latestTurn,
          state,
          completedAt: '2026-05-28T00:00:04.000Z',
        },
      }).size,
    ).toBe(0)
  },
)
