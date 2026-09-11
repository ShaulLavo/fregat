import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigation } from '@/hooks/use-navigation'
import {
  useEditorWorkspaceState,
  useEditorWorkspaceStoreApi,
} from '@/features/editor/state/workspace-state'
import { watchRootValidation } from '@/features/workspace/state/root-validation'

export function useValidateRootFolder() {
  const queryClient = useQueryClient()
  const store = useEditorWorkspaceStoreApi()
  const navigation = useNavigation()
  const path = useEditorWorkspaceState((state) => state.rootFolder?.path ?? null)

  useEffect(() => {
    if (path === null) return
    return watchRootValidation({ navigation, path, queryClient, store })
  }, [navigation, path, queryClient, store])
}
