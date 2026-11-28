import { filesystemPath } from '@/lib/documents/utils/identity'
import { useNavigation } from '@/hooks/use-navigation'
import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'

export function useOpenFileAtRef() {
  const navigation = useNavigation()
  const owner = useEditorWorkspaceStoreApi()
  return async (path: string, ref: string) =>
    (await navigation.openFileAtRef({ owner, path: filesystemPath(path), ref })).status ===
    'applied'
}
