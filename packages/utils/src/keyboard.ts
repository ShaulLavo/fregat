type ContextMenuKeyEvent = { readonly shiftKey?: boolean; readonly key: string }
export function isContextMenuKey(event: ContextMenuKeyEvent): boolean {
  return (event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu'
}

export function hasCommandModifier(event: {
  readonly metaKey: boolean
  readonly ctrlKey: boolean
}): boolean {
  return event.metaKey || event.ctrlKey
}
