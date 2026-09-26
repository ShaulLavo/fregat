import { useLayoutEffect, useState, type RefObject } from 'react'

type ListGeometry = {
  /** The list's offset from the top of the scroller's content. */
  readonly scrollMargin: number
  /** Height of the sticky header above the list, which a revealed row must clear. */
  readonly stickyHeight: number
  /** The settings container is below `@3xl` (48rem), where rows stack. */
  readonly narrow: boolean
}

const NARROW_REM = 48

/**
 * Where a list sits inside a scroller it shares with the page, remeasured whenever anything in
 * the scroller resizes. Container queries have no script API, so width stands in for `@3xl`.
 */
export function useListGeometry(
  scrollRef: RefObject<HTMLDivElement | null> | null,
  listRef: RefObject<HTMLDivElement | null>,
  stickyRef: RefObject<HTMLDivElement | null>,
): ListGeometry {
  const [geometry, setGeometry] = useState<ListGeometry>({
    narrow: false,
    scrollMargin: 0,
    stickyHeight: 0,
  })

  useLayoutEffect(() => {
    const scroller = scrollRef?.current
    const list = listRef.current
    if (!scroller || !list) return

    const measure = () => {
      const next = measureList(scroller, list, stickyRef.current)
      setGeometry((previous) => (sameGeometry(previous, next) ? previous : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    for (const child of scroller.children) observer.observe(child)
    if (stickyRef.current) observer.observe(stickyRef.current)

    return () => observer.disconnect()
  }, [scrollRef, listRef, stickyRef])

  return geometry
}

function measureList(
  scroller: HTMLElement,
  list: HTMLElement,
  sticky: HTMLElement | null,
): ListGeometry {
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const offset =
    list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop

  return {
    narrow: scroller.clientWidth < NARROW_REM * rem,
    scrollMargin: Math.round(offset),
    stickyHeight: sticky?.offsetHeight ?? 0,
  }
}

function sameGeometry(left: ListGeometry, right: ListGeometry) {
  return (
    left.narrow === right.narrow &&
    left.scrollMargin === right.scrollMargin &&
    left.stickyHeight === right.stickyHeight
  )
}
