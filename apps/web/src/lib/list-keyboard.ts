type ListKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'preventDefault'
> & {
  readonly target: EventTarget
  readonly currentTarget: HTMLElement
}

export function forwardActiveRowKey(event: ListKeyEvent) {
  if (event.target !== event.currentTarget) return
  const id = event.currentTarget.getAttribute('aria-activedescendant')
  const row = id ? event.currentTarget.ownerDocument.getElementById(id) : null
  if (!row) return
  row.focus({ preventScroll: true })
  row.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: event.key,
      code: event.code,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      bubbles: true,
      cancelable: true,
    }),
  )
  event.preventDefault()
}
