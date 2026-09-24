import { copyPathSection } from '@/keymap/menus/utils/copy-path-section'
import { openFileItem } from '@/keymap/menus/utils/open-file-item'
import {
  ArrowBendUpLeftIcon,
  CopySimpleIcon,
  FilePlusIcon,
  FolderPlusIcon,
  MinusIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from '@phosphor-icons/react'

import type { GitFileStatus } from '@workspace/contracts'

import { isWorktreeStatus } from '@/lib/git-status'
import { isStagedStatus } from '@/lib/git-status'
import { actionItem, section, type Menu } from '@/keymap/menus/utils/model'

export type RowGitActions = {
  readonly canStage: boolean
  readonly canUnstage: boolean
}

/**
 * Reads the real per-file status rather than the tree's own git decoration.
 * The tree's `GitStatusEntry` collapses index and worktree into one status, so
 * it cannot say which direction is available — offering Unstage on a file with
 * nothing staged runs a `git restore --staged` that does nothing.
 *
 * A directory offers whatever any file beneath it offers.
 */
export function rowGitActions(
  files: readonly GitFileStatus[] | undefined,
  path: string | null,
  isDirectory: boolean,
): RowGitActions {
  if (!files?.length || !path) return { canStage: false, canUnstage: false }

  const prefix = `${path}/`
  let canStage = false
  let canUnstage = false

  for (const file of files) {
    if (!fileBelongsToRow(file.path, path, prefix, isDirectory)) continue
    if (isWorktreeStatus(file.worktree)) canStage = true
    if (isStagedStatus(file.index)) canUnstage = true
  }

  return { canStage, canUnstage }
}

function fileBelongsToRow(filePath: string, path: string, prefix: string, isDirectory: boolean) {
  if (filePath === path) return true

  return isDirectory && filePath.startsWith(prefix)
}

export type TreeRowMenuContext = {
  readonly copyPath: (path: string, label: string) => void
  readonly createFile: () => void
  readonly createFolder: () => void
  readonly discard: () => void
  readonly duplicate: () => void
  /** Which git directions this row actually has; both false omits the section. */
  readonly git: RowGitActions
  readonly isDirectory: boolean
  readonly mutationsEnabled?: boolean
  /** Absolute path on disk. Null when the row is not backed by a loaded entry. */
  readonly path: string | null
  readonly openFile: () => void
  readonly relativePath: string
  readonly rename: () => void
  readonly requestDelete: () => void
  readonly stage: () => void
  readonly unstage: () => void
}

export function treeRowMenu(context: TreeRowMenuContext): Menu {
  // Every filesystem action resolves a real path on the server, so a row the
  // tree model has not loaded yet can only be read from, not mutated.
  const unresolved = context.path === null
  const mutationsDisabled = context.mutationsEnabled === false

  return [
    section('open', [!context.isDirectory && openFileItem({ run: context.openFile })]),
    section('new', [
      actionItem({
        disabled: unresolved || mutationsDisabled,
        icon: FilePlusIcon,
        id: 'newFile',
        label: 'New File',
        run: context.createFile,
      }),
      actionItem({
        disabled: unresolved || mutationsDisabled,
        icon: FolderPlusIcon,
        id: 'newFolder',
        label: 'New Folder',
        run: context.createFolder,
      }),
    ]),
    // Omitted entirely for unchanged rows: staging a file with nothing to
    // stage is not a disabled action, it is a meaningless one. Placed above the
    // copy section so it lands in the same slot as the `git.file` menu's, and
    // carries the same glyphs the git panel's own row buttons use.
    section('git', [
      context.git.canStage &&
        actionItem({
          disabled: unresolved || mutationsDisabled,
          icon: PlusIcon,
          id: 'stage',
          label: 'Stage Changes',
          run: context.stage,
        }),
      context.git.canUnstage &&
        actionItem({
          disabled: unresolved || mutationsDisabled,
          icon: MinusIcon,
          id: 'unstage',
          label: 'Unstage Changes',
          run: context.unstage,
        }),
      (context.git.canStage || context.git.canUnstage) &&
        actionItem({
          destructive: true,
          disabled: unresolved || mutationsDisabled,
          icon: ArrowBendUpLeftIcon,
          id: 'discard',
          label: 'Discard Changes',
          run: context.discard,
        }),
    ]),
    copyPathSection({
      copyPath: context.copyPath,
      path: context.path,
      relativePath: context.relativePath,
    }),
    section('edit', [
      actionItem({
        disabled: unresolved || mutationsDisabled,
        icon: PencilSimpleIcon,
        id: 'rename',
        label: 'Rename',
        run: context.rename,
        shortcut: 'F2',
      }),
      actionItem({
        disabled: unresolved || mutationsDisabled,
        icon: CopySimpleIcon,
        id: 'duplicate',
        label: 'Duplicate',
        run: context.duplicate,
      }),
    ]),
    section('danger', [
      actionItem({
        destructive: true,
        disabled: unresolved || mutationsDisabled,
        icon: TrashIcon,
        id: 'delete',
        label: 'Delete',
        run: context.requestDelete,
      }),
    ]),
  ]
}
