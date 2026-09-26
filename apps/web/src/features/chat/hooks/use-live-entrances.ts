import { useEffect, useRef } from 'react'
import type { ChatTimelineItem } from '@/features/chat/utils/timeline-items'

/** Mark only visible arrivals after the previous tail. Recycling a row never enters it. */
export function useLiveEntrances(
  element: HTMLElement | null,
  items: readonly Pick<ChatTimelineItem, 'id'>[],
) {
  const previous = useRef<string | undefined>(undefined)
  useEffect(() => {
    const last = previous.current
    previous.current = items.at(-1)?.id
    const edge = items.findIndex((item) => item.id === last)
    if (!element || last === undefined || edge < 0) return
    const feel = element.ownerDocument.documentElement.dataset.feel
    if (!feel || feel === 'flat') return
    const arrived = new Set(items.slice(edge + 1).map((item) => item.id))
    for (const row of element.querySelectorAll<HTMLElement>('[data-timeline-row-id]')) {
      if (!arrived.has(row.dataset.timelineRowId ?? '')) continue
      row.setAttribute('data-entering', '')
      const animations = row.getAnimations()
      void Promise.allSettled(animations.map((animation) => animation.finished)).then(() =>
        row.removeAttribute('data-entering'),
      )
    }
  }, [element, items])
}
