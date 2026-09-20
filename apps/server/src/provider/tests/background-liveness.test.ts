import { describe, expect, it } from 'vitest'
import { BackgroundTaskRegistry } from '../background-liveness'

describe('background task liveness', () => {
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
