import { useCallback, useState } from 'react'

/** The width of the element the returned ref lands on; null until it attaches. */
export function useElementWidth<TElement extends HTMLElement>() {
  const [width, setWidth] = useState<number | null>(null)

  // Kept stable: React detaches the old ref callback on every identity change,
  // which would disconnect and re-observe the element on each render.
  const ref = useCallback((element: TElement | null) => {
    if (!element) return

    setWidth(element.clientWidth)
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}
