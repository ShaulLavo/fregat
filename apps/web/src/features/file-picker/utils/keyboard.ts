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
