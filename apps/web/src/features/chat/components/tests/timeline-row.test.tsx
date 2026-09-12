import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  eventIdSchema,
  messageIdSchema,
  sessionIdSchema,
  turnIdSchema,
  type OrchestrationMessage,
} from '@workspace/contracts'
import * as v from 'valibot'

import { TimelineRow } from '@/features/chat/components/timeline-row'
import { chatTimelineItems, type ChatTimelineItem } from '@/features/chat/utils/timeline-items'
import { useChatWorkLogExpansionStore } from '@/features/chat/state/chat-work-log-expansion-store'
import { expect, test } from '../../../../../test/fixtures'
import { chatMessage, sessionActivity } from '../../../../../test/factories/chat'
import { renderWithProviders } from '../../../../../test/render'

const sessionId = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')
const turnId = v.parse(turnIdSchema, 'turn-1')

test('a settled turn hides its work until the fold is opened', async () => {
  resetExpansion()
  renderWithProviders(<TimelineRow item={settledTurnFold()} />)

  expect(screen.queryByText('Read file')).not.toBeInTheDocument()

  await userEvent.click(foldToggle())
  expect(screen.queryByText('Read file')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Ran 2 commands' }))

  expect(screen.getByText('Read file')).toBeInTheDocument()
  expect(screen.getByText('Run tests')).toBeInTheDocument()
})

test('the fold closes again on a second click', async () => {
  resetExpansion()
  renderWithProviders(<TimelineRow item={settledTurnFold()} />)

  await userEvent.click(foldToggle())
  await userEvent.click(foldToggle())

  expect(screen.queryByText('Read file')).not.toBeInTheDocument()
})

test('an opened fold survives its row unmounting', async () => {
  resetExpansion()
  const item = settledTurnFold()
  const { unmount } = renderWithProviders(<TimelineRow item={item} />)

  await userEvent.click(foldToggle())
  await userEvent.click(screen.getByRole('button', { name: 'Ran 2 commands' }))
  expect(screen.getByText('Read file')).toBeInTheDocument()

  unmount()
  renderWithProviders(<TimelineRow item={item} />)

  expect(screen.getByText('Read file')).toBeInTheDocument()
})

function foldToggle() {
  return screen.getByRole('button', { name: /Worked for/ })
}

function resetExpansion() {
  useChatWorkLogExpansionStore.setState({ expandedGroupIds: {}, expandedRowIds: {} })
}

/** Built from the real derivation, so the row under test is the row the timeline renders. */
function settledTurnFold(): ChatTimelineItem {
  const items = chatTimelineItems({
    activities: [
      toolActivity('event-1', timestamp(3), 'Read file completed'),
      toolActivity('event-2', timestamp(4), 'Run tests completed'),
    ],
    latestTurn: {
      providerStartState: 'adopted' as const,
      providerStartGeneration: 1,
      providerStartSequence: 1,
      runtimeEpoch: 'test-epoch',
      assistantMessageId: v.parse(messageIdSchema, 'message-2'),
      completedAt: timestamp(5),
      requestedAt: timestamp(1),
      startedAt: timestamp(2),
      state: 'completed',
      turnId,
    },
    messages: [
      chatMessage({
        createdAt: timestamp(1),
        id: v.parse(messageIdSchema, 'message-1'),
        role: 'user',
        text: 'Go',
      }),
      assistantMessage(),
    ],
    optimisticMessages: [],
    proposedPlans: [],
  })
  const fold = items.find((item) => item.type === 'turn-fold')

  expect(fold).toBeDefined()

  return fold!
}

function assistantMessage(): OrchestrationMessage {
  return chatMessage({
    createdAt: timestamp(5),
    id: v.parse(messageIdSchema, 'message-2'),
    role: 'assistant',
    text: 'Done',
    turnId,
    updatedAt: timestamp(5),
  })
}

function toolActivity(id: string, createdAt: string, summary: string) {
  return sessionActivity({
    createdAt,
    id: v.parse(eventIdSchema, id),
    kind: 'tool.completed',
    payload: { itemType: 'command_execution', status: 'completed' },
    summary,
    sessionId,
    tone: 'tool',
    turnId,
  })
}

function timestamp(index: number) {
  return `2026-05-28T00:00:0${index}.000Z`
}
