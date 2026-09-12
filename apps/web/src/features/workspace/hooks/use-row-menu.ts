import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FileTreeContextMenuItem, FileTreeContextMenuOpenContext } from '@workspace/tree'
import { containerTreePath, entryName } from '@/features/workspace/utils/entry-paths'
import { rowGitActions, treeRowMenu } from '@/features/workspace/utils/row-menu'
import type { TreeFsActions } from '@/features/workspace/hooks/use-fs-actions'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { useDiscardPathsMutation } from '@/features/git/hooks/use-discard-paths-mutation'
import { useStagePathsMutation } from '@/features/git/hooks/use-stage-paths-mutation'
import { useStatus } from '@/features/git/hooks/use-status'
import { useUnstagePathsMutation } from '@/features/git/hooks/use-unstage-paths-mutation'
import type { Menu } from '@/keymap/menus/utils/model'
import { copyTextToClipboard } from '@/lib/clipboard'
import { canonicalTreePath } from '@/lib/path-formatters'
import { entryForTreePath, type TreeModel } from '@/lib/tree-model'

export function useRowMenu({
  actions,
  item,
  menuContext,
  model,
  rootPath,
}: {
  readonly actions: TreeFsActions
  readonly item: FileTreeContextMenuItem
  readonly menuContext: FileTreeContextMenuOpenContext
  readonly model: TreeModel
  readonly rootPath: string
}): Menu {
  const isDirectory = item.kind === 'directory'
  // Directory rows arrive with a trailing slash; every path comparison in the
  // app (git status, the tree model index) is keyed without one.
  const treePath = canonicalTreePath(item.path)
  const path = entryForTreePath(model, treePath)?.path ?? null
  const paths = path ? [path] : []
  const discard = useDiscardPathsMutation(paths)
  const stage = useStagePathsMutation(paths)
  const unstage = useUnstagePathsMutation(paths)
  const { selectFile } = useEditorCommands()
  // Same query key the git panel uses, so this is a cache read, not a refetch.
  const status = useStatus(rootPath)

  /**
   * Inline edits take focus into the tree's rename input. Closing with
   * `restoreFocus: false` first stops the menu's own close path from pulling
   * focus back onto the row.
   */
  function startInlineEdit(begin: () => void) {
    menuContext.close({ restoreFocus: false })
    begin()
  }

  return treeRowMenu({
    copyPath: (value, label) => void copyTextToClipboard(value, label),
    createFile: () =>
      startInlineEdit(() => actions.createEntry(containerTreePath(treePath, isDirectory), false)),
    createFolder: () =>
      startInlineEdit(() => actions.createEntry(containerTreePath(treePath, isDirectory), true)),
    discard: () => discard.mutate(),
    duplicate: () => actions.duplicateEntry(treePath, isDirectory),
    git: rowGitActions(status.data?.files, path, isDirectory),
    isDirectory,
    mutationsEnabled: actions.mutationsEnabled,
    openFile: () => selectFile(path),
    path,
    relativePath: treePath,
    rename: () => startInlineEdit(() => actions.renameEntry(item.path)),
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
