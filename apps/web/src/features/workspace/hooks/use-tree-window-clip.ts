import { useLayoutEffect, useRef, type RefObject } from 'react'

/** Keep the guide seam on the scroll timeline, including frames before React catches up. */
export function useTreeWindowClip({
  height,
  listRef,
  offsetTop,
  stickyBottomInset,
  stickyOverlayHeight,
  stickyTopInset,
  totalHeight,
  viewportHeight,
}: {
  readonly height: number
  readonly listRef: RefObject<HTMLDivElement | null>
  readonly offsetTop: number
  readonly stickyBottomInset: number
  readonly stickyOverlayHeight: number
  readonly stickyTopInset: number
  readonly totalHeight: number
  readonly viewportHeight: number
}) {
  const windowRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = windowRef.current
    const scroll = listRef.current?.parentElement
    const maxScroll = totalHeight - viewportHeight
    if (!element || !scroll || maxScroll <= 0 || stickyOverlayHeight <= 0) return
    const bottomTop = viewportHeight - height - stickyBottomInset
    const clipAt = (scrollTop: number): string => {
      const top = Math.max(stickyTopInset, Math.min(offsetTop - scrollTop, bottomTop))
      return `inset(${Math.max(0, stickyOverlayHeight - top)}px 0 0)`
    }
    if (typeof ScrollTimeline === 'undefined') {
      const update = () => element.style.setProperty('clip-path', clipAt(scroll.scrollTop))
      update()
      scroll.addEventListener('scroll', update, { passive: true })
      return () => scroll.removeEventListener('scroll', update)
    }
    // The window pins at either overscan edge; preserve those flat segments in the timeline.
    const positions = [
      ...new Set(
        [
          0,
          offsetTop - bottomTop,
          offsetTop - stickyOverlayHeight,
          offsetTop - stickyTopInset,
          maxScroll,
        ].map((value) => Math.max(0, Math.min(maxScroll, value))),
      ),
    ].sort((a, b) => a - b)
    const animation = element.animate(
      positions.map((position) => ({ offset: position / maxScroll, clipPath: clipAt(position) })),
      { timeline: new ScrollTimeline({ source: scroll, axis: 'block' }), fill: 'both' },
    )
    return () => animation.cancel()
  }, [
    height,
    listRef,
    offsetTop,
    stickyBottomInset,
    stickyOverlayHeight,
    stickyTopInset,
    totalHeight,
    viewportHeight,
  ])
  return windowRef
}
