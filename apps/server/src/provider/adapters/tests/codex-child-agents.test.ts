import { describe, expect, it } from 'vitest'
import { turnIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { CodexChildAgents, type CodexChildAgentEvent } from '../state/codex-child-agents'

const firstTurn = v.parse(turnIdSchema, 'parent-turn-1')
const secondTurn = v.parse(turnIdSchema, 'parent-turn-2')

function fixture() {
  const events: CodexChildAgentEvent[] = []
  let currentTurn = firstTurn
  const agents = new CodexChildAgents({
    rootThreadId: 'root',
    canonicalTurn: (id) => {
      if (id === 'native-parent-1') return firstTurn
      if (id === 'native-parent-2') return secondTurn
    },
    currentTurn: () => currentTurn,
    emit: (event) => events.push(event),
  })
  return {
    agents,
    events,
    advanceTurn: () => {
      currentTurn = secondTurn
    },
  }
}

function register(agents: CodexChildAgents, turnId = 'native-parent-1') {
  agents.handle('item/started', {
    threadId: 'root',
    turnId,
    item: {
      type: 'subAgentActivity',
      id: 'spawn',
      agentThreadId: 'child',
      agentPath: '/root/check',
      kind: 'started',
    },
  })
}

describe('Codex child notification routing', () => {
  it('emits canonical tool types while preserving native data', () => {
    const { agents, events } = fixture()
    register(agents)
    agents.handle('item/completed', {
      threadId: 'child',
      turnId: 'child-turn',
      item: { id: 'command-1', type: 'commandExecution', command: 'pwd', status: 'completed' },
    })
    expect(events.at(-1)).toMatchObject({
      payload: { tool: { itemType: 'command_execution', data: { type: 'commandExecution' } } },
    })
  })

  it('preserves the original parent turn across child resume and later registration', () => {
    const { agents, events, advanceTurn } = fixture()
    register(agents)
    advanceTurn()
    register(agents, 'native-parent-2')
    agents.handle('turn/started', { threadId: 'child', turn: { id: 'child-turn-2' } })
    expect(events.every((event) => event.turnId === firstTurn)).toBe(true)
    expect(agents.activeTurns()).toEqual([{ threadId: 'child', turnId: 'child-turn-2' }])
  })

  it('does not assign unknown native parent turn ids to whichever turn is active', () => {
    const { agents, events } = fixture()
    register(agents, 'unknown-parent-turn')
    agents.handle('turn/completed', {
      threadId: 'child',
      turn: { id: 'child-turn', status: 'completed' },
    })
    expect(events.every((event) => event.turnId === undefined)).toBe(true)
  })

  it('does not let child status, plans, compaction, or token updates reach parent state before registration', () => {
    const { agents, events } = fixture()
    for (const method of [
      'thread/status/changed',
      'turn/plan/updated',
      'thread/compacted',
      'thread/tokenUsage/updated',
    ]) {
      expect(agents.handle(method, { threadId: 'child', status: { type: 'idle' } })).toBe(true)
    }
    expect(events).toEqual([])
    expect(agents.handle('future/diagnostic', { threadId: 'child' })).toBe(false)
    expect(agents.handle('serverRequest/resolved', { threadId: 'child', requestId: 1 })).toBe(false)
    register(agents)
    expect(events.at(-1)?.agent.status).toBe('idle')
  })

  it('keeps retryable failures interruptible and isolates terminal failures', () => {
    const { agents, events } = fixture()
    register(agents)
    agents.handle('turn/started', { threadId: 'child', turn: { id: 'child-turn' } })
    agents.handle('error', { threadId: 'child', willRetry: true, error: { message: 'Retrying' } })
    expect(events.at(-1)?.agent.status).toBe('running')
    expect(agents.activeTurns()).toHaveLength(1)
    agents.handle('error', { threadId: 'child', willRetry: false, error: { message: 'Stopped' } })
    expect(events.at(-1)?.agent.status).toBe('failed')
    expect(agents.activeTurns()).toHaveLength(0)
    agents.handle('item/completed', {
      threadId: 'root',
      turnId: 'native-parent-1',
      item: {
        type: 'subAgentActivity',
        agentThreadId: 'child',
        agentPath: '/root/check',
        kind: 'completed',
      },
    })
    expect(events.at(-1)?.agent.status).toBe('failed')
  })

  it('allows root self-activity and drops closed children from stop targets', () => {
    const { agents } = fixture()
    expect(
      agents.handle('item/completed', {
        threadId: 'root',
        item: {
          type: 'subAgentActivity',
          agentThreadId: 'root',
          agentPath: '/root',
          kind: 'interacted',
        },
      }),
    ).toBe(false)
    register(agents)
    agents.handle('turn/started', { threadId: 'child', turn: { id: 'child-turn' } })
    agents.handle('thread/closed', { threadId: 'child' })
    expect(agents.activeTurns()).toEqual([])
  })
})
