import type { ProviderSessionGoal } from '@workspace/contracts'
import type { ProviderRuntimeEvent } from './types'

/** Each session's goal as its harness last reported it; a runtime start or exit forgets it. */
export class SessionGoalRegistry {
  private readonly goals = new Map<string, ProviderSessionGoal>()

  accept(event: ProviderRuntimeEvent) {
    if (event.type === 'goal.updated') {
      this.record(event.sessionId, event.payload.goal)
      return
    }
    if (
      event.type === 'runtime.started' ||
      event.type === 'runtime.exited' ||
      (event.type === 'runtime.state.changed' && event.payload.state === 'stopped')
    )
      this.goals.delete(event.sessionId)
  }

  record(sessionId: string, goal: ProviderSessionGoal | null) {
    if (goal) this.goals.set(sessionId, goal)
    else this.goals.delete(sessionId)
  }

  clear(sessionId: string) {
    this.goals.delete(sessionId)
  }

  get(sessionId: string) {
    return this.goals.get(sessionId) ?? null
  }

  /** An active goal keeps working between turns, so its process must stay. */
  isActive(sessionId: string) {
    return this.goals.get(sessionId)?.status === 'active'
  }
}
