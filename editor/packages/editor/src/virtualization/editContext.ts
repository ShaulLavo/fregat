// The slice of the EditContext API the editor uses. TypeScript's DOM library does not declare it
// yet, and a global declaration would leak into every consumer's type check.

export type EditorTextUpdateEvent = Event & {
  readonly text: string
  readonly updateRangeStart: number
  readonly updateRangeEnd: number
  readonly selectionStart: number
  readonly selectionEnd: number
}

export type EditorCharacterBoundsUpdateEvent = Event & {
  readonly rangeStart: number
  readonly rangeEnd: number
}

export type EditorEditContext = EventTarget & {
  readonly text: string
  readonly selectionStart: number
  readonly selectionEnd: number
  updateText(rangeStart: number, rangeEnd: number, text: string): void
  updateSelection(start: number, end: number): void
  updateControlBounds(bounds: DOMRect): void
  updateSelectionBounds(bounds: DOMRect): void
  updateCharacterBounds(rangeStart: number, bounds: readonly DOMRect[]): void
}

type EditContextHost = HTMLElement & { editContext: EditorEditContext | null }
type EditContextWindow = Window & { EditContext?: new () => EditorEditContext }

export function createEditContext(element: HTMLElement): EditorEditContext | null {
  const view = element.ownerDocument.defaultView as EditContextWindow | null
  if (!view?.EditContext) return null
  return new view.EditContext()
}

export function attachEditContext(element: HTMLElement, context: EditorEditContext | null): void {
  ;(element as EditContextHost).editContext = context
}
