import { MenuSurface } from '@/keymap/menus/components/surface'
import type { MenuAnchor } from '@/keymap/menus/utils/virtual-anchor'
import { copyTextToClipboard } from '@/lib/clipboard'

import { chatLinkMenu } from '../utils/link-menu'

/**
 * Mounted by the link only while its menu is open, so a message full of links
 * does not carry one menu tree per anchor.
 *
 * Reported under `chat.message`: a link menu is raised from inside a message
 * and the surface registry has no id of its own for it yet.
 */
export function MarkdownLinkMenu({
  anchor,
  href,
  onOpenChange,
}: {
  readonly anchor: MenuAnchor | null
  readonly href: string
  readonly onOpenChange: (open: boolean) => void
}) {
  const menu = chatLinkMenu({
    copyLink: () => void copyTextToClipboard(href, 'link'),
    openLink: () => void window.open(href, '_blank', 'noopener,noreferrer'),
  })

  return (
    <MenuSurface
      anchor={anchor}
      className='w-56'
      menu={menu}
      onOpenChange={onOpenChange}
      open
      surface='chat.message'
    />
  )
}
