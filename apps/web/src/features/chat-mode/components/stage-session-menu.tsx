import { DotsThreeIcon } from '@phosphor-icons/react'
import { useState } from 'react'

import { useSessionMenu } from '@/features/chat-mode/hooks/use-session-menu'
import type { SessionRailItem } from '@workspace/client-core/chat/rail/model'
import { MenuSurface } from '@/features/menus/components/surface'
import { rectAnchor, type MenuAnchor } from '@/features/menus/utils/virtual-anchor'
import { Button } from '@workspace/ui/components/button'

/**
 * The stage's own handle on the session it is showing — the same menu the rail row
 * carries, opened from a button instead of a right-click, because the header is where
 * you are looking when you decide to rename or archive what you are reading.
 */
export function StageSessionMenu({ session }: { readonly session: SessionRailItem }) {
  const menu = useSessionMenu(session, 'header')
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)

  return (
    <>
      <Button
        aria-label='Session actions'
        className='text-muted-foreground hover:text-foreground compact:size-6 size-7 shrink-0 rounded-md'
        size='icon-sm'
        type='button'
        variant='ghost'
        onClick={(event) =>
          setAnchor(rectAnchor(event.currentTarget.getBoundingClientRect(), event.currentTarget))
        }
      >
        <DotsThreeIcon className='size-4' weight='bold' />
      </Button>
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
