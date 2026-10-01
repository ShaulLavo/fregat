import { descriptorFor } from '@workspace/contracts'

export type StartupBudget = { idleMs: number; limitMs: number }
export type StartupCounters = Record<string, number | null>
export type StartupVerdict = 'progressing' | 'startup-stalled' | 'startup-limit'

const IDLE = 'window.browserStartupIdleSeconds'
const LIMIT = 'window.browserStartupLimitSeconds'

export function startupBudget(values: Partial<Record<string, unknown>> = {}): StartupBudget {
  const seconds = (id: typeof IDLE | typeof LIMIT) => {
    const value = values[id]
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : descriptorFor(id).default
  }
  return { idleMs: seconds(IDLE) * 1000, limitMs: seconds(LIMIT) * 1000 }
}

// Progress is a new maximum of a finite counter, so a reset or a re-read of an old value never renews the budget.
export function startupSupervisor(budget: StartupBudget, now: () => number) {
  const startedAt = now()
  let idleSince = startedAt
  const highest = new Map<string, number>()
  const advanced = (counters: StartupCounters) => {
    let increased = false
    for (const [name, value] of Object.entries(counters)) {
      if (value === null || !Number.isFinite(value)) continue
      const previous = highest.get(name)
      if (previous !== undefined && value <= previous) continue
      highest.set(name, value)
      if (previous !== undefined) increased = true
    }
    return increased
  }
  return {
    elapsedMs: () => now() - startedAt,
    remainingMs: () => Math.max(0, startedAt + budget.limitMs - now()),
    idleRemainingMs: () => Math.max(0, startedAt + budget.idleMs - now()),
    check(counters: StartupCounters): StartupVerdict {
      const at = now()
      if (at - startedAt >= budget.limitMs) return 'startup-limit'
      if (advanced(counters)) idleSince = at
      return at - idleSince >= budget.idleMs ? 'startup-stalled' : 'progressing'
    },
  }
}
