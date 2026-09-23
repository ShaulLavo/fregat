export type FollowUpPhase = 'connecting' | 'running' | 'ready' | 'disconnected'

export function followUpPhase(busy: boolean, starting: boolean): FollowUpPhase {
  if (!busy) return 'ready'
  return starting ? 'connecting' : 'running'
}

export function latestCompletedToolActivityId(
  activities: readonly { id: string; kind: string; sequence?: number; createdAt: string }[],
) {
  let latest: (typeof activities)[number] | undefined
  for (const activity of activities) {
    if (activity.kind !== 'tool.completed') continue
    const sequence = activity.sequence ?? -1
    const previousSequence = latest?.sequence ?? -1
    if (
      !latest ||
      sequence > previousSequence ||
      (sequence === previousSequence && activity.createdAt > latest.createdAt)
    )
      latest = activity
  }
  return latest?.id ?? null
}

export function followUpDue(input: {
  held: boolean
  phase: FollowUpPhase
  afterToolActivityId: string | null
  latestToolActivityId: string | null
}) {
  if (input.held || input.phase === 'connecting') return false
  if (input.phase !== 'running') return true
  return input.latestToolActivityId !== input.afterToolActivityId
}
