import { describe } from 'vitest'
import { expect, test as it } from '../../../../../test/fixtures'
import {
  commandIdSchema,
  eventIdSchema,
  messageIdSchema,
  proposedPlanIdSchema,
  sessionIdSchema,
  turnIdSchema,
  type OrchestrationLatestTurn,
  type OrchestrationMessage,
  type OrchestrationProposedPlan,
  type OrchestrationSessionActivity,
} from '@workspace/contracts'
import * as v from 'valibot'

import type { OptimisticChatMessage } from '@/features/chat/state/chat-optimistic-store'
import type { ChatTurnDiffSummary } from '@workspace/client-core/chat/types'
import { chatTimelineItems, type ChatTimelineItem } from '@/features/chat/utils/timeline-items'

describe('chat timeline items', () => {
  it.each(['completed', 'interrupted', 'error'] as const)(
    'clears activity running identity when a turn is %s',
    (state) => {
      const sessionId = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')
      const turnId = v.parse(turnIdSchema, 'unfinished-tool-turn')
      const latestTurn = runningTurn(turnId, timestamp(1))
      const input = {
        activities: [
          activity('unfinished-tool', sessionId, timestamp(2), turnId, 'tool.started', 'tool', {
            toolCallId: 'call-1',
            status: 'inProgress',
          }),
        ],
        latestTurn,
        messages: [],
        optimisticMessages: [],
        proposedPlans: [],
      }
      const before = flattenTimelineItems(chatTimelineItems(input)).find(
        (item) => item.type === 'activity-group',
      )
      const after = flattenTimelineItems(
        chatTimelineItems({
          ...input,
          latestTurn: { ...latestTurn, state, completedAt: timestamp(3) },
        }),
      ).find((item) => item.type === 'activity-group')

      expect(before).toMatchObject({ activeTurnId: turnId })
      expect(after).toMatchObject({ activeTurnId: null })
      expect(after).not.toBe(before)
    },
  )

  it('orders messages, optimistic messages, activities, and working state by timestamp', () => {
    const sessionId = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')
    const turnId = v.parse(turnIdSchema, 'turn-1')
    const latestTurn: OrchestrationLatestTurn = {
      providerStartState: 'adopted' as const,
      providerStartGeneration: 1,
      providerStartSequence: 1,
      runtimeEpoch: 'test-epoch',
      assistantMessageId: null,
      completedAt: null,
      requestedAt: timestamp(4),
      startedAt: timestamp(4),
      state: 'running',
      turnId,
    }
    const items = chatTimelineItems({
      activities: [activity('event-1', sessionId, timestamp(3), turnId)],
      latestTurn,
      messages: [message('message-1', sessionId, timestamp(1), 'user')],
      optimisticMessages: [optimisticMessage('message-2', sessionId, timestamp(2), turnId)],
      proposedPlans: [proposedPlan('plan-1', sessionId, timestamp(5), turnId)],
    })

    expect(items.map((item) => item.id)).toEqual([
      'message:message-1',
      'message:message-2',
      'activity-group:event-1',
      'proposed-plan:plan-1',
      'working:turn-1',
    ])
  })

  it('drops optimistic messages once the server message has arrived', () => {
    const sessionId = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')
    const turnId = v.parse(turnIdSchema, 'turn-1')
    const resolved = optimisticMessage('message-1', sessionId, timestamp(1), turnId)
    const items = chatTimelineItems({
      activities: [],
      latestTurn: null,
      messages: [message('message-1', sessionId, timestamp(2), 'user')],
      optimisticMessages: [resolved],
      proposedPlans: [],
    })

    expect(items.map((item) => item.id)).toEqual(['message:message-1'])
  })

  it('uses proposed-plan ids as stable replay keys', () => {
    const sessionId = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')
    const turnId = v.parse(turnIdSchema, 'turn-1')
    const items = chatTimelineItems({
      activities: [],
      latestTurn: null,
      messages: [],
      optimisticMessages: [],
      proposedPlans: [proposedPlan('plan-1', sessionId, timestamp(1), turnId)],
    })

    expect(items.map((item) => item.id)).toEqual(['proposed-plan:plan-1'])
  })

  it('keeps T3 chronological tie order across messages, plans, and work', () => {
    const sessionId = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')
    const turnId = v.parse(turnIdSchema, 'turn-1')
    const sameTime = timestamp(1)
    const items = chatTimelineItems({
      activities: [activity('event-1', sessionId, sameTime, turnId)],
      latestTurn: null,
      messages: [message('message-1', sessionId, sameTime, 'assistant')],
      optimisticMessages: [],
      proposedPlans: [proposedPlan('plan-1', sessionId, sameTime, turnId, timestamp(2))],
    })

    expect(items.map((item) => item.id)).toEqual([
      'message:message-1',
      'proposed-plan:plan-1',
      // The settled turn's lone tool row folds where it happened.
      'turn-fold:turn-1',
    ])
    expect(items[1]?.timestamp).toBe(sameTime)
  })

  it('groups only consecutive activities after chronological ordering', () => {
    const sessionId = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')
    const turnId = v.parse(turnIdSchema, 'turn-1')
    const items = chatTimelineItems({
      activities: [
        activity('event-1', sessionId, timestamp(2), turnId),
        activity('event-2', sessionId, timestamp(4), turnId),
      ],
      // The turn is still running, so nothing folds and every group stays where it landed.
      latestTurn: runningTurn(turnId, timestamp(1)),
      messages: [message('message-1', sessionId, timestamp(1), 'user')],
      optimisticMessages: [],
      proposedPlans: [proposedPlan('plan-1', sessionId, timestamp(3), turnId)],
    })

    expect(items.map((item) => item.id)).toEqual([
      'message:message-1',
      'activity-group:event-1',
      'proposed-plan:plan-1',
      'activity-group:event-2',
      'working:turn-1',
    ])
  })

  it('keeps older turns in the work log and groups them where they happened', () => {
    const sessionId = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')
    const turnId = v.parse(turnIdSchema, 'turn-2')
    const latestTurn: OrchestrationLatestTurn = {
      providerStartState: 'adopted' as const,
      providerStartGeneration: 1,
      providerStartSequence: 1,
      runtimeEpoch: 'test-epoch',
      assistantMessageId: null,
      completedAt: null,
      requestedAt: timestamp(5),
      startedAt: timestamp(5),
      state: 'running',
      turnId,
    }
    const items = chatTimelineItems({
      activities: [
        activity('old-turn-tool', sessionId, timestamp(2), v.parse(turnIdSchema, 'turn-1')),
        activity('task-start', sessionId, timestamp(3), turnId, 'task.started', 'info'),
        activity('thinking', sessionId, timestamp(4), turnId, 'task.progress', 'thinking', {
          summary: 'Inspecting repository state',
        }),
      ],
      latestTurn,
      messages: [message('message-1', sessionId, timestamp(1), 'user')],
      optimisticMessages: [],
      proposedPlans: [],
    })

    expect(items.map((item) => item.id)).toEqual([
      'message:message-1',
      // The finished turn keeps its work, folded where it happened.
      'turn-fold:turn-1',
      'activity-group:thinking',
      'working:turn-2',
    ])
    expect(items[1]).toMatchObject({
      items: [{ activities: [{ title: 'old-turn-tool', turnId: 'turn-1' }] }],
    })
    expect(items[2]).toMatchObject({
      activities: [{ title: 'Inspecting repository state', tone: 'thinking', turnId: 'turn-2' }],
    })
  })

  it('hands the running turn its plan so the working row can name the current step', () => {
    const sessionId = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')
    const turnId = v.parse(turnIdSchema, 'turn-1')
    const latestTurn: OrchestrationLatestTurn = {
      providerStartState: 'adopted' as const,
      providerStartGeneration: 1,
      providerStartSequence: 1,
      runtimeEpoch: 'test-epoch',
      assistantMessageId: null,
      completedAt: null,
      requestedAt: timestamp(1),
      startedAt: timestamp(1),
      state: 'running',
      turnId,
    }
    const items = chatTimelineItems({
      activities: [
        activity('plan-1', sessionId, timestamp(2), turnId, 'turn.plan.updated', 'thinking', {
          plan: [
            { status: 'completed', step: 'Read the code' },
            { status: 'inProgress', step: 'Write the test' },
          ],
        }),
      ],
      latestTurn,
      messages: [],
      optimisticMessages: [],
      proposedPlans: [],
    })
    const workingItem = items.find((item) => item.type === 'working')

    expect(workingItem).toMatchObject({
      plan: { completedCount: 1, currentStep: 'Write the test' },
    })
  })

  it('derives T3 assistant row metadata before rendering', () => {
    const sessionId = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')
    const turnId = v.parse(turnIdSchema, 'turn-1')
    const latestTurn: OrchestrationLatestTurn = {
      providerStartState: 'adopted' as const,
      providerStartGeneration: 1,
      providerStartSequence: 1,
      runtimeEpoch: 'test-epoch',
      assistantMessageId: v.parse(messageIdSchema, 'message-3'),
      completedAt: timestamp(5),
      requestedAt: timestamp(1),
      startedAt: timestamp(2),
      state: 'completed',
      turnId,
    }
    const items = chatTimelineItems({
      activities: [activity('tool-done', sessionId, timestamp(3), turnId)],
      latestTurn,
      messages: [
        message('message-1', sessionId, timestamp(1), 'user'),
        message('message-2', sessionId, timestamp(2), 'assistant', {
          text: 'First draft',
          turnId,
          updatedAt: timestamp(3),
        }),
        message('message-3', sessionId, timestamp(4), 'assistant', {
          text: 'Final response',
          turnId,
          updatedAt: timestamp(5),
        }),
      ],
      optimisticMessages: [],
      proposedPlans: [],
    })
    const assistantItems = flattenTimelineItems(items).filter(
      (item) => item.type === 'message' && item.message.role === 'assistant',
    )

    expect(assistantItems).toHaveLength(2)
    expect(assistantItems[0]).toMatchObject({
      assistantStreaming: false,
      completionSummary: 'Worked for 3.0s',
      durationEnd: timestamp(3),
      durationStart: timestamp(1),
      showAssistantCopyButton: false,
      showCompletionDivider: false,
    })
    expect(assistantItems[1]).toMatchObject({
      assistantStreaming: false,
      completionSummary: 'Worked for 3.0s',
      durationEnd: timestamp(5),
      durationStart: timestamp(3),
      showAssistantCopyButton: true,
      // The fold row above already reports the turn's duration.
      showCompletionDivider: false,
    })
  })

  it('freezes terminal assistant metadata when raw message streaming lags turn completion', () => {
    const sessionId = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')
    const turnId = v.parse(turnIdSchema, 'turn-1')
    const latestTurn: OrchestrationLatestTurn = {
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
    }
    const items = chatTimelineItems({
      activities: [activity('tool-done', sessionId, timestamp(4), turnId)],
      latestTurn,
      messages: [
        message('message-1', sessionId, timestamp(1), 'user'),
        message('message-2', sessionId, timestamp(3), 'assistant', {
          streaming: true,
          text: 'Done',
          turnId,
          updatedAt: timestamp(4),
        }),
      ],
      optimisticMessages: [],
      proposedPlans: [],
    })
    const assistantItem = items.find(
      (item) => item.type === 'message' && item.message.role === 'assistant',
    )

    expect(assistantItem).toMatchObject({
      assistantStreaming: false,
      durationEnd: timestamp(5),
      showAssistantCopyButton: true,
    })
  })

  it('projects assistant turn diff summaries onto assistant rows', () => {
    const sessionId = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')
    const turnId = v.parse(turnIdSchema, 'turn-1')
    const assistantMessageId = v.parse(messageIdSchema, 'message-2')
    const items = chatTimelineItems({
      activities: [],
      latestTurn: null,
      messages: [
        message('message-1', sessionId, timestamp(1), 'user'),
        message('message-2', sessionId, timestamp(2), 'assistant', {
          text: 'Updated the files',
          turnId,
        }),
      ],
      optimisticMessages: [],
      proposedPlans: [],
      turnDiffSummaries: [
        turnDiffSummary(sessionId, turnId, assistantMessageId, [
          checkpointFile('apps/web/src/App.tsx', 12, 4),
          checkpointFile('packages/contracts/src/index.ts', 2, 0),
        ]),
      ],
    })
    const assistantItem = items.find(
      (item) => item.type === 'message' && item.message.id === assistantMessageId,
    )

    expect(assistantItem).toMatchObject({
      turnDiffSummary: {
        files: [
          { additions: 12, deletions: 4, path: 'apps/web/src/App.tsx' },
          { additions: 2, deletions: 0, path: 'packages/contracts/src/index.ts' },
        ],
      },
    })
  })

  it('projects checkpoint revert counts onto the nearby user row', () => {
    const sessionId = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')
    const turnId = v.parse(turnIdSchema, 'turn-1')
    const assistantMessageId = v.parse(messageIdSchema, 'message-2')
    const items = chatTimelineItems({
      activities: [],
      latestTurn: null,
      messages: [
        message('message-1', sessionId, timestamp(1), 'user', { turnId }),
        message('message-2', sessionId, timestamp(2), 'assistant', {
          text: 'Updated the files',
          turnId,
        }),
      ],
      optimisticMessages: [],
      proposedPlans: [],
      turnDiffSummaries: [
        {
          ...turnDiffSummary(sessionId, turnId, assistantMessageId, [
            checkpointFile('apps/web/src/App.tsx', 12, 4),
          ]),
          checkpointTurnCount: 3,
        },
      ],
    })
    const userItem = items.find(
      (item) => item.type === 'message' && item.message.id === 'message-1',
    )

    expect(userItem).toMatchObject({
      revertTurnCount: 2,
    })
  })

  it('folds a settled turn behind one row and keeps its closing message visible', () => {
    const sessionId = v.parse(sessionIdSchema, 'bc3e1c41-73bd-5eb7-824f-b1fd01bf336d')
    const turnId = v.parse(turnIdSchema, 'turn-1')
    const items = chatTimelineItems({
      activities: [
        activity('tool-1', sessionId, timestamp(3), turnId),
        activity('tool-2', sessionId, timestamp(4), turnId),
      ],
      latestTurn: {
        providerStartState: 'adopted' as const,
        providerStartGeneration: 1,
        providerStartSequence: 1,
        runtimeEpoch: 'test-epoch',
        assistantMessageId: v.parse(messageIdSchema, 'message-3'),
        completedAt: timestamp(5),
        requestedAt: timestamp(1),
        startedAt: timestamp(2),
        state: 'completed',
        turnId,
      },
      messages: [
        message('message-1', sessionId, timestamp(1), 'user'),
        message('message-2', sessionId, timestamp(3), 'assistant', {
          text: 'Thinking out loud',
          turnId,
        }),
        message('message-3', sessionId, timestamp(5), 'assistant', {
          text: 'Final response',
          turnId,
        }),
      ],
      optimisticMessages: [],
      proposedPlans: [],
    })

    expect(items.map((item) => item.id)).toEqual([
      'message:message-1',
      'turn-fold:turn-1',
      'message:message-3',
    ])
    expect(items[1]).toMatchObject({
      hiddenCount: 3,
      label: 'Worked for 3.0s',
      timestamp: timestamp(3),
      turnId,
    })
    expect(foldedItemIds(items[1])).toEqual(['message:message-2', 'activity-group:tool-1'])
  })

  it('leaves the turn in flight unfolded', () => {
    const sessionId = v.parse(sessionIdSchema, '28a4dd88-b175-59c8-a28b-4df609078204')
    const turnId = v.parse(turnIdSchema, 'turn-1')
    const items = chatTimelineItems({
      activities: [activity('tool-1', sessionId, timestamp(2), turnId)],
      latestTurn: runningTurn(turnId, timestamp(1)),
      messages: [
        message('message-1', sessionId, timestamp(1), 'user'),
        message('message-2', sessionId, timestamp(3), 'assistant', { text: 'Working', turnId }),
      ],
      optimisticMessages: [],
      proposedPlans: [],
    })

    expect(items.some((item) => item.type === 'turn-fold')).toBe(false)
  })

  it('names an interrupted turn after the user who stopped it', () => {
    const sessionId = v.parse(sessionIdSchema, 'affd3ce8-92e1-5ee7-b089-edd598c2c35a')
    const turnId = v.parse(turnIdSchema, 'turn-1')
    const items = chatTimelineItems({
      activities: [activity('tool-1', sessionId, timestamp(3), turnId)],
      latestTurn: {
        providerStartState: 'adopted' as const,
        providerStartGeneration: 1,
        providerStartSequence: 1,
        runtimeEpoch: 'test-epoch',
        assistantMessageId: null,
        completedAt: timestamp(4),
        requestedAt: timestamp(1),
        startedAt: timestamp(2),
        state: 'interrupted',
        turnId,
      },
      messages: [message('message-1', sessionId, timestamp(1), 'user')],
      optimisticMessages: [],
      proposedPlans: [],
    })

    expect(items.find((item) => item.type === 'turn-fold')).toMatchObject({
      label: 'You stopped after 2.0s',
    })
  })

  it('keeps unchanged rows identical across a streaming delta', () => {
    const sessionId = v.parse(sessionIdSchema, 'feef9dfd-ea59-5848-a328-7cc338903b44')
    const turnId = v.parse(turnIdSchema, 'turn-1')
    const latestTurn = runningTurn(turnId, timestamp(1))
    const userMessage = message('message-1', sessionId, timestamp(1), 'user')
    const activities = [activity('tool-1', sessionId, timestamp(2), turnId)]
    const streamed = (text: string) =>
      message('message-2', sessionId, timestamp(3), 'assistant', {
        streaming: true,
        text,
        turnId,
        updatedAt: timestamp(4),
      })
    const render = (assistant: OrchestrationMessage) =>
      chatTimelineItems({
        activities,
        latestTurn,
        messages: [userMessage, assistant],
        optimisticMessages: [],
        proposedPlans: [],
      })

    const before = render(streamed('Hel'))
    const chunk = streamed('Hello')
    const after = render(chunk)

    expect(after.map((item) => item.id)).toEqual([
      'message:message-1',
      'activity-group:tool-1',
      'message:message-2',
      'working:turn-1',
    ])
    expect(after[0]).toBe(before[0])
    expect(after[1]).toBe(before[1])
    expect(after[3]).toBe(before[3])
    expect(after[2]).not.toBe(before[2])
    // A tick that changes nothing hands back the same array, so the consumer's
    // memo — and every effect keyed on it — sees no change at all.
    expect(render(chunk)).toBe(after)
  })
})

function runningTurn(
  turnId: ReturnType<typeof parseTurnId>,
  startedAt: string,
): OrchestrationLatestTurn {
  return {
    providerStartState: 'adopted' as const,
    providerStartGeneration: 1,
    providerStartSequence: 1,
    runtimeEpoch: 'test-epoch',
    assistantMessageId: null,
    completedAt: null,
    requestedAt: startedAt,
    startedAt,
    state: 'running',
    turnId,
  }
}

function flattenTimelineItems(items: readonly ChatTimelineItem[]): ChatTimelineItem[] {
  return items.flatMap((item) =>
    item.type === 'turn-fold' ? [item, ...flattenTimelineItems(item.items)] : [item],
  )
}

function foldedItemIds(item: ChatTimelineItem | undefined) {
  if (item?.type !== 'turn-fold') return []

  return item.items.map((folded) => folded.id)
}

function message(
  id: string,
  sessionId: ReturnType<typeof parseSessionId>,
  createdAt: string,
  role: OrchestrationMessage['role'],
  options: {
    streaming?: boolean
    text?: string
    turnId?: ReturnType<typeof parseTurnId> | null
    updatedAt?: string
  } = {},
): OrchestrationMessage {
  return {
    attachments: [],
    createdAt,
    id: v.parse(messageIdSchema, id),
    role,
    streaming: options.streaming ?? false,
    text: options.text ?? id,
    sessionId,
    turnId: options.turnId ?? null,
    updatedAt: options.updatedAt ?? createdAt,
  }
}

function optimisticMessage(
  id: string,
  sessionId: ReturnType<typeof parseSessionId>,
  createdAt: string,
  turnId: ReturnType<typeof parseTurnId>,
): OptimisticChatMessage {
  return {
    ...message(id, sessionId, createdAt, 'user'),
    commandId: v.parse(commandIdSchema, `command-${id}`),
    optimistic: true,
    turnId,
  }
}

function activity(
  id: string,
  sessionId: ReturnType<typeof parseSessionId>,
  createdAt: string,
  turnId: ReturnType<typeof parseTurnId>,
  kind = 'tool.completed',
  tone: OrchestrationSessionActivity['tone'] = 'tool',
  payload: unknown = null,
): OrchestrationSessionActivity {
  return {
    createdAt,
    id: v.parse(eventIdSchema, id),
    kind,
    payload,
    summary: id,
    sessionId,
    tone,
    turnId,
  }
}

function proposedPlan(
  id: string,
  sessionId: ReturnType<typeof parseSessionId>,
  createdAt: string,
  turnId: ReturnType<typeof parseTurnId>,
  updatedAt = createdAt,
): OrchestrationProposedPlan {
  return {
    createdAt,
    id: v.parse(proposedPlanIdSchema, id),
    planMarkdown: '- Do the work',
    sessionId,
    turnId,
    updatedAt,
  }
}

function turnDiffSummary(
  sessionId: ReturnType<typeof parseSessionId>,
  turnId: ReturnType<typeof parseTurnId>,
  assistantMessageId: ReturnType<typeof parseMessageId> | null,
  files: ChatTurnDiffSummary['files'],
): ChatTurnDiffSummary {
  return {
    assistantMessageId,
    checkpointRef: `checkpoint-${turnId}`,
    checkpointTurnCount: 1,
    completedAt: timestamp(5),
    files,
    status: 'ready',
    sessionId,
    turnId,
  }
}

function checkpointFile(
  path: string,
  additions: number,
  deletions: number,
): ChatTurnDiffSummary['files'][number] {
  return {
    additions,
    deletions,
    kind: 'modified',
    path,
  }
}

function parseMessageId(value: string) {
  return v.parse(messageIdSchema, value)
}

function parseSessionId(value: string) {
  return v.parse(sessionIdSchema, value)
}

function parseTurnId(value: string) {
  return v.parse(turnIdSchema, value)
}

function timestamp(index: number) {
  return `2026-05-24T12:00:0${index}.000Z`
}
