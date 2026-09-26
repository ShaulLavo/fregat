import { prefersReducedMotion } from './wallpaper'

export type TabStripScrollBounds = {
  /** Breathing room kept between a revealed tab and the strip edge. */
  readonly gutter: number
  readonly scrollLeft: number
  readonly stripLeft: number
  readonly stripRight: number
  readonly tabLeft: number
  readonly tabRight: number
}

/**
 * The scroll offset that brings a tab back into the strip, or null when it
 * already fits. Moves by the least amount that clears the clipped edge rather
 * than centering, so revealing a tab keeps the rest of the strip where the
 * user left it. A tab wider than the window aligns to its left edge, since
 * that is where the icon and the start of the name are.
 *
 * The caller assigns the result to `scrollLeft`, which the browser clamps to
 * the scrollable range.
 */
export function tabStripScrollLeft(bounds: TabStripScrollBounds): number | null {
  const clippedLeft = bounds.stripLeft + bounds.gutter - bounds.tabLeft
  if (clippedLeft > 0) return bounds.scrollLeft - clippedLeft

  const clippedRight = bounds.tabRight - (bounds.stripRight - bounds.gutter)
  if (clippedRight > 0) return bounds.scrollLeft + clippedRight

  return null
}

export function scrollGutter(strip: HTMLElement): number {
  return Number.parseFloat(getComputedStyle(strip).scrollPaddingInlineStart) || 0
}

export function revealBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth'
}
