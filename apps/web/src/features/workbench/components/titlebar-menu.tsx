import { useState, type ReactElement } from 'react'

import { MenuSurface } from '@/keymap/menus/components/surface'
import { useTitlebarMenu } from '@/features/workbench/hooks/use-titlebar-menu'

/**
 * Open state is held here rather than left to Base UI so the recent-projects
 * query can stay idle until someone actually opens the menu.
 */
export function TitlebarMenu({ trigger }: { readonly trigger: ReactElement }) {
  const [open, setOpen] = useState(false)
  const menu = useTitlebarMenu(open)

  return (
    <MenuSurface
      className='w-60'
      menu={menu}
      onOpenChange={setOpen}
      open={open}
      surface='titlebar'
      trigger={trigger}
    />
  )
}
