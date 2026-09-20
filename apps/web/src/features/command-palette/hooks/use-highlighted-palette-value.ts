import { isHighlightNavigationKey } from '@/features/command-palette/utils/query'
import { useEffect, useRef, useState } from 'react'

/**
 * The value of the row the palette currently highlights, reported however the
 * highlight moved — arrow keys, pointer, or the list re-filtering under a new
 * query.
 *
 * Read off the DOM rather than through cmdk's `onValueChange`, which only fires
 * when the list is a controlled component. Controlling it would mean owning
 * "which row is highlighted first after filtering", and only cmdk knows that —
 * it runs the filter. The `data-selected` attribute it writes is the same fact
 * without taking on that ownership.
 */
export function useHighlightedPaletteValue({
  enabled,
  onHighlight,
}: {
  readonly enabled: boolean
  readonly onHighlight: (value: string) => void
}) {
  const [list, setList] = useState<HTMLElement | null>(null)
  // The observer must not be torn down and rebuilt every render just because the
  // callback is a new closure; the latest one is read at report time instead.
  const onHighlightRef = useRef(onHighlight)
  useEffect(() => {
    onHighlightRef.current = onHighlight
  })

  useEffect(() => {
    if (!enabled || !list) return
    let active = true
    let reportQueued = false

    const reportHighlightedValue = () => {
      const value = list
        .querySelector('[cmdk-item][data-selected="true"]')
        ?.getAttribute('data-value')
      if (!value) return

      onHighlightRef.current(value)
    }
    const queueHighlightReport = () => {
      if (reportQueued) return

      // Cmdk updates selection later in the event; read after its handler runs.
      reportQueued = true
      globalThis.queueMicrotask(() => {
        reportQueued = false
        if (!active) return

        reportHighlightedValue()
      })
    }
    const handleNavigationKey = (event: KeyboardEvent) => {
      if (!isHighlightNavigationKey(event)) return

      queueHighlightReport()
    }

    reportHighlightedValue()
    const observer = new MutationObserver(reportHighlightedValue)
    observer.observe(list, {
      attributeFilter: ['aria-selected', 'data-selected'],
      subtree: true,
    })
    const commandRoot = list.closest<HTMLElement>('[cmdk-root]')
    commandRoot?.addEventListener('keydown', handleNavigationKey)
    commandRoot?.addEventListener('pointermove', queueHighlightReport)

    return () => {
      active = false
      observer.disconnect()
      commandRoot?.removeEventListener('keydown', handleNavigationKey)
      commandRoot?.removeEventListener('pointermove', queueHighlightReport)
    }
  }, [enabled, list])

  return setList
}
