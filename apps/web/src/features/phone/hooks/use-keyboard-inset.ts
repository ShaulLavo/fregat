import { useEffect, useRef } from 'react'

/**
 * iOS lays the on-screen keyboard over the page instead of resizing it, so the frame pads its
 * bottom by what the keyboard covers. Chromium resizes the page (`interactive-widget` in
 * index.html) and this measures zero there.
 */
export function useKeyboardInset<T extends HTMLElement>() {
  const ref = useRef<T>(null)

  useEffect(() => {
    const viewport = window.visualViewport
    const element = ref.current
    if (!viewport || !element) return
    const update = () => {
      const covered = window.innerHeight - viewport.height - viewport.offsetTop
      element.style.setProperty('--keyboard-inset', `${Math.max(0, Math.round(covered))}px`)
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])

  return ref
}
