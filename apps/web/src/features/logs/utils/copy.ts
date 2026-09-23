import type { LogEventDetail, LogEventSummary } from '@workspace/contracts'

export function logCopyValue(event: LogEventSummary, detail: LogEventDetail | null) {
  return detail?.rawJson ?? event
}
