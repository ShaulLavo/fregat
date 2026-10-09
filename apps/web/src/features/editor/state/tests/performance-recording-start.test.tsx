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
    report(): {
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
  buffer.stop()
  buffer.sink.record({ name: 'after-stop' })
  expect(buffer.snapshot().events).toHaveLength(0)
})
