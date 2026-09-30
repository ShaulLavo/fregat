import {
  withDocumentSessionChangeTimings,
  type DocumentSessionChange,
  type EditorTimingMeasurement,
} from '../documentSession'

export function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now()
}

export function eventStartMs(event: Event): number {
  const start = event.timeStamp
  if (!Number.isFinite(start) || start <= 0) return nowMs()

  const now = nowMs()
  if (start <= now + 1_000) return start

  const wallClockDelta = Date.now() - start
  if (!Number.isFinite(wallClockDelta) || wallClockDelta < 0) return now

  return Math.max(0, now - wallClockDelta)
}

export function appendTiming(
  change: DocumentSessionChange,
  name: string,
  startMs: number,
): DocumentSessionChange {
  return withDocumentSessionChangeTimings(change, [...change.timings, createTiming(name, startMs)])
}

export function mergeChangeTimings(
  change: DocumentSessionChange,
  earlierChange: DocumentSessionChange | null,
): DocumentSessionChange {
  if (!earlierChange) return change
  return withDocumentSessionChangeTimings(change, earlierChange.timings.concat(change.timings))
}

function createTiming(name: string, startMs: number): EditorTimingMeasurement {
  return { name, durationMs: nowMs() - startMs }
}
