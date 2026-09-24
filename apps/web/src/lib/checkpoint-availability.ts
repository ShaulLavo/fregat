import type { ChatTurnDiffSummary } from '@workspace/client-core/chat/types'

/**
 * What a selected turn's checkpoint can show. `pending` is local: the turn is
 * selected but its summary has not streamed in. The rest are the server's
 * verdict, with `ready` split by whether any file changed.
 */
export type CheckpointAvailability =
  | { readonly kind: 'pending' }
  | { readonly kind: 'missing'; readonly turnCount: number }
  | { readonly kind: 'error'; readonly turnCount: number }
  | { readonly kind: 'empty'; readonly turnCount: number }
  | {
      readonly kind: 'available'
      readonly turnCount: number
      readonly summary: ChatTurnDiffSummary
    }

export function checkpointAvailability(
  summary: ChatTurnDiffSummary | null,
): CheckpointAvailability {
  if (!summary) return { kind: 'pending' }

  const turnCount = summary.checkpointTurnCount
  // Missing and error come first: a failed capture has no files, and must not read as empty.
  if (summary.status === 'missing') return { kind: 'missing', turnCount }
  if (summary.status === 'error') return { kind: 'error', turnCount }
  if (summary.files.length === 0) return { kind: 'empty', turnCount }

  return { kind: 'available', turnCount, summary }
}

/** The one sentence every surface uses for a checkpoint it cannot list. */
export function checkpointAvailabilityLabel(availability: CheckpointAvailability): string {
  if (availability.kind === 'pending') return 'Loading checkpoint'
  if (availability.kind === 'missing')
    return `Checkpoint missing for turn ${availability.turnCount}`
  if (availability.kind === 'error') return `Checkpoint error for turn ${availability.turnCount}`
  if (availability.kind === 'empty') return `No changed files in turn ${availability.turnCount}`

  return `Turn ${availability.turnCount}`
}
