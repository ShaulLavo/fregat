import type { ChatTimelineItem } from '@/features/chat/utils/timeline-items'

/**
 * A row's part in a restore: the target turn, a turn the restore will remove, or any other row,
 * which only loses its revert action. Undefined while nothing restores.
 */
export type CheckpointRestoreRole = 'target' | 'receding' | 'other'

export function checkpointRestoreRoles(
  items: readonly ChatTimelineItem[],
  restoringId: string | null,
): ReadonlyMap<string, CheckpointRestoreRole> | null {
  if (restoringId === null) return null
  const target = items.findIndex(
    (item) => item.type === 'message' && item.message.id === restoringId,
  )
  const roles = new Map<string, CheckpointRestoreRole>()
  items.forEach((item, index) => {
    if (index === target) roles.set(item.id, 'target')
    else roles.set(item.id, target >= 0 && index > target ? 'receding' : 'other')
  })
  return roles
}
