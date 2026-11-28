import { useNavigation } from '@/hooks/use-navigation'
import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { historicalDocument, type HistoricalDiffOpen } from '@/lib/documents/utils/comparisons'
import { documentTab } from '@/lib/documents/utils/tabs'

export function useOpenHistoricalDiff() {
  const navigation = useNavigation()
  const owner = useEditorWorkspaceStoreApi()
  return (input: HistoricalDiffOpen) => {
    if (owner.getState().rootFolder?.path !== input.rootPath)
      return Promise.resolve({ status: 'superseded' } as const)
    const document = historicalDocument(input)
    if (!document) return Promise.resolve({ status: 'superseded' } as const)
    return navigation.openContent({ owner, content: documentTab(document) })
  }
}
