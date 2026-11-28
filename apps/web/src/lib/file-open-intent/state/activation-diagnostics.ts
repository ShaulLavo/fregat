import { isRecord } from '@workspace/utils/objects'
import type { FilesystemPath } from '@/lib/documents/utils/types'

type PostActivationWorkCounters = {
  readonly bufferBuilds: number
  readonly fileReads: number
  readonly highlighterSessionCreations: number
  readonly lineIndexScans: number
  readonly structuralSessionCreations: number
  readonly workerOpenRequests: number
  readonly workerParseRequests: number
  readonly workerQueryRequests: number
  readonly workerRefreshRequests: number
}

export type PostActivationWorkSnapshot = PostActivationWorkCounters & {
  readonly diagnosticsObserved: boolean
}

export function postActivationWorkSince(
  baseline: PostActivationWorkSnapshot | null,
  path: FilesystemPath,
): PostActivationWorkSnapshot {
  const current = postActivationWorkSnapshot(path)
  if (!baseline) return current

  return {
    bufferBuilds: counterDelta(current.bufferBuilds, baseline.bufferBuilds),
    diagnosticsObserved: current.diagnosticsObserved && baseline.diagnosticsObserved,
    fileReads: counterDelta(current.fileReads, baseline.fileReads),
    highlighterSessionCreations: counterDelta(
      current.highlighterSessionCreations,
      baseline.highlighterSessionCreations,
    ),
    lineIndexScans: counterDelta(current.lineIndexScans, baseline.lineIndexScans),
    structuralSessionCreations: counterDelta(
      current.structuralSessionCreations,
      baseline.structuralSessionCreations,
    ),
    workerOpenRequests: counterDelta(current.workerOpenRequests, baseline.workerOpenRequests),
    workerParseRequests: counterDelta(current.workerParseRequests, baseline.workerParseRequests),
    workerQueryRequests: counterDelta(current.workerQueryRequests, baseline.workerQueryRequests),
    workerRefreshRequests: counterDelta(
      current.workerRefreshRequests,
      baseline.workerRefreshRequests,
    ),
  }
}

export function postActivationWorkSnapshot(path: FilesystemPath): PostActivationWorkSnapshot {
  const diagnostics = editorTraceDiagnostics()
  return {
    bufferBuilds: pathPerformanceMarkCount('editor.file_open.buffer_built', path),
    diagnosticsObserved: diagnostics.observed,
    fileReads: pathPerformanceMarkCount('editor.file_open.file_read', path),
    highlighterSessionCreations: diagnosticCount(
      diagnostics.entries,
      'editor.syntax.session_created',
      'highlighter',
    ),
    lineIndexScans: diagnosticCount(diagnostics.entries, 'editor.line_starts.scan'),
    structuralSessionCreations: diagnosticCount(
      diagnostics.entries,
      'editor.syntax.session_created',
      'structural',
    ),
    workerOpenRequests: workerPerformanceMarkCount('open'),
    workerParseRequests: workerPerformanceMarkCount('parse'),
    workerQueryRequests: workerPerformanceMarkCount('queryRange'),
    workerRefreshRequests: workerPerformanceMarkCount('edit'),
  }
}

function counterDelta(current: number, baseline: number): number {
  return Math.max(0, current - baseline)
}

function pathPerformanceMarkCount(name: string, path: FilesystemPath): number {
  return performanceMarks(name).filter((entry) => entry.detail?.path === path).length
}

function workerPerformanceMarkCount(type: string): number {
  return performanceMarks('editor.worker.request').filter(
    (entry) =>
      entry.detail?.type === type &&
      entry.detail.type !== 'idleFence' &&
      entry.detail.type !== 'runtimeBarrier',
  ).length
}

function performanceMarks(name: string): readonly PerformanceMark[] {
  const entries = globalThis.performance?.getEntriesByName(name, 'mark') ?? []
  return entries.filter((entry): entry is PerformanceMark => entry.entryType === 'mark')
}

type TraceDiagnosticEntry = {
  readonly detail?: Readonly<Record<string, unknown>>
  readonly name: string
}

function editorTraceDiagnostics(): {
  readonly entries: readonly TraceDiagnosticEntry[]
  readonly observed: boolean
} {
  const trace = (
    globalThis as typeof globalThis & {
      readonly __editorPerfTrace?: { readonly report?: () => unknown }
    }
  ).__editorPerfTrace
  if (!trace?.report) return { entries: [], observed: false }

  try {
    return { entries: traceDiagnosticEntries(trace.report()), observed: true }
  } catch {
    return { entries: [], observed: false }
  }
}

function traceDiagnosticEntries(report: unknown): readonly TraceDiagnosticEntry[] {
  if (!isRecord(report) || !Array.isArray(report.traceEvents)) return []

  const entries: TraceDiagnosticEntry[] = []
  for (const event of report.traceEvents) {
    if (!isRecord(event) || event.kind !== 'diagnostic') continue
    if (!isRecord(event.diagnostic) || typeof event.diagnostic.name !== 'string') continue

    entries.push({
      detail: isRecord(event.diagnostic.detail) ? event.diagnostic.detail : undefined,
      name: event.diagnostic.name,
    })
  }
  return entries
}

function diagnosticCount(
  entries: readonly TraceDiagnosticEntry[],
  name: string,
  family?: string,
): number {
  return entries.filter(
    (entry) => entry.name === name && (!family || entry.detail?.family === family),
  ).length
}
