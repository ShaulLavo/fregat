import { useStatus } from '@/features/git/hooks/use-status'
import { useGitStoreApi } from '@/features/git/state/store'
import { discardRequest } from '@/features/git/utils/discard-prompt'
import type { ChangeRow, PanelSection } from '@/features/git/utils/types'
import { groupMenu } from '../utils/group-menu'
import { useOpenDiffDocument } from './use-open-diff-document'
import { useStagePathsMutation } from './use-stage-paths-mutation'
import { useUnstagePathsMutation } from './use-unstage-paths-mutation'

export function useGroupMenu(rows: readonly ChangeRow[], section: PanelSection, rootPath: string) {
  const confirmed = Boolean(useStatus(rootPath).data)
  const paths = rows.map((row) => row.file.path)
  const store = useGitStoreApi()
  const stage = useStagePathsMutation(paths, rootPath)
  const unstage = useUnstagePathsMutation(paths, rootPath)
  const { openDiffs } = useOpenDiffDocument()

  return groupMenu({
    writable: confirmed,
    discardAll: () => store.getState().requestDiscard(discardRequest(section, rows)),
    openAllDiffs: () => void openDiffs(rows),
    section,
    stageAll: () => stage.mutate(),
    unstageAll: () => unstage.mutate(),
  })
}
