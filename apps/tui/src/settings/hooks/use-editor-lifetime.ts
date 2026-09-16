import { useLayoutEffect, useRef, useState } from 'react'

/**
 * One abort signal for the life of an editor dialog, and a `close` that fires
 * it before telling the parent. Stable across renders so an effect can start
 * the host editor once against it.
 */
export function useEditorLifetime(onClose: () => void) {
  const onCloseRef = useRef(onClose)
  useLayoutEffect(() => {
    onCloseRef.current = onClose
  })
  const [lifetime] = useState(() => {
    const controller = new AbortController()
    return {
      signal: controller.signal,
      abort: () => controller.abort(),
      close() {
        if (controller.signal.aborted) return
        controller.abort()
        onCloseRef.current()
      },
    }
  })
  useLayoutEffect(() => lifetime.abort, [lifetime])

  return lifetime
}
