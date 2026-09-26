import { useLayoutEffect, useRef, useState, type FragmentInstance } from 'react'

import { attachWorkLogScroll, type WorkLogContent } from '@/features/chat/state/work-log-scroll'

export function useWorkLogScroll(key: string, contentLength: number, kind: WorkLogContent['kind']) {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const rowsRef = useRef<FragmentInstance>(null)
  const scroll = useRef<ReturnType<typeof attachWorkLogScroll> | null>(null)

  useLayoutEffect(() => {
    if (!element) return
    const fragment = rowsRef.current
    if (kind === 'rows' && !fragment) return
    const content: WorkLogContent =
      kind === 'rows' && fragment ? { kind, fragment } : { kind: 'text' }
    const current = attachWorkLogScroll(element, key, content)
    scroll.current = current
    return () => {
      current.dispose()
      scroll.current = null
    }
  }, [element, key, kind])

  useLayoutEffect(() => {
    scroll.current?.update(contentLength)
  }, [contentLength, element, key])

  return { scrollRef: setElement, rowsRef }
}
