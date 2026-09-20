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
