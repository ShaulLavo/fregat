import type { ComponentProps } from 'react'
import type { ResolvedMenuSection } from '@/keymap/menus/utils/resolve'
import {
  ContextMenuGroup,
  ContextMenuLabel,
  ContextMenuSeparator,
} from '@workspace/ui/components/context-menu'

import { MenuItemRow } from './item-row'
import { MenuSubmenu } from './submenu'

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
  readonly onInvoke: ComponentProps<typeof MenuItemRow>['onInvoke']
  readonly section: ResolvedMenuSection
}) {
  return (
    <>
      {index > 0 ? <ContextMenuSeparator /> : null}
      <ContextMenuGroup>
        {section.label ? <ContextMenuLabel>{section.label}</ContextMenuLabel> : null}
        {section.items.map((item) =>
          item.kind === 'submenu' ? (
            <MenuSubmenu item={item} key={item.key}>
              {item.sections.map((child, index) => (
                <MenuSection index={index} key={child.id} onInvoke={onInvoke} section={child} />
              ))}
            </MenuSubmenu>
          ) : (
            <MenuItemRow item={item} key={item.key} onInvoke={onInvoke} />
          ),
        )}
      </ContextMenuGroup>
    </>
  )
}
