import * as v from 'valibot'
import { eventIdSchema, turnIdSchema } from '@workspace/contracts'

import { test, expect } from '../../../../test/fixtures'
import { sessionActivity } from '../../../../test/factories/chat'
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
