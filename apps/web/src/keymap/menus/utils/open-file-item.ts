import { FileIcon } from '@phosphor-icons/react'

import { actionItem, type MenuActionItem } from '@/keymap/menus/utils/model'

/** "Open File", the same item in every file menu: Files, Git and Search. */
export function openFileItem({
  onDisk = true,
  run,
  takesFocus,
}: {
  /** A deleted file has nothing left to open; the item stays, disabled. */
  readonly onDisk?: boolean
  readonly run: () => void
  /** Set where the open hands focus to the editor rather than back to the list. */
  readonly takesFocus?: boolean
}): MenuActionItem {
  return actionItem({
    disabled: !onDisk,
    icon: FileIcon,
    id: 'openFile',
    label: 'Open File',
    run,
    takesFocus,
  })
}
