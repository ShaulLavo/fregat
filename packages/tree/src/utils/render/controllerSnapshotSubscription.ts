// Modified for Platform from Pierre. Apache-2.0; see LICENSE-pierre and UPSTREAM.md.
export interface ControllerSnapshotSubscriptionTransition {
  hasSeenInitialSnapshot: true
  shouldBumpRevision: boolean
}

export function transitionControllerSnapshotSubscription(
  hasSeenInitialSnapshot: boolean,
): ControllerSnapshotSubscriptionTransition {
  return {
    hasSeenInitialSnapshot: true,
    shouldBumpRevision: hasSeenInitialSnapshot,
  }
}
