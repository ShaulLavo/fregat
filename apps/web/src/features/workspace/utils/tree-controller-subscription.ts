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
