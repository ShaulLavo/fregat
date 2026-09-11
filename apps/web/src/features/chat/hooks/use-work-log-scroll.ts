import { useLayoutEffect, useRef, useState } from 'react'

import { attachWorkLogScroll } from '@/features/chat/state/work-log-scroll'

export function useWorkLogScroll(key: string, contentLength: number) {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const scroll = useRef<ReturnType<typeof attachWorkLogScroll> | null>(null)

  useLayoutEffect(() => {
    if (!element) return
    const current = attachWorkLogScroll(element, key)
    scroll.current = current
    return () => {
      current.dispose()
      scroll.current = null
    }
  }, [element, key])

  useLayoutEffect(() => {
    scroll.current?.update(contentLength)
  }, [contentLength, element, key])

  return setElement
}
