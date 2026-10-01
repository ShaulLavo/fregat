import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import { sessionIdSchema } from '@workspace/contracts'
import { BackgroundTaskRegistry } from '../background-liveness'

describe('background task liveness', () => {
  it.each(['runtime.started', 'runtime.exited', 'runtime.state.changed'] as const)(
    'clears authoritative monitors on %s and restores the task-event fallback',
    (type) => {
      const registry = new BackgroundTaskRegistry()
      const common = {
        sessionId: v.parse(sessionIdSchema, '00000000-0000-4000-8000-000000000001'),
        runtimeEpoch: 'epoch',
        eventId: 'e',
        createdAt: '2026-10-01T00:00:00.000Z',
      }
      registry.accept({
        ...common,
        type: 'tasks.roster',
        payload: {
          tasks: [{ taskId: 'watch', taskType: 'monitor', description: 'Watch logs' }],
        },
      })
      expect(registry.get(common.sessionId)).toBe('monitoring')
      if (type === 'runtime.state.changed')
        registry.accept({ ...common, type, payload: { state: 'stopped' } })
      else registry.accept({ ...common, type, payload: {} })
      expect(registry.get(common.sessionId)).toBeNull()
      registry.accept({ ...common, type: 'task.started', payload: { taskId: 'agent' } })
      expect(registry.get(common.sessionId)).toBe('working')
    },
  )

  it('lets an idle child release its internal silent shell while a root monitor stays live', () => {
    const registry = new BackgroundTaskRegistry()
    registry.record({ sessionId: 's', taskId: 'child', taskType: 'local_agent', kind: 'started' })
    registry.record({ sessionId: 's', taskId: 'root-watch', taskType: 'monitor', kind: 'started' })
    registry.record({
      sessionId: 's',
      taskId: 'child-shell',
      taskType: 'shell',
      agentId: 'child',
      kind: 'started',
    })
    expect(registry.get('s')).toBe('working')
    registry.record({
      sessionId: 's',
      taskId: 'child',
      taskType: 'local_agent',
      kind: 'updated',
      status: 'idle',
    })
    expect(registry.get('s')).toBe('monitoring')
    registry.record({ sessionId: 's', taskId: 'root-watch', kind: 'completed' })
    expect(registry.get('s')).toBeNull()
    registry.record({
      sessionId: 's',
      taskId: 'child-shell',
      taskType: 'shell',
      agentId: 'child',
      kind: 'progress',
      status: 'running',
    })
    expect(registry.get('s')).toBeNull()
  })

  it('keeps nested agents alive after their parent finishes, then reports monitor-only work', () => {
    const registry = new BackgroundTaskRegistry()
    registry.record({ sessionId: 's', taskId: 'parent', taskType: 'agent', kind: 'started' })
    registry.record({
      sessionId: 's',
      taskId: 'nested',
      taskType: 'local_agent',
      agentId: 'parent',
      kind: 'started',
    })
    registry.record({ sessionId: 's', taskId: 'watch', taskType: 'shell', kind: 'started' })
    registry.record({ sessionId: 's', taskId: 'parent', kind: 'completed' })
    expect(registry.get('s')).toBe('working')
    registry.record({ sessionId: 's', taskId: 'nested', kind: 'progress', status: 'idle' })
    expect(registry.get('s')).toBe('monitoring')
    registry.clear('s')
    expect(registry.get('s')).toBeNull()
  })

  it.each(['plan', 'dream', 'shell', 'monitor'])(
    'reclassifies previously unknown %s tasks without leaking an agent entry',
    (taskType) => {
      const registry = new BackgroundTaskRegistry()
      registry.record({ sessionId: 's', taskId: 't', kind: 'started' })
      expect(registry.get('s')).toBe('working')
      registry.record({ sessionId: 's', taskId: 't', kind: 'updated', taskType, agentId: 'parent' })
      expect(registry.get('s')).toBeNull()
    },
  )

  it('does not resurrect an idle child from late status-free metadata', () => {
    const registry = new BackgroundTaskRegistry()
    registry.record({ sessionId: 's', taskId: 't', kind: 'started', taskType: 'agent' })
    registry.record({
      sessionId: 's',
      taskId: 't',
      kind: 'updated',
      taskType: 'agent',
      status: 'idle',
    })
    registry.record({ sessionId: 's', taskId: 't', kind: 'progress', taskType: 'agent' })
    expect(registry.get('s')).toBeNull()
    registry.record({
      sessionId: 's',
      taskId: 't',
      kind: 'updated',
      taskType: 'agent',
      status: 'running',
    })
    expect(registry.get('s')).toBe('working')
    expect(registry.get('other')).toBeNull()
  })
})
