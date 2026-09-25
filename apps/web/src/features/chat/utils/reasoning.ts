import { formatChatElapsed } from '@/features/chat/utils/formatters'
import type { ChatTimelineItem } from '@/features/chat/utils/timeline-items'
import type { ChatWorkLogEntry } from '@/features/chat/utils/work-log'

/** How long a finished reasoning fold stays open before it folds itself. */
export const REASONING_FOLD_DELAY_MS = 1_000

export function reasoningLabel(entry: ChatWorkLogEntry, streaming: boolean) {
  if (streaming) return 'Thinking'
  // An entry with no later chunk has no measurable length.
  if (entry.lastActivityAt <= entry.createdAt) return 'Thought'

  const elapsed = formatChatElapsed(entry.createdAt, entry.lastActivityAt)
  return elapsed ? `Thought for ${elapsed}` : 'Thought'
}

export function streamingReasoningEntryId(items: readonly ChatTimelineItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.type === 'reasoning' && item.streaming) return item.entry.id
  }

  return null
}

/** Rows the automation opened that are no longer streaming, so they are due to fold. */
export function settledAutoOpenRowIds(
  autoExpanded: Readonly<Record<string, boolean>>,
  streamingId: string | null,
) {
  return Object.keys(autoExpanded).filter((id) => autoExpanded[id] && id !== streamingId)
}
