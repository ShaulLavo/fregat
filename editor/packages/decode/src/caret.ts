import type { EditorViewContributionContext } from '@singapore-editor/core/extensions'
import type { DecodeRevealRow } from './rows'

const LAYER_CLASS = 'editor-decode-caret-layer'
const CARET_CLASS = 'editor-decode-caret'
const CARET_BAR_CLASS = 'editor-decode-caret-bar'

export type DecodeCarets = {
  readonly layer: HTMLElement
  /** One caret per reveal row, index-aligned with the rows passed in. */
  readonly carets: readonly HTMLElement[]
}

/**
 * Builds an owned caret layer (one caret per revealing row) over the editor's
 * scroll content. Carets are our own DOM — never the recycled rows — so the
 * reconciler can't clobber them. Each caret is positioned at its row and is
 * animated to ride the reveal edge by `reveal.ts`.
 */
export function buildCarets(
  context: EditorViewContributionContext,
  rows: readonly DecodeRevealRow[],
): DecodeCarets {
  const document = context.scrollElement.ownerDocument
  const layer = document.createElement('div')
  layer.className = LAYER_CLASS
  layer.setAttribute('aria-hidden', 'true')

  const carets = rows.map((row) => createCaret(document, row))
  for (const caret of carets) layer.appendChild(caret)
  context.contentElement.appendChild(layer)
  return { layer, carets }
}

export function removeCarets(carets: DecodeCarets): void {
  carets.layer.remove()
}

function createCaret(document: Document, row: DecodeRevealRow): HTMLElement {
  // Outer caret: WAAPI drives its travel (stepped transform) and visibility
  // window (opacity). Inner bar: pure-CSS blink. Nested opacity multiplies, so
  // the caret ticks while it types but stays hidden outside its active window.
  const caret = document.createElement('div')
  caret.className = CARET_CLASS
  caret.style.top = `${row.top}px`
  caret.style.left = `calc(var(--editor-gutter-width, 0px) + ${row.leftSpacerWidth}px)`
  caret.style.height = `${row.height}px`

  const bar = document.createElement('div')
  bar.className = CARET_BAR_CLASS
  caret.appendChild(bar)
  return caret
}
