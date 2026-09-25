import type { OrchestrationLatestTurn, TurnId } from '@workspace/contracts'

import { isWorkLogToolEntry, workLogEntryLabel } from '@/features/chat/utils/tool-label'
import type { ChatWorkLogEntry } from '@/features/chat/utils/work-log'
import { isWorkLogFailure } from '@/features/chat/utils/work-row'

export type ChatLiveActivity = {
  entry: ChatWorkLogEntry | null
  label: string
  active: boolean
  activities: readonly ChatWorkLogEntry[]
  /** The response's newest calls, oldest first; empty until its first one. */
  tail: readonly ChatWorkLogEntry[]
}

/** Rows the live tail shows; its height is reserved for all of them from the first call. */
export const LIVE_TAIL_ROWS = 3

export function deriveChatLiveActivity({
  entries,
  trailingEntries,
  latestTurn,
  assistantStreaming = false,
  activeResponseTurnIds,
}: {
  entries: readonly ChatWorkLogEntry[]
  trailingEntries: readonly ChatWorkLogEntry[]
  latestTurn: OrchestrationLatestTurn | null
  assistantStreaming?: boolean
  activeResponseTurnIds?: ReadonlySet<TurnId>
}): ChatLiveActivity | null {
  if (latestTurn?.state !== 'running' || latestTurn.completedAt !== null) return null

  const responseEntries = entries.filter(
    (entry) =>
      entry.plan === null &&
      (entry.turnId === latestTurn.turnId ||
        (entry.turnId !== null && activeResponseTurnIds?.has(entry.turnId))),
  )
  const activities = trailingEntries
  const tail = responseEntries.filter((entry) => !entry.reasoning).slice(-LIVE_TAIL_ROWS)
  const live = liveActivityState({ activities, assistantStreaming, latestTurn, responseEntries })
  return { ...live, activities, tail }
}

function liveActivityState({
  activities,
  assistantStreaming,
  latestTurn,
  responseEntries,
}: {
  activities: readonly ChatWorkLogEntry[]
  assistantStreaming: boolean
  latestTurn: OrchestrationLatestTurn
  responseEntries: readonly ChatWorkLogEntry[]
}): Pick<ChatLiveActivity, 'active' | 'entry' | 'label'> {
  const waiting = pendingInteraction(responseEntries)
  if (waiting) return { entry: waiting, label: waitingLabel(waiting), active: false }

  const running = responseEntries.findLast(
    (entry) =>
      entry.turnId === latestTurn.turnId &&
      isWorkLogToolEntry(entry) &&
      entry.lifecycle === 'running',
  )
  if (running) return { entry: running, label: workLogEntryLabel(running, true), active: true }
  if (assistantStreaming) return { entry: null, label: 'Responding', active: true }
  const newest = responseEntries.at(-1)
  if (newest?.reasoning) return { entry: newest, label: 'Thinking', active: true }

  const latest = activities.at(-1)
  if (
    latest &&
    isWorkLogToolEntry(latest) &&
    latest.lifecycle === 'completed' &&
    !isWorkLogFailure(latest)
  ) {
    return { entry: latest, label: workLogEntryLabel(latest, false), active: true }
  }
  if (latest?.tone === 'thinking') return { entry: latest, label: 'Thinking', active: true }

  // Work already on screen means the turn started, even before the provider says so.
  const started = latestTurn.startedAt !== null || responseEntries.length > 0
  return { entry: null, label: started ? 'Thinking' : 'Starting', active: true }
}

function pendingInteraction(entries: readonly ChatWorkLogEntry[]) {
  const pending = new Map<string, ChatWorkLogEntry>()
  for (const entry of entries) {
    if (!entry.sourceKind.startsWith('approval.') && !entry.sourceKind.startsWith('user-input.'))
      continue
    const family = entry.sourceKind.split('.')[0]
    const key = `${family}:${entry.requestId ?? 'unkeyed'}`
    if (entry.sourceKind.endsWith('.resolved')) {
      pending.delete(key)
      continue
    }
    if (entry.sourceKind.endsWith('.requested')) pending.set(key, entry)
  }

  return pending.values().next().value ?? null
}

function waitingLabel(entry: ChatWorkLogEntry) {
  return entry.sourceKind === 'approval.requested'
    ? 'Waiting for approval'
    : 'Waiting for your answer'
}

export function liveTailLabel(entry: ChatWorkLogEntry) {
  return entry.command ?? workLogEntryLabel(entry, entry.lifecycle === 'running')
}
