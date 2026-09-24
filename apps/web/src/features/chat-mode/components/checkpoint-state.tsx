import { EmptyState } from '@workspace/ui/components/empty-state'

import {
  checkpointAvailabilityLabel,
  type CheckpointAvailability,
} from '@/lib/checkpoint-availability'

/** The Turn panel's verdict for a checkpoint it cannot list. Pending is a loader, not this. */
export function CheckpointState({
  availability,
}: {
  readonly availability: Exclude<CheckpointAvailability, { kind: 'pending' | 'available' }>
}) {
  return (
    <EmptyState
      className='min-h-0 flex-1'
      title={checkpointAvailabilityLabel(availability)}
      tone={availability.kind === 'error' ? 'error' : 'muted'}
    />
  )
}
