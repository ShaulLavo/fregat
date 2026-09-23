import { useStatus } from '@/features/git/hooks/use-status'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { copyTextToClipboard } from '@/lib/clipboard'
import { toTreePath } from '@/lib/path-formatters'

import { useGitStoreApi } from '@/features/git/state/store'
import { discardRequest } from '@/features/git/utils/discard-prompt'
import type { ChangeRow } from '@/features/git/utils/types'
import { fileMenu } from '../utils/file-menu'
import { useOpenDiffDocument } from './use-open-diff-document'
import { useStagePathMutation } from './use-stage-path-mutation'
import { useUnstagePathMutation } from './use-unstage-path-mutation'

export function useFileMenu(row: ChangeRow, rootPath: string) {
  const confirmed = Boolean(useStatus(rootPath).data)
  const path = filesystemPath(row.file.path)
  const store = useGitStoreApi()
  const stage = useStagePathMutation(path, rootPath)
  const unstage = useUnstagePathMutation(path, rootPath)
  const { openDiff } = useOpenDiffDocument()
  const { selectFile } = useEditorCommands()

  return fileMenu({
    writable: confirmed,
    copyPath: (value, label) => void copyTextToClipboard(value, label),
    discard: () => store.getState().requestDiscard(discardRequest(row.section, [row])),
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
