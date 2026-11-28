import type { ReactNode } from 'react'
import {
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@workspace/ui/components/context-menu'
import type { ResolvedMenuItem } from '@/keymap/menus/utils/resolve'

export function MenuSubmenu({
  item,
  children,
}: {
  readonly item: Extract<ResolvedMenuItem, { kind: 'submenu' }>
  readonly children: ReactNode
}) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger disabled={item.disabled}>
        {item.icon ? <item.icon /> : null}
        <span>{item.label}</span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>{children}</ContextMenuSubContent>
    </ContextMenuSub>
  )
}
