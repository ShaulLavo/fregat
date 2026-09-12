import * as v from 'valibot'
import { eventIdSchema, messageIdSchema, turnIdSchema } from '@workspace/contracts'

import { test, expect } from '../../../../test/fixtures'
import { chatMessage, sessionActivity } from '../../../../test/factories/chat'
import { agentConversation } from '../../../../test/factories/chat-agents'
import { chatTimelineItems } from '@/features/chat/utils/timeline-items'
import {
  chatAgentGroups,
  chatAgentGroupsEqual,
  chatAgentGroupLabel,
} from '@/features/chat/utils/agents'

test('keeps child tool history and identity under the original parent turn', () => {
  const oldTurn = v.parse(turnIdSchema, 'original-parent')
  const laterTurn = v.parse(turnIdSchema, 'later-parent')
  const first = sessionActivity({
    kind: 'task.started',
    turnId: oldTurn,
    payload: {
      agent: { threadId: 'child-one', nickname: 'Locke', status: 'running' },
      description: 'Inspect command failures',
    },
  })
  const tool = sessionActivity({
    id: v.parse(eventIdSchema, 'child-tool'),
    kind: 'task.progress',
    turnId: oldTurn,
    sequence: 2,
    payload: {
      agent: { threadId: 'child-one', status: 'running' },
      tool: {
        itemId: 'command-one',
        itemType: 'command_execution',
        status: 'completed',
        data: {
          command: 'rg missing-path',
          exitCode: 2,
          aggregatedOutput: 'rg: missing-path: No such file or directory',
        },
      },
    },
  })
  const done = sessionActivity({
    id: v.parse(eventIdSchema, 'child-done'),
    kind: 'task.completed',
    turnId: oldTurn,
    sequence: 4,
    payload: {
      agent: { threadId: 'child-one', status: 'idle' },
      summary: 'Found a missing path',
      usage: { totalTokens: 1234 },
    },
  })
  const later = sessionActivity({
    id: v.parse(eventIdSchema, 'parent-tool'),
    kind: 'tool.completed',
    turnId: laterTurn,
    sequence: 3,
  })
  const groups = chatAgentGroups([first, tool, later, done])

  expect(groups).toHaveLength(1)
  expect(groups[0]?.turnId).toBe(oldTurn)
  expect(groups[0]?.agents[0]).toMatchObject({
    agent: { nickname: 'Locke', status: 'idle' },
    totalTokens: 1234,
    summary: 'Found a missing path',
  })
  expect(groups[0]?.agents[0]?.activities).toHaveLength(1)
  expect(groups[0]?.agents[0]?.activities[0]).toMatchObject({
    command: 'rg missing-path',
    outcome: 'failed',
    turnId: oldTurn,
  })
  expect(chatAgentGroupLabel(groups[0]!)).toBe('1 agent finished')
})

test('does not merge agents or tool calls that share provider item ids', () => {
  const activities = ['first-child', 'second-child'].map((threadId, index) =>
    sessionActivity({
      id: v.parse(eventIdSchema, `child-tool-${index}`),
      kind: 'task.progress',
      sequence: index,
      payload: {
        agent: { threadId, status: 'running' },
        tool: {
          itemId: 'shared-item-id',
          itemType: 'command_execution',
          status: 'inProgress',
          data: { command: `cat ${threadId}.md` },
        },
      },
    }),
  )
  const group = chatAgentGroups(activities)[0]!
  expect(group.agents.map((entry) => entry.agent.threadId)).toEqual(['first-child', 'second-child'])
  expect(group.agents.map((entry) => entry.activities[0]?.command)).toEqual([
    'cat first-child.md',
    'cat second-child.md',
  ])
  expect(chatAgentGroupLabel(group)).toBe('2 agents working')
  expect(chatAgentGroupsEqual(group, chatAgentGroups(activities)[0]!)).toBe(true)
})

test('keeps unknown ownership separate and ignores malformed agent metadata', () => {
  const activities = ['first-child', 'second-child'].map((threadId) =>
    sessionActivity({
      turnId: null,
      payload: { agent: { threadId, status: 'waiting' } },
    }),
  )
  activities.push(sessionActivity({ payload: { agent: { threadId: 'bad', status: 'invented' } } }))
  const groups = chatAgentGroups(activities)
  expect(groups).toHaveLength(2)
  expect(groups.every((group) => group.turnId === null)).toBe(true)
})

test('keeps the agent anchor visible after parent completion without duplicating child errors', () => {
  const snapshot = agentConversation(false)
  const items = chatTimelineItems({ ...snapshot, optimisticMessages: [] })
  expect(items.filter((item) => item.type === 'agent-group')).toHaveLength(1)
  expect(items.filter((item) => item.type === 'activity-group')).toHaveLength(0)
  expect(
    items.find((item) => item.type === 'message' && item.message.role === 'assistant'),
  ).toMatchObject({ showCompletionDivider: true })
})

test('leaves a lone context compaction visible', () => {
  const snapshot = agentConversation(false)
  snapshot.activities = [
    sessionActivity({
      kind: 'context-compaction',
      tone: 'info',
      summary: 'Context compacted',
      turnId: snapshot.latestTurn!.turnId,
      payload: {},
    }),
  ]
  const items = chatTimelineItems({ ...snapshot, optimisticMessages: [] })
  expect(items.filter((item) => item.type === 'turn-fold')).toHaveLength(0)
  expect(items.filter((item) => item.type === 'activity-group')).toHaveLength(1)
})

test('keeps child warnings and approval details inspectable without counting them as commands', () => {
  const snapshot = agentConversation(true)
  snapshot.activities.push(
    sessionActivity({
      id: v.parse(eventIdSchema, 'child-warning'),
      kind: 'runtime.warning',
      tone: 'info',
      sequence: 4,
      turnId: snapshot.latestTurn!.turnId,
      payload: {
        agent: { threadId: 'proof-child', status: 'waiting' },
        message: 'Connection interrupted; retrying',
      },
      summary: 'Connection interrupted; retrying',
    }),
  )
  const agent = chatAgentGroups(snapshot.activities)[0]!.agents[0]!
  expect(agent.activities).toHaveLength(2)
  expect(agent.activities.at(-1)).toMatchObject({ title: 'Connection interrupted; retrying' })
  expect(
    chatTimelineItems({ ...snapshot, optimisticMessages: [] }).some(
      (item) => item.type === 'activity-group',
    ),
  ).toBe(false)
})

test('joins early child requests only to explicit ownership of the same child thread', () => {
  const snapshot = agentConversation(true)
  const approval = sessionActivity({
    id: v.parse(eventIdSchema, 'early-child-approval'),
    kind: 'approval.requested',
    turnId: null,
    payload: { agent: { threadId: 'proof-child', status: 'waiting' }, requestId: 'child-request' },
  })
  const groups = chatAgentGroups([approval, ...snapshot.activities])
  expect(groups).toHaveLength(1)
  expect(groups[0]?.turnId).toBe(snapshot.latestTurn!.turnId)
  expect(groups[0]?.agents[0]?.activities[0]).toMatchObject({
    requestId: 'child-request',
    turnId: snapshot.latestTurn!.turnId,
  })
})

test('uses the latest agent snapshot time when projection upserts preserve creation time', () => {
  const snapshot = agentConversation(false)
  const initial = snapshot.activities[0]!
  const final = sessionActivity({
    ...initial,
    id: v.parse(eventIdSchema, 'upserted-state'),
    kind: 'task.progress',
    sequence: 3,
    payload: {
      agent: { threadId: 'proof-child', status: 'idle', updatedAt: '2026-09-12T08:48:47.000Z' },
    },
  })
  const entry = chatAgentGroups([initial, final])[0]!.agents[0]!
  expect(entry.startedAt).toBe('2026-09-12T08:46:50.000Z')
  expect(entry.updatedAt).toBe('2026-09-12T08:48:47.000Z')
})

test('does not let stable row order resurrect a completed agent from a stale tool snapshot', () => {
  const snapshot = agentConversation(false)
  const state = sessionActivity({
    id: v.parse(eventIdSchema, 'early-state-row'),
    kind: 'task.progress',
    sequence: 2,
    turnId: snapshot.latestTurn!.turnId,
    payload: {
      agent: {
        threadId: 'proof-child',
        status: 'idle',
        revision: 3,
        updatedAt: '2026-09-12T08:48:47.000Z',
      },
      summary: 'Investigation complete',
      usage: { totalTokens: 9000 },
    },
  })
  const tool = sessionActivity({
    id: v.parse(eventIdSchema, 'later-tool-row'),
    kind: 'task.progress',
    sequence: 3,
    turnId: snapshot.latestTurn!.turnId,
    payload: {
      agent: {
        threadId: 'proof-child',
        status: 'running',
        revision: 2,
        updatedAt: '2026-09-12T08:48:47.000Z',
      },
      summary: 'Running rg',
      usage: { totalTokens: 5000 },
      tool: {
        itemId: 'command',
        itemType: 'command_execution',
        status: 'completed',
        data: { command: 'rg foo', exitCode: 0 },
      },
    },
  })
  const agent = chatAgentGroups([state, tool])[0]!.agents[0]!
  expect(agent.agent.status).toBe('idle')
  expect(agent.summary).toBe('Investigation complete')
  expect(agent.totalTokens).toBe(9000)
  expect(agent.activities).toHaveLength(1)
})

test('accepts a newer snapshot when a resumed provider resets its local revision counter', () => {
  const activities = [
    sessionActivity({
      payload: {
        agent: {
          threadId: 'child',
          status: 'idle',
          revision: 10,
          updatedAt: '2026-09-12T08:48:47.000Z',
        },
        summary: 'Earlier result',
      },
    }),
    sessionActivity({
      payload: {
        agent: {
          threadId: 'child',
          status: 'running',
          revision: 1,
          updatedAt: '2026-09-12T09:00:00.000Z',
        },
        summary: 'Resumed work',
      },
    }),
  ]
  const agent = chatAgentGroups(activities)[0]!.agents[0]!
  expect(agent.agent.status).toBe('running')
  expect(agent.summary).toBe('Resumed work')
})

test('keeps elapsed work anchored to the original prompt after a same-turn correction', () => {
  const snapshot = agentConversation(true)
  snapshot.messages.push(
    chatMessage({
      id: v.parse(messageIdSchema, 'correction'),
      role: 'user',
      text: 'Also check the command results.',
      turnId: snapshot.latestTurn!.turnId,
      createdAt: '2026-09-12T08:47:40.000Z',
      updatedAt: '2026-09-12T08:47:40.000Z',
    }),
  )
  const working = chatTimelineItems({ ...snapshot, optimisticMessages: [] }).find(
    (item) => item.type === 'working',
  )
  expect(working).toMatchObject({ startedAt: snapshot.messages[0]!.createdAt })
})
