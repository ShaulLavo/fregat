import { reportClientError } from '@/lib/client-error-reporting'
type FlushMeasurement = {
  callbacks: number
  writes: number
  serializedBytes: number
  writtenBytes: number
  writeMs: number
}
const callbacks = new Set<() => void>()
let measurement: FlushMeasurement | null = null

export function addLifecycleFlush(flush: () => void) {
  if (typeof window === 'undefined') return noop
  if (callbacks.size === 0) {
    window.addEventListener('pagehide', flushAll)
    document.addEventListener('visibilitychange', flushHiddenDocument)
  }
  callbacks.add(flush)
  return () => {
    callbacks.delete(flush)
    if (callbacks.size !== 0) return
    window.removeEventListener('pagehide', flushAll)
    document.removeEventListener('visibilitychange', flushHiddenDocument)
  }
}

export function recordLifecycleWrite(start: number, bytes: number | null, written: boolean) {
  if (!measurement) return
  measurement.writes += 1
  measurement.serializedBytes += bytes ?? 0
  if (written) measurement.writtenBytes += bytes ?? 0
  measurement.writeMs += performance.now() - start
}

function flushHiddenDocument() {
  if (document.visibilityState === 'hidden') flushAll()
}

function flushAll() {
  const start = performance.now()
  measurement = { callbacks: 0, writes: 0, serializedBytes: 0, writtenBytes: 0, writeMs: 0 }
  try {
    for (const flush of callbacks) {
      measurement.callbacks += 1
      flushOne(flush)
    }
  } finally {
    const detail = { ...measurement, durationMs: performance.now() - start }
    measurement = null
    performance.clearMeasures('workspace.reload.flush')
    performance.measure('workspace.reload.flush', { start, detail })
  }
}

function flushOne(flush: () => void) {
  try {
    flush()
  } catch (cause) {
    reportClientError({
      area: 'workspace-cache',
      operation: 'cache.flush',
      message: 'Local view state could not be saved.',
      cause,
    })
  }
}

function noop() {}
