import type { QueryClient } from '@tanstack/react-query'
import {
  editorPerformanceRecordingRequested,
  editorPerformanceDisabledFeatures,
  installDisabledFeatureStyles,
  editorPerformanceTraceEnabled,
} from '@/features/editor/state/performance-trace'
import { createDiagnosticBuffer } from '@/features/editor/utils/diagnostic-buffer'
import {
  performanceRecordingMutationOptions,
  type PerformanceRecordingLoader,
} from '@/features/editor/utils/performance-recording-mutation'
import { performanceRecordingLoadError } from '@/features/editor/utils/structured-errors'
import { reportClientError } from '@/lib/client-error-reporting'
import { runMutation } from '@/lib/mutations/run'

export function startEditorPerformanceRecording(
  queryClient: QueryClient,
  load?: PerformanceRecordingLoader,
): Promise<void> {
  if (!editorPerformanceRecordingRequested()) return Promise.resolve()

  installDisabledFeatureStyles(editorPerformanceDisabledFeatures())
  if (!editorPerformanceTraceEnabled(window.location.search)) return Promise.resolve()

  const buffer = createDiagnosticBuffer()
  const host = globalThis as typeof globalThis & {
    __EDITOR_PERFORMANCE_DIAGNOSTICS__?: unknown
  }
  const previousSink = host.__EDITOR_PERFORMANCE_DIAGNOSTICS__
  host.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = buffer.sink

  return runMutation(queryClient, performanceRecordingMutationOptions(queryClient, load), buffer)
    .then(() => undefined)
    .catch((cause: unknown) => {
      const error = performanceRecordingLoadError(cause)
      reportClientError({
        area: 'editor',
        operation: 'editor.performance_recording_load_failed',
        category: 'connectivity',
        message: error.message,
        cause: error,
      })
    })
    .finally(() => {
      if (host.__EDITOR_PERFORMANCE_DIAGNOSTICS__ === buffer.sink)
        host.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = previousSink
      buffer.stop()
    })
}
