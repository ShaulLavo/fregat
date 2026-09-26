import type { WorktreePullRequest } from '@workspace/contracts'
import { settleBlocker } from '../command-invariants'
import type { OrchestrationProjectedSession, OrchestrationProjectedWorktree } from '../read-model'

export type AutoSettleRules = {
  /** 0 turns inactivity settlement off. */
  readonly afterDays: number
  readonly onMerge: boolean
}

const DAY_MS = 24 * 60 * 60 * 1_000

/**
 * When the server may settle this session, or null. The settled time is the last activity, never
 * the sweep time. Ported from upstream `ThreadSettlementPolicy.resolveAutoSettlementAt`.
 */
export function autoSettlementAt(input: {
  readonly session: OrchestrationProjectedSession
  readonly pullRequest: WorktreePullRequest | null
  readonly pendingPullRequest: boolean
  readonly backgroundLive: boolean
  readonly now: number
  readonly rules: AutoSettleRules
}): string | null {
  const { session, pullRequest, rules } = input
  if (!isCandidate(session, input.backgroundLive, input.now)) return null
  // An open or unanswered pull request is unfinished work.
  if (input.pendingPullRequest || pullRequest?.status === 'unknown') return null
  if (pullRequest?.status === 'found' && pullRequest.state === 'open') return null
  const activityAt = latest([
    session.latestUserMessageAt,
    session.latestTurn?.requestedAt,
    session.latestTurn?.startedAt,
    session.latestTurn?.completedAt,
  ])
  if (pullRequest?.status === 'found' && pullRequestSettles(session, pullRequest, rules.onMerge))
    return activityAt ?? session.createdAt
  if (rules.afterDays === 0 || activityAt === null) return null
  return Date.parse(activityAt) < input.now - rules.afterDays * DAY_MS ? activityAt : null
}

/** A merge or close settles only when it came after the user's last request. */
function pullRequestSettles(
  session: OrchestrationProjectedSession,
  pullRequest: Extract<WorktreePullRequest, { status: 'found' }>,
  onMerge: boolean,
) {
  if (pullRequest.state === 'open' || (pullRequest.state === 'merged' && !onMerge)) return false
  if (!pullRequest.closedAt) return false
  const anchor = latest([
    session.createdAt,
    session.latestUserMessageAt,
    session.latestTurn?.requestedAt,
  ])
  if (anchor === null) return false
  return Date.parse(pullRequest.closedAt) >= Date.parse(anchor)
}

function isCandidate(session: OrchestrationProjectedSession, backgroundLive: boolean, now: number) {
  if (session.deletedAt || session.archivedAt || session.settledOverride != null) return false
  if (backgroundLive || settleBlocker(session) !== null) return false
  if (!session.snoozedUntil || Date.parse(session.snoozedUntil) <= now) return true
  return wokeFromSnooze(session)
}

/** A snoozed session that failed or finished since it was snoozed is awake again. */
function wokeFromSnooze(session: OrchestrationProjectedSession) {
  const snoozedAt = session.snoozedAt ? Date.parse(session.snoozedAt) : null
  if (snoozedAt === null) return session.runtime?.status === 'error'
  if (session.runtime?.status === 'error' && Date.parse(session.runtime.updatedAt) > snoozedAt)
    return true
  const completedAt = session.latestTurn?.completedAt
  return (
    session.latestTurn?.state === 'completed' &&
    completedAt != null &&
    Date.parse(completedAt) > snoozedAt
  )
}

function latest(values: ReadonlyArray<string | null | undefined>) {
  let found: string | null = null
  for (const value of values) {
    if (!value) continue
    if (found === null || Date.parse(value) > Date.parse(found)) found = value
  }
  return found
}

export function pendingPullRequest(worktree: OrchestrationProjectedWorktree) {
  return (
    worktree.pullRequest === null &&
    worktree.ownership === 'platform' &&
    worktree.kind === 'linked' &&
    worktree.branch !== null &&
    !worktree.retiredAt
  )
}
