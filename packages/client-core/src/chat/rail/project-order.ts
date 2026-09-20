import { timestampMs as orderTimestampMs } from './timestamp'
import type { OrchestrationProjectShell, ProjectId } from '@workspace/contracts'

import { compareOrderKeys } from '@workspace/client-core/chat/rail/reorder'

type ProjectOrderSource = {
  readonly createdAt: string
  readonly id: ProjectId
  readonly orderKey: string | null
}

/**
 * Projects the user has dragged into place first, then the rest oldest-first.
 *
 * Neither selection nor activity is in here, for the same reason they are absent
 * from the session comparator: a project that jumps to the top the moment you
 * open a session in it — or slides a slot every time a session is created or
 * deleted — moves the row you were aiming at out from under the cursor. Which
 * project is active is carried by the highlighted row, never by its position.
 */
export function compareProjectsForRail(left: ProjectOrderSource, right: ProjectOrderSource) {
  return (
    compareOrderKeys(left.orderKey, right.orderKey) ||
    orderTimestampMs(left.createdAt) - orderTimestampMs(right.createdAt) ||
    left.id.localeCompare(right.id)
  )
}

/** Folds a drag still in flight over the key the server last confirmed. */
export function withProjectOrderKey(
  project: OrchestrationProjectShell,
  pendingOrderKey: string | undefined,
): OrchestrationProjectShell {
  const orderKey = pendingOrderKey ?? project.orderKey ?? null
  if (orderKey === project.orderKey) return project

  return { ...project, orderKey }
}
