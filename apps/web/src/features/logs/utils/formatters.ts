import type { LogDashboardLevel, LogEventSummary } from '@workspace/contracts'

export function formatLogTime(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp))
}

export function formatLogDateTime(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    second: '2-digit',
  }).format(new Date(timestamp))
}

export function formatDuration(durationMs: number | null) {
  if (durationMs === null) return ''
  if (durationMs >= 1_000) return `${(durationMs / 1_000).toFixed(2)}s`

  return `${Math.round(durationMs)}ms`
}

export function formatLogSecondary(event: LogEventSummary) {
  return [event.area, event.source, event.method, event.status]
    .filter((value) => value !== null && value !== undefined && value !== '')
    .join(' · ')
}

export function logLevelClass(level: LogDashboardLevel) {
  if (level === 'error') return 'bg-destructive/10 text-destructive'
  if (level === 'warn') return 'bg-warning/10 text-warning'
  if (level === 'debug') return 'bg-info/10 text-info'

  return 'bg-success/10 text-success'
}

export function logLevelDotClass(level: LogDashboardLevel) {
  if (level === 'error') return 'bg-destructive'
  if (level === 'warn') return 'bg-warning'
  if (level === 'debug') return 'bg-info'

  return 'bg-success'
}
