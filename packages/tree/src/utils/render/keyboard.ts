import { isContextMenuKey as isContextMenuOpenKey } from '@workspace/utils/keyboard'
export interface FileTreeKeyboardEventLike {
  readonly altKey: boolean
  readonly code?: string
  readonly ctrlKey: boolean
  readonly key: string
  readonly metaKey: boolean
  readonly shiftKey: boolean
}

export function isSearchOpenSeedKey(event: FileTreeKeyboardEventLike): boolean {
  return (
    event.key.length === 1 &&
    /^[\p{L}\p{N}]$/u.test(event.key) &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  )
}

export function isSpaceSelectionKey(event: FileTreeKeyboardEventLike): boolean {
  return event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar'
}

export function canKeyUseStickyKeyboardState(
  event: FileTreeKeyboardEventLike,
  contextMenuEnabled: boolean,
): boolean {
  if (contextMenuEnabled && isContextMenuOpenKey(event)) return true
  if ((event.ctrlKey || event.metaKey) && isSpaceSelectionKey(event)) return true

  return (
    event.key === 'ArrowDown' ||
    event.key === 'ArrowLeft' ||
    event.key === 'ArrowRight' ||
    event.key === 'ArrowUp'
  )
}

export const BLOCKED_CONTEXT_MENU_NAV_KEYS: ReadonlySet<string> = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
])
