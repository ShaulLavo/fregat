import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { useDiscardPathsMutation } from '@/features/git/hooks/use-discard-paths-mutation'
import { useStagePathsMutation } from '@/features/git/hooks/use-stage-paths-mutation'
import { useStatus } from '@/features/git/hooks/use-status'
import { useUnstagePathsMutation } from '@/features/git/hooks/use-unstage-paths-mutation'
import type { TreeFsActions } from '@/features/workspace/hooks/use-fs-actions'
import { containerTreePath, entryName } from '@/features/workspace/utils/entry-paths'
import { rowGitActions, treeRowMenu } from '@/features/workspace/utils/row-menu'
import type { Menu } from '@/keymap/menus/utils/model'
import { copyTextToClipboard } from '@/lib/clipboard'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { canonicalTreePath } from '@/lib/path-formatters'
import { entryForTreePath, type TreeModel } from '@/lib/tree-model'

export type TreeContextMenuItem = {
  readonly kind: 'directory' | 'file'
  readonly path: string
}

export function useRowMenu({
  actions,
  item,
  model,
  rootPath,
}: {
  readonly actions: TreeFsActions
  readonly item: TreeContextMenuItem
  readonly model: TreeModel
  readonly rootPath: string
}): Menu {
  const isDirectory = item.kind === 'directory'
  const treePath = canonicalTreePath(item.path)
  const path = entryForTreePath(model, treePath)?.path ?? null
  const paths = path ? [path] : []
  const discard = useDiscardPathsMutation(paths, rootPath)
  const stage = useStagePathsMutation(paths, rootPath)
  const unstage = useUnstagePathsMutation(paths, rootPath)
  const { selectFile } = useEditorCommands()
  // Same query key the git panel uses, so this is a cache read, not a refetch.
  const status = useStatus(rootPath)

  return treeRowMenu({
    copyPath: (value, label) => void copyTextToClipboard(value, label),
    createFile: () => actions.createEntry(containerTreePath(treePath, isDirectory), false),
    createFolder: () => actions.createEntry(containerTreePath(treePath, isDirectory), true),
    discard: () => discard.mutate(),
    duplicate: () => actions.duplicateEntry(treePath, isDirectory),
    git: rowGitActions(status.data?.files, path, isDirectory),
    isDirectory,
    mutationsEnabled: actions.mutationsEnabled,
    openFile: () => selectFile(path),
    path,
    relativePath: treePath,
    rename: () => actions.renameEntry(treePath),
    requestDelete: () =>
      actions.requestDelete({
        isDirectory,
        name: entryName(treePath),
        path: path ?? filesystemPath(''),
      }),
    stage: () => stage.mutate(),
    unstage: () => unstage.mutate(),
  })
}
