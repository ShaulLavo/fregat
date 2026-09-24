import type { ReactElement } from 'react'

import { usePaneHost } from '@/hooks/use-pane-host'
import { MenuSurface } from '@/keymap/menus/components/surface'
import { paneHeaderMenu } from '@/keymap/menus/utils/pane-header-menu'

export function PaneHeaderMenu({
  title,
  trigger,
}: {
  readonly title: string
  readonly trigger: ReactElement
}) {
  const host = usePaneHost()
  if (!host) return trigger

  return (
    <MenuSurface
      className='w-52'
      menu={paneHeaderMenu(host, title)}
      surface='pane.header'
      trigger={trigger}
    />
  )
}
