import { filesystemPath } from '@/lib/documents/utils/identity'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { copyTextToClipboard } from '@/lib/clipboard'
import { toTreePath } from '@/lib/path-formatters'

import type { ChangeRow } from '@/features/git/utils/types'
import { fileMenu } from '../utils/file-menu'
import { useDiscardPathMutation } from './use-discard-path-mutation'
import { useDiscardStagedPathsMutation } from './use-discard-staged-paths-mutation'
import { useOpenDiffDocument } from './use-open-diff-document'
import { useStagePathMutation } from './use-stage-path-mutation'
import { useUnstagePathMutation } from './use-unstage-path-mutation'

export function useFileMenu(row: ChangeRow, rootPath: string) {
  const path = filesystemPath(row.file.path)
  const staged = row.section === 'staged'
  const discard = useDiscardPathMutation(path)
  const discardStaged = useDiscardStagedPathsMutation([path])
  const stage = useStagePathMutation(path)
  const unstage = useUnstagePathMutation(path)
  const { openDiff } = useOpenDiffDocument()
  const { selectFile } = useEditorCommands()

  function runDiscard() {
    if (staged) {
      discardStaged.mutate()
      return
    }

    discard.mutate()
  }

  return fileMenu({
    copyPath: (value, label) => void copyTextToClipboard(value, label),
    discard: runDiscard,
    onDisk: row.status !== 'deleted',
    openDiff: () => void openDiff(row),
    openFile: () => selectFile(path),
    path,
    relativePath: toTreePath(path, rootPath),
    section: row.section,
    stage: () => stage.mutate(),
    unstage: () => unstage.mutate(),
  })
}
