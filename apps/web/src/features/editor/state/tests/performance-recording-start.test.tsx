import { afterEach, vi } from 'vitest'
import { expect, test } from '../../../../../test/fixtures'
import { startEditorPerformanceRecording } from '@/features/editor/state/performance-recording-start'
import { createDiagnosticBuffer, MAX_TRACE_EVENTS } from '@/features/editor/utils/diagnostic-buffer'
import { createResourceQueryClient } from '@/lib/resources/state/query-client'
import { editorQueryKeys } from '@/features/editor/utils/query-keys'

const host = globalThis as typeof globalThis & {
  __EDITOR_PERFORMANCE_DIAGNOSTICS__?: ReturnType<typeof createDiagnosticBuffer>['sink']
  __editorPerfTrace?: {
    stop(): void
    reset(): void
    report(): {
      droppedEvents: number
      truncated: boolean
      durationMs: number
      traceEvents: readonly { at: number; diagnostic?: { name: string } }[]
      topDiagnostics: readonly { name: string; count: number; totalMs: number }[]
    }
  }
}
const originalUrl = window.location.href

afterEach(() => {
  host.__editorPerfTrace?.stop()
  delete host.__editorPerfTrace
  delete host.__EDITOR_PERFORMANCE_DIAGNOSTICS__
  history.replaceState(null, '', originalUrl)
  vi.unstubAllEnvs()
})

function enableRecording() {
  vi.stubEnv('OBSERVABILITY_ENABLED', 'true')
  history.replaceState(null, '', '/?editorPerfTrace=1')
}

test('a held import leaves startup independent and buffers diagnostics until replay', async () => {
  enableRecording()
  const recording = await import('@/features/editor/state/performance-recording')
  const load = Promise.withResolvers<typeof recording>()
  const client = createResourceQueryClient()
  const completed = startEditorPerformanceRecording(client, () => load.promise)
  let settled = false
  void completed.then(() => {
    settled = true
  })
  try {
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(host.__editorPerfTrace).toBeUndefined()
    expect(host.__EDITOR_PERFORMANCE_DIAGNOSTICS__?.enabled).toBe(true)
    const at = performance.now()
    host.__EDITOR_PERFORMANCE_DIAGNOSTICS__?.record({
      name: 'editor.document.attach',
      timestampMs: at,
      durationMs: 2,
    })
    load.resolve(recording)
    await completed
    expect(host.__editorPerfTrace?.report().traceEvents).toContainEqual({
      at,
      kind: 'diagnostic',
      diagnostic: { name: 'editor.document.attach', timestampMs: at, durationMs: 2 },
    })
    expect(host.__editorPerfTrace?.report().topDiagnostics).toContainEqual(
      expect.objectContaining({ name: 'editor.document.attach', count: 1, totalMs: 2 }),
    )
    expect(client.getQueryData(editorQueryKeys.performanceRecording)).toBe(recording)
  } finally {
    load.resolve(recording)
    await completed
    client.clear()
  }
})

test('a rejected import settles independently, clears the buffer, and restores the previous sink', async () => {
  enableRecording()
  const previous = createDiagnosticBuffer().sink
  host.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = previous
  const client = createResourceQueryClient()
  const completed = startEditorPerformanceRecording(client, () =>
    Promise.reject(new TypeError('Controlled import failure')),
  )
  const pending = host.__EDITOR_PERFORMANCE_DIAGNOSTICS__
  await expect(completed).resolves.toBeUndefined()
  expect(pending?.enabled).toBe(false)
  expect(host.__EDITOR_PERFORMANCE_DIAGNOSTICS__).toBe(previous)
  expect(host.__editorPerfTrace).toBeUndefined()
  expect(client.getQueryData(editorQueryKeys.performanceRecording)).toBeUndefined()
  client.clear()
})

test('early diagnostics stay bounded during an indefinitely pending import', () => {
  const buffer = createDiagnosticBuffer()
  for (let index = 0; index < MAX_TRACE_EVENTS + 2; index++)
    buffer.sink.record({ name: `event-${index}`, timestampMs: index })
  expect(buffer.snapshot().events).toHaveLength(MAX_TRACE_EVENTS)
  expect(buffer.snapshot().events[0]?.diagnostic.name).toBe('event-2')
  const snapshot = buffer.snapshot()
  expect(snapshot.droppedEvents).toBe(2)
  expect(snapshot.summaries.get('event-0')).toEqual({ count: 1, maxMs: 0, totalMs: 0 })
  buffer.sink.record({ name: 'event-0', durationMs: 5 })
  expect(snapshot.summaries.get('event-0')?.count).toBe(1)
  expect(buffer.snapshot().summaries.get('event-0')).toEqual({ count: 2, maxMs: 5, totalMs: 5 })
  buffer.stop()
  buffer.sink.record({ name: 'after-stop' })
  expect(buffer.snapshot().events).toHaveLength(0)
  expect(buffer.snapshot().summaries.size).toBe(0)
  expect(buffer.snapshot().droppedEvents).toBe(0)
})

test('overflow through replay preserves complete summaries and discloses raw event loss', async () => {
  enableRecording()
  const recording = await import('@/features/editor/state/performance-recording')
  const load = Promise.withResolvers<typeof recording>()
  const client = createResourceQueryClient()
  const completed = startEditorPerformanceRecording(client, () => load.promise)
  try {
    for (let index = 0; index < MAX_TRACE_EVENTS + 2; index++)
      host.__EDITOR_PERFORMANCE_DIAGNOSTICS__?.record({
        name: 'early',
        timestampMs: index,
        durationMs: index < 2 ? 3 : 1,
      })
    load.resolve(recording)
    await completed
    const report = host.__editorPerfTrace?.report()
    expect(report?.topDiagnostics).toContainEqual(
      expect.objectContaining({
        name: 'early',
        count: 5002,
        totalMs: 5006,
        maxMs: 3,
      }),
    )
    expect(report?.traceEvents).toHaveLength(MAX_TRACE_EVENTS)
    expect(report?.traceEvents[0]?.at).toBe(2)
    expect(report?.droppedEvents).toBe(2)
    expect(report?.truncated).toBe(true)
    host.__EDITOR_PERFORMANCE_DIAGNOSTICS__?.record({ name: 'early', durationMs: 4 })
    expect(host.__editorPerfTrace?.report().topDiagnostics).toContainEqual(
      expect.objectContaining({
        name: 'early',
        count: 5003,
        totalMs: 5010,
        maxMs: 4,
      }),
    )
    expect(host.__editorPerfTrace?.report().droppedEvents).toBe(3)
    host.__editorPerfTrace?.reset()
    expect(host.__editorPerfTrace?.report().topDiagnostics).toEqual([])
    expect(host.__editorPerfTrace?.report().traceEvents).toEqual([])
    expect(host.__editorPerfTrace?.report().droppedEvents).toBe(0)
    expect(host.__editorPerfTrace?.report().truncated).toBe(false)
  } finally {
    load.resolve(recording)
    await completed
    client.clear()
  }
})
