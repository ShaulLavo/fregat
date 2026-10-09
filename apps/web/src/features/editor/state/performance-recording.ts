import {
  MAX_TRACE_EVENTS,
  type EditorPerformanceDiagnostic,
  type InitialDiagnostics,
} from '@/features/editor/utils/diagnostic-buffer'
import { clientLoggingEnabled } from '@/lib/client-logging'
import { createTraceBuffer } from '@/features/editor/utils/trace-buffer'
import { roundMs as round } from '@workspace/utils/timing'
import {
  editorPerformanceDisabledFeatures,
  installDisabledFeatureStyles,
  editorPerformanceLayoutVariant,
  editorPerformanceTraceEnabled,
  requireEditorOpenBenchmarkControl,
  type EditorPerformanceLayoutVariant,
  type EditorOpenSampleResetRequest,
  type EditorOpenSampleTarget,
  type EditorOpenSampleResetResult,
} from '@/features/editor/state/performance-trace'

type EditorPerformanceDiagnosticSink = {
  enabled: boolean
  record(diagnostic: EditorPerformanceDiagnostic): void
}

type EditorPerformanceTraceEvent =
  | {
      readonly kind: 'diagnostic'
      readonly at: number
      readonly diagnostic: EditorPerformanceDiagnostic
    }
  | {
      readonly kind: 'long-task'
      readonly at: number
      readonly durationMs: number
      readonly name: string
    }

type EditorPerformanceTraceReport = {
  readonly durationMs: number
  readonly disabledFeatures: readonly string[]
  readonly dom: Readonly<Record<string, number>>
  readonly events: Readonly<Record<string, number>>
  readonly frameStats: Readonly<Record<string, number>>
  readonly layoutVariant: EditorPerformanceLayoutVariant
  readonly topDiagnostics: readonly EditorPerformanceTraceSummary[]
  readonly topTargets: readonly EditorPerformanceTraceTargetSummary[]
  readonly traceEvents: readonly EditorPerformanceTraceEvent[]
  readonly url: string
  readonly userAgent: string
}

type EditorPerformanceTraceSummary = {
  readonly count: number
  readonly maxMs: number
  readonly meanMs: number
  readonly name: string
  readonly totalMs: number
}

type EditorPerformanceTraceTargetSummary = {
  readonly count: number
  readonly target: string
  readonly type: string
}

type EditorPerformanceTraceHandle = {
  beginEditorOpenSample(request: EditorOpenSampleTarget): { readonly sampleId: string }
  download(): EditorPerformanceTraceReport
  mark(name: string, detail?: Readonly<Record<string, unknown>>): void
  print(): EditorPerformanceTraceReport
  primeEditorOpenQuery(request: EditorOpenSampleTarget): Promise<{ readonly ready: true }>
  report(): EditorPerformanceTraceReport
  reset(): void
  resetEditorOpenSample(request: EditorOpenSampleResetRequest): Promise<EditorOpenSampleResetResult>
  stop(): void
}

type EditorPerformanceTraceGlobal = typeof globalThis & {
  __EDITOR_PERFORMANCE_DIAGNOSTICS__?: EditorPerformanceDiagnosticSink | null
  __editorPerfTrace?: EditorPerformanceTraceHandle
}

const SLOW_FRAME_MS = 16.7
const LONG_FRAME_MS = 50

export function installEditorPerformanceTraceFromUrl(initial?: InitialDiagnostics): void {
  if (typeof window === 'undefined' || !clientLoggingEnabled()) return

  editorPerformanceTraceGlobal().__editorPerfTrace?.stop()
  installDisabledFeatureStyles(editorPerformanceDisabledFeatures())
  if (!editorPerformanceTraceEnabled(window.location.search)) return

  const trace = createEditorPerformanceTrace(initial)
  editorPerformanceTraceGlobal().__EDITOR_PERFORMANCE_DIAGNOSTICS__ = trace.sink
  editorPerformanceTraceGlobal().__editorPerfTrace = trace.handle

  console.info(
    '[editor-perf] trace enabled. Use window.__editorPerfTrace.print() or .download() after scrolling.',
  )
}

function createEditorPerformanceTrace(initial?: InitialDiagnostics): {
  readonly handle: EditorPerformanceTraceHandle
  readonly sink: EditorPerformanceDiagnosticSink
} {
  let stopped = false
  let frame = 0
  let lastFrameTime = performance.now()
  const traceEvents = createTraceBuffer<EditorPerformanceTraceEvent>(MAX_TRACE_EVENTS)
  const diagnosticSummaries = new Map<string, { count: number; maxMs: number; totalMs: number }>()
  let frames = emptyFrameStats()
  let startedAt = initial?.startedAt ?? performance.now()
  const eventCounts = new Map<string, number>()
  const targetCounts = new Map<string, number>()
  const recordLongTask = (entry: PerformanceEntry) => {
    if (!stopped) traceEvents.push(longTaskTraceEvent(entry))
  }
  const observer = createLongTaskObserver(recordLongTask)

  const sink: EditorPerformanceDiagnosticSink = {
    enabled: true,
    record: (diagnostic) => {
      if (stopped) return

      const durationMs = diagnostic.durationMs ?? 0
      const summary = diagnosticSummaries.get(diagnostic.name) ?? {
        count: 0,
        maxMs: 0,
        totalMs: 0,
      }
      summary.count += 1
      summary.maxMs = Math.max(summary.maxMs, durationMs)
      summary.totalMs += durationMs
      diagnosticSummaries.set(diagnostic.name, summary)
      traceEvents.push({
        at: diagnostic.timestampMs ?? performance.now(),
        diagnostic,
        kind: 'diagnostic',
      })
    },
  }

  for (const event of initial?.events ?? [])
    sink.record({ ...event.diagnostic, timestampMs: event.at })

  const recordInputEvent = (event: Event) => {
    if (stopped) return

    increment(eventCounts, event.type)
    increment(targetCounts, `${event.type}:${targetLabel(event.target)}`)
  }

  window.addEventListener('scroll', recordInputEvent, { capture: true, passive: true })
  window.addEventListener('wheel', recordInputEvent, { capture: true, passive: true })

  const tick = (now: number) => {
    if (stopped) return

    const duration = now - lastFrameTime
    lastFrameTime = now
    frames.count += 1
    frames.totalMs += duration
    frames.maxMs = Math.max(frames.maxMs, duration)
    if (duration >= SLOW_FRAME_MS) frames.slowFrames += 1
    if (duration >= LONG_FRAME_MS) frames.longFrames += 1
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
  const onVisibilityChange = () => {
    cancelAnimationFrame(frame)
    if (stopped || document.hidden) return
    lastFrameTime = performance.now()
    frame = requestAnimationFrame(tick)
  }
  document.addEventListener('visibilitychange', onVisibilityChange)

  const handle: EditorPerformanceTraceHandle = {
    beginEditorOpenSample: (request) => {
      performance.clearMarks('editor.file_open_intent.detected')
      const sampleId = crypto.randomUUID()
      requireEditorOpenBenchmarkControl().begin({ ...request, sampleId })
      return { sampleId }
    },
    download: () => {
      const report = createReport()
      downloadJson(report)
      return report
    },
    mark: (name, detail) => {
      sink.record({ detail, name })
    },
    print: () => {
      const report = createReport()
      console.table(report.topDiagnostics)
      console.table(report.topTargets)
      console.info('[editor-perf] report', report)
      return report
    },
    primeEditorOpenQuery: (request) => requireEditorOpenBenchmarkControl().prime(request),
    report: () => createReport(),
    reset: () => {
      observer?.takeRecords()
      traceEvents.clear()
      diagnosticSummaries.clear()
      frames = emptyFrameStats()
      eventCounts.clear()
      targetCounts.clear()
      startedAt = performance.now()
      lastFrameTime = startedAt
    },
    resetEditorOpenSample: (request) => requireEditorOpenBenchmarkControl().reset(request),
    stop: () => {
      if (stopped) return

      stopped = true
      sink.enabled = false
      document.removeEventListener('visibilitychange', onVisibilityChange)
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', recordInputEvent, { capture: true })
      window.removeEventListener('wheel', recordInputEvent, { capture: true })
      observer?.disconnect()
    },
  }

  function createReport(): EditorPerformanceTraceReport {
    for (const entry of observer?.takeRecords() ?? []) recordLongTask(entry)

    const currentTraceEvents = traceEvents
      .values()
      .filter((event) => event.kind !== 'long-task' || event.at + event.durationMs >= startedAt)
    return {
      disabledFeatures: Array.from(editorPerformanceDisabledFeatures()),
      dom: editorPerformanceDomSnapshot(document),
      durationMs: performance.now() - startedAt,
      events: Object.fromEntries(eventCounts),
      frameStats: {
        count: frames.count,
        longFrames: frames.longFrames,
        maxMs: round(frames.maxMs),
        meanMs: round(frames.totalMs / Math.max(1, frames.count)),
        slowFrames: frames.slowFrames,
      },
      layoutVariant: editorPerformanceLayoutVariant(),
      topDiagnostics: summarizeDiagnostics(diagnosticSummaries),
      topTargets: summarizeTargets(targetCounts),
      traceEvents: currentTraceEvents,
      url: location.href,
      userAgent: navigator.userAgent,
    }
  }

  return { handle, sink }
}

function createLongTaskObserver(
  record: (entry: PerformanceEntry) => void,
): PerformanceObserver | null {
  if (!('PerformanceObserver' in window)) return null

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) record(entry)
    })
    observer.observe({ entryTypes: ['longtask'] })
    return observer
  } catch {
    return null
  }
}

function longTaskTraceEvent(entry: PerformanceEntry): EditorPerformanceTraceEvent {
  return {
    at: entry.startTime,
    durationMs: entry.duration,
    kind: 'long-task',
    name: entry.name,
  }
}

function summarizeDiagnostics(
  summaries: ReadonlyMap<
    string,
    { readonly count: number; readonly maxMs: number; readonly totalMs: number }
  >,
): readonly EditorPerformanceTraceSummary[] {
  return Array.from(summaries, ([name, summary]) => ({
    count: summary.count,
    maxMs: round(summary.maxMs),
    meanMs: round(summary.totalMs / Math.max(1, summary.count)),
    name,
    totalMs: round(summary.totalMs),
  })).sort((left, right) => right.totalMs - left.totalMs)
}

function summarizeTargets(
  targetCounts: ReadonlyMap<string, number>,
): readonly EditorPerformanceTraceTargetSummary[] {
  return Array.from(targetCounts, ([key, count]) => {
    const separator = key.indexOf(':')
    return {
      count,
      target: key.slice(separator + 1),
      type: key.slice(0, separator),
    }
  })
    .sort((left, right) => right.count - left.count)
    .slice(0, 20)
}

function emptyFrameStats() {
  return { count: 0, totalMs: 0, maxMs: 0, longFrames: 0, slowFrames: 0 }
}

export function editorPerformanceDomSnapshot(document: Document): Readonly<Record<string, number>> {
  const highlights = cssHighlightSnapshot(document)
  const editorRows = liveEditorElements(document, '.editor-virtualized-row')

  return {
    cssHighlightGroups: highlights.groups,
    cssHighlightRanges: highlights.ranges,
    cssHighlightRules: cssHighlightRuleCount(document),
    editorRowTextCharacters: editorRowTextCharacters(editorRows),
    editorRows: editorRows.length,
    editorScrollers: liveEditorElements(document, '.editor-virtualized').length,
    minimapCanvases: document.querySelectorAll('.editor-minimap-canvas').length,
    minimaps: document.querySelectorAll('.editor-minimap').length,
    scopeLines: document.querySelectorAll('.editor-scope-line').length,
  }
}

function cssHighlightSnapshot(document: Document): {
  readonly groups: number
  readonly ranges: number
} {
  const registry = document.defaultView?.CSS?.highlights
  if (!registry) return { groups: 0, ranges: 0 }

  let groups = 0
  let ranges = 0
  for (const [, highlight] of registry) {
    groups += 1
    ranges += highlight.size
  }

  return { groups, ranges }
}

function cssHighlightRuleCount(document: Document): number {
  return Array.from(document.querySelectorAll('style')).reduce(
    (count, style) => count + (style.textContent?.match(/::highlight\(/g)?.length ?? 0),
    0,
  )
}

function editorRowTextCharacters(rows: readonly Element[]): number {
  return rows.reduce((count, row) => count + (row.textContent?.length ?? 0), 0)
}

function liveEditorElements(document: Document, selector: string): Element[] {
  return Array.from(document.querySelectorAll(selector))
}

function targetLabel(target: EventTarget | null): string {
  if (!(target instanceof Element)) return 'unknown'

  const classes = Array.from(target.classList).slice(0, 3).join('.')
  if (target.id) return `${target.tagName.toLowerCase()}#${target.id}`
  if (classes) return `${target.tagName.toLowerCase()}.${classes}`
  return target.tagName.toLowerCase()
}

function increment(map: Map<string, number>, key: string): void {
  const retainedKey = map.has(key) || map.size < 100 ? key : 'other'
  map.set(retainedKey, (map.get(retainedKey) ?? 0) + 1)
}

function downloadJson(report: EditorPerformanceTraceReport): void {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
  const link = document.createElement('a')
  link.download = `editor-perf-trace-${Date.now()}.json`
  link.href = URL.createObjectURL(blob)
  link.click()
  URL.revokeObjectURL(link.href)
}

function editorPerformanceTraceGlobal(): EditorPerformanceTraceGlobal {
  return globalThis as EditorPerformanceTraceGlobal
}
