import { mutationOptions, type QueryClient } from '@tanstack/react-query'
import { editorMutationKeys } from '@/features/editor/utils/mutation-keys'
import { editorQueryKeys } from '@/features/editor/utils/query-keys'
import type { createDiagnosticBuffer } from '@/features/editor/utils/diagnostic-buffer'

export type PerformanceRecordingLoader = () => Promise<
  typeof import('@/features/editor/state/performance-recording')
>

export function performanceRecordingMutationOptions(
  queryClient: QueryClient,
  load: PerformanceRecordingLoader = () => import('@/features/editor/state/performance-recording'),
) {
  return mutationOptions({
    mutationKey: editorMutationKeys.performanceRecording,
    scope: { id: 'editor.performance-recording' },
    retry: false,
    mutationFn: async (buffer: ReturnType<typeof createDiagnosticBuffer> | undefined) => {
      const recording = await load()
      recording.installEditorPerformanceTraceFromUrl(buffer?.snapshot())
      return recording
    },
    onSuccess: (recording) => {
      queryClient.setQueryData(editorQueryKeys.performanceRecording, recording)
    },
  })
}
