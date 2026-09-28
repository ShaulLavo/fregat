import { useLayoutEffect, useRef, type RefObject } from 'react'

/** Scroll the row window inside a fixed clip, retaining overscan coverage between renders. */
export function useTreeWindowPosition({
  height,
  listRef,
  offsetTop,
  stickyOverlayHeight,
  totalHeight,
  viewportHeight,
}: {
  readonly height: number
  readonly listRef: RefObject<HTMLDivElement | null>
  readonly offsetTop: number
  readonly stickyOverlayHeight: number
  readonly totalHeight: number
  readonly viewportHeight: number
}) {
  const windowRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = windowRef.current
    const scroll = listRef.current?.parentElement
    const maxScroll = totalHeight - viewportHeight
    if (!element || !scroll) return
    const minimum = Math.min(0, viewportHeight - stickyOverlayHeight - height)
    const positionAt = (scrollTop: number): string => {
      const offset = offsetTop - scrollTop - stickyOverlayHeight
      return `translateY(${Math.max(minimum, Math.min(0, offset))}px)`
    }
    const update = () => element.style.setProperty('transform', positionAt(scroll.scrollTop))
    update()
    if (maxScroll <= 0) return
    if (typeof ScrollTimeline === 'undefined') {
      scroll.addEventListener('scroll', update, { passive: true })
      return () => scroll.removeEventListener('scroll', update)
    }
    // The window pins at either overscan edge; preserve those flat segments in the timeline.
    const positions = [
      ...new Set(
        [
          0,
          offsetTop - stickyOverlayHeight,
          offsetTop - stickyOverlayHeight - minimum,
          maxScroll,
        ].map((value) => Math.max(0, Math.min(maxScroll, value))),
      ),
    ].sort((a, b) => a - b)
    const animation = element.animate(
      positions.map((position) => ({
        offset: position / maxScroll,
        transform: positionAt(position),
      })),
      { timeline: new ScrollTimeline({ source: scroll, axis: 'block' }), fill: 'both' },
    )
    return () => animation.cancel()
  }, [height, listRef, offsetTop, stickyOverlayHeight, totalHeight, viewportHeight])
  return windowRef
}
