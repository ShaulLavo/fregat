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

export type DiagnosticSummary = {
  count: number
  maxMs: number
  totalMs: number
}

export function addDiagnosticSummary(
  summaries: Map<string, DiagnosticSummary>,
  diagnostic: EditorPerformanceDiagnostic,
): void {
  const durationMs = diagnostic.durationMs ?? 0
  const summary = summaries.get(diagnostic.name) ?? { count: 0, maxMs: 0, totalMs: 0 }
  summary.count += 1
  summary.maxMs = Math.max(summary.maxMs, durationMs)
  summary.totalMs += durationMs
  summaries.set(diagnostic.name, summary)
}

export type InitialDiagnostics = {
  readonly startedAt: number
  readonly events: readonly BufferedDiagnostic[]
  readonly summaries: ReadonlyMap<string, Readonly<DiagnosticSummary>>
  readonly droppedEvents: number
}

export function createDiagnosticBuffer() {
  const startedAt = performance.now()
  const events = createTraceBuffer<BufferedDiagnostic>(MAX_TRACE_EVENTS)
  const summaries = new Map<string, DiagnosticSummary>()
  const sink = {
    enabled: true,
    record(diagnostic: EditorPerformanceDiagnostic) {
      if (!sink.enabled) return
      addDiagnosticSummary(summaries, diagnostic)
      events.push({ at: diagnostic.timestampMs ?? performance.now(), diagnostic })
    },
  }
  return {
    sink,
    snapshot(): InitialDiagnostics {
      return {
        startedAt,
        events: events.values(),
        summaries: new Map(Array.from(summaries, ([name, summary]) => [name, { ...summary }])),
        droppedEvents: events.droppedCount(),
      }
    },
    stop() {
      sink.enabled = false
      events.clear()
      summaries.clear()
    },
  }
}
