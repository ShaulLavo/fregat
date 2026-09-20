export type ListboxRole = 'listbox' | 'tree' | 'tablist'

export type ListboxKeyAction =
  | { kind: 'move'; index: number }
  | { kind: 'collapse' | 'expand' | 'parent' | 'child' | 'commit' | 'select' | 'none' }

export type ListboxKeyInput = {
  key: string
  modifiers?: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }
  role: ListboxRole
  count: number
  activeIndex: number
  pageSize: number
  canCollapse?: boolean
  isCollapsed?: boolean
}

export function listboxKeyAction(input: ListboxKeyInput): ListboxKeyAction {
  const { key, modifiers, role, count, activeIndex, pageSize, canCollapse, isCollapsed } = input
  if (modifiers && Object.values(modifiers).some(Boolean)) return { kind: 'none' }
  if (count === 0) return { kind: 'none' }
  const index = Math.max(0, activeIndex)
  const page = Math.max(1, pageSize)

  switch (key) {
    case 'ArrowDown':
      return { kind: 'move', index: Math.min(count - 1, activeIndex + 1) }
    case 'ArrowUp':
      return { kind: 'move', index: Math.max(0, index - 1) }
    case 'Home':
      return { kind: 'move', index: 0 }
    case 'End':
      return { kind: 'move', index: count - 1 }
    case 'PageDown':
      return { kind: 'move', index: Math.min(count - 1, index + page) }
    case 'PageUp':
      return { kind: 'move', index: Math.max(0, index - page) }
    case 'Enter':
      return { kind: 'commit' }
    case ' ':
      return { kind: 'select' }
    case 'ArrowLeft':
      if (role !== 'tree') return { kind: 'none' }
      return { kind: canCollapse && !isCollapsed ? 'collapse' : 'parent' }
    case 'ArrowRight':
      if (role !== 'tree' || !canCollapse) return { kind: 'none' }
      return { kind: isCollapsed ? 'expand' : 'child' }
    default:
      return { kind: 'none' }
  }
}

export type ListboxItem<Id extends string = string> = {
  id: Id
  label?: string
  disabled?: boolean
  parentId?: Id | null
  hasChildren?: boolean
  expanded?: boolean
}

export function enabledListboxIndex(
  items: readonly ListboxItem[],
  index: number,
  direction: 1 | -1,
) {
  for (let cursor = index; cursor >= 0 && cursor < items.length; cursor += direction) {
    if (!items[cursor]?.disabled) return cursor
  }
  return -1
}

export function typeaheadListboxIndex(
  items: readonly ListboxItem[],
  activeIndex: number,
  query: string,
) {
  for (let offset = 1; offset <= items.length; offset += 1) {
    const index = (Math.max(-1, activeIndex) + offset) % items.length
    const item = items[index]
    if (item?.disabled || !item?.label) continue
    if (item.label.toLocaleLowerCase().startsWith(query.toLocaleLowerCase())) return index
  }
  return -1
}
