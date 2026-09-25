import { eventIdSchema, messageIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { deriveChatLiveActivity } from '@/features/chat/utils/live-activity'
import { chatTimelineItemEstimate, chatTimelineItems } from '@/features/chat/utils/timeline-items'
import { chatWorkLogEntries } from '@/features/chat/utils/work-log'
import { chatMessage, session, sessionActivity } from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'

const latestTurn = session().latestTurn!

test('mixed reasoning and running commands produce a concise current action', () => {
  const entries = chatWorkLogEntries({
    activities: [
      sessionActivity({
        kind: 'task.progress',
        tone: 'thinking',
        summary: 'Reasoning update',
        payload: { detail: 'Check the editor theme' },
      }),
      sessionActivity({
        id: v.parse(eventIdSchema, 'tool-start'),
        kind: 'tool.started',
        tone: 'tool',
        summary: 'commandExecution started',
        payload: {
          toolCallId: 'tool-1',
          itemType: 'command_execution',
          status: 'inProgress',
          data: { command: '/usr/bin/bash -lc "rg gutter apps/web"' },
        },
      }),
    ],
  })
  const live = deriveChatLiveActivity({ entries, trailingEntries: entries, latestTurn })
  expect(live?.label).toBe('Running rg')
  expect(live?.entry?.lifecycle).toBe('running')
  expect(live?.activities).toHaveLength(2)
})

test('a completed tool stays inspectable without claiming its process is still running', () => {
  const entries = chatWorkLogEntries({
    activities: [
      sessionActivity({
        kind: 'tool.completed',
        tone: 'tool',
        summary: 'commandExecution completed',
        payload: {
          toolCallId: 'tool-1',
          itemType: 'command_execution',
          status: 'completed',
          data: { command: 'rg gutter apps/web' },
        },
      }),
    ],
  })
  const live = deriveChatLiveActivity({ entries, trailingEntries: entries, latestTurn })
  expect(live?.label).toBe('Ran rg')
  expect(live?.active).toBe(true)
  expect(
    deriveChatLiveActivity({
      entries,
      trailingEntries: entries,
      latestTurn: { ...latestTurn, state: 'completed', completedAt: '2026-05-28T00:00:05.000Z' },
    }),
  ).toBeNull()
})

test('failure remains visible while the live row returns to thinking', () => {
  const entries = chatWorkLogEntries({
    activities: [
      sessionActivity({
        kind: 'tool.completed',
        tone: 'tool',
        summary: 'commandExecution completed',
        payload: {
          itemType: 'command_execution',
          status: 'failed',
          data: { command: 'rg gutter missing', exitCode: 2 },
        },
      }),
    ],
  })
  expect(deriveChatLiveActivity({ entries, trailingEntries: [], latestTurn })).toMatchObject({
    label: 'Thinking',
    active: true,
  })
})

test('live row identity survives tools and reasoning and the timer starts after the prompt', () => {
  const base = {
    latestTurn,
    messages: [chatMessage({ role: 'user', createdAt: latestTurn.requestedAt })],
    optimisticMessages: [],
    proposedPlans: [],
  }
  const first = chatTimelineItems({ ...base, activities: [] })
  const second = chatTimelineItems({
    ...base,
    activities: [
      sessionActivity({
        kind: 'tool.started',
        tone: 'tool',
        payload: {
          toolCallId: 'call-1',
          itemType: 'command_execution',
          status: 'inProgress',
          data: { command: 'rg gutter' },
        },
      }),
    ],
  })
  expect(first.map((item) => item.type)).toEqual(['message', 'working', 'live-activity'])
  expect(second.at(-1)?.id).toBe(first.at(-1)?.id)
  expect(second.at(-1)).toMatchObject({ type: 'live-activity', activity: { label: 'Running rg' } })
})

test('commentary closes the previous work drawer before the next action starts', () => {
  const completed = sessionActivity({
    id: v.parse(eventIdSchema, 'completed-before-commentary'),
    createdAt: '2026-05-28T00:00:02.000Z',
    kind: 'tool.completed',
    tone: 'tool',
    payload: {
      toolCallId: 'read-1',
      itemType: 'command_execution',
      status: 'completed',
      data: { command: 'rg gutter' },
    },
  })
  const base = {
    latestTurn,
    messages: [
      chatMessage({ id: v.parse(messageIdSchema, 'prompt'), role: 'user' }),
      chatMessage({
        id: v.parse(messageIdSchema, 'commentary'),
        turnId: latestTurn.turnId,
        createdAt: '2026-05-28T00:00:03.000Z',
        text: 'I found the gutter styles.',
      }),
    ],
    optimisticMessages: [],
    proposedPlans: [],
  }
  const afterCommentary = chatTimelineItems({ ...base, activities: [completed] })
  expect(afterCommentary.at(-1)).toMatchObject({
    type: 'live-activity',
    activity: { label: 'Thinking', activities: [] },
  })
  expect(afterCommentary.find((item) => item.type === 'activity-group')).toMatchObject({
    activities: [{ id: completed.id }],
  })

  const running = sessionActivity({
    id: v.parse(eventIdSchema, 'running-after-commentary'),
    createdAt: '2026-05-28T00:00:04.000Z',
    kind: 'tool.started',
    tone: 'tool',
    payload: {
      toolCallId: 'check-1',
      itemType: 'command_execution',
      status: 'inProgress',
      data: { command: 'bun test' },
    },
  })
  const afterNextAction = chatTimelineItems({ ...base, activities: [completed, running] })
  expect(afterNextAction.at(-1)).toMatchObject({
    id: afterCommentary.at(-1)?.id,
    type: 'live-activity',
    activity: { label: 'Running bun', activities: [{ id: running.id }] },
  })
  expect(afterNextAction.find((item) => item.type === 'activity-group')).toMatchObject({
    activities: [{ id: completed.id }],
  })
})

test.each([
  {
    kind: 'tool.started',
    label: 'Running rg',
    active: true,
    payload: {
      toolCallId: 'running-before-commentary',
      itemType: 'command_execution',
      status: 'inProgress',
      data: { command: 'rg gutter' },
    },
  },
  {
    kind: 'approval.requested',
    label: 'Waiting for approval',
    active: false,
    payload: { requestId: 'approval-before-commentary' },
  },
])(
  'commentary preserves $kind status without duplicating its history',
  ({ kind, label, active, payload }) => {
    const items = chatTimelineItems({
      latestTurn,
      messages: [
        chatMessage({
          turnId: latestTurn.turnId,
          createdAt: '2026-05-28T00:00:04.000Z',
          text: 'The operation is still pending.',
        }),
      ],
      optimisticMessages: [],
      proposedPlans: [],
      activities: [sessionActivity({ kind, payload })],
    })

    expect(items.at(-1)).toMatchObject({
      type: 'live-activity',
      activity: { label, active, activities: [] },
    })
    expect(items.find((item) => item.type === 'activity-group')).toMatchObject({
      activities: [expect.objectContaining({ sourceKind: kind })],
    })
  },
)

test('an error separates historical work from the following live drawer', () => {
  const activities = [
    sessionActivity({
      id: v.parse(eventIdSchema, 'completed-before-error'),
      createdAt: '2026-05-28T00:00:02.000Z',
      kind: 'tool.completed',
      tone: 'tool',
      payload: { itemType: 'command_execution', data: { command: 'rg gutter' } },
    }),
    sessionActivity({
      id: v.parse(eventIdSchema, 'error-boundary'),
      createdAt: '2026-05-28T00:00:03.000Z',
      kind: 'runtime.error',
      tone: 'error',
      summary: 'Provider retry failed',
    }),
    sessionActivity({
      id: v.parse(eventIdSchema, 'thinking-after-error'),
      createdAt: '2026-05-28T00:00:04.000Z',
      kind: 'task.progress',
      tone: 'thinking',
      payload: { summary: 'Checking another approach' },
    }),
  ]
  const items = chatTimelineItems({
    latestTurn,
    messages: [],
    optimisticMessages: [],
    proposedPlans: [],
    activities,
  })

  expect(items.find((item) => item.type === 'activity-group')).toMatchObject({
    activities: [{ id: activities[0]?.id }, { id: activities[1]?.id }],
  })
  expect(items.at(-1)).toMatchObject({
    type: 'live-activity',
    activity: { activities: [{ id: activities[2]?.id }] },
  })
})

test('a response stopped before any text has an explicit final state', () => {
  const items = chatTimelineItems({
    latestTurn: { ...latestTurn, state: 'interrupted', completedAt: '2026-05-28T00:00:05.000Z' },
    messages: [],
    optimisticMessages: [],
    proposedPlans: [],
    activities: [],
  })
  expect(items).toEqual([
    expect.objectContaining({
      type: 'turn-status',
      label: expect.stringMatching(/^Stopped after/),
    }),
    expect.objectContaining({ type: 'turn-retry', turnId: latestTurn.turnId }),
  ])
})

test('failed tool calls after the answer remain visible outside completed work folds', () => {
  const completedAt = '2026-05-28T00:00:06.000Z'
  const items = chatTimelineItems({
    latestTurn: { ...latestTurn, state: 'completed', completedAt },
    optimisticMessages: [],
    proposedPlans: [],
    messages: [
      chatMessage({
        turnId: latestTurn.turnId,
        createdAt: '2026-05-28T00:00:04.000Z',
        updatedAt: '2026-05-28T00:00:04.000Z',
        text: 'The edit is ready.',
      }),
    ],
    activities: [
      sessionActivity({
        createdAt: '2026-05-28T00:00:05.000Z',
        kind: 'tool.completed',
        tone: 'tool',
        payload: {
          itemType: 'command_execution',
          status: 'failed',
          data: { command: 'bun test', exitCode: 1 },
        },
      }),
    ],
  })
  expect(
    items.some(
      (item) =>
        item.type === 'activity-group' &&
        item.activities.some((entry) => entry.outcome === 'failed'),
    ),
  ).toBe(true)
})

test('runtime errors stay visible outside the live drawer and completed folds', () => {
  const error = sessionActivity({
    kind: 'runtime.error',
    tone: 'error',
    summary: 'Provider crashed',
    payload: { message: 'Provider crashed' },
  })
  for (const turn of [
    latestTurn,
    { ...latestTurn, state: 'error' as const, completedAt: '2026-05-28T00:00:05.000Z' },
  ]) {
    const items = chatTimelineItems({
      latestTurn: turn,
      activities: [error],
      messages: [],
      optimisticMessages: [],
      proposedPlans: [],
    })
    expect(
      items.some(
        (item) =>
          item.type === 'activity-group' &&
          item.activities.some((entry) => entry.title === 'Provider crashed'),
      ),
    ).toBe(true)
  }
})

test('resolving one approval does not hide another outstanding request', () => {
  const entries = chatWorkLogEntries({
    activities: [
      sessionActivity({
        id: v.parse(eventIdSchema, 'request-a'),
        kind: 'approval.requested',
        payload: { requestId: 'a' },
      }),
      sessionActivity({
        id: v.parse(eventIdSchema, 'request-b'),
        kind: 'approval.requested',
        payload: { requestId: 'b' },
      }),
      sessionActivity({
        id: v.parse(eventIdSchema, 'resolved-b'),
        kind: 'approval.resolved',
        payload: { requestId: 'b' },
      }),
    ],
  })
  expect(deriveChatLiveActivity({ entries, trailingEntries: entries, latestTurn })).toMatchObject({
    label: 'Waiting for approval',
    active: false,
    entry: { requestId: 'a' },
  })
})

test('the tail holds the newest three calls of the response and leaves reasoning out', () => {
  const call = (index: number) =>
    sessionActivity({
      id: v.parse(eventIdSchema, `call-${index}`),
      createdAt: `2026-05-28T00:00:0${index}.000Z`,
      kind: 'tool.completed',
      tone: 'tool',
      payload: {
        toolCallId: `call-${index}`,
        itemType: 'command_execution',
        status: 'completed',
        data: { command: `echo ${index}` },
      },
    })
  const reasoning = sessionActivity({
    id: v.parse(eventIdSchema, 'reasoning'),
    createdAt: '2026-05-28T00:00:06.000Z',
    kind: 'task.progress',
    tone: 'thinking',
    payload: { streamKind: 'reasoning_text', summary: 'Checking', taskId: 'r' },
  })
  const entries = chatWorkLogEntries({ activities: [1, 2, 3, 4].map(call).concat(reasoning) })
  const live = deriveChatLiveActivity({ entries, trailingEntries: [], latestTurn })

  expect(live?.tail.map((entry) => entry.id)).toEqual(['call-2', 'call-3', 'call-4'])
})

test('a live row reserves its tail in the estimate from the first call', () => {
  const items = chatTimelineItems({
    activities: [
      sessionActivity({
        kind: 'tool.started',
        tone: 'tool',
        payload: { toolCallId: 'one', itemType: 'command_execution', status: 'inProgress' },
      }),
    ],
    latestTurn,
    messages: [chatMessage({ id: v.parse(messageIdSchema, 'prompt'), role: 'user' })],
    optimisticMessages: [],
    proposedPlans: [],
  })
  const live = items.at(-1)

  expect(live?.type).toBe('live-activity')
  expect(chatTimelineItemEstimate(live)).toBe(96)
})
