import type { Editor } from '@singapore-editor/core/editor'

import { useEditorTextMenu } from '@/features/editor/hooks/use-editor-text-menu'
import { MenuSurface } from '@/keymap/menus/components/surface'
import type { MenuAnchor } from '@/keymap/menus/utils/virtual-anchor'

/**
 * Mounted by the editor frame only while the menu is open. The frame is the
 * only element we own around the editor, and the editor's own DOM is not ours
 * to wrap in a trigger, so this takes the anchor path.
 */
export function EditorTextMenu({
  anchor,
  editor,
  offset,
  onOpenChange,
}: {
  readonly anchor: MenuAnchor
  readonly editor: Editor | null
  /** The text offset the menu was opened for, for the spelling section. */
  readonly offset: number | null
  readonly onOpenChange: (open: boolean) => void
}) {
  const menu = useEditorTextMenu(editor, offset)

  return (
    <MenuSurface
      anchor={anchor}
      className='w-60'
      menu={menu}
      onOpenChange={onOpenChange}
      open
      surface='editor.text'
    />
  )
}
