import type {
  TerminalLease,
  MessageId,
  OrchestrationCheckpointStatus,
  OrchestrationProject,
  OrchestrationWorktree,
  SessionRuntimeStatus,
  OrchestrationSession,
  OrchestrationSessionShell,
  TurnId,
} from '@workspace/contracts'
import { orchestrationErrors } from '../observability'
import { sessionDomainErrors } from './structured-errors'

/**
 * Row caps for the in-memory read model. It answers "what is this session doing
 * right now" for the decider and the provider reactor; SQL keeps the history.
 * Uncapped, a long session grew the model forever and every read walked it.
 */
export const MAX_SESSION_MESSAGES = 2_000
export const MAX_SESSION_ACTIVITIES = 500
const MAX_SESSION_CHECKPOINTS = 500

export type OrchestrationProjectedCheckpoint = {
  assistantMessageId: MessageId | null
  checkpointRef: string
  checkpointTurnCount: number
  completedAt: string
  status: OrchestrationCheckpointStatus
  turnId: TurnId
}

export type OrchestrationProjectedSession = OrchestrationSession & {
  latestFailureSequence: number | null
  latestInterruptionSequence: number | null
  runtimeSequence: number | null
  checkpointByTurnId: Record<TurnId, OrchestrationProjectedCheckpoint>
  hasActionableProposedPlan: boolean
  latestUserMessageAt: string | null
  pendingApprovalCount: number
  pendingUserInputCount: number
}

export type OrchestrationProjectedWorktree = OrchestrationWorktree & {
  retirementSequence: number | null
}

export type OrchestrationReadModel = {
  terminalLeases: Map<string, TerminalLease>
  projects: Map<string, OrchestrationProject>
  sequence: number
  worktrees: Map<string, OrchestrationProjectedWorktree>
  sessions: Map<string, OrchestrationProjectedSession>
}

export function createEmptyReadModel(sequence = 0): OrchestrationReadModel {
  return {
    terminalLeases: new Map(),
    projects: new Map(),
    sequence,
    worktrees: new Map(),
    sessions: new Map(),
  }
}

export function requireProject(model: OrchestrationReadModel, projectId: string) {
  const project = model.projects.get(projectId)
  if (!project || project.deletedAt) throw orchestrationErrors.PROJECT_NOT_FOUND({ projectId })

  return project
}

export function requireSession(model: OrchestrationReadModel, sessionId: string) {
  const session = model.sessions.get(sessionId)
  if (!session || session.deletedAt) throw orchestrationErrors.SESSION_NOT_FOUND({ sessionId })

  return session
}

/**
 * Turn state to settle a still-running turn with when its session leaves the
 * "running" status, or null while the session is (re)starting, running, or
 * parked mid-work (`waiting`) and the turn must stay unsettled. Leaving "running" is the authoritative turn
 * end: a turn that produced no assistant message has no other end signal, and
 * without one the session spins forever.
 */
export function settledTurnStateForSessionStatus(status: SessionRuntimeStatus) {
  switch (status) {
    case 'idle':
    case 'ready':
      return 'completed' as const
    case 'error':
      return 'error' as const
    case 'interrupted':
    case 'stopped':
      return 'interrupted' as const
    case 'starting':
    case 'running':
    case 'waiting':
      return null
  }
}

/**
 * Shared by both projections so their message text cannot drift: a streaming
 * frame appends its delta, a final frame carrying text replaces the
 * accumulated draft, and a final frame with no text keeps it. Total over the
 * contract — our ingestion happens to send empty text on complete, but the
 * event schema promises no such thing.
 */
export function mergedMessageText(
  current: string | null,
  payload: { streaming: boolean; text: string },
) {
  if (current === null) return payload.text
  if (payload.streaming) return `${current}${payload.text}`
  if (payload.text.length === 0) return current

  return payload.text
}

/** The one activity a plan snapshot ever arrives on; ingestion mints no other. */
export const PLAN_PROGRESS_ACTIVITY_KIND = 'turn.plan.updated'

/**
 * Derived from the shell rather than redeclared: the column, the row reader and
 * the rail all have to mean the same three fields, and the contract owns them.
 */
export type SessionPlanProgress = NonNullable<OrchestrationSessionShell['planProgress']>

type PlanProgressActivity = {
  readonly kind: string
  readonly payload: unknown
  readonly turnId: SessionPlanProgress['turnId']
}

type PlanStepStatus = 'completed' | 'inProgress' | 'pending'

type PlanStep = {
  readonly status: PlanStepStatus
  readonly step: string
}

/**
 * Which plan step a session is on, folded over its retained activities. A plan
 * rewrites itself in place on every step, so the fold is last-snapshot-wins and
 * is recomputed rather than advanced — the same contract as
 * `pendingRequestCounts`, and for the same reason: a replayed event, a revised
 * activity, or a revert that prunes whole turns must never leave the field
 * describing a plan the session no longer holds.
 *
 * The step rule is the timeline's own (`chat-work-log.ts`), deliberately: the
 * in-progress step, else the first pending one. The server must not invent a
 * second notion of "step" for the rail to disagree with the chat about.
 */
export function sessionPlanProgress(
  activities: Iterable<PlanProgressActivity>,
): SessionPlanProgress | null {
  let progress: SessionPlanProgress | null = null

  for (const activity of activities) {
    if (!isPlanProgressActivityKind(activity.kind)) continue

    progress = planProgressFromSteps(planSteps(activity.payload), activity.turnId)
  }

  return progress
}

/**
 * The SQL projection reads a session's plan activities to refold them, so it
 * gates on this instead of paying a query for every tool call of a streaming
 * turn.
 */
export function isPlanProgressActivityKind(kind: string) {
  return kind === PLAN_PROGRESS_ACTIVITY_KIND
}

/**
 * An empty plan is a withdrawn one and an all-completed plan is a finished one;
 * both narrate nothing, so both clear the field instead of freezing the rail on
 * a step nobody is working.
 */
function planProgressFromSteps(
  steps: readonly PlanStep[],
  turnId: SessionPlanProgress['turnId'],
): SessionPlanProgress | null {
  const current =
    steps.find((step) => step.status === 'inProgress') ??
    steps.find((step) => step.status === 'pending')
  if (!current) return null

  return {
    completedSteps: steps.filter((step) => step.status === 'completed').length,
    step: current.step,
    totalSteps: steps.length,
    turnId,
  }
}

/** Mirrors `chatActivityPlanSteps`: both read the raw provider payload ingestion stored. */
function planSteps(payload: unknown): readonly PlanStep[] {
  const plan = payloadRecord(payload)?.plan
  if (!Array.isArray(plan)) return []

  const steps: PlanStep[] = []
  for (const entry of plan) {
    const record = payloadRecord(entry)
    const step = typeof record?.step === 'string' ? record.step.trim() : ''
    if (step.length === 0) continue

    steps.push({ status: planStepStatus(record?.status), step })
  }

  return steps
}

function planStepStatus(value: unknown): PlanStepStatus {
  if (value === 'completed') return 'completed'
  if (value === 'inProgress') return 'inProgress'

  return 'pending'
}

function payloadRecord(value: unknown) {
  if (typeof value !== 'object' || value === null) return null
  if (Array.isArray(value)) return null

  return value as Record<string, unknown>
}

export function appendBounded<Row>(rows: Row[], row: Row, max: number) {
  rows.push(row)
  if (rows.length <= max) return

  rows.splice(0, rows.length - max)
}

export function boundCheckpoints(
  checkpoints: Record<TurnId, OrchestrationProjectedCheckpoint>,
): Record<TurnId, OrchestrationProjectedCheckpoint> {
  const entries = Object.entries(checkpoints)
  if (entries.length <= MAX_SESSION_CHECKPOINTS) return checkpoints

  const retained = entries
    .toSorted(([, left], [, right]) => left.checkpointTurnCount - right.checkpointTurnCount)
    .slice(-MAX_SESSION_CHECKPOINTS)

  return Object.fromEntries(retained) as Record<TurnId, OrchestrationProjectedCheckpoint>
}

export function requireWorktree(model: OrchestrationReadModel, worktreeId: string) {
  const worktree = model.worktrees.get(worktreeId)
  if (!worktree || worktree.retiredAt) throw sessionDomainErrors.WORKTREE_NOT_FOUND({ worktreeId })
  return worktree
}

export function currentWorktree(model: OrchestrationReadModel, projectId: string) {
  return (
    [...model.worktrees.values()].find(
      (worktree) =>
        worktree.projectId === projectId &&
        worktree.kind === 'current' &&
        worktree.retiredAt === null,
    ) ?? null
  )
}
