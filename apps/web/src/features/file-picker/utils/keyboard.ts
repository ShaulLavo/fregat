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

/** "12 items", or "3 results" while a search runs. */
export function listCountLabel(count: number, searching: boolean) {
  const noun = searching ? 'result' : 'item'
  return `${count} ${count === 1 ? noun : `${noun}s`}`
}
