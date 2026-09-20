import { useLayoutEffect, useState, type RefObject } from 'react'
export function useElementWidth<TElement extends HTMLElement>(ref: RefObject<TElement | null>) {
  const [width, setWidth] = useState<number | null>(null)

  useLayoutEffect(() => {
    let disposed = false
    let observer: ResizeObserver | null = null
    let retryFrame = 0

    function updateWidth(element: TElement) {
      setWidth(element.clientWidth)
    }

    function attachObserver() {
      if (disposed) return

      const element = ref.current
      if (!element) {
        retryFrame = requestAnimationFrame(attachObserver)
        return
      }

      updateWidth(element)
      if (!('ResizeObserver' in window)) return

      observer = new ResizeObserver(() => updateWidth(element))
      observer.observe(element)
    }

    attachObserver()

    return () => {
      disposed = true
      observer?.disconnect()
      cancelAnimationFrame(retryFrame)
    }
  }, [ref])

  return width
}
