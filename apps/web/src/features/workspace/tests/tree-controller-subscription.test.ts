import { describe, expect, it } from 'vitest'

import { transitionControllerSnapshotSubscription } from '@/features/workspace/utils/tree-controller-subscription'

describe('controller snapshot subscription transition', () => {
  it('suppresses only the genuine initial snapshot', () => {
    expect(transitionControllerSnapshotSubscription(false)).toEqual({
      hasSeenInitialSnapshot: true,
      shouldBumpRevision: false,
    })
  })

  it('bumps every observation after the initial snapshot, including after re-subscribe', () => {
    const initial = transitionControllerSnapshotSubscription(false)
    const afterFirstMutation = transitionControllerSnapshotSubscription(
      initial.hasSeenInitialSnapshot,
    )
    const afterResubscribe = transitionControllerSnapshotSubscription(
      afterFirstMutation.hasSeenInitialSnapshot,
    )

    expect(afterFirstMutation.shouldBumpRevision).toBe(true)
    expect(afterResubscribe.shouldBumpRevision).toBe(true)
  })
})
