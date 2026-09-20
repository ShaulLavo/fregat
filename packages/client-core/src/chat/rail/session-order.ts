import { timestampMs as orderTimestampMs } from './timestamp'
import { compareOrderKeys } from '@workspace/client-core/chat/rail/reorder'

type Identity = { readonly id: string; readonly environmentId?: string }
type PinnedOrderSource = Identity & {
  readonly createdAt: string
  readonly pinOrderKey?: string | null
}
type ActiveOrderSource = Identity & {
  readonly createdAt: string
  readonly unsettledAt?: string | null
  readonly activeOrderKey?: string | null
}
type SettledOrderSource = Identity & {
  readonly settledAt?: string | null
  readonly latestUserMessageAt?: string | null
  readonly latestTurn?: {
    readonly requestedAt?: string | null
    readonly startedAt?: string | null
    readonly completedAt?: string | null
  } | null
  readonly updatedAt: string
}

function identityOrder(left: Identity, right: Identity) {
  return (
    left.id.localeCompare(right.id) ||
    (left.environmentId ?? '').localeCompare(right.environmentId ?? '')
  )
}

export function comparePinnedSessions(left: PinnedOrderSource, right: PinnedOrderSource) {
  const keys = compareOrderKeys(left.pinOrderKey ?? null, right.pinOrderKey ?? null)
  if (keys) return keys
  if (left.pinOrderKey != null) return identityOrder(left, right)
  return (
    orderTimestampMs(right.createdAt) - orderTimestampMs(left.createdAt) ||
    identityOrder(left, right)
  )
}

function activeAnchor(session: ActiveOrderSource) {
  return Math.max(orderTimestampMs(session.createdAt), orderTimestampMs(session.unsettledAt ?? ''))
}

export function compareActiveSessions(left: ActiveOrderSource, right: ActiveOrderSource) {
  if (left.activeOrderKey == null && right.activeOrderKey != null) return -1
  if (left.activeOrderKey != null && right.activeOrderKey == null) return 1
  const order =
    left.activeOrderKey != null && right.activeOrderKey != null
      ? compareOrderKeys(left.activeOrderKey, right.activeOrderKey)
      : activeAnchor(right) - activeAnchor(left)
  return order || identityOrder(left, right)
}

export function settledSessionTimestamp(session: SettledOrderSource): string | null {
  if (session.settledAt != null && Number.isFinite(Date.parse(session.settledAt)))
    return session.settledAt
  let latest: string | null = null
  let latestMs = Number.NEGATIVE_INFINITY
  for (const candidate of [
    session.latestUserMessageAt,
    session.latestTurn?.requestedAt,
    session.latestTurn?.startedAt,
    session.latestTurn?.completedAt,
  ]) {
    if (candidate == null) continue
    const timestamp = Date.parse(candidate)
    if (!Number.isFinite(timestamp) || timestamp <= latestMs) continue
    latest = candidate
    latestMs = timestamp
  }
  if (latest !== null) return latest
  return Number.isFinite(Date.parse(session.updatedAt)) ? session.updatedAt : null
}

export function compareSettledSessions(left: SettledOrderSource, right: SettledOrderSource) {
  return (
    orderTimestampMs(settledSessionTimestamp(right) ?? '') -
      orderTimestampMs(settledSessionTimestamp(left) ?? '') || identityOrder(left, right)
  )
}

type SessionSortSource = Identity & {
  readonly createdAt: string
  readonly updatedAt: string
  readonly latestUserMessageAt?: string | null
  readonly messages?: readonly { readonly role: string; readonly createdAt: string }[]
}
export type SessionSortOrder = 'updated_at' | 'created_at'

function firstValidTimestamp(...values: readonly (string | null | undefined)[]) {
  for (const value of values) {
    if (!value) continue
    const timestamp = Date.parse(value)
    if (Number.isFinite(timestamp)) return timestamp
  }
  return Number.NEGATIVE_INFINITY
}

export function sessionSortTimestamp(session: SessionSortSource, sortOrder: SessionSortOrder) {
  if (sortOrder === 'created_at') return firstValidTimestamp(session.createdAt, session.updatedAt)
  const latestUser = firstValidTimestamp(session.latestUserMessageAt)
  if (Number.isFinite(latestUser)) return latestUser
  let latest = Number.NEGATIVE_INFINITY
  for (const message of session.messages ?? []) {
    if (message.role !== 'user') continue
    latest = Math.max(latest, firstValidTimestamp(message.createdAt))
  }
  return Number.isFinite(latest)
    ? latest
    : firstValidTimestamp(session.updatedAt, session.createdAt)
}

export function compareSessionsByActivity(
  left: SessionSortSource,
  right: SessionSortSource,
  sortOrder: SessionSortOrder,
) {
  const order = sessionSortTimestamp(right, sortOrder) - sessionSortTimestamp(left, sortOrder)
  if (order) return order
  if (left.id === right.id) return 0
  return left.id < right.id ? 1 : -1
}

export function compareSessionSortValues(
  left: { readonly id: string; readonly createdSortAt: number; readonly updatedSortAt: number },
  right: { readonly id: string; readonly createdSortAt: number; readonly updatedSortAt: number },
  sortOrder: SessionSortOrder,
) {
  const field = sortOrder === 'created_at' ? 'createdSortAt' : 'updatedSortAt'
  const order = right[field] - left[field]
  if (order) return order
  if (left.id === right.id) return 0
  return left.id < right.id ? 1 : -1
}
