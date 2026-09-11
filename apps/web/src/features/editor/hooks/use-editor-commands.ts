import { useMemo } from 'react'
import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { useNavigation } from '@/hooks/use-navigation'

export function useEditorCommands() {
  const navigation = useNavigation()
  const owner = useEditorWorkspaceStoreApi()
  // Effects retain command handlers across renders and asynchronous resource work.
  return useMemo(() => navigation.editorCommands(owner), [navigation, owner])
}
