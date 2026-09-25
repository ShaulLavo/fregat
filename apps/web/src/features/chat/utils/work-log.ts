import {
  questionAnswerHistory,
  questionAnswerHistoryEqual,
  type QuestionAnswerRow,
} from './question-answer-history'
import { sameItems as stringListsEqual } from '@workspace/utils/collections'
import { compactActivityLabel } from '@/features/chat/utils/activity-label'
import type { OrchestrationLatestTurn, OrchestrationSessionActivity } from '@workspace/contracts'

import {
  chatActivityHasFailure,
  chatActivityPlanSteps,
  chatActivityPresentation,
  chatActivityReasoningDelta,
  chatActivityToolCallId,
  type ChatActivityIconKey,
  type ChatActivityLifecycle,
  type ChatActivityOutcome,
  type ChatActivityPlanStep,
  type ChatActivityTool,
} from '@/features/chat/utils/activity-presentation'
import { isVisibleChatActivity } from '@/features/chat/utils/activity-visibility'
import { chatAgentActivity } from '@/features/chat/utils/agent-activity'

type ChatWorkLogTone = 'error' | 'info' | 'thinking' | 'tool'

export type ChatWorkLogPlan = {
  completedCount: number
  currentStep: string | null
  steps: readonly ChatActivityPlanStep[]
}

export type ChatWorkLogEntry = {
  questionAnswers?: readonly QuestionAnswerRow[]
  changedFiles: readonly string[]
  command: string | null
  createdAt: string
  detail: string | null
  icon: ChatActivityIconKey
  id: string
  input: string | null
  itemType: string | null
  lifecycle: ChatActivityLifecycle | null
  outcome: ChatActivityOutcome | null
  output: string | null
  result?: string
  plan: ChatWorkLogPlan | null
  requestId: string | null
  sourceKind: string
  status: string | null
  title: string
  tone: ChatWorkLogTone
  tool?: ChatActivityTool
  turnId: OrchestrationSessionActivity['turnId']
}

type DerivedChatWorkLogEntry = ChatWorkLogEntry & {
  activityKind: string
  collapseKey: string | null
  toolCallKey: string | null
  reasoningDelta: boolean
}

type TurnPlanRow = {
  anchorId: string
  createdAt: string
  entry: DerivedChatWorkLogEntry
}

/** Every field of `ChatWorkLogEntry` that compares by `===`; the rest are handled by hand. */
const WORK_LOG_SCALAR_FIELDS = [
  'command',
  'createdAt',
  'detail',
  'icon',
  'id',
  'input',
  'itemType',
  'lifecycle',
  'outcome',
  'output',
  'result',
  'requestId',
  'sourceKind',
  'status',
  'title',
  'tone',
  'turnId',
] as const satisfies readonly (keyof ChatWorkLogEntry)[]

/**
 * Every turn's work is derived, not just the running one: scrolling back through a
 * finished session must still show the tool calls, reasoning and approvals that produced it.
 *
 * The caller passes the store's order — `(sequence, createdAt, id)`, established
 * once in `chat-projection-writers.ts`. Re-sorting here by `createdAt` alone used
 * to be able to contradict it, so the rows and the transcript disagreed. The store
 * is the authority; do not re-establish the order.
 */
export function chatWorkLogEntries({
  activities,
}: {
  activities: readonly OrchestrationSessionActivity[]
}) {
  const planRows = turnPlanRows(activities)
  const entries: DerivedChatWorkLogEntry[] = []

  for (const activity of activities) {
    if (chatAgentActivity(activity.payload)) continue
    if (activity.kind === 'turn.plan.updated') {
      appendTurnPlanRow(entries, planRows, activity)
      continue
    }
    if (!isActivityForWorkLog(activity)) continue

    entries.push(derivedWorkLogEntry(activity))
  }

  return collapseWorkLogEntries(entries).map(
    ({
      activityKind: _activityKind,
      collapseKey: _collapseKey,
      toolCallKey: _toolCallKey,
      reasoningDelta: _reasoningDelta,
      ...entry
    }) => entry,
  )
}

/** A new turn must not narrate unfinished steps from an earlier response. */
export function chatActiveWorkLogPlan(
  entries: readonly ChatWorkLogEntry[],
  latestTurnId: OrchestrationLatestTurn['turnId'] | null | undefined,
) {
  if (!latestTurnId) return null

  return (
    entries.findLast((entry) => entry.turnId === latestTurnId && entry.plan !== null)?.plan ?? null
  )
}

/**
 * Value equality, because every projection tick re-derives fresh entry objects — an
 * identity check would report "changed" on every streaming delta and defeat the
 * structural sharing the timeline rows depend on.
 */
export function chatWorkLogEntryEquals(left: ChatWorkLogEntry, right: ChatWorkLogEntry) {
  if (left === right) return true

  const scalarsMatch = WORK_LOG_SCALAR_FIELDS.every((field) => left[field] === right[field])
  if (!scalarsMatch) return false
  if (!questionAnswerHistoryEqual(left.questionAnswers, right.questionAnswers)) return false
  if (!stringListsEqual(left.changedFiles, right.changedFiles)) return false
  if (left.tool?.kind !== right.tool?.kind || left.tool?.target !== right.tool?.target) return false

  return chatWorkLogPlanEquals(left.plan, right.plan)
}

function chatWorkLogPlanEquals(left: ChatWorkLogPlan | null, right: ChatWorkLogPlan | null) {
  if (left === right) return true
  if (!left || !right) return false
  if (left.completedCount !== right.completedCount) return false
  if (left.currentStep !== right.currentStep) return false
  if (left.steps.length !== right.steps.length) return false

  return left.steps.every((step, index) => planStepEquals(step, right.steps[index]))
}

function planStepEquals(left: ChatActivityPlanStep, right: ChatActivityPlanStep | undefined) {
  return left.status === right?.status && left.step === right.step
}

function isActivityForWorkLog(activity: OrchestrationSessionActivity) {
  if (!isVisibleChatActivity(activity)) return false
  if (isPlanBoundaryToolActivity(activity)) return false
  if (isGenericReasoningActivity(activity)) return false
  // A start with no tool-call id cannot fold into its completion, so it would
  // duplicate the row it belongs to.
  if (activity.kind === 'tool.started') return chatActivityToolCallId(activity) !== null

  return true
}

function isGenericReasoningActivity(activity: OrchestrationSessionActivity) {
  if (activity.kind !== 'task.progress') return false
  if (chatActivityReasoningDelta(activity) !== null) return false
  const summary = stringPayloadValue(activity.payload, 'summary')
  const detail = stringPayloadValue(activity.payload, 'detail')

  return [summary, detail, activity.summary].every(
    (text) => !text || /^(?:Thinking|Reasoning update|task\.progress)$/i.test(text.trim()),
  )
}

function isPlanBoundaryToolActivity(activity: OrchestrationSessionActivity) {
  if (!activity.kind.startsWith('tool.')) return false

  const detail = stringPayloadValue(activity.payload, 'detail')
  return Boolean(detail?.startsWith('ExitPlanMode:'))
}

/**
 * Plans rewrite themselves on every step, so one row per turn holds the latest snapshot
 * anchored where planning began — a row per snapshot would bury the rest of the log.
 */
function turnPlanRows(ordered: readonly OrchestrationSessionActivity[]) {
  const rows = new Map<string, TurnPlanRow>()

  for (const activity of ordered) {
    if (chatAgentActivity(activity.payload)) continue
    if (activity.kind !== 'turn.plan.updated') continue

    const key = turnPlanKey(activity)
    const plan = workLogPlan(activity)
    // A later snapshot with no steps withdraws the plan; keeping the stale row would
    // freeze the timeline on a plan the model already abandoned.
    if (!plan) {
      rows.delete(key)
      continue
    }

    const existing = rows.get(key)
    const createdAt = existing?.createdAt ?? activity.createdAt
    rows.set(key, {
      anchorId: existing?.anchorId ?? activity.id,
      createdAt,
      entry: planWorkLogEntry(activity, key, createdAt, plan),
    })
  }

  return rows
}

function appendTurnPlanRow(
  entries: DerivedChatWorkLogEntry[],
  planRows: ReadonlyMap<string, TurnPlanRow>,
  activity: OrchestrationSessionActivity,
) {
  const row = planRows.get(turnPlanKey(activity))
  if (!row) return
  if (row.anchorId !== activity.id) return

  entries.push(row.entry)
}

function turnPlanKey(activity: OrchestrationSessionActivity) {
  return activity.turnId ?? 'no-turn'
}

function workLogPlan(activity: OrchestrationSessionActivity): ChatWorkLogPlan | null {
  const steps = chatActivityPlanSteps(activity)
  if (steps.length === 0) return null

  return {
    completedCount: steps.filter((step) => step.status === 'completed').length,
    currentStep: currentPlanStep(steps),
    steps,
  }
}

function currentPlanStep(steps: readonly ChatActivityPlanStep[]) {
  const inProgress = steps.find((step) => step.status === 'inProgress')
  if (inProgress) return inProgress.step

  return steps.find((step) => step.status === 'pending')?.step ?? null
}

function planWorkLogEntry(
  activity: OrchestrationSessionActivity,
  key: string,
  createdAt: string,
  plan: ChatWorkLogPlan,
): DerivedChatWorkLogEntry {
  return {
    activityKind: activity.kind,
    changedFiles: [],
    collapseKey: null,
    command: null,
    createdAt,
    detail: null,
    icon: 'task',
    id: `turn-plan:${key}`,
    input: null,
    itemType: null,
    lifecycle: null,
    outcome: null,
    output: null,
    plan,
    requestId: null,
    sourceKind: activity.kind,
    status: null,
    title: activity.summary || 'Plan updated',
    toolCallKey: null,
    reasoningDelta: false,
    tone: 'info',
    turnId: activity.turnId,
  }
}

function derivedWorkLogEntry(activity: OrchestrationSessionActivity): DerivedChatWorkLogEntry {
  const presentation = chatActivityPresentation(activity)
  const entry = {
    activityKind: activity.kind,
    ...(activity.kind === 'user-input.answer-submitted'
      ? { questionAnswers: questionAnswerHistory(activity.payload) }
      : {}),
    changedFiles: presentation.changedFiles,
    collapseKey: null,
    command: presentation.command,
    createdAt: activity.createdAt,
    detail: presentation.detail,
    icon: presentation.icon,
    id: activity.id,
    input: presentation.input,
    itemType: stringPayloadValue(activity.payload, 'itemType'),
    lifecycle: presentation.lifecycle,
    outcome: presentation.outcome,
    output: presentation.output,
    ...(presentation.result ? { result: presentation.result } : {}),
    plan: null,
    requestId: stringPayloadValue(activity.payload, 'requestId'),
    sourceKind: activity.kind,
    status: presentation.status,
    title: presentation.title,
    toolCallKey: workLogIdentity(activity, presentation.toolCallId),
    reasoningDelta: chatActivityReasoningDelta(activity) !== null,
    tone: workLogTone(activity, presentation.outcome),
    ...(presentation.tool ? { tool: presentation.tool } : {}),
    turnId: activity.turnId,
  }

  return {
    ...entry,
    collapseKey: workLogCollapseKey(entry),
  }
}

function workLogIdentity(activity: OrchestrationSessionActivity, toolCallId: string | null) {
  const taskId = stringPayloadValue(activity.payload, 'taskId')
  if (taskId && (activity.kind === 'task.progress' || activity.kind === 'task.completed')) {
    return ['task', activity.turnId ?? 'no-turn', taskId, reasoningSection(activity.payload)].join(
      '\u001f',
    )
  }
  if (!toolCallId) return null
  if (!activity.kind.startsWith('tool.')) return null

  return ['tool', activity.turnId ?? 'no-turn', toolCallId].join('')
}

function reasoningSection(payload: unknown) {
  if (!payload || typeof payload !== 'object') return ''
  if (!('streamKind' in payload)) return ''
  const contentIndex = 'contentIndex' in payload ? payload.contentIndex : ''
  const summaryIndex = 'summaryIndex' in payload ? payload.summaryIndex : ''
  return `${payload.streamKind}:${contentIndex ?? ''}:${summaryIndex ?? ''}`
}

function workLogTone(
  activity: OrchestrationSessionActivity,
  outcome: ChatActivityOutcome | null,
): ChatWorkLogTone {
  if (outcome !== 'neutral' && chatActivityHasFailure(activity)) return 'error'
  if (activity.kind === 'task.progress') return 'thinking'
  if (activity.tone === 'approval') return 'info'
  if (activity.tone === 'thinking') return 'thinking'
  if (activity.tone === 'tool') return 'tool'

  return 'info'
}

/**
 * Two folds, deliberately different: a provider tool-call id folds the whole lifecycle
 * into the row where the call started, while the text key only ever merges neighbours —
 * running the same command twice must stay two rows.
 */
function collapseWorkLogEntries(entries: readonly DerivedChatWorkLogEntry[]) {
  const collapsed: DerivedChatWorkLogEntry[] = []
  const indexByToolCallKey = new Map<string, number>()

  for (const entry of entries) {
    const foldIndex = entry.toolCallKey ? indexByToolCallKey.get(entry.toolCallKey) : undefined
    if (foldIndex !== undefined) {
      collapsed[foldIndex] = mergeWorkLogEntries(collapsed[foldIndex]!, entry)
      continue
    }
    const previous = collapsed.at(-1)
    if (previous && shouldCollapseWorkLogEntries(previous, entry)) {
      collapsed[collapsed.length - 1] = mergeWorkLogEntries(previous, entry)
      continue
    }
    if (entry.toolCallKey) {
      indexByToolCallKey.set(entry.toolCallKey, collapsed.length)
    }
    collapsed.push(entry)
  }

  return collapsed
}

function shouldCollapseWorkLogEntries(
  previous: DerivedChatWorkLogEntry,
  next: DerivedChatWorkLogEntry,
) {
  if (previous.turnId !== next.turnId) return false
  if (!isCollapsibleToolLifecycleKind(previous.activityKind)) return false
  if (!isCollapsibleToolLifecycleKind(next.activityKind)) return false
  if (previous.activityKind === 'tool.completed') return false
  if (!previous.collapseKey || !next.collapseKey) return false
  // Two provider call ids are two calls: a retry or a parallel run must not rewrite the row.
  if (previous.toolCallKey && next.toolCallKey && previous.toolCallKey !== next.toolCallKey)
    return false

  return previous.collapseKey === next.collapseKey
}

function isCollapsibleToolLifecycleKind(kind: string) {
  return kind === 'tool.updated' || kind === 'tool.completed'
}

/** The surviving row keeps the first event's id and timestamp so it never moves or remounts. */
function mergeWorkLogEntries(
  previous: DerivedChatWorkLogEntry,
  next: DerivedChatWorkLogEntry,
): DerivedChatWorkLogEntry {
  const lifecycle = mergedLifecycle(previous.lifecycle, next.lifecycle)
  return {
    ...previous,
    ...next,
    changedFiles: next.changedFiles.length > 0 ? next.changedFiles : previous.changedFiles,
    command: next.command ?? previous.command,
    createdAt: previous.createdAt,
    detail: next.detail ?? previous.detail,
    id: previous.id,
    input: next.input ?? previous.input,
    itemType: next.itemType ?? previous.itemType,
    lifecycle,
    outcome: mergedOutcome(previous.outcome, next.outcome, lifecycle),
    output: next.output ?? previous.output,
    result: next.result ?? previous.result,
    status: lifecycleStatus(lifecycle) ?? next.status ?? previous.status,
    title: mergedTitle(previous, next),
    tool: next.tool ?? previous.tool,
  }
}

function mergedTitle(previous: DerivedChatWorkLogEntry, next: DerivedChatWorkLogEntry) {
  if (!previous.reasoningDelta || !next.reasoningDelta) return next.title || previous.title

  return previous.title + next.title
}

function mergedLifecycle(
  previous: ChatActivityLifecycle | null,
  next: ChatActivityLifecycle | null,
) {
  if (previous === 'failed' || next === 'failed') return 'failed'
  if (next && next !== 'running') return next
  if (previous && previous !== 'running') return previous

  return next ?? previous
}

function lifecycleStatus(lifecycle: ChatActivityLifecycle | null) {
  if (!lifecycle) return null
  if (lifecycle === 'running') return 'In progress'

  return lifecycle.charAt(0).toUpperCase() + lifecycle.slice(1)
}

function mergedOutcome(
  previous: ChatActivityOutcome | null,
  next: ChatActivityOutcome | null,
  lifecycle: ChatActivityLifecycle | null,
): ChatActivityOutcome | null {
  if (previous === 'failed' || next === 'failed') return 'failed'
  if (previous === null && next === null) return null
  if (lifecycle === 'completed') return 'succeeded'

  return next ?? previous
}

function workLogCollapseKey(entry: Omit<DerivedChatWorkLogEntry, 'collapseKey'>) {
  if (!isCollapsibleToolLifecycleKind(entry.activityKind)) return null

  const title = compactActivityLabel(entry.title)
  const detail = entry.detail?.trim() ?? ''
  const itemType = entry.itemType ?? ''
  if (!title && !detail && !itemType) return null

  return [itemType, title, detail].join('')
}

function stringPayloadValue(payload: unknown, key: string) {
  if (!payload || typeof payload !== 'object') return null
  if (Array.isArray(payload)) return null

  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}
