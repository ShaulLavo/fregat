import { emptySubscription } from '@workspace/utils/subscriptions'
import { useCallback, useSyncExternalStore } from 'react'
import {
  groupSplitVerdict,
  subscribeGroupGeometry,
} from '@/features/workbench/state/group-geometry'
import type { GroupId } from '@/lib/documents/utils/group-types'

export function useGroupSplitAvailability(id: GroupId | null, open: boolean) {
  // Manual memo: useSyncExternalStore re-reads when this changes, and the compiler's cache is a cache, not an identity
  // guarantee — a recompute hands it a cold value every render.
  const snapshot = useCallback(() => {
    if (!id || !open) return 0
    const right = groupSplitVerdict(id, 'right') !== 'too-small'
    const down = groupSplitVerdict(id, 'bottom') !== 'too-small'
    return Number(right) + Number(down) * 2
  }, [id, open])
  const availability = useSyncExternalStore(
    open ? subscribeGroupGeometry : emptySubscription,
    snapshot,
    () => 0,
  )
  return { right: (availability & 1) !== 0, down: (availability & 2) !== 0 }
}
