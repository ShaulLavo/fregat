import { useState, type ReactElement } from 'react'

import type { EditorTabCloseTarget } from '@/features/workspace/utils/tab-close-targets'
import type { EditorTabModel } from '@/features/workspace/utils/tab-types'
import { MenuSurface } from '@/keymap/menus/components/surface'
import { useEditorTabMenu } from '@/features/workbench/hooks/use-editor-tab-menu'

export function EditorTabMenu({
  closeTargets,
  tab,
  trigger,
}: {
  readonly closeTargets: readonly EditorTabCloseTarget[]
  readonly tab: EditorTabModel
  readonly trigger: ReactElement
}) {
  const [open, setOpen] = useState(false)
  const menu = useEditorTabMenu(tab, closeTargets, open)

  return (
    <MenuSurface
      className='w-52'
      menu={menu}
      open={open}
      onOpenChange={setOpen}
      surface='editor.tab'
      trigger={trigger}
    />
  )
}
