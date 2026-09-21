import { useEffect, useRef, useState } from 'react'

import { TOOLTIP_DELAY } from '@workspace/ui/components/tooltip'
import { tooltipTargetFor, type TooltipTarget } from '@workspace/ui/patterns/tooltip-target'

/**
 * Moving straight from one row to the next should not re-wait: the user has
 * already asked for hover text. This is the window Base UI calls its grace
 * period, which a controlled tooltip has to keep itself.
 */
const INSTANT_AFTER_CLOSE_MS = 300

/**
 * Tracks what the pointer or keyboard is on, for the one shared tooltip.
 *
 * Delegation is what makes a single instance possible: rows carry an
 * attribute, so a virtualized list can recycle them without any tooltip
 * bookkeeping, and nothing is mounted per control.
 *
 * The delay lives here because a controlled `open` bypasses the provider's.
 */
export function useTooltipLayer(describedById: string) {
  const [target, setTarget] = useState<TooltipTarget | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const closedAt = useRef(0)

  useEffect(() => {
    function clearTimer() {
      if (timer.current === undefined) return

      window.clearTimeout(timer.current)
      timer.current = undefined
    }

    function hide() {
      clearTimer()
      setTarget((current) => {
        if (current) closedAt.current = Date.now()
        return null
      })
    }

    function open(next: TooltipTarget | null) {
      clearTimer()
      if (!next) {
        hide()
        return
      }
      if (Date.now() - closedAt.current < INSTANT_AFTER_CLOSE_MS) {
        setTarget(next)
        return
      }

      timer.current = window.setTimeout(() => setTarget(next), TOOLTIP_DELAY)
    }

    function show(event: Event) {
      open(tooltipTargetFor(event.target))
    }

    function showOnFocus(event: FocusEvent) {
      const next = tooltipTargetFor(event.target)
      open(next?.element.matches(':focus-visible') ? next : null)
    }

    function hideOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return

      hide()
    }

    // Capture: a row that stops propagation must not strand the tooltip open.
    document.addEventListener('pointerover', show, true)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('focusin', showOnFocus, true)
    document.addEventListener('focusout', hide, true)
    document.addEventListener('keydown', hideOnEscape, true)
    return () => {
      clearTimer()
      document.removeEventListener('pointerover', show, true)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('focusin', showOnFocus, true)
      document.removeEventListener('focusout', hide, true)
      document.removeEventListener('keydown', hideOnEscape, true)
    }
  }, [])

  // Scrolling a virtualized list can unmount the anchor under the pointer.
  useEffect(() => {
    if (!target) return

    function dropDetachedAnchor() {
      if (target?.element.isConnected) return

      setTarget(null)
    }

    document.addEventListener('scroll', dropDetachedAnchor, true)
    return () => document.removeEventListener('scroll', dropDetachedAnchor, true)
  }, [target])

  // The layer owns no trigger, so it announces the text the way one would.
  useEffect(() => {
    const element = target?.element
    if (!element) return

    element.setAttribute('aria-describedby', describedById)
    return () => element.removeAttribute('aria-describedby')
  }, [target, describedById])

  return target
}
