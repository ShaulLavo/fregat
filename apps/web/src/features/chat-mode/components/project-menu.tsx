import type { ReactElement } from 'react'

import { useProjectMenu } from '@/features/chat-mode/hooks/use-project-menu'
import type { SessionRailGroup } from '@workspace/client-core/chat/rail/model'
import { MenuSurface } from '@/keymap/menus/components/surface'

export function ProjectMenu({
  group,
  trigger,
}: {
  readonly group: SessionRailGroup
  readonly trigger: ReactElement
}) {
  const menu = useProjectMenu(group)

  return <MenuSurface className='w-56' menu={menu} surface='chat.project' trigger={trigger} />
}
