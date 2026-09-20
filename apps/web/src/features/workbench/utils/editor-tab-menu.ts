import { copyPathSection } from '@/keymap/menus/utils/copy-path-section'
import { ArrowRightIcon, FileIcon, FilesIcon, FloppyDiskIcon, XIcon } from '@phosphor-icons/react'

import {
  editorTabCloseTargetIds,
  type EditorTabCloseTarget,
  type EditorTabCloseTargetKind,
} from '@/features/workspace/utils/tab-close-targets'
import type { EditorTabModel } from '@/features/workspace/utils/tab-types'
import type { FilesystemPath, TabId } from '@/lib/documents/utils/types'
import type { GroupEdge } from '@/lib/documents/utils/group-types'
import { actionItem, section, type Menu } from '@/keymap/menus/utils/model'

export type EditorTabMenuContext = {
  readonly closeTargets: readonly EditorTabCloseTarget[]
  readonly copyPath: (path: string, label: string) => void
  readonly closeTabs: (tabIds: readonly TabId[]) => void
  readonly openFile: (path: FilesystemPath) => void
  readonly tab: EditorTabModel
  readonly canSplitRight: boolean
  readonly canSplitDown: boolean
  readonly canMoveToGroup: boolean
  readonly split: (edge: GroupEdge) => void
  readonly moveToGroup: () => void
}

export function editorTabMenu(context: EditorTabMenuContext): Menu {
  const diffSource = context.tab.diffSource

  return [
    section('close', [
      closeAction(context, 'close', 'Close', XIcon),
      closeAction(context, 'closeOthers', 'Close Others', FilesIcon),
      closeAction(context, 'closeToRight', 'Close to the Right', ArrowRightIcon),
      closeAction(context, 'closeSaved', 'Close Saved', FloppyDiskIcon),
      closeAction(context, 'closeAll', 'Close All', XIcon),
    ]),
    section('groups', [
      actionItem({
        id: 'splitRight',
        label: 'Split Right',
        icon: FilesIcon,
        disabled: !context.canSplitRight,
        run: () => context.split('right'),
      }),
      actionItem({
        id: 'splitDown',
        label: 'Split Down',
        icon: FilesIcon,
        disabled: !context.canSplitDown,
        run: () => context.split('bottom'),
      }),
      actionItem({
        id: 'moveToGroup',
        label: 'Move to Group…',
        icon: ArrowRightIcon,
        disabled: !context.canMoveToGroup,
        run: context.moveToGroup,
      }),
    ]),
    section('open', [
      // Only a diff tab has a file behind it worth jumping to; a file tab is
      // already the file.
      diffSource &&
        actionItem({
          disabled: !diffSource.onDisk,
          icon: FileIcon,
          id: 'openFile',
          label: 'Open File',
          run: () => context.openFile(diffSource.path),
        }),
    ]),
    copyPathSection({
      copyPath: context.copyPath,
      path: context.tab.copyPath,
      relativePath: context.tab.copyRelativePath,
    }),
  ]
}

function closeAction(
  context: EditorTabMenuContext,
  kind: EditorTabCloseTargetKind,
  label: string,
  icon: typeof XIcon,
) {
  const tabIds = editorTabCloseTargetIds(context.closeTargets, context.tab.id, kind)

  return actionItem({
    disabled: tabIds.length === 0,
    icon,
    id: kind,
    label,
    run: () => context.closeTabs(tabIds),
  })
}
