import type { ReactElement } from 'react'

import { useSessionMenu } from '@/features/chat-mode/hooks/use-session-menu'
import type { SessionRailItem } from '@workspace/client-core/chat/rail/model'
import { MenuSurface } from '@/features/menus/components/surface'

export function SessionMenu({
  session,
  trigger,
}: {
  readonly session: SessionRailItem
  readonly trigger: ReactElement
}) {
  const menu = useSessionMenu(session, 'rail')

  return <MenuSurface className='w-56' menu={menu} surface='chat.session' trigger={trigger} />
}
