import type { GitCommitFile } from '@workspace/contracts'
import { useNavigation } from '@/hooks/use-navigation'
import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { documentTab } from '@/lib/documents/utils/tabs'

export function useOpenHistoricalDiff() {
  const navigation = useNavigation()
  const owner = useEditorWorkspaceStoreApi()
  return (file: GitCommitFile) =>
    navigation.openContent({
      owner,
      content: documentTab({
        kind: 'git-diff',
        source: {
          kind: 'snapshot',
          source: 'historical',
          path: filesystemPath(file.path),
          oldPath: file.oldPath ? filesystemPath(file.oldPath) : undefined,
          oldObjectId: file.oldObjectId,
          newObjectId: file.newObjectId,
          status: file.status,
        },
      }),
    })
}
