import { mutationOptions, type QueryClient } from '@tanstack/react-query'
import { editorMutationKeys } from '@/features/editor/utils/mutation-keys'
import { editorQueryKeys } from '@/features/editor/utils/query-keys'

export function performanceRecordingMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationKey: editorMutationKeys.performanceRecording,
    scope: { id: 'editor.performance-recording' },
    mutationFn: async () => {
      const recording = await import('@/features/editor/state/performance-recording')
      recording.installEditorPerformanceTraceFromUrl()
      return recording
    },
    onSuccess: (recording) => {
      queryClient.setQueryData(editorQueryKeys.performanceRecording, recording)
    },
  })
}
