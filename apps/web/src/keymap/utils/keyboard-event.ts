const NON_TEXT_INPUT_TYPES = new Set(['button', 'reset', 'submit'])

export function eventTargetsTextEntry(
  event: KeyboardEvent,
  editorInput: HTMLElement | null = null,
) {
  if (isTextEntryElement(document.activeElement, editorInput)) return true
  if (isTextEntryElement(event.target, editorInput)) return true

  return event.composedPath().some((target) => isTextEntryElement(target, editorInput))
}

function isTextEntryElement(
  target: EventTarget | null | undefined,
  editorInput: HTMLElement | null,
) {
  if (target === editorInput) return false
  if (target instanceof HTMLInputElement)
    return !NON_TEXT_INPUT_TYPES.has(target.type.toLowerCase())
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLSelectElement) return true
  if (!(target instanceof HTMLElement)) return false
  // An EditContext host takes typing without being contenteditable, so it has to be named.
  if (hasEditContext(target)) return true

  return target.isContentEditable
}

function hasEditContext(element: HTMLElement) {
  return 'editContext' in element && element.editContext != null
}
