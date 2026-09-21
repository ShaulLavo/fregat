import { useStatus } from '@/features/git/hooks/use-status'
import type { ChangeRow, PanelSection } from '@/features/git/utils/types'
import { groupMenu } from '../utils/group-menu'
import { useDiscardPathsMutation } from './use-discard-paths-mutation'
import { useDiscardStagedPathsMutation } from './use-discard-staged-paths-mutation'
import { useOpenDiffDocument } from './use-open-diff-document'
import { useStagePathsMutation } from './use-stage-paths-mutation'
import { useUnstagePathsMutation } from './use-unstage-paths-mutation'

export function useGroupMenu(rows: readonly ChangeRow[], section: PanelSection, rootPath: string) {
  const confirmed = Boolean(useStatus(rootPath).data)
  const paths = rows.map((row) => row.file.path)
  const staged = section === 'staged'
  const discard = useDiscardPathsMutation(paths, rootPath)
  const discardStaged = useDiscardStagedPathsMutation(paths, rootPath)
  const stage = useStagePathsMutation(paths, rootPath)
  const unstage = useUnstagePathsMutation(paths, rootPath)
  const { openDiffs } = useOpenDiffDocument()

  function runDiscardAll() {
    if (staged) {
      discardStaged.mutate()
      return
    }

    discard.mutate()
  }

  return groupMenu({
    writable: confirmed,
    discardAll: runDiscardAll,
    openAllDiffs: () => void openDiffs(rows),
    section,
    stageAll: () => stage.mutate(),
    unstageAll: () => unstage.mutate(),
  })
}
