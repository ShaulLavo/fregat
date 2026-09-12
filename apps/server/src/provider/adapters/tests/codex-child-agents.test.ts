import { describe, expect, it } from 'vitest'
import { turnIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { CodexChildAgents, type CodexChildAgentEvent } from '../state/codex-child-agents'
import { CODEX_CHILD_PENDING_LIMITS } from '../utils/codex-child-notifications'

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
  it.each([undefined, null])(
    'retains streamed output when completed output is %s',
    (aggregatedOutput) => {
      const { agents, events } = fixture()
      register(agents)
      const item = { id: 'command', type: 'commandExecution', command: 'check' }
      const params = { threadId: 'child', turnId: 'child-turn' }
      agents.handle('item/started', { ...params, item: { ...item, status: 'inProgress' } })
      for (const delta of ['specific failure', '\n', 'details']) {
        agents.handle('item/commandExecution/outputDelta', { ...params, itemId: item.id, delta })
      }
      agents.handle('item/completed', {
        ...params,
        item: { ...item, status: 'failed', exitCode: 1, aggregatedOutput },
      })
      expect(events.at(-1)).toMatchObject({
        payload: {
          tool: { status: 'failed', detail: 'specific failure\ndetails', data: { exitCode: 1 } },
        },
      })
    },
  )

  it.each(['replacement output', ''])(
    'uses explicit completed output %j without duplicating streamed bytes',
    (aggregatedOutput) => {
      const { agents, events } = fixture()
      register(agents)
      const item = { id: 'command', type: 'commandExecution', command: 'check' }
      const params = { threadId: 'child', turnId: 'child-turn' }
      agents.handle('item/started', { ...params, item: { ...item, status: 'inProgress' } })
      agents.handle('item/commandExecution/outputDelta', {
        ...params,
        itemId: item.id,
        delta: 'partial output',
      })
      agents.handle('item/completed', {
        ...params,
        item: { ...item, status: 'completed', aggregatedOutput },
      })
      expect(events.at(-1)).toMatchObject({
        payload: { tool: { status: 'completed', detail: aggregatedOutput } },
      })
    },
  )

  it('keeps file-change output and late command details without replacing the running summary', () => {
    const { agents, events } = fixture()
    register(agents)
    agents.handle('turn/started', { threadId: 'child', turn: { id: 'old-turn' } })
    const oldParams = { threadId: 'child', turnId: 'old-turn' }
    const item = { id: 'patch', type: 'fileChange', changes: [] }
    agents.handle('item/started', { ...oldParams, item: { ...item, status: 'inProgress' } })
    agents.handle('item/fileChange/outputDelta', {
      ...oldParams,
      itemId: item.id,
      delta: 'patch diagnostic',
    })
    agents.handle('turn/completed', {
      threadId: 'child',
      turn: { id: 'old-turn', status: 'completed' },
    })
    agents.handle('turn/started', { threadId: 'child', turn: { id: 'current-turn' } })
    agents.handle('item/started', {
      threadId: 'child',
      turnId: 'current-turn',
      item: {
        id: 'current',
        type: 'commandExecution',
        command: 'current work',
        status: 'inProgress',
      },
    })
    agents.handle('item/completed', { ...oldParams, item: { ...item, status: 'failed' } })
    agents.handle('item/fileChange/outputDelta', { ...oldParams, itemId: item.id, delta: '\n' })
    expect(events.at(-1)).toMatchObject({
      agent: { status: 'running' },
      payload: {
        summary: 'current work',
        tool: { status: 'failed', detail: 'patch diagnostic\n' },
      },
    })
  })

  it.each(['failed', 'interrupted', 'closed'] as const)(
    'preserves the %s summary when a same-turn tool completes late',
    (status) => {
      const { agents, events } = fixture()
      register(agents)
      const params = { threadId: 'child', turnId: 'child-turn' }
      agents.handle('turn/started', { threadId: 'child', turn: { id: params.turnId } })
      agents.handle('item/completed', {
        ...params,
        item: { id: 'explanation', type: 'agentMessage', text: 'The operation stopped.' },
      })
      if (status === 'closed') agents.handle('thread/closed', { threadId: 'child' })
      if (status !== 'closed')
        agents.handle('turn/completed', {
          threadId: 'child',
          turn: { id: params.turnId, status },
        })
      agents.handle('item/completed', {
        ...params,
        item: { id: 'late-tool', type: 'commandExecution', command: 'pwd', status: 'completed' },
      })
      expect(events.at(-1)).toMatchObject({
        agent: { status },
        payload: { summary: 'The operation stopped.', tool: { title: 'pwd', status: 'completed' } },
      })
    },
  )

  it.each([false, true])(
    'ignores old child terminal events with deferred registration=%s',
    (deferred) => {
      const { agents, events } = fixture()
      if (!deferred) register(agents)
      agents.handle('turn/started', { threadId: 'child', turn: { id: 'old-turn' } })
      agents.handle('turn/completed', {
        threadId: 'child',
        turn: { id: 'old-turn', status: 'completed' },
      })
      agents.handle('turn/started', { threadId: 'child', turn: { id: 'current-turn' } })
      agents.handle('item/completed', {
        threadId: 'child',
        turnId: 'current-turn',
        item: {
          id: 'current-command',
          type: 'commandExecution',
          command: 'current work',
          status: 'completed',
        },
      })
      agents.handle('turn/completed', {
        threadId: 'child',
        turn: { id: 'old-turn', status: 'completed' },
      })
      agents.handle('error', {
        threadId: 'child',
        turnId: 'old-turn',
        willRetry: false,
        error: { message: 'Old failure' },
      })
      if (deferred) register(agents)
      expect(agents.activeTurns()).toEqual([{ threadId: 'child', turnId: 'current-turn' }])
      expect(agents.owner({ threadId: 'child' }).agent?.status).toBe('running')
      expect(events.at(-1)?.payload).toMatchObject({ summary: 'current work' })
      agents.handle('error', {
        threadId: 'child',
        turnId: 'current-turn',
        willRetry: false,
        error: { message: 'Current failure' },
      })
      expect(agents.activeTurns()).toEqual([])
      expect(agents.owner({ threadId: 'child' }).agent?.status).toBe('failed')
      agents.handle('item/started', {
        threadId: 'child',
        turnId: 'current-turn',
        item: {
          id: 'current-command',
          type: 'commandExecution',
          command: 'current work',
          status: 'inProgress',
        },
      })
      expect(events.at(-1)?.payload).toMatchObject({ summary: 'Current failure' })
      expect(agents.owner({ threadId: 'child' }).agent?.status).toBe('failed')
      agents.handle('turn/completed', {
        threadId: 'child',
        turn: { id: 'current-turn', status: 'failed' },
      })
      expect(agents.owner({ threadId: 'child' }).agent?.status).toBe('failed')
      agents.handle('turn/started', { threadId: 'child', turn: { id: 'current-turn' } })
      expect(agents.activeTurns()).toEqual([])
      expect(agents.owner({ threadId: 'child' }).agent?.status).toBe('failed')
    },
  )

  it('bounds pending threads, events, and bytes while retaining stop targets and registered tools', () => {
    const { agents, events } = fixture()
    register(agents)
    agents.handle('item/started', {
      threadId: 'child',
      item: { id: 'saved-command', type: 'commandExecution', command: 'pwd' },
    })
    for (let index = 0; index < 200; index += 1) {
      agents.handle('turn/started', { threadId: `unknown-${index}`, turn: { id: `turn-${index}` } })
    }
    expect(agents.pendingStats().threads).toBeLessThanOrEqual(CODEX_CHILD_PENDING_LIMITS.threads)
    expect(agents.activeTurns()).toHaveLength(200)
    for (let index = 0; index < 700; index += 1) {
      agents.handle('item/started', {
        threadId: 'many-events',
        item: { id: `command-${index}`, type: 'commandExecution', command: 'pwd' },
      })
    }
    expect(agents.pendingStats().events).toBeLessThanOrEqual(CODEX_CHILD_PENDING_LIMITS.events)
    for (let index = 0; index < 140; index += 1) {
      agents.handle('item/commandExecution/outputDelta', {
        threadId: `large-output-${index}`,
        itemId: 'command',
        delta: 'x'.repeat(32_768),
      })
    }
    expect(agents.pendingStats().bytes).toBeLessThanOrEqual(CODEX_CHILD_PENDING_LIMITS.bytes)
    const beforeOversized = agents.pendingStats()
    agents.handle('item/commandExecution/outputDelta', {
      threadId: 'oversized',
      itemId: 'command',
      delta: 'x'.repeat(CODEX_CHILD_PENDING_LIMITS.bytes + 1),
    })
    expect(agents.pendingStats()).toEqual({
      ...beforeOversized,
      droppedEvents: beforeOversized.droppedEvents + 1,
    })
    agents.handle('item/commandExecution/outputDelta', {
      threadId: 'child',
      itemId: 'saved-command',
      delta: '/workspace',
    })
    expect(events.at(-1)).toMatchObject({
      payload: { tool: { itemId: 'saved-command', detail: '/workspace' } },
    })
    const beforeRegistration = agents.pendingStats()
    agents.handle('thread/started', {
      thread: {
        id: 'large-output-139',
        source: {
          subAgent: { thread_spawn: { parent_thread_id: 'root', agent_nickname: 'Late agent' } },
        },
      },
    })
    expect(agents.owner({ threadId: 'large-output-139' })).toMatchObject({
      agent: { nickname: 'Late agent' },
      turnId: firstTurn,
    })
    expect(agents.pendingStats().threads).toBe(beforeRegistration.threads - 1)
    expect(agents.pendingStats().bytes).toBeLessThan(beforeRegistration.bytes)
    expect(agents.activeTurns()).toContainEqual({ threadId: 'unknown-0', turnId: 'turn-0' })
    expect(agents.pendingStats().droppedEvents).toBeGreaterThan(0)
  })

  it('orders latest state independently from retained tool row order and timestamp ties', () => {
    const { agents, events } = fixture()
    register(agents)
    agents.handle('turn/started', { threadId: 'child', turn: { id: 'child-turn' } })
    agents.handle('item/completed', {
      threadId: 'child',
      turnId: 'child-turn',
      item: { id: 'command-1', type: 'commandExecution', command: 'pwd', status: 'completed' },
    })
    agents.handle('turn/completed', {
      threadId: 'child',
      turn: { id: 'child-turn', status: 'completed' },
    })
    const snapshots = events.map((event) => ({
      ...event.agent,
      updatedAt: '2026-09-12T12:00:00.000Z',
    }))
    expect(snapshots.map((agent) => agent.revision)).toEqual([1, 2, 3, 4])
    expect(snapshots[2]).toMatchObject({ status: 'running', revision: 3 })
    expect(snapshots[3]).toMatchObject({ status: 'idle', revision: 4 })
    expect(agents.owner({ threadId: 'child' }).agent).toMatchObject({ status: 'idle', revision: 4 })
  })

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
