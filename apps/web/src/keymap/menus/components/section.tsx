import type { ResolvedMenuItem, ResolvedMenuSection } from '@/keymap/menus/utils/resolve'
import {
  ContextMenuGroup,
  ContextMenuLabel,
  ContextMenuSeparator,
} from '@workspace/ui/components/context-menu'

import { MenuItemRow } from './item-row'

/**
 * Draws the rule that precedes every section but the first. Resolution has
 * already dropped empty sections, so a separator here can never end up
 * leading, trailing, or doubled.
 */
export function MenuSection({
  index,
  onInvoke,
  section,
}: {
  readonly index: number
  readonly onInvoke: (item: ResolvedMenuItem, value?: string) => void
  readonly section: ResolvedMenuSection
}) {
  return (
    <>
      {index > 0 ? <ContextMenuSeparator /> : null}
      <ContextMenuGroup>
        {section.label ? <ContextMenuLabel>{section.label}</ContextMenuLabel> : null}
        {section.items.map((item) => (
          <MenuItemRow item={item} key={item.key} onInvoke={onInvoke} />
        ))}
      </ContextMenuGroup>
    </>
  )
}
