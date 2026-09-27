import { ArrowSquareOutIcon, LinkSimpleIcon } from '@phosphor-icons/react'

import { actionItem, section, type Menu } from '@/keymap/menus/utils/model'

export type ChatLinkMenuContext = {
  /** Shown over the actions: a touch screen has no hover to show where a link goes. */
  readonly href: string
  readonly copyLink: () => void
  readonly openLink: () => void
}

export function chatLinkMenu(context: ChatLinkMenuContext): Menu {
  return [
    {
      ...section('link', [
        actionItem({
          icon: ArrowSquareOutIcon,
          id: 'openLink',
          label: 'Open Link',
          run: context.openLink,
        }),
        actionItem({
          icon: LinkSimpleIcon,
          id: 'copyLink',
          label: 'Copy Link',
          run: context.copyLink,
        }),
      ]),
      label: context.href,
    },
  ]
}
