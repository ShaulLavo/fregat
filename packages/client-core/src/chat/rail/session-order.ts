import type { ProjectionSession } from '@workspace/client-core/chat/types'
import { compareOrderKeys } from '@workspace/client-core/chat/rail/reorder'

type SessionOrderSource = Pick<ProjectionSession, 'createdAt' | 'id' | 'pinOrderKey'>

/**
 * The one order every chat-mode surface sorts by: the sessions the user has
 * dragged into place first, in the order they arranged them, then everything
 * else newest-created on top — and there it stays for the rest of its life.
 *
 * Activity is deliberately absent from the comparator. Sorting by last message
 * means an unrelated session finishing a turn slides the row you are aiming at
 * out from under the cursor — with several agents running at once that is not an
 * edge case, it is the normal state of the list. Status is carried by the row's
 * dot and its unread mark, never by its position.
 */
export function compareSessionsForRail(left: SessionOrderSource, right: SessionOrderSource) {
  return (
    compareOrderKeys(left.pinOrderKey ?? null, right.pinOrderKey ?? null) ||
    orderTimestampMs(right.createdAt) - orderTimestampMs(left.createdAt) ||
    left.id.localeCompare(right.id)
  )
}

/** A malformed stamp must not poison the whole ordering, so it sinks to the epoch. */
function orderTimestampMs(value: string) {
  const parsed = Date.parse(value)

  return Number.isNaN(parsed) ? 0 : parsed
}
