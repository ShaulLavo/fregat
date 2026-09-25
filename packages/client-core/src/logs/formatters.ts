import type { LogEventSummary } from '@workspace/contracts'

export function formatLogPrimary(event: LogEventSummary) {
  return event.action ?? event.operation ?? event.path ?? event.message ?? 'log event'
}
