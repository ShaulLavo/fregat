import {
  isProviderTurnFailureActivity,
  type OrchestrationEvent,
  type TurnEndReason,
} from '@workspace/contracts'
import { sql } from 'drizzle-orm'
import { projectionTurns, type projectionSessionMessages } from '../../db/schema'

export function compactPatch<T extends Record<string, unknown>>(patch: T) {
  return Object.fromEntries(
    Object.entries(patch).filter((entry) => entry[1] !== undefined),
  ) as Partial<T>
}

export function jsonOrNull(value: unknown) {
  if (value === undefined || value === null) return null

  return JSON.stringify(value)
}

/**
 * Three-way, for nullable-and-optional payload fields: absent leaves the column alone
 * (compactPatch drops undefined), explicit null clears it. Collapsing the two would let
 * a partial update — say a rename carrying no defaultModelSelection — wipe the stored value.
 */
export function jsonPatch(value: unknown) {
  if (value === undefined) return undefined
  if (value === null) return null

  return JSON.stringify(value)
}

export function jsonOrUndefined(value: unknown) {
  if (value === undefined) return undefined

  return JSON.stringify(value)
}

export function latestProjectionTurn(turns: readonly (typeof projectionTurns.$inferSelect)[]) {
  let latest: (typeof turns)[number] | undefined
  for (const turn of turns) {
    if (!latest) {
      latest = turn
      continue
    }
    const requestedOrder = turn.requestedAt.localeCompare(latest.requestedAt)
    if (requestedOrder < 0) continue
    if (requestedOrder === 0 && turn.turnId.localeCompare(latest.turnId) < 0) continue
    latest = turn
  }
  return latest
}

/** The first cause recorded wins: a user stop stays a user stop when the harness reports its abort. */
export function firstEndReason(endReason: TurnEndReason | undefined) {
  if (!endReason) return {}

  return { endReason: sql<TurnEndReason>`coalesce(${projectionTurns.endReason}, ${endReason})` }
}

export function latestTurnJson(turn: typeof projectionTurns.$inferSelect) {
  return {
    assistantMessageId: turn.assistantMessageId,
    completedAt: turn.completedAt,
    endReason: turn.endReason,
    requestedAt: turn.requestedAt,
    sourceProposedPlan: parseJsonOrUndefined(turn.sourceProposedPlanJson),
    startedAt: turn.startedAt,
    state: turn.state,
    providerStartState: turn.providerStartState,
    providerStartGeneration: turn.providerStartGeneration,
    providerStartSequence: turn.providerStartSequence,
    runtimeEpoch: turn.runtimeEpoch,
    turnId: turn.turnId,
  }
}

export function turnInsertRow(
  turn: typeof projectionTurns.$inferSelect,
): typeof projectionTurns.$inferInsert {
  const { rowId: _rowId, ...row } = turn
  return row
}

export function latestUserMessageAt(
  messages: Array<typeof projectionSessionMessages.$inferSelect>,
) {
  return (
    messages
      .filter((message) => message.role === 'user')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .at(-1)?.createdAt ?? null
  )
}

function parseJsonOrUndefined(value: string | null) {
  if (!value) return undefined

  return JSON.parse(value) as unknown
}

/**
 * Null — never a throw — for a row whose payload no longer parses: the fold
 * treats it as a non-request activity instead of poisoning the projection.
 */
export function parseActivityPayload(payloadJson: string): unknown {
  try {
    return JSON.parse(payloadJson) as unknown
  } catch {
    return null
  }
}

export function failureKind(event: OrchestrationEvent) {
  if (event.type === 'session.runtime-set')
    return event.payload.runtime.status === 'error' ? 'failure' : null
  if (event.type === 'session.runtime-recovered') return 'interruption'
  if (event.type === 'session.turn-diff-completed' && event.payload.status === 'error')
    return 'failure'
  if (event.type !== 'session.activity-appended') return null
  return isProviderTurnFailureActivity(event.payload.activity.kind) ||
    event.payload.activity.kind === 'runtime.error'
    ? 'failure'
    : null
}
