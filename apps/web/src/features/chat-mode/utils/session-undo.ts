import type { SessionId } from '@workspace/contracts'
import { tokenForChatReference } from '@workspace/client-core/address/references'
import type { SessionLifecycleChange } from '@workspace/client-core/chat/commands'
import type { RailDropPlan } from '@workspace/client-core/chat/rail/drop'
import type { SessionLifecycleUndoKind } from '@workspace/client-core/chat/rail/lifecycle-undo'

type AddressSurfaces = {
  readonly document: string | null
  readonly chat: string | null
}

type SessionSurface = 'main' | 'sidebar'

/** Which conversation surface shows the session, if any. */
export function viewedSessionSurface(
  address: AddressSurfaces,
  sessionId: SessionId,
): SessionSurface | null {
  if (surfaceShowsSession(address, 'main', sessionId)) return 'main'
  if (surfaceShowsSession(address, 'sidebar', sessionId)) return 'sidebar'
  return null
}

export function surfaceShowsSession(
  address: AddressSurfaces,
  surface: SessionSurface,
  sessionId: SessionId,
) {
  const token = tokenForChatReference({ kind: 'session', sessionId })
  return (surface === 'main' ? address.document : address.chat) === token
}

export function lifecycleUndoKind(
  type: SessionLifecycleChange['type'],
): SessionLifecycleUndoKind | null {
  if (type === 'settle' || type === 'snooze' || type === 'unpin') return type
  return null
}

/** Dragging to Settled settles and dragging a pin into Active unpins; both offer Undo. */
export function dropUndoKind(plan: RailDropPlan): SessionLifecycleUndoKind | null {
  if (plan.kind === 'settle') return 'settle'
  if (plan.kind === 'move-active' && plan.unpin) return 'unpin'
  return null
}

export function batchDetail(counts: {
  readonly skipped?: number
  readonly failed?: number
  readonly skippedOrFailed?: number
  readonly navigationFailures?: number
}) {
  const parts: string[] = []
  if (counts.skipped) parts.push(`${counts.skipped} skipped`)
  if (counts.failed) parts.push(`${counts.failed} failed`)
  if (counts.skippedOrFailed) parts.push(`${counts.skippedOrFailed} skipped or failed`)
  const navigation = counts.navigationFailures
  if (navigation) parts.push(`${navigation} navigation failure${navigation === 1 ? '' : 's'}`)
  return parts.map((part) => `, ${part}`).join('')
}
