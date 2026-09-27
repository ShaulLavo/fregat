import { useEffect } from 'react'

/**
 * iOS lays the on-screen keyboard over the page instead of resizing it, so the frame pads its
 * bottom by what the keyboard covers, and sheets sit above it. Chromium resizes the page
 * (`interactive-widget` in index.html) and this measures zero there. On the root, because sheets
 * portal out of the frame.
 */
export function useKeyboardInset() {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const root = document.documentElement
    const update = () => {
      const covered = window.innerHeight - viewport.height - viewport.offsetTop
      root.style.setProperty('--keyboard-inset', `${Math.max(0, Math.round(covered))}px`)
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      root.style.removeProperty('--keyboard-inset')
    }
  }, [])
}
