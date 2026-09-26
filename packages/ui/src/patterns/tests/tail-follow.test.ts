import { describe, expect, it } from 'vitest'

import {
  TAIL_FOLLOWING,
  arrivedAtEdge,
  isAtEdge,
  tailFollowArrived,
  tailFollowScrolled,
} from '@workspace/ui/patterns/tail-follow'

describe('tail follow', () => {
  it('counts rows that arrive at either edge', () => {
    expect(arrivedAtEdge(['c', 'b', 'a'], 'a', 'start')).toBe(2)
    expect(arrivedAtEdge(['a', 'b', 'c'], 'a', 'end')).toBe(2)
    expect(arrivedAtEdge(['x', 'y'], 'a', 'start')).toBe(0)
    expect(arrivedAtEdge(['a'], undefined, 'end')).toBe(0)
  })

  it('counts arrivals only while away from the edge', () => {
    expect(tailFollowArrived(TAIL_FOLLOWING, 3)).toBe(TAIL_FOLLOWING)
    const away = tailFollowScrolled(TAIL_FOLLOWING, false)
    expect(away).toEqual({ following: false, arrivals: 0 })
    expect(tailFollowArrived(tailFollowArrived(away, 2), 3)).toEqual({
      following: false,
      arrivals: 5,
    })
  })

  it('re-arms and clears the count on reaching the edge', () => {
    const away = { following: false, arrivals: 7 }
    expect(tailFollowScrolled(away, false)).toBe(away)
    expect(tailFollowScrolled(away, true)).toBe(TAIL_FOLLOWING)
  })

  it('measures either edge within the slack', () => {
    const metrics = { scrollTop: 10, scrollHeight: 1000, clientHeight: 200 }
    expect(isAtEdge(metrics, 'start', 24)).toBe(true)
    expect(isAtEdge(metrics, 'end', 24)).toBe(false)
    expect(isAtEdge({ ...metrics, scrollTop: 790 }, 'end', 24)).toBe(true)
  })
})
