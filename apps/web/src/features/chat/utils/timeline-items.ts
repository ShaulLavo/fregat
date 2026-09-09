import type {
  OrchestrationLatestTurn,
  OrchestrationMessage,
  OrchestrationProposedPlan,
  OrchestrationSessionActivity,
  TurnId,
} from '@workspace/contracts'

import type { OptimisticChatMessage } from '@/features/chat/state/chat-optimistic-store'
import type { ChatTurnDiffSummary } from '@workspace/client-core/chat/types'
import { formatChatElapsed } from '@/features/chat/utils/formatters'
import {
  chatMessageTimelineMetadata,
  type ChatTimelineMessage,
  fallbackChatMessageTimelineMetadata,
} from '@/features/chat/utils/message-metadata'
import {
  chatActiveWorkLogPlan,
  chatWorkLogEntries,
  chatWorkLogEntryEquals,
  chatWorkLogPlanEquals,
  type ChatWorkLogEntry,
  type ChatWorkLogPlan,
} from '@/features/chat/utils/work-log'

export type ChatTimelineItem =
  | {
      activeTurnId: TurnId | null
      activities: ChatWorkLogEntry[]
      id: string
      timestamp: string
      type: 'activity-group'
    }
  | {
      assistantStreaming: boolean
      assistantTurnInProgress: boolean
      completionSummary: string | null
      durationEnd: string
      durationStart: string
      id: string
      message: OrchestrationMessage | OptimisticChatMessage
      revertTurnCount: number | null
      showAssistantCopyButton: boolean
      showCompletionDivider: boolean
      timestamp: string
      turnDiffSummary: ChatTurnDiffSummary | null
      type: 'message'
    }
  | {
      hiddenCount: number
      id: string
      items: readonly ChatTimelineItem[]
      label: string
      timestamp: string
      turnId: TurnId
      type: 'turn-fold'
    }
  | {
      id: string
      latestTurn: OrchestrationLatestTurn
      plan: ChatWorkLogPlan | null
      timestamp: string
      type: 'working'
    }
  | {
      id: string
      plan: OrchestrationProposedPlan
      timestamp: string
      type: 'proposed-plan'
    }

type ChronologicalTimelineItem =
  | {
      activity: ChatWorkLogEntry
      id: string
      sourceOrder: number
      timestamp: string
      type: 'activity'
    }
  | {
      assistantStreaming: boolean
      assistantTurnInProgress: boolean
      completionSummary: string | null
      durationEnd: string
      durationStart: string
      id: string
      message: OrchestrationMessage | OptimisticChatMessage
      revertTurnCount: number | null
      showAssistantCopyButton: boolean
      showCompletionDivider: boolean
      sourceOrder: number
      timestamp: string
      turnDiffSummary: ChatTurnDiffSummary | null
      type: 'message'
    }
  | {
      id: string
      plan: OrchestrationProposedPlan
      sourceOrder: number
      timestamp: string
      type: 'proposed-plan'
    }

type TurnFold = {
  entries: readonly ChronologicalTimelineItem[]
  label: string
  turnId: TurnId
}

type TurnFoldGroup = {
  entries: ChronologicalTimelineItem[]
  hasStreamingMessage: boolean
  /**
   * The user message that kicked the turn off. Entry timestamps alone undercount the
   * duration: the first entry only appears once the provider starts producing output.
   */
  startBoundary: string | null
  terminalMessageId: string | null
}

type StableTimelineItems = {
  byId: ReadonlyMap<string, ChatTimelineItem>
  result: readonly ChatTimelineItem[]
}

const NO_FOLDS: ReadonlyMap<string, TurnFold> = new Map()
const EMPTY_STABLE_TIMELINE_ITEMS: StableTimelineItems = { byId: new Map(), result: [] }
/** One entry per session the user has open; sessions are switched, not held. */
const MAX_STABLE_TIMELINES = 8

/**
 * Rows are re-derived from scratch on every projection tick, so identity has to be
 * handed back here — the consumer memoizes on the items array, and that array changes
 * on every streaming delta. Without this, one chunk re-renders every visible row.
 */
const stableTimelineItemsBySession = new Map<string, StableTimelineItems>()

export function chatTimelineItems({
  activities,
  latestTurn,
  messages,
  optimisticMessages,
  proposedPlans,
  turnDiffSummaries = [],
}: {
  activities: readonly OrchestrationSessionActivity[]
  latestTurn: OrchestrationLatestTurn | null
  messages: readonly OrchestrationMessage[]
  optimisticMessages: readonly OptimisticChatMessage[]
  proposedPlans: readonly OrchestrationProposedPlan[]
  turnDiffSummaries?: readonly ChatTurnDiffSummary[]
}) {
  const resolvedMessageIds = new Set(messages.map((message) => message.id))
  const visibleOptimisticMessages = optimisticMessages.filter(
    (message) => !resolvedMessageIds.has(message.id),
  )
  const timelineMessages = [...messages, ...visibleOptimisticMessages]
  const workLogEntries = chatWorkLogEntries({ activities })
  const messageMetadata = chatMessageTimelineMetadata({
    latestTurn,
    messages: timelineMessages,
    // The completion divider reports the latest turn's duration, so only that turn's
    // work decides whether there was anything to report.
    showCompletionSummary: latestTurnWorkLogEntryCount(workLogEntries, latestTurn) > 0,
  })
  const turnDiffSummaryByAssistantMessageId = deriveTurnDiffSummaryByAssistantMessageId(
    turnDiffSummaries,
    timelineMessages,
  )
  const revertTurnCountByUserMessageId = deriveRevertTurnCountByUserMessageId(
    timelineMessages,
    turnDiffSummaryByAssistantMessageId,
  )
  const items: ChronologicalTimelineItem[] = []
  let sourceOrder = 0

  for (const message of messages) {
    items.push(
      messageTimelineItem(
        message,
        sourceOrder,
        messageMetadata.get(message.id),
        turnDiffSummaryByAssistantMessageId.get(message.id) ?? null,
        revertTurnCountByUserMessageId.get(message.id) ?? null,
      ),
    )
    sourceOrder += 1
  }
  for (const message of visibleOptimisticMessages) {
    items.push(
      messageTimelineItem(
        message,
        sourceOrder,
        messageMetadata.get(message.id),
        turnDiffSummaryByAssistantMessageId.get(message.id) ?? null,
        revertTurnCountByUserMessageId.get(message.id) ?? null,
      ),
    )
    sourceOrder += 1
  }
  for (const plan of proposedPlans) {
    items.push(proposedPlanTimelineItem(plan, sourceOrder))
    sourceOrder += 1
  }
  for (const activity of workLogEntries) {
    items.push(activityTimelineItem(activity, sourceOrder))
    sourceOrder += 1
  }

  const chronological = items.toSorted(compareTimelineEntries)
  const timelineItems = arrangeTimelineItems(
    chronological,
    deriveTurnFolds(chronological, latestTurn),
    latestTurn?.state === 'running' ? latestTurn.turnId : null,
  )
  if (latestTurn?.state === 'running') {
    timelineItems.push(
      workingTimelineItem(latestTurn, chatActiveWorkLogPlan(workLogEntries, latestTurn.turnId)),
    )
  }

  return shareTimelineItems(
    timelineCacheKey(messages, activities, proposedPlans, optimisticMessages),
    timelineItems,
  )
}

function latestTurnWorkLogEntryCount(
  entries: readonly ChatWorkLogEntry[],
  latestTurn: OrchestrationLatestTurn | null,
) {
  if (!latestTurn) return entries.length

  return entries.filter((entry) => entry.turnId === latestTurn.turnId).length
}

export function chatTimelineItemEstimate(item: ChatTimelineItem | undefined) {
  if (!item) return 64
  if (item.type === 'activity-group') return Math.min(220, 36 + item.activities.length * 28)
  if (item.type === 'proposed-plan') return 160
  if (item.type === 'turn-fold') return 34
  if (item.type === 'working') return item.plan?.currentStep ? 72 : 52

  const dividerHeight = item.showCompletionDivider ? 34 : 0
  const changedFilesHeight =
    item.turnDiffSummary && item.turnDiffSummary.files.length > 0
      ? Math.min(220, 46 + item.turnDiffSummary.files.length * 24)
      : 0
  const messageHeight = Math.min(
    220,
    Math.max(56, 42 + Math.ceil(item.message.text.length / 48) * 18),
  )

  return dividerHeight + messageHeight + changedFilesHeight
}

function messageTimelineItem(
  message: OrchestrationMessage | OptimisticChatMessage,
  sourceOrder: number,
  metadata = fallbackChatMessageTimelineMetadata(message),
  turnDiffSummary: ChatTurnDiffSummary | null = null,
  revertTurnCount: number | null = null,
): ChronologicalTimelineItem {
  return {
    assistantStreaming: metadata.assistantStreaming,
    assistantTurnInProgress: metadata.assistantTurnInProgress,
    completionSummary: metadata.completionSummary,
    durationEnd: metadata.durationEnd,
    durationStart: metadata.durationStart,
    id: `message:${message.id}`,
    message,
    revertTurnCount,
    showAssistantCopyButton: metadata.showAssistantCopyButton,
    showCompletionDivider: metadata.showCompletionDivider,
    sourceOrder,
    timestamp: message.createdAt,
    turnDiffSummary,
    type: 'message',
  }
}

function activityTimelineItem(
  activity: ChatWorkLogEntry,
  sourceOrder: number,
): ChronologicalTimelineItem {
  return {
    activity,
    id: `activity:${activity.id}`,
    sourceOrder,
    timestamp: activity.createdAt,
    type: 'activity',
  }
}

function workingTimelineItem(
  latestTurn: OrchestrationLatestTurn,
  plan: ChatWorkLogPlan | null,
): ChatTimelineItem {
  return {
    id: `working:${latestTurn.turnId}`,
    latestTurn,
    plan,
    timestamp: latestTurn.startedAt ?? latestTurn.requestedAt,
    type: 'working',
  }
}

function proposedPlanTimelineItem(
  plan: OrchestrationProposedPlan,
  sourceOrder: number,
): ChronologicalTimelineItem {
  return {
    id: `proposed-plan:${plan.id}`,
    plan,
    sourceOrder,
    timestamp: plan.createdAt,
    type: 'proposed-plan',
  }
}

function compareTimelineEntries(left: ChronologicalTimelineItem, right: ChronologicalTimelineItem) {
  return left.timestamp.localeCompare(right.timestamp) || left.sourceOrder - right.sourceOrder
}

/**
 * Walks the chronological entries once, emitting a fold row where a settled turn's work
 * begins, dropping that work, and merging whatever activity rows remain adjacent.
 */
function arrangeTimelineItems(
  entries: readonly ChronologicalTimelineItem[],
  folds: ReadonlyMap<string, TurnFold>,
  activeTurnId: TurnId | null,
) {
  const hiddenEntryIds = foldedEntryIds(folds)
  const foldedTurnIds = new Set([...folds.values()].map((fold) => fold.turnId))
  const arranged: ChatTimelineItem[] = []
  let pendingActivities: ChatWorkLogEntry[] = []
  const flushActivities = () => {
    appendActivityGroup(arranged, pendingActivities, activeTurnId)
    pendingActivities = []
  }

  for (const entry of entries) {
    const fold = folds.get(entry.id)
    if (fold) {
      flushActivities()
      arranged.push(turnFoldTimelineItem(fold))
    }
    if (hiddenEntryIds.has(entry.id)) continue
    if (entry.type === 'activity') {
      pendingActivities.push(entry.activity)
      continue
    }

    flushActivities()
    arranged.push(timelineItemFromEntry(entry, foldedTurnIds))
  }

  flushActivities()

  return arranged
}

function foldedEntryIds(folds: ReadonlyMap<string, TurnFold>) {
  const ids = new Set<string>()
  for (const fold of folds.values()) {
    for (const entry of fold.entries) ids.add(entry.id)
  }

  return ids
}

function turnFoldTimelineItem(fold: TurnFold): ChatTimelineItem {
  const anchor = fold.entries[0]

  return {
    hiddenCount: fold.entries.length,
    id: `turn-fold:${fold.turnId}`,
    items: arrangeTimelineItems(fold.entries, NO_FOLDS, null),
    label: fold.label,
    timestamp: anchor?.timestamp ?? '',
    turnId: fold.turnId,
    type: 'turn-fold',
  }
}

function timelineItemFromEntry(
  item: Exclude<ChronologicalTimelineItem, { type: 'activity' }>,
  foldedTurnIds: ReadonlySet<TurnId>,
): ChatTimelineItem {
  if (item.type === 'message') {
    const turnId = entryTurnId(item)

    return {
      assistantStreaming: item.assistantStreaming,
      assistantTurnInProgress: item.assistantTurnInProgress,
      completionSummary: item.completionSummary,
      durationEnd: item.durationEnd,
      durationStart: item.durationStart,
      id: item.id,
      message: item.message,
      revertTurnCount: item.revertTurnCount,
      showAssistantCopyButton: item.showAssistantCopyButton,
      // A folded turn already reports its duration on the fold row, so the message-level
      // divider under it would draw a second rule saying the same thing.
      showCompletionDivider:
        item.showCompletionDivider && !(turnId !== null && foldedTurnIds.has(turnId)),
      timestamp: item.timestamp,
      turnDiffSummary: item.turnDiffSummary,
      type: item.type,
    }
  }

  return {
    id: item.id,
    plan: item.plan,
    timestamp: item.timestamp,
    type: item.type,
  }
}

/**
 * A settled turn folds its commentary and tool work behind a "Worked for ..." row anchored
 * where the work began; the message that ends the turn stays visible below it. Restoring
 * history without this turns a long session into a wall of tool rows.
 */
function deriveTurnFolds(
  entries: readonly ChronologicalTimelineItem[],
  latestTurn: OrchestrationLatestTurn | null,
) {
  const unsettledTurnId = deriveUnsettledTurnId(latestTurn)
  const folds = new Map<string, TurnFold>()

  for (const [turnId, group] of turnFoldGroups(entries)) {
    if (turnId === unsettledTurnId) continue
    // A turn whose text is still arriving has no duration to report yet, and folding
    // mid-stream would yank the rows the user is watching.
    if (group.hasStreamingMessage) continue

    const foldable = group.entries.filter((entry) => entry.id !== group.terminalMessageId)
    const anchor = foldable[0]
    if (!anchor) continue

    folds.set(anchor.id, {
      entries: foldable,
      label: turnFoldLabel(group, latestTurn, turnId),
      turnId,
    })
  }

  return folds
}

/**
 * Keyed on turn lifecycle rather than transient working state: right after the user sends,
 * the previous turn is still the latest one until the server creates the new turn, and the
 * fold must not flicker through that window.
 */
function deriveUnsettledTurnId(latestTurn: OrchestrationLatestTurn | null) {
  if (!latestTurn) return null
  if (latestTurn.completedAt !== null && latestTurn.state !== 'running') return null

  return latestTurn.turnId
}

function turnFoldGroups(entries: readonly ChronologicalTimelineItem[]) {
  const groups = new Map<TurnId, TurnFoldGroup>()
  let pendingUserBoundary: string | null = null

  for (const entry of entries) {
    if (isUserMessageEntry(entry)) {
      pendingUserBoundary = entry.timestamp
      continue
    }

    const turnId = entryTurnId(entry)
    if (!turnId) continue

    const group = groups.get(turnId)
    if (!group) {
      // Each user boundary starts at most one turn; a later turn under the same user
      // message falls back to its own first entry.
      groups.set(turnId, newTurnFoldGroup(entry, pendingUserBoundary))
      pendingUserBoundary = null
      continue
    }

    appendTurnFoldEntry(group, entry)
  }

  return groups
}

function newTurnFoldGroup(
  entry: ChronologicalTimelineItem,
  startBoundary: string | null,
): TurnFoldGroup {
  const group: TurnFoldGroup = {
    entries: [],
    hasStreamingMessage: false,
    startBoundary,
    terminalMessageId: null,
  }
  appendTurnFoldEntry(group, entry)

  return group
}

function appendTurnFoldEntry(group: TurnFoldGroup, entry: ChronologicalTimelineItem) {
  group.entries.push(entry)
  if (entry.type !== 'message') return
  if (entry.showAssistantCopyButton) group.terminalMessageId = entry.id
  if (entry.assistantStreaming || entry.assistantTurnInProgress) group.hasStreamingMessage = true
}

function isUserMessageEntry(entry: ChronologicalTimelineItem) {
  return entry.type === 'message' && entry.message.role === 'user'
}

/** Proposed plans stay out of every fold: they are the user's decision, not the turn's work. */
function entryTurnId(entry: ChronologicalTimelineItem): TurnId | null {
  if (entry.type === 'activity') return entry.activity.turnId
  if (entry.type !== 'message') return null
  if (entry.message.role !== 'assistant') return null

  return entry.message.turnId
}

function turnFoldLabel(
  group: TurnFoldGroup,
  latestTurn: OrchestrationLatestTurn | null,
  turnId: TurnId,
) {
  const elapsed = turnFoldElapsed(group, latestTurn, turnId)
  if (latestTurn?.turnId === turnId && latestTurn.state === 'interrupted') {
    return elapsed ? `You stopped after ${elapsed}` : 'You stopped this response'
  }

  return elapsed ? `Worked for ${elapsed}` : 'Worked'
}

function turnFoldElapsed(
  group: TurnFoldGroup,
  latestTurn: OrchestrationLatestTurn | null,
  turnId: TurnId,
) {
  if (latestTurn?.turnId === turnId && latestTurn.startedAt && latestTurn.completedAt) {
    return formatChatElapsed(latestTurn.startedAt, latestTurn.completedAt)
  }

  const first = group.entries[0]
  if (!first) return null

  return formatChatElapsed(group.startBoundary ?? first.timestamp, turnFoldEnd(group))
}

/** A turn cut short by a steer leaves work behind its last message — take whichever ended last. */
function turnFoldEnd(group: TurnFoldGroup) {
  let end = ''
  for (const entry of group.entries) {
    const entryEnd = entry.type === 'message' ? entry.message.updatedAt : entry.timestamp
    if (entryEnd.localeCompare(end) <= 0) continue

    end = entryEnd
  }

  return end
}

function deriveTurnDiffSummaryByAssistantMessageId(
  summaries: readonly ChatTurnDiffSummary[],
  messages: readonly ChatTimelineMessage[],
) {
  const lastAssistantMessageIdByTurnId = new Map<string, string>()
  for (const message of messages.toSorted(compareMessagesByCreatedAt)) {
    if (message.role !== 'assistant') continue
    if (!message.turnId) continue

    lastAssistantMessageIdByTurnId.set(message.turnId, message.id)
  }

  const summaryByAssistantMessageId = new Map<string, ChatTurnDiffSummary>()
  for (const summary of summaries) {
    const assistantMessageId =
      summary.assistantMessageId ?? lastAssistantMessageIdByTurnId.get(summary.turnId)
    if (!assistantMessageId) continue

    summaryByAssistantMessageId.set(assistantMessageId, summary)
  }

  return summaryByAssistantMessageId
}

function deriveRevertTurnCountByUserMessageId(
  messages: readonly ChatTimelineMessage[],
  summaryByAssistantMessageId: ReadonlyMap<string, ChatTurnDiffSummary>,
) {
  const chronologicalMessages = messages.toSorted(compareMessagesByCreatedAt)
  const counts = new Map<string, number>()

  for (let index = 0; index < chronologicalMessages.length; index += 1) {
    const message = chronologicalMessages[index]
    if (!message || message.role !== 'user') continue

    const turnCount = revertTurnCountAfterUserMessage(
      chronologicalMessages,
      index,
      summaryByAssistantMessageId,
    )
    if (turnCount === null) continue

    counts.set(message.id, turnCount)
  }

  return counts
}

function revertTurnCountAfterUserMessage(
  messages: readonly ChatTimelineMessage[],
  userMessageIndex: number,
  summaryByAssistantMessageId: ReadonlyMap<string, ChatTurnDiffSummary>,
) {
  for (let index = userMessageIndex + 1; index < messages.length; index += 1) {
    const message = messages[index]
    if (!message) continue
    if (message.role === 'user') return null
    if (message.role !== 'assistant') continue

    const summary = summaryByAssistantMessageId.get(message.id)
    if (!summary) continue

    return Math.max(0, summary.checkpointTurnCount - 1)
  }

  return null
}

function compareMessagesByCreatedAt(left: ChatTimelineMessage, right: ChatTimelineMessage) {
  return left.createdAt.localeCompare(right.createdAt)
}

function appendActivityGroup(
  items: ChatTimelineItem[],
  activities: readonly ChatWorkLogEntry[],
  activeTurnId: TurnId | null,
) {
  const firstActivity = activities[0]
  if (!firstActivity) return

  items.push({
    activeTurnId,
    activities: [...activities],
    id: `activity-group:${firstActivity.id}`,
    timestamp: firstActivity.createdAt,
    type: 'activity-group',
  })
}

function timelineCacheKey(
  messages: readonly OrchestrationMessage[],
  activities: readonly OrchestrationSessionActivity[],
  proposedPlans: readonly OrchestrationProposedPlan[],
  optimisticMessages: readonly OptimisticChatMessage[],
) {
  return (
    messages[0]?.sessionId ??
    activities[0]?.sessionId ??
    proposedPlans[0]?.sessionId ??
    optimisticMessages[0]?.sessionId ??
    ''
  )
}

/**
 * Hands every unchanged row back its previous object, and the whole array back when nothing
 * moved, so a streaming chunk only re-renders the row it actually touched.
 */
function shareTimelineItems(cacheKey: string, items: readonly ChatTimelineItem[]) {
  const previous = stableTimelineItemsBySession.get(cacheKey) ?? EMPTY_STABLE_TIMELINE_ITEMS
  const byId = new Map<string, ChatTimelineItem>()
  const result = shareItems(items, previous.byId, byId)
  const unchanged =
    previous.result.length === result.length &&
    result.every((item, index) => previous.result[index] === item)

  return rememberStableTimelineItems(cacheKey, unchanged ? previous : { byId, result }).result
}

function rememberStableTimelineItems(cacheKey: string, stable: StableTimelineItems) {
  // Re-inserting keeps the map in least-recently-used order, so the eviction below drops
  // the session the user left longest ago.
  stableTimelineItemsBySession.delete(cacheKey)
  stableTimelineItemsBySession.set(cacheKey, stable)

  const oldest = stableTimelineItemsBySession.keys().next()
  if (stableTimelineItemsBySession.size > MAX_STABLE_TIMELINES && !oldest.done) {
    stableTimelineItemsBySession.delete(oldest.value)
  }

  return stable
}

function shareItems(
  items: readonly ChatTimelineItem[],
  previousById: ReadonlyMap<string, ChatTimelineItem>,
  nextById: Map<string, ChatTimelineItem>,
): ChatTimelineItem[] {
  return items.map((item) => {
    const candidate = withSharedFoldItems(item, previousById, nextById)
    const previous = previousById.get(candidate.id)
    const shared = previous && timelineItemsEqual(previous, candidate) ? previous : candidate
    nextById.set(shared.id, shared)

    return shared
  })
}

/** Folded rows are shared first so the fold itself can compare its children by identity. */
function withSharedFoldItems(
  item: ChatTimelineItem,
  previousById: ReadonlyMap<string, ChatTimelineItem>,
  nextById: Map<string, ChatTimelineItem>,
): ChatTimelineItem {
  if (item.type !== 'turn-fold') return item

  return { ...item, items: shareItems(item.items, previousById, nextById) }
}

function timelineItemsEqual(left: ChatTimelineItem, right: ChatTimelineItem): boolean {
  if (left === right) return true
  if (left.id !== right.id) return false
  if (left.timestamp !== right.timestamp) return false
  if (left.type === 'message' && right.type === 'message') return messageItemsEqual(left, right)
  if (left.type === 'activity-group' && right.type === 'activity-group') {
    return (
      left.activeTurnId === right.activeTurnId &&
      activityListsEqual(left.activities, right.activities)
    )
  }
  if (left.type === 'turn-fold' && right.type === 'turn-fold')
    return turnFoldItemsEqual(left, right)
  if (left.type === 'proposed-plan' && right.type === 'proposed-plan') {
    return left.plan === right.plan
  }
  if (left.type === 'working' && right.type === 'working') {
    return left.latestTurn === right.latestTurn && chatWorkLogPlanEquals(left.plan, right.plan)
  }

  return false
}

function messageItemsEqual(
  left: Extract<ChatTimelineItem, { type: 'message' }>,
  right: Extract<ChatTimelineItem, { type: 'message' }>,
) {
  return (
    left.message === right.message &&
    left.turnDiffSummary === right.turnDiffSummary &&
    left.assistantStreaming === right.assistantStreaming &&
    left.assistantTurnInProgress === right.assistantTurnInProgress &&
    left.completionSummary === right.completionSummary &&
    left.durationEnd === right.durationEnd &&
    left.durationStart === right.durationStart &&
    left.revertTurnCount === right.revertTurnCount &&
    left.showAssistantCopyButton === right.showAssistantCopyButton &&
    left.showCompletionDivider === right.showCompletionDivider
  )
}

function turnFoldItemsEqual(
  left: Extract<ChatTimelineItem, { type: 'turn-fold' }>,
  right: Extract<ChatTimelineItem, { type: 'turn-fold' }>,
) {
  if (left.label !== right.label) return false
  if (left.hiddenCount !== right.hiddenCount) return false
  if (left.turnId !== right.turnId) return false
  if (left.items.length !== right.items.length) return false

  return left.items.every((item, index) => item === right.items[index])
}

function activityListsEqual(left: readonly ChatWorkLogEntry[], right: readonly ChatWorkLogEntry[]) {
  if (left.length !== right.length) return false

  return left.every((entry, index) => {
    const other = right[index]
    return other !== undefined && chatWorkLogEntryEquals(entry, other)
  })
}
