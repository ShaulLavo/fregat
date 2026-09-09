// @vitest-environment happy-dom

import { afterEach, vi } from 'vitest'

import {
  installEditorPerformanceTraceFromUrl,
  registerEditorOpenBenchmarkControl,
  type EditorOpenSampleResetResult,
} from '@/features/editor/state/performance-trace'
import { expect, test } from '../../../../../test/fixtures'

type TraceHandle = {
  beginEditorOpenSample(request: { readonly path: string; readonly rootPath: string }): {
    readonly sampleId: string
  }
  primeEditorOpenQuery(request: {
    readonly path: string
    readonly rootPath: string
  }): Promise<{ readonly ready: true }>
  resetEditorOpenSample(request: {
    readonly path: string
    readonly rootPath: string
    readonly sampleId: string
  }): Promise<EditorOpenSampleResetResult>
  report(): {
    readonly traceEvents: readonly {
      readonly at: number
      readonly durationMs?: number
      readonly kind: string
      readonly name?: string
    }[]
  }
  reset(): void
  stop(): void
}

const originalUrl = window.location.href

afterEach(() => {
  traceHandle()?.stop()
  delete (globalThis as typeof globalThis & { __editorPerfTrace?: TraceHandle }).__editorPerfTrace
  history.replaceState(null, '', originalUrl)
  vi.unstubAllGlobals()
})

test('report drains long tasks that overlap the activation boundary', () => {
  let records: PerformanceEntry[] = []
  class TestPerformanceObserver {
    constructor(_callback: PerformanceObserverCallback) {}

    disconnect(): void {}
    observe(): void {}
    takeRecords(): PerformanceEntryList {
      const current = records
      records = []
      return current
    }
  }
  vi.stubGlobal('PerformanceObserver', TestPerformanceObserver)
  history.replaceState(null, '', '/?editorPerfTrace=1')
  installEditorPerformanceTraceFromUrl()
  const handle = traceHandle()
  handle?.reset()
  const reportAt = performance.now()
  records = [
    performanceEntry(reportAt - 10, 20, 'activation-task'),
    performanceEntry(reportAt - 20, 5, 'pre-activation-task'),
  ]

  expect(handle?.report().traceEvents).toEqual([
    expect.objectContaining({
      durationMs: 20,
      kind: 'long-task',
      name: 'activation-task',
    }),
  ])
})

test('trace-only bridge forwards opaque sample controls and unregisters ownership', async () => {
  const begin = vi.fn()
  const prime = vi.fn(async () => ({ ready: true as const }))
  const resetResult: EditorOpenSampleResetResult = {
    evictions: 0,
    nonTargetIntents: 0,
    preparedClaims: 1,
    promotedBytes: 20,
    highlighterRuntimeSessionIds: ['shiki:1'],
    quiescent: true,
    structuralRuntimeSessionIds: ['tree:1'],
    targetIntents: 1,
    transferredHighlighterRuntimeSessionIds: ['shiki:1'],
    transferredStructuralRuntimeSessionIds: ['tree:1'],
    wastedIntents: 0,
  }
  const reset = vi.fn(async () => resetResult)
  const unregister = registerEditorOpenBenchmarkControl({ begin, prime, reset })
  history.replaceState(null, '', '/?editorPerfTrace=1')
  installEditorPerformanceTraceFromUrl()
  const handle = traceHandle()
  const target = { path: '/repo/a.ts', rootPath: '/repo' }

  const sample = handle?.beginEditorOpenSample(target)
  expect(sample?.sampleId).toEqual(expect.any(String))
  expect(begin).toHaveBeenCalledWith({ ...target, sampleId: sample?.sampleId })
  await expect(handle?.primeEditorOpenQuery(target)).resolves.toEqual({ ready: true })
  await expect(
    handle?.resetEditorOpenSample({ ...target, sampleId: sample?.sampleId ?? '' }),
  ).resolves.toEqual(resetResult)

  unregister()
  expect(() => handle?.beginEditorOpenSample(target)).toThrow(
    'Editor-open benchmark control is unavailable',
  )
})

test('benchmark control registration rejects concurrent owners', () => {
  const control = {
    begin: vi.fn(),
    prime: vi.fn(async () => ({ ready: true as const })),
    reset: vi.fn(async () => ({
      evictions: 0,
      nonTargetIntents: 0,
      preparedClaims: 0,
      promotedBytes: 0,
      highlighterRuntimeSessionIds: [],
      quiescent: true as const,
      structuralRuntimeSessionIds: [],
      targetIntents: 0,
      transferredHighlighterRuntimeSessionIds: [],
      transferredStructuralRuntimeSessionIds: [],
      wastedIntents: 0,
    })),
  }
  const unregister = registerEditorOpenBenchmarkControl(control)

  expect(() => registerEditorOpenBenchmarkControl({ ...control })).toThrow(
    'Editor-open benchmark control is already registered',
  )
  unregister()
})

function traceHandle(): TraceHandle | undefined {
  return (globalThis as typeof globalThis & { __editorPerfTrace?: TraceHandle }).__editorPerfTrace
}

function performanceEntry(startTime: number, duration: number, name: string): PerformanceEntry {
  return {
    duration,
    entryType: 'longtask',
    name,
    startTime,
    toJSON: () => ({}),
  }
}
