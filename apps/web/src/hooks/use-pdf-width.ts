import { useEffect, useState } from 'react'

export function usePdfWidth() {
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!host) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width))
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [host])
  return { host, setHost, width }
}
