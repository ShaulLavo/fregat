import type { Icon } from '@phosphor-icons/react'

import type { PlatformCommandId } from '@/keymap/types'

type MenuItemShared = {
  readonly icon?: Icon
  /**
   * Disables the item and renders this text in the trailing slot where a
   * shortcut would otherwise go. Use for actions whose backing feature does
   * not exist yet, so the menu shows the shape without pretending it works.
   */
  readonly unavailable?: string
}

/**
 * An item backed by the command registry. Title, shortcut, and availability
 * all resolve from the registry, so a menu item can never drift from its
 * command palette twin.
 */
export type MenuCommandItem = MenuItemShared & {
  readonly kind: 'command'
  readonly command: PlatformCommandId
  /** Overrides the registry title. Menus say "Close", the palette says "Close current tab". */
  readonly label?: string
}

/** An item that runs a local callback rather than a registered command. */
export type MenuActionItem = MenuItemShared & {
  readonly kind: 'action'
  readonly id: string
  readonly label: string
  readonly run: () => void
  readonly destructive?: boolean
  readonly disabled?: boolean
  readonly shortcut?: string
}

export type MenuCheckboxItem = MenuItemShared & {
  readonly kind: 'checkbox'
  readonly id: string
  readonly label: string
  readonly checked: boolean
  readonly toggle: (checked: boolean) => void
  readonly disabled?: boolean
}

export type MenuRadioItem = {
  readonly value: string
  readonly label: string
  /** Runs through the shared command bus; omitted for a local radio action. */
  readonly command?: PlatformCommandId
  readonly icon?: Icon
  readonly disabled?: boolean
}

export type MenuRadioGroupItem = MenuItemShared & {
  readonly kind: 'radio-group'
  readonly id: string
  readonly value: string
  readonly options: readonly MenuRadioItem[]
  /** Handles options without a command. Command-backed options bypass it. */
  readonly select?: (value: string) => void
}

export type MenuSubmenuItem = MenuItemShared & {
  readonly kind: 'submenu'
  readonly id: string
  readonly label: string
  readonly sections: readonly MenuSection[]
}

export type MenuItem =
  | MenuActionItem
  | MenuCheckboxItem
  | MenuCommandItem
  | MenuRadioGroupItem
  | MenuSubmenuItem

/**
 * Separators are not items — sections are. Empty sections are dropped during
 * resolution, so a section that filters to nothing cannot leave a dangling
 * separator behind.
 */
export type MenuSection = {
  readonly id: string
  readonly label?: string
  readonly items: readonly (MenuItem | null | false)[]
}

export type Menu = readonly MenuSection[]

export function section(id: string, items: MenuSection['items']): MenuSection {
  return { id, items }
}

export function commandItem(
  command: PlatformCommandId,
  options: Omit<MenuCommandItem, 'command' | 'kind'> = {},
): MenuCommandItem {
  return { ...options, command, kind: 'command' }
}

export function actionItem(options: Omit<MenuActionItem, 'kind'>): MenuActionItem {
  return { ...options, kind: 'action' }
}

export function submenuItem(options: Omit<MenuSubmenuItem, 'kind'>): MenuSubmenuItem {
  return { ...options, kind: 'submenu' }
}

export function menuItemKey(item: MenuItem) {
  return item.kind === 'command' ? item.command : item.id
}
