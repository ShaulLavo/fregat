import type { LogDashboardSummary, LogEventsResult, LogLiveStreamItem } from '@workspace/contracts'

export function mergeLogEvent(result: LogEventsResult, item: LogLiveStreamItem): LogEventsResult {
  if (result.detailsById[item.event.id]) return result
  const events = [item.event, ...result.events]
    .toSorted((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, 300)
  const detailsById = Object.fromEntries(
    events.flatMap((event) => {
      const detail = event.id === item.event.id ? item.detail : result.detailsById[event.id]
      return detail ? [[event.id, detail]] : []
    }),
  )
  return { ...result, events, detailsById, total: result.total + 1 }
}
export function mergeLogSnapshot(
  snapshot: LogEventsResult,
  live: LogEventsResult,
): LogEventsResult {
  return live.events.reduce((result, event) => {
    const detail = live.detailsById[event.id]
    return detail ? mergeLogEvent(result, { kind: 'event', event, detail }) : result
  }, snapshot)
}
export function logHistogram(summary: LogDashboardSummary) {
  const maximum = Math.max(1, ...summary.timeline.map((bucket) => bucket.total))
  const bars = ' ▁▂▃▄▅▆▇█'
  return summary.timeline.map((bucket) => bars[Math.ceil((bucket.total / maximum) * 8)]).join('')
}
export function logRow(event: LogEventsResult['events'][number]) {
  return `${event.timestamp.slice(11, 23)} ${event.level.padEnd(5)} ${(event.source ?? '').padEnd(7)} ${event.action ?? event.message ?? event.path ?? event.operation ?? ''}`
}

export function addLogSummary(
  summary: LogDashboardSummary,
  event: LogEventsResult['events'][number],
  slowMs: number,
): LogDashboardSummary {
  const error = Number(event.level === 'error')
  const warn = Number(event.level === 'warn')
  const slow = Number((event.durationMs ?? -1) >= slowMs)
  const finalIndex = summary.timeline.length - 1
  const timeline = summary.timeline.map((bucket, index) => {
    if (event.timestamp < bucket.start) return bucket
    if (event.timestamp >= bucket.end && index !== finalIndex) return bucket
    return {
      ...bucket,
      total: bucket.total + 1,
      error: bucket.error + error,
      warn: bucket.warn + warn,
      slow: bucket.slow + slow,
    }
  })
  return {
    ...summary,
    timeline,
    total: summary.total + 1,
    errorCount: summary.errorCount + error,
    warnCount: summary.warnCount + warn,
    slowCount: summary.slowCount + slow,
    lastTimestamp: event.timestamp,
  }
}
