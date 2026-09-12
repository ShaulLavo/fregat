import type { ReactElement } from 'react'

import { MenuSurface } from '@/keymap/menus/components/surface'
import { usePaneHeaderMenu } from '@/features/workbench/hooks/use-pane-header-menu'

export function PaneHeaderMenu({
  title,
  trigger,
}: {
  readonly title: string
  readonly trigger: ReactElement
}) {
  const menu = usePaneHeaderMenu(title)

  return <MenuSurface className='w-52' menu={menu} surface='pane.header' trigger={trigger} />
}
