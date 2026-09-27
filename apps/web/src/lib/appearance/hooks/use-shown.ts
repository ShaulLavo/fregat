import { useCallback, useState } from 'react'

/** False until the element the returned ref lands on has been on screen, then true for good. */
export function useShown<TElement extends Element>() {
  const [shown, setShown] = useState(false)

  // Kept stable: React detaches the old ref callback on every identity change, which would
  // disconnect and re-observe the element on each render.
  const ref = useCallback((element: TElement | null) => {
    if (!element) return

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      setShown(true)
      observer.disconnect()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, shown] as const
}
