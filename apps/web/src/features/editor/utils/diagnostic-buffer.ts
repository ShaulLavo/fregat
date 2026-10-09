import { createTraceBuffer } from '@/features/editor/utils/trace-buffer'

export const MAX_TRACE_EVENTS = 5000

export type EditorPerformanceDiagnostic = {
  readonly timestampMs?: number
  readonly name: string
  readonly durationMs?: number
  readonly detail?: Readonly<Record<string, unknown>>
}

export type BufferedDiagnostic = {
  readonly at: number
  readonly diagnostic: EditorPerformanceDiagnostic
}

export type InitialDiagnostics = {
  readonly startedAt: number
  readonly events: readonly BufferedDiagnostic[]
}

export function createDiagnosticBuffer() {
  const startedAt = performance.now()
  const events = createTraceBuffer<BufferedDiagnostic>(MAX_TRACE_EVENTS)
  const sink = {
    enabled: true,
    record(diagnostic: EditorPerformanceDiagnostic) {
      if (!sink.enabled) return
      events.push({ at: diagnostic.timestampMs ?? performance.now(), diagnostic })
    },
  }
  return {
    sink,
    snapshot(): InitialDiagnostics {
      return { startedAt, events: events.values() }
    },
    stop() {
      sink.enabled = false
      events.clear()
    },
  }
}
