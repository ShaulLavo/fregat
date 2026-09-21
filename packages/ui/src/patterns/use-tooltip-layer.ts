import { useEffect, useState } from 'react'

import { tooltipTargetFor, type TooltipTarget } from '@workspace/ui/patterns/tooltip-target'

/**
 * Tracks what the pointer or keyboard is on, for the one shared tooltip.
 *
 * Delegation is what makes a single instance possible: rows carry an
 * attribute, so a virtualized list can recycle them without any tooltip
 * bookkeeping, and nothing is mounted per control.
 */
export function useTooltipLayer(describedById: string) {
  const [target, setTarget] = useState<TooltipTarget | null>(null)

  useEffect(() => {
    function show(event: Event) {
      setTarget(tooltipTargetFor(event.target))
    }

    function showOnFocus(event: FocusEvent) {
      const next = tooltipTargetFor(event.target)
      setTarget(next?.element.matches(':focus-visible') ? next : null)
    }

    function hide() {
      setTarget(null)
    }

    function hideOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return

      setTarget(null)
    }

    // Capture: a row that stops propagation must not strand the tooltip open.
    document.addEventListener('pointerover', show, true)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('focusin', showOnFocus, true)
    document.addEventListener('focusout', hide, true)
    document.addEventListener('keydown', hideOnEscape, true)
    return () => {
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
