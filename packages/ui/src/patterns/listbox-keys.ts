import { resolveListboxKeyAction } from '@shaulavo/workbench-ui'

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
  /** Tiles per row in a grid: ↑↓ move a whole row and ←→ one tile. Absent for a plain list. */
  columns?: number
}

export function listboxKeyAction(input: ListboxKeyInput): ListboxKeyAction {
  const { key, modifiers, role, count, activeIndex, pageSize, canCollapse, isCollapsed } = input
  if (modifiers && Object.values(modifiers).some(Boolean)) return { kind: 'none' }
  if (count === 0) return { kind: 'none' }
  if (input.columns !== undefined) {
    const grid = gridKeyAction(key, count, Math.max(0, activeIndex), input.columns)
    if (grid && activeIndex < 0) return { kind: 'move', index: 0 }
    if (grid) return grid
  }

  if (key === ' ') return { kind: 'select' }
  if (key === 'ArrowLeft') {
    if (role !== 'tree') return { kind: 'none' }
    return { kind: canCollapse && !isCollapsed ? 'collapse' : 'parent' }
  }
  if (key === 'ArrowRight') {
    if (role !== 'tree' || !canCollapse) return { kind: 'none' }
    return { kind: isCollapsed ? 'expand' : 'child' }
  }

  return resolveListboxKeyAction({
    activeIndex,
    count,
    key,
    loop: false,
    pageSize: Math.max(1, pageSize),
  })
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

// Searches from `from` inclusive, wrapping, so a longer buffer can stay on a row that still matches.
export function typeaheadListboxIndex(items: readonly ListboxItem[], from: number, query: string) {
  const start = Math.max(0, from)
  const needle = query.toLocaleLowerCase()
  for (let offset = 0; offset < items.length; offset += 1) {
    const index = (start + offset) % items.length
    const item = items[index]
    if (item?.disabled || !item?.label) continue
    if (item.label.toLocaleLowerCase().startsWith(needle)) return index
  }
  return -1
}

/** Grid moves; anything else falls through to the list's keys. Never wraps past either end. */
function gridKeyAction(
  key: string,
  count: number,
  index: number,
  columns: number,
): ListboxKeyAction | null {
  const step = Math.max(1, columns)
  if (key === 'ArrowDown')
    return { kind: 'move', index: index + step < count ? index + step : index }
  if (key === 'ArrowUp') return { kind: 'move', index: index - step >= 0 ? index - step : index }
  if (key === 'ArrowRight') return { kind: 'move', index: Math.min(count - 1, index + 1) }
  if (key === 'ArrowLeft') return { kind: 'move', index: Math.max(0, index - 1) }
  return null
}
