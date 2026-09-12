import { eventIdSchema, messageIdSchema, turnIdSchema } from '@workspace/contracts'
import * as v from 'valibot'

import { chatMessage, session, sessionActivity } from './chat'

export function agentConversation(running = true) {
  const turnId = v.parse(turnIdSchema, 'agent-proof-turn')
  const startedAt = '2026-09-12T08:46:50.000Z'
  const completedAt = '2026-09-12T08:48:47.000Z'
  const agent = {
    threadId: 'proof-child',
    nickname: 'Locke',
    path: '/root/explain_diff',
    model: 'gpt-5.4',
    status: running ? ('running' as const) : ('idle' as const),
  }
  const activities = [
    sessionActivity({
      id: v.parse(eventIdSchema, 'agent-start'),
      kind: 'task.started',
      tone: 'info',
      turnId,
      createdAt: startedAt,
      sequence: 1,
      payload: { agent, description: 'Inspect how session diffs are calculated' },
    }),
    sessionActivity({
      id: v.parse(eventIdSchema, 'agent-tool'),
      kind: 'task.progress',
      tone: 'info',
      turnId,
      createdAt: '2026-09-12T08:47:32.000Z',
      sequence: 2,
      payload: {
        agent,
        tool: {
          itemId: 'child-command',
          itemType: 'command_execution',
          status: 'completed',
          data: {
            command: "rg -n 'sessionDiff' apps/server/src/missing",
            exitCode: 2,
            aggregatedOutput: 'rg: apps/server/src/missing: No such file or directory',
          },
        },
      },
    }),
    sessionActivity({
      id: v.parse(eventIdSchema, 'agent-state'),
      kind: running ? 'task.progress' : 'task.completed',
      tone: 'info',
      turnId,
      createdAt: running ? '2026-09-12T08:47:33.000Z' : completedAt,
      sequence: 3,
      payload: {
        agent,
        summary: running ? 'Reading the diff calculation' : 'Found the diff calculation',
        usage: { totalTokens: 4321 },
      },
    }),
  ]
  const messages = [
    chatMessage({
      role: 'user',
      text: 'Explain the session diff.',
      turnId,
      createdAt: startedAt,
      updatedAt: startedAt,
    }),
  ]
  if (!running)
    messages.push(
      chatMessage({
        id: v.parse(messageIdSchema, 'proof-answer'),
        role: 'assistant',
        text: 'The session diff compares the saved checkpoint with the working tree.',
        turnId,
        createdAt: completedAt,
        updatedAt: completedAt,
      }),
    )
  return session({
    activities,
    messages,
    latestTurn: {
      ...session().latestTurn!,
      turnId,
      state: running ? 'running' : 'completed',
      requestedAt: startedAt,
      startedAt,
      completedAt: running ? null : completedAt,
    },
  })
}
