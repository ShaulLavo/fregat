import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { DotsThreeIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Button } from '@workspace/ui/components/button'
import type { SessionRailItem } from '@workspace/client-core/chat/rail/model'

import { useSessionMenuActions } from '@/hooks/use-session-menu-actions'
import type { SessionRenameSurface } from '@/features/chat-mode/state/session-rail-store'
import { MenuSurface } from '@/keymap/menus/components/surface'
import { sessionActionsMenu } from '@/keymap/menus/utils/session-actions-menu'
import { rectAnchor, type MenuAnchor } from '@/keymap/menus/utils/virtual-anchor'

/**
 * A header's handle on the session it shows: the same actions the rail row offers,
 * opened from a button, because the header is where you are looking when you decide
 * to rename or archive what you are reading.
 */
export function SessionActionsButton({
  session,
  surface,
}: {
  readonly session: SessionRailItem
  readonly surface: Exclude<SessionRenameSurface, 'rail'>
}) {
  const menu = sessionActionsMenu(useSessionMenuActions(session, surface))
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label='Session actions'
              className='text-muted-foreground hover:text-foreground shrink-0'
              size='icon-sm'
              type='button'
              variant='ghost'
              onClick={(event) =>
                setAnchor(
                  rectAnchor(event.currentTarget.getBoundingClientRect(), event.currentTarget),
                )
              }
            >
              <DotsThreeIcon className='size-(--icon-size)' weight='bold' />
            </Button>
          }
        />
        <TooltipContent>{'Session actions'}</TooltipContent>
      </Tooltip>
      <MenuSurface
        anchor={anchor}
        className='w-56'
        menu={menu}
        open={anchor !== null}
        surface='chat.session'
        onOpenChange={(open) => {
          if (open) return
          setAnchor(null)
        }}
      />
    </>
  )
}
