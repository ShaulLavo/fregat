import type { SessionId } from '@workspace/contracts'

/**
 * What a click on a session row is asking for. The rail is a list, and a list that
 * cannot be range-picked forces one action per row for every bulk operation.
 */
export type SessionClickIntent = 'extend' | 'open' | 'toggle'

export type SessionClickModifiers = {
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
}

/**
 * Shift wins over the toggle modifier, matching every file list on both platforms:
 * shift-cmd-click continues the range rather than punching a hole in it.
 */
export function sessionClickIntent(modifiers: SessionClickModifiers): SessionClickIntent {
  if (modifiers.shiftKey) return 'extend'
  if (modifiers.metaKey || modifiers.ctrlKey) return 'toggle'

  return 'open'
}

export function toggledSessionIds(
  sessionIds: readonly SessionId[],
  sessionId: SessionId,
): readonly SessionId[] {
  if (!sessionIds.includes(sessionId)) return [...sessionIds, sessionId]

  return sessionIds.filter((candidate) => candidate !== sessionId)
}

/**
 * Every row between the anchor and the target, in the order the rail draws them. An
 * anchor that has scrolled out of the visible list (filtered away, archived) leaves
 * nothing to span, so the target becomes the whole range and the new anchor.
 */
export function sessionIdRange(
  orderedSessionIds: readonly SessionId[],
  anchorSessionId: SessionId | null,
  sessionId: SessionId,
): readonly SessionId[] {
  const target = orderedSessionIds.indexOf(sessionId)
  if (target === -1) return []

  const anchor = anchorSessionId ? orderedSessionIds.indexOf(anchorSessionId) : -1
  if (anchor === -1) return [sessionId]

  return orderedSessionIds.slice(Math.min(anchor, target), Math.max(anchor, target) + 1)
}
