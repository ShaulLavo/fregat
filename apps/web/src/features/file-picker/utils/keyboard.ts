import { hasCommandModifier } from '@workspace/utils/keyboard'
export type PickerKeyboardEvent = {
  altKey: boolean
  code?: string
  ctrlKey: boolean
  key: string
  metaKey: boolean
  shiftKey: boolean
}

export function isPrintablePickerKey(event: PickerKeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey) return false

  return event.key.length === 1
}

export function isGoToFolderShortcut(event: PickerKeyboardEvent) {
  return hasCommandModifier(event) && event.shiftKey && event.key.toLowerCase() === 'g'
}

export function isToggleHiddenShortcut(event: PickerKeyboardEvent) {
  if (!hasCommandModifier(event) || !event.shiftKey) return false

  return event.code === 'Period' || event.key === '.' || event.key === '>'
}

export function isGoUpShortcut(event: PickerKeyboardEvent) {
  return hasCommandModifier(event) && !event.shiftKey && event.key === 'ArrowUp'
}

function isUnshiftedCommand(event: PickerKeyboardEvent) {
  return hasCommandModifier(event) && !event.shiftKey && !event.altKey
}

export function isBackShortcut(event: PickerKeyboardEvent) {
  return isUnshiftedCommand(event) && (event.code === 'BracketLeft' || event.key === '[')
}

export function isForwardShortcut(event: PickerKeyboardEvent) {
  return isUnshiftedCommand(event) && (event.code === 'BracketRight' || event.key === ']')
}

/** Finder's ⌘↓: enter the selected folder, or choose the selected file. */
export function isOpenShortcut(event: PickerKeyboardEvent) {
  return isUnshiftedCommand(event) && event.key === 'ArrowDown'
}

/** "12 items", or "3 results" while a search runs. */
export function listCountLabel(count: number, searching: boolean) {
  const noun = searching ? 'result' : 'item'
  return `${count} ${count === 1 ? noun : `${noun}s`}`
}
