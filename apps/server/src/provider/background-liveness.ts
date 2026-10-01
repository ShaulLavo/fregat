import type { ProviderRuntimeEvent } from './types'

export type BackgroundLiveness = 'working' | 'monitoring' | null
const monitorTypes = new Set(['monitor', 'monitor_mcp', 'local_bash', 'shell'])
const inertTypes = new Set(['plan', 'dream'])
const terminalStatuses = new Set([
  'idle',
  'completed',
  'failed',
  'stopped',
  'cancelled',
  'interrupted',
])
type TaskTransition = {
  readonly sessionId: string
  readonly taskId: string
  readonly taskType?: string
  readonly status?: string
  readonly agentId?: string
  readonly kind: 'started' | 'progress' | 'updated' | 'completed'
}

export class BackgroundTaskRegistry {
  private readonly sessions = new Map<string, Map<string, Exclude<BackgroundLiveness, null>>>()
  private readonly rosters = new Map<string, BackgroundLiveness>()

  get(sessionId: string): BackgroundLiveness {
    if (this.rosters.has(sessionId)) return this.rosters.get(sessionId) ?? null
    const tasks = this.sessions.get(sessionId)
    if (!tasks?.size) return null
    return [...tasks.values()].includes('working') ? 'working' : 'monitoring'
  }

  clear(sessionId: string) {
    this.sessions.delete(sessionId)
    this.rosters.delete(sessionId)
  }

  record(input: TaskTransition) {
    // Native rosters replace membership; bookends for the same change can arrive later.
    if (this.rosters.has(input.sessionId)) return
    const previous = this.sessions.get(input.sessionId)?.has(input.taskId) ?? false
    this.drop(input.sessionId, input.taskId)
    if (input.taskType && inertTypes.has(input.taskType)) return
    if (input.agentId && (!input.taskType || monitorTypes.has(input.taskType))) return
    if (input.kind === 'completed' || (input.status && terminalStatuses.has(input.status))) return
    if ((input.kind === 'progress' || input.kind === 'updated') && !input.status && !previous)
      return
    const tasks =
      this.sessions.get(input.sessionId) ?? new Map<string, Exclude<BackgroundLiveness, null>>()
    tasks.set(
      input.taskId,
      input.taskType && monitorTypes.has(input.taskType) ? 'monitoring' : 'working',
    )
    this.sessions.set(input.sessionId, tasks)
  }

  accept(event: ProviderRuntimeEvent) {
    if (event.type === 'item.completed' && event.itemId) this.drop(event.sessionId, event.itemId)
    if (
      event.type === 'runtime.started' ||
      event.type === 'runtime.exited' ||
      (event.type === 'runtime.state.changed' && event.payload.state === 'stopped')
    ) {
      this.clear(event.sessionId)
      return
    }
    if (event.type === 'tasks.roster') {
      let liveness: BackgroundLiveness = null
      for (const task of event.payload.tasks) {
        if (inertTypes.has(task.taskType)) continue
        if (!monitorTypes.has(task.taskType)) {
          liveness = 'working'
          break
        }
        liveness = 'monitoring'
      }
      this.sessions.delete(event.sessionId)
      this.rosters.set(event.sessionId, liveness)
      return
    }
    if (
      event.type !== 'task.started' &&
      event.type !== 'task.progress' &&
      event.type !== 'task.completed'
    )
      return
    const child = event.agent?.threadId === event.payload.taskId
    this.record({
      sessionId: event.sessionId,
      taskId: event.payload.taskId,
      taskType: child ? 'agent' : event.payload.taskType,
      status: taskEventStatus(event, child),
      agentId: child ? event.agent?.parentThreadId : event.agent?.threadId,
      kind: taskEventKind(event.type),
    })
  }

  private drop(sessionId: string, taskId: string) {
    const tasks = this.sessions.get(sessionId)
    tasks?.delete(taskId)
    if (tasks?.size === 0) this.sessions.delete(sessionId)
  }
}

function taskEventKind(type: 'task.started' | 'task.progress' | 'task.completed') {
  if (type === 'task.started') return 'started'
  if (type === 'task.completed') return 'completed'
  return 'progress'
}

function taskEventStatus(
  event: Extract<
    ProviderRuntimeEvent,
    { type: 'task.started' | 'task.progress' | 'task.completed' }
  >,
  child: boolean,
) {
  const status = child ? event.agent?.status : event.payload.status
  return status === 'closed' ? 'stopped' : status
}
