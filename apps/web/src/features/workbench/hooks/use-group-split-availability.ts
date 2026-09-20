import { useCallback, useSyncExternalStore } from 'react'
import { editorGroupElement, readGroupBounds } from '@/lib/documents/state/group-geometry'
import { canSplitGroup } from '@/lib/documents/utils/group-layout'
import type { GroupId } from '@/lib/documents/utils/group-types'

export function useGroupSplitAvailability(id: GroupId | null, open: boolean) {
  // Stable subscriptions keep an open menu in sync with layout and window resizes.
  const subscribe = useCallback(
    (notify: () => void) => {
      const element = id && open ? editorGroupElement(id) : null
      if (!element) return () => {}
      const observer = new ResizeObserver(notify)
      observer.observe(element)
      return () => observer.disconnect()
    },
    [id, open],
  )
  const snapshot = useCallback(() => {
    const bounds = id && open ? readGroupBounds(id) : null
    if (!bounds) return 0
    return Number(canSplitGroup(bounds, 'right')) + Number(canSplitGroup(bounds, 'bottom')) * 2
  }, [id, open])
  const availability = useSyncExternalStore(subscribe, snapshot, () => 0)
  return { right: (availability & 1) !== 0, down: (availability & 2) !== 0 }
}
