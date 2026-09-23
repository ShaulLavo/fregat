import { useLayoutEffect } from 'react'
import type { EditorRuntime } from '@/features/editor/state/runtime'
import { watchFileAvailability } from '@/features/editor/state/file-availability'
import { useNavigation } from '@/hooks/use-navigation'

export function useFileAvailability(runtime: EditorRuntime) {
  const navigation = useNavigation()
  useLayoutEffect(() => {
    const commands = navigation.editorCommands(runtime.workspaceStore)
    return watchFileAvailability({
      documentStore: runtime.documentStore,
      workspaceStore: runtime.workspaceStore,
      queryClient: runtime.queryClient,
      forgetFile: (document) => {
        void commands.discardLiveEditorDocument(document).settled
      },
    })
  }, [navigation, runtime])
}
