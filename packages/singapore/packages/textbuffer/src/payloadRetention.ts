import type { CharIdSpan } from './identityRuns'
import type { PieceTableSnapshot } from './pieceTableTypes'

// Roots belong to the snapshot; unreachable snapshots release their history automatically.
const roots = new WeakMap<PieceTableSnapshot, Iterable<CharIdSpan>>()

/** Register immutable, reusable identity spans reachable by the snapshot's undo provenance. */
export function retainCharIdPayloads(
  snapshot: PieceTableSnapshot,
  spans: Iterable<CharIdSpan>,
): void {
  if (!snapshot.charIds || snapshot.consumed)
    throw new RangeError('payload retention requires a usable identity snapshot')
  roots.set(snapshot, spans)
}

export function retainedCharIdPayloads(snapshot: PieceTableSnapshot): Iterable<CharIdSpan> {
  return roots.get(snapshot) ?? []
}
