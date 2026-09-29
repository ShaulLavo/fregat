import { setElementHidden, setStyleValue } from './virtualizedTextViewHelpers'
import type { VirtualizedTextViewInternal } from './virtualizedTextViewInternals'
import { caretPosition } from './virtualizedTextViewRows'

/**
 * The overlay each view draws its in-progress composition into, made the first time one starts.
 *
 * A composition assembles its text inside the hidden input — transparent, a pixel wide — and only
 * hands it to the document once the reader accepts a candidate. Until then a reader composing
 * Japanese, Korean, Chinese or Vietnamese is looking at a document that has not moved since they
 * started typing, which is most of the interaction for those keyboards.
 *
 * Held beside the view instead of built with it because a keyboard that never composes never pays
 * for the element, and because nothing else in a view's lifetime has to know it exists.
 */
const compositionPreedits = new WeakMap<VirtualizedTextViewInternal, HTMLElement>()

/**
 * Draws what the reader is composing over the row it will land in.
 *
 * Empty text is what takes it down again — a composition that reached the document, and one the
 * reader abandoned, both end with nothing left to show.
 */
export function setCompositionPreedit(view: VirtualizedTextViewInternal, text: string): void {
  const existing = compositionPreedits.get(view)
  if (text.length === 0) {
    existing?.remove()
    compositionPreedits.delete(view)
    return
  }

  const element = existing ?? createCompositionPreedit(view)
  element.textContent = text
  positionCompositionPreedit(view, element)
}

/** Where each character of the drawn candidate sits, for an IME placing its candidate window. */
export function compositionCharacterRects(view: VirtualizedTextViewInternal): DOMRect[] {
  const node = compositionPreedits.get(view)?.firstChild
  if (!node || node.nodeType !== Node.TEXT_NODE) return []

  const range = view.scrollElement.ownerDocument.createRange()
  const rects: DOMRect[] = []
  const length = node.textContent?.length ?? 0
  for (let index = 0; index < length; index += 1) {
    range.setStart(node, index)
    range.setEnd(node, index + 1)
    rects.push(range.getBoundingClientRect())
  }
  return rects
}

/**
 * The composition has not touched the document, so the caret still marks where its text will go —
 * which is also the left edge of what is being composed.
 */
function positionCompositionPreedit(view: VirtualizedTextViewInternal, element: HTMLElement): void {
  const selection = view.selections[0]
  const position = selection
    ? (caretPosition(view, selection.head, selection.affinity)?.[0] ?? null)
    : null
  // Scrolled past the mounted rows there is no row to draw over. The next candidate the IME offers
  // puts the preedit back, so nothing is lost by waiting for one.
  if (!position) {
    setElementHidden(element, true)
    return
  }

  setElementHidden(element, false)
  setStyleValue(element, 'height', `${position.height}px`)
  setStyleValue(element, 'transform', `translate(${position.left}px, ${position.top}px)`)
}

function createCompositionPreedit(view: VirtualizedTextViewInternal): HTMLElement {
  const element = view.scrollElement.ownerDocument.createElement('span')
  element.className = 'editor-virtualized-composition'
  // The characters are already in the hidden input, which is the copy a screen reader is following.
  element.setAttribute('aria-hidden', 'true')
  view.spacer.appendChild(element)
  compositionPreedits.set(view, element)

  return element
}
