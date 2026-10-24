import type { EditorPerformanceDiagnostic } from '../src/editor/performanceDiagnostics'

export type SourceReadCounters = {
  sourceIndexBytesRead: number
  sourceIndexBuilds: number
  sourceIndexRetainedBytes: number
  sourceBytesRead: number
  fullTextReads: number
  materializedStrings: number
}

export function captureSourceReads(): { readonly counters: SourceReadCounters; dispose(): void } {
  const counters = {
    sourceIndexBytesRead: 0,
    sourceIndexBuilds: 0,
    sourceIndexRetainedBytes: 0,
    sourceBytesRead: 0,
    fullTextReads: 0,
    materializedStrings: 0,
  }
  const key = '__EDITOR_PERFORMANCE_DIAGNOSTICS__'
  const previous: unknown = Reflect.get(globalThis, key)
  Object.assign(globalThis, {
    [key]: (event: EditorPerformanceDiagnostic) => record(counters, event),
  })
  return { counters, dispose: () => Object.assign(globalThis, { [key]: previous }) }
}

function record(counters: SourceReadCounters, event: EditorPerformanceDiagnostic): void {
  if (event.name === 'textSnapshot.sourceIndex') {
    counters.sourceIndexBytesRead += numeric(event, 'sourceBytesRead')
    counters.sourceIndexRetainedBytes += numeric(event, 'retainedIndexBytes')
    counters.sourceIndexBuilds += 1
    return
  }
  if (event.name !== 'textSnapshot.read') return
  counters.sourceBytesRead += numeric(event, 'sourceBytesRead')
  counters.fullTextReads += numeric(event, 'fullTextReads')
  counters.materializedStrings += numeric(event, 'materializedStrings')
}

function numeric(event: EditorPerformanceDiagnostic, name: string): number {
  const value = event.detail?.[name]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new TypeError(`Missing numeric ${event.name}.${name}`)
}

export function counterDelta(
  after: SourceReadCounters,
  before: SourceReadCounters,
): SourceReadCounters {
  return {
    sourceIndexBytesRead: after.sourceIndexBytesRead - before.sourceIndexBytesRead,
    sourceIndexBuilds: after.sourceIndexBuilds - before.sourceIndexBuilds,
    sourceIndexRetainedBytes: after.sourceIndexRetainedBytes - before.sourceIndexRetainedBytes,
    sourceBytesRead: after.sourceBytesRead - before.sourceBytesRead,
    fullTextReads: after.fullTextReads - before.fullTextReads,
    materializedStrings: after.materializedStrings - before.materializedStrings,
  }
}
