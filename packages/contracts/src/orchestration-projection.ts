import type { OrchestrationLatestTurn } from './chat-model'

/**
 * `settling` is true for the message that finishes the turn: not mid-stream, and
 * nothing else keeps the provider turn running. An interrupted or errored turn stays that way.
 */
export function assistantTurnState(
  current: OrchestrationLatestTurn['state'] | undefined,
  settling: boolean,
): OrchestrationLatestTurn['state'] {
  if (!settling) return current ?? 'running'
  if (current === 'interrupted' || current === 'error') return current

  return 'completed'
}

/** A null turnId (no turn attached) always survives a revert; an empty or unknown turnId does not. */
export function shouldRetainAfterRevert<TTurnId extends string | null>(
  turnId: TTurnId,
  retainedTurnIds: ReadonlySet<TTurnId & string>,
): boolean {
  if (turnId === null) return true

  return retainedTurnIds.has(turnId as TTurnId & string)
}
