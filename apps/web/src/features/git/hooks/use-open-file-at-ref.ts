import { useNavigation } from '@/hooks/use-navigation'
import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'

export function useOpenFileAtRef() {
  const navigation = useNavigation()
  const owner = useEditorWorkspaceStoreApi()
  return async (path: string, ref: string) =>
    (await navigation.openFileAtRef({ owner, path, ref })).status === 'applied'
}
