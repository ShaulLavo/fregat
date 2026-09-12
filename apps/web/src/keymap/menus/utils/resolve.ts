import type { Icon } from '@phosphor-icons/react'

import { platformCommandSpec } from '@/keymap/command-registry'
import type { CommandDispatchTicket } from '@/keymap/state/command-bus'
import type { PlatformCommandId, PlatformKeyBinding } from '@/keymap/types'

import type { Menu, MenuItem, MenuRadioItem, MenuSection } from './model'
import { menuItemKey } from './model'
import { commandShortcut } from '@/keymap/utils/format-keys'

export type MenuResolveContext = {
  readonly bindings: readonly PlatformKeyBinding[]
  readonly dispatch: (command: PlatformCommandId) => CommandDispatchTicket
  readonly inspect: (
    command: PlatformCommandId,
  ) => { readonly status: 'ready' } | { readonly reason: string; readonly status: 'disabled' }
}

export type ResolvedMenuInvocation = CommandDispatchTicket | void

/** Command and action items collapse to one shape — both just run something. */
export type ResolvedRunItem = {
  readonly kind: 'run'
  readonly key: string
  readonly label: string
  readonly icon?: Icon
  /** Shortcut glyphs, or the reason the item is unavailable. */
  readonly trailing: string | null
  readonly disabled: boolean
  readonly destructive: boolean
  readonly command: PlatformCommandId | null
  readonly run: () => ResolvedMenuInvocation
}

export type ResolvedCheckboxItem = {
  readonly kind: 'checkbox'
  readonly key: string
  readonly label: string
  readonly icon?: Icon
  readonly checked: boolean
  readonly disabled: boolean
  readonly toggle: (checked: boolean) => void
}

export type ResolvedRadioGroupItem = {
  readonly kind: 'radio-group'
  readonly key: string
  readonly value: string
  readonly options: readonly MenuRadioItem[]
  readonly select: (value: string) => ResolvedMenuInvocation
}

export type ResolvedSubmenuItem = {
  readonly kind: 'submenu'
  readonly key: string
  readonly label: string
  readonly icon?: Icon
  readonly disabled: boolean
  readonly sections: readonly ResolvedMenuSection[]
}

export type ResolvedMenuItem =
  | ResolvedCheckboxItem
  | ResolvedRadioGroupItem
  | ResolvedRunItem
  | ResolvedSubmenuItem

export type ResolvedMenuSection = {
  readonly id: string
  readonly label?: string
  readonly items: readonly ResolvedMenuItem[]
}

export type ResolvedMenu = readonly ResolvedMenuSection[]

/**
 * Fills labels, shortcuts, and availability from the command registry, then
 * drops sections that ended up empty so a filtered-out group cannot leave a
 * dangling separator behind.
 */
export function resolveMenu(menu: Menu, context: MenuResolveContext): ResolvedMenu {
  return menu.map((entry) => resolveSection(entry, context)).filter(sectionHasItems)
}

function resolveSection(entry: MenuSection, context: MenuResolveContext): ResolvedMenuSection {
  const items = entry.items
    .filter((item): item is MenuItem => Boolean(item))
    .map((item) => resolveItem(item, context))

  return { id: entry.id, items, label: entry.label }
}

function sectionHasItems(entry: ResolvedMenuSection) {
  return entry.items.length > 0
}

function resolveItem(item: MenuItem, context: MenuResolveContext): ResolvedMenuItem {
  if (item.kind === 'command') return resolveCommandItem(item, context)
  if (item.kind === 'submenu') {
    return {
      disabled: Boolean(item.unavailable),
      icon: item.icon,
      key: item.id,
      kind: 'submenu',
      label: item.label,
      sections: resolveMenu(item.sections, context),
    }
  }
  if (item.kind === 'checkbox') {
    return {
      checked: item.checked,
      disabled: Boolean(item.disabled) || Boolean(item.unavailable),
      icon: item.icon,
      key: item.id,
      kind: 'checkbox',
      label: item.label,
      toggle: item.toggle,
    }
  }
  if (item.kind === 'radio-group') {
    const options = item.options.map((option) => resolveRadioOption(option, context))

    return {
      key: item.id,
      kind: 'radio-group',
      options,
      select: (value) => selectRadioOption(item, options, value, context),
      value: item.value,
    }
  }

  return {
    command: null,
    destructive: Boolean(item.destructive),
    disabled: Boolean(item.disabled) || Boolean(item.unavailable),
    icon: item.icon,
    key: item.id,
    kind: 'run',
    label: item.label,
    run: () => {
      item.run()
    },
    trailing: item.unavailable ?? item.shortcut ?? null,
  }
}

function resolveCommandItem(
  item: Extract<MenuItem, { kind: 'command' }>,
  context: MenuResolveContext,
): ResolvedRunItem {
  const spec = platformCommandSpec(item.command)
  const inspection = context.inspect(item.command)

  return {
    command: item.command,
    destructive: false,
    disabled: Boolean(item.unavailable) || inspection.status === 'disabled',
    icon: item.icon,
    key: menuItemKey(item),
    kind: 'run',
    label: item.label ?? spec?.title ?? item.command,
    run: () => context.dispatch(item.command),
    trailing:
      item.unavailable ??
      (inspection.status === 'disabled'
        ? inspection.reason
        : commandShortcut(item.command, context.bindings)),
  }
}

function resolveRadioOption(option: MenuRadioItem, context: MenuResolveContext): MenuRadioItem {
  if (!option.command) return option

  return {
    ...option,
    disabled: Boolean(option.disabled) || context.inspect(option.command).status === 'disabled',
  }
}

function selectRadioOption(
  item: Extract<MenuItem, { kind: 'radio-group' }>,
  options: readonly MenuRadioItem[],
  value: string,
  context: MenuResolveContext,
): ResolvedMenuInvocation {
  const option = options.find((candidate) => candidate.value === value)
  if (!option || option.disabled) return
  if (option.command) return context.dispatch(option.command)

  item.select?.(value)
}
