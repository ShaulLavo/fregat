import { createError } from '../logging/errors'
import type { RevealBlock } from './virtualizedTextViewInternals'

const MAX_CONTENT_TEXT_LENGTH = 1_048_576
const MAX_CONTENT_ROWS = 10_000
const MAX_CONTENT_HEIGHT = 1_000_000

export function assertContentLayout(textLength: number, rowCount: number, height: number): void {
  if (textLength > MAX_CONTENT_TEXT_LENGTH)
    refuseContentLayout('textLength', textLength, MAX_CONTENT_TEXT_LENGTH)
  if (rowCount > MAX_CONTENT_ROWS) refuseContentLayout('displayRows', rowCount, MAX_CONTENT_ROWS)
  if (height > MAX_CONTENT_HEIGHT) refuseContentLayout('height', height, MAX_CONTENT_HEIGHT)
}

function refuseContentLayout(metric: string, actual: number, maximum: number): never {
  throw createError({
    code: 'EDITOR_CONTENT_LAYOUT_LIMIT',
    status: 413,
    message: 'The document exceeds the content layout limit.',
    why: 'Content layout paints every display row in document flow.',
    fix: 'Use virtualized scrolling for this document.',
    internal: { metric, actual, maximum },
  })
}

export function revealContentRow(row: HTMLElement, requested: RevealBlock): void {
  let block: ScrollLogicalPosition = 'nearest'
  if (requested !== 'center-if-outside') block = requested
  if (requested === 'center-if-outside' && !contentRowIsVisible(row)) block = 'center'
  row.scrollIntoView({ block, inline: 'nearest' })
}

function contentRowIsVisible(row: HTMLElement): boolean {
  const bounds = row.getBoundingClientRect()
  const window = row.ownerDocument.defaultView
  if (!window || bounds.top < 0 || bounds.bottom > window.innerHeight) return false
  for (let ancestor = row.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const overflow = window.getComputedStyle(ancestor).overflowY
    if (overflow !== 'auto' && overflow !== 'scroll' && overflow !== 'hidden') continue
    const box = ancestor.getBoundingClientRect()
    if (bounds.top < box.top || bounds.bottom > box.bottom) return false
  }
  return true
}
