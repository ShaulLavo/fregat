import type { Key } from 'react'

/** Which end of the list new rows arrive at: logs are newest-first, a transcript newest-last. */
export type TailEdge = 'start' | 'end'

export type TailFollow = { readonly following: boolean; readonly arrivals: number }

export const TAIL_FOLLOWING: TailFollow = { following: true, arrivals: 0 }

/**
 * How many rows appeared past the row that used to sit at the live edge. A missing previous edge
 * row means the list was replaced (a filter), which is not an arrival.
 */
export function arrivedAtEdge(
  keys: readonly Key[],
  previousEdgeKey: Key | undefined,
  edge: TailEdge,
): number {
  if (previousEdgeKey === undefined) return 0
  const index = keys.indexOf(previousEdgeKey)
  if (index < 0) return 0
  return edge === 'start' ? index : keys.length - 1 - index
}

export function tailFollowArrived(state: TailFollow, count: number): TailFollow {
  if (state.following || count === 0) return state
  return { following: false, arrivals: state.arrivals + count }
}

/** Reaching the live edge re-arms following; leaving it keeps the count so far. */
export function tailFollowScrolled(state: TailFollow, atEdge: boolean): TailFollow {
  if (atEdge) return state.following && state.arrivals === 0 ? state : TAIL_FOLLOWING
  return state.following ? { following: false, arrivals: 0 } : state
}

export function isAtEdge(
  metrics: {
    readonly scrollTop: number
    readonly scrollHeight: number
    readonly clientHeight: number
  },
  edge: TailEdge,
  slack: number,
): boolean {
  if (edge === 'start') return metrics.scrollTop <= slack
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= slack
}
