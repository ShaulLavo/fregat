/** Clock for elapsed durations; never use it as a persisted wall-clock timestamp. */
export function nowMs() {
  return globalThis.performance?.now() ?? Date.now()
}

export function roundMs(value: number) {
  return Math.round(value * 100) / 100
}

export function elapsedMs(startedAt: number) {
  return roundMs(nowMs() - startedAt)
}

export function durationBetweenMs(startedAt: number, endedAt: number) {
  return roundMs(endedAt - startedAt)
}

const MINUTES_PER_DAY = 24 * 60

/** A wait read at a glance: `5d 5h`, `3h 20m`, `12m`. Rounds up, so it never says `0m`. */
export function formatWait(waitMs: number) {
  const totalMinutes = Math.max(1, Math.ceil(waitMs / 60_000))
  const days = Math.floor(totalMinutes / MINUTES_PER_DAY)
  const hours = Math.floor((totalMinutes % MINUTES_PER_DAY) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return hours === 0 ? `${days}d` : `${days}d ${hours}h`
  if (hours > 0) return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`

  return `${totalMinutes}m`
}
