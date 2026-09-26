import type { ProviderSessionSchedule } from '@workspace/contracts'
import type { ProviderHarnessSchedule, ProviderRuntimeEvent } from './types'
import { nextCronFire } from './utils/cron-next'

type ReportedSchedule = ProviderHarnessSchedule & {
  /** When a report first listed it; a one-shot fires once after this. */
  readonly firstSeenAt: Date
}

/**
 * The schedules each session's harness process holds, as its last Stop hook reported them.
 * They live only in that process, so a runtime start or exit forgets them.
 */
export class SessionScheduleRegistry {
  private readonly sessions = new Map<string, readonly ReportedSchedule[]>()

  accept(event: ProviderRuntimeEvent) {
    if (event.type === 'schedules.updated') {
      this.record(event.sessionId, event.payload.schedules, new Date(event.createdAt))
      return
    }
    if (
      event.type === 'runtime.started' ||
      event.type === 'runtime.exited' ||
      (event.type === 'runtime.state.changed' && event.payload.state === 'stopped')
    )
      this.clear(event.sessionId)
  }

  record(sessionId: string, schedules: readonly ProviderHarnessSchedule[], reportedAt: Date) {
    if (schedules.length === 0) {
      this.sessions.delete(sessionId)
      return
    }
    const previous = new Map((this.sessions.get(sessionId) ?? []).map((item) => [item.id, item]))
    this.sessions.set(
      sessionId,
      schedules.map((schedule) => ({
        ...schedule,
        firstSeenAt: previous.get(schedule.id)?.firstSeenAt ?? reportedAt,
      })),
    )
  }

  clear(sessionId: string) {
    this.sessions.delete(sessionId)
  }

  has(sessionId: string) {
    return this.sessions.has(sessionId)
  }

  count() {
    return this.sessions.size
  }

  list(sessionId: string, now = new Date()): ProviderSessionSchedule[] {
    return (this.sessions.get(sessionId) ?? []).map(({ firstSeenAt, ...schedule }) => ({
      ...schedule,
      nextFireAt:
        nextCronFire(
          schedule.schedule,
          schedule.recurring ? now : oneShotFrom(firstSeenAt),
        )?.toISOString() ?? null,
    }))
  }

  /** The earliest next fire; a one-shot already due reports its due time. */
  sleepingUntil(sessionId: string, now = new Date()): string | null {
    let earliest: string | null = null
    for (const schedule of this.list(sessionId, now)) {
      if (!schedule.nextFireAt) continue
      if (earliest === null || schedule.nextFireAt < earliest) earliest = schedule.nextFireAt
    }
    return earliest
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

// A one-shot names one date and time, which may already have passed when a turn that ran long
// first reports it; searching from a day earlier finds that time, so it reads as due.
function oneShotFrom(firstSeenAt: Date) {
  return new Date(firstSeenAt.getTime() - DAY_MS)
}
