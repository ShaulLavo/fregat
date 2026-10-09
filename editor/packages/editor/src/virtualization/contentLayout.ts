import { createError } from '../logging/errors'
import type { RevealBlock } from './revealBlock'

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
  const reading = contentReadingBounds(row)
  return bounds.top >= reading.top && bounds.bottom <= reading.bottom
}

export function contentReadingBounds(element: HTMLElement): {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
} {
  const window = element.ownerDocument.defaultView!
  let left = 0
  let right = window.innerWidth
  let top = 0
  let bottom = window.innerHeight
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = window.getComputedStyle(ancestor)
    const box = ancestor.getBoundingClientRect()
    const scale = ancestor.offsetWidth > 0 ? box.width / ancestor.offsetWidth : 1
    if (clipsOverflow(style.overflowX)) {
      left = Math.max(left, box.left + ancestor.clientLeft * scale)
      right = Math.min(right, box.left + (ancestor.clientLeft + ancestor.clientWidth) * scale)
    }
    if (clipsOverflow(style.overflowY)) {
      top = Math.max(top, box.top + ancestor.clientTop * scale)
      bottom = Math.min(bottom, box.top + (ancestor.clientTop + ancestor.clientHeight) * scale)
    }
  }
  return { left, right, top, bottom }
}

function clipsOverflow(overflow: string): boolean {
  return (
    overflow === 'auto' || overflow === 'scroll' || overflow === 'hidden' || overflow === 'clip'
  )
}
