import type { OrchestrationLatestTurn, TurnEndReason } from '@workspace/contracts'

type EndedTurn = Pick<OrchestrationLatestTurn, 'endReason' | 'state'>

const REASON_LINES: Record<TurnEndReason, { readonly bare: string; readonly timed: string }> = {
  'user-stop': { bare: 'You stopped it', timed: 'You stopped it after' },
  'server-restart': {
    bare: 'Interrupted by a server restart',
    timed: 'Interrupted by a server restart after',
  },
  'runtime-stopped': { bare: 'The session was stopped', timed: 'The session was stopped after' },
  'output-limit': { bare: 'Hit the output limit', timed: 'Hit the output limit after' },
  'turn-limit': { bare: 'Hit the turn limit', timed: 'Hit the turn limit after' },
  refusal: { bare: 'The model declined to continue', timed: 'The model declined to continue' },
  'provider-error': { bare: 'Response failed', timed: 'Failed after' },
}

/** Whether the turn stopped short of a finished answer. */
export function turnStoppedShort(turn: EndedTurn | null) {
  if (!turn || turn.state === 'running') return false

  return turn.state !== 'completed' || Boolean(turn.endReason)
}

/** The status line of a turn that stopped short, or null for a finished one. */
export function stoppedTurnLabel(turn: EndedTurn, elapsed: string | null) {
  if (!turnStoppedShort(turn)) return null
  const line = REASON_LINES[turn.endReason ?? fallbackReason(turn.state)]
  if (turn.endReason === 'refusal') return line.bare
  if (!turn.endReason && turn.state === 'interrupted')
    return elapsed ? `Stopped after ${elapsed}` : 'Stopped'

  return elapsed ? `${line.timed} ${elapsed}` : line.bare
}

function fallbackReason(state: EndedTurn['state']): TurnEndReason {
  return state === 'interrupted' ? 'user-stop' : 'provider-error'
}
