import {
  bufferStorageIdentity,
  bufferTextPages,
  retainedBufferTextOwners,
  chunkOfBuffer,
  reclaimBufferGroup,
} from './buffers'
import type { TextPageOwner, TextPageRegistry } from './textPages'
import type { TextRange } from './textSpans'
import type { PieceTableBuffers, PieceTableSnapshot, PieceTreeNode } from './pieceTableTypes'
import { createSnapshot, publishSnapshotStorage, retainPieceTableSnapshot } from './snapshot'

// A standalone caller may choose a fork instead of publishing storage in place.
export function reclaimPieceTableText(snapshot: PieceTableSnapshot): PieceTableSnapshot {
  if (snapshot.consumed) throw new RangeError('cannot reclaim a consumed transient snapshot')
  retainPieceTableSnapshot(snapshot)
  const next = retainPieceTableSnapshot(
    createSnapshot(snapshot.buffers, snapshot.root, snapshot.reverseIndex),
  )
  const job = reclaimSnapshotStorage([next])
  while (!job.next().done) {
    /* Drain the same incremental collector for synchronous callers. */
  }
  return next.buffers === snapshot.buffers ? snapshot : next
}

export type TextReclamationResult = { chunks: number; codeUnits: number; snapshots: number }
type Source = { snapshot: PieceTableSnapshot; buffers: PieceTableBuffers }

function markPieceRange(
  buffers: PieceTableBuffers,
  node: PieceTreeNode,
  live: Map<number, TextRange[]>,
): void {
  if (!node.piece.visible) return
  const chunk = chunkOfBuffer(buffers, node.piece.buffer)
  const ranges = live.get(chunk) ?? []
  ranges.push({ start: node.piece.start, end: node.piece.start + node.piece.length })
  live.set(chunk, ranges)
}

function* markLiveRanges(
  sources: readonly Source[],
  live: Map<number, TextRange[]>,
): Generator<void> {
  const visited = new Set<PieceTreeNode>()
  let steps = 0
  for (const { snapshot, buffers } of sources) {
    const stack = snapshot.root ? [snapshot.root] : []
    while (stack.length > 0) {
      const node = stack.pop()!
      if (visited.has(node) || node.subtreeVisibleLength === 0) continue
      visited.add(node)
      markPieceRange(buffers, node, live)
      if (node.left) stack.push(node.left)
      if (node.right) stack.push(node.right)
      if (++steps % 256 === 0) yield
    }
    yield
  }
}

export function* reclaimSnapshotStorage(
  snapshots: Iterable<PieceTableSnapshot>,
): Generator<void, TextReclamationResult> {
  const groups = new Map<object, Source[]>()
  const seen = new Set<PieceTableSnapshot>()
  const result: TextReclamationResult = { chunks: 0, codeUnits: 0, snapshots: 0 }
  for (const snapshot of snapshots) {
    yield
    if (seen.has(snapshot) || snapshot.consumed) continue
    seen.add(snapshot)
    retainPieceTableSnapshot(snapshot)
    const buffers = snapshot.buffers
    const identity = bufferStorageIdentity(buffers)
    const group = groups.get(identity) ?? []
    group.push({ snapshot, buffers })
    groups.set(identity, group)
  }
  let remainingGroups = groups.size
  for (const sources of groups.values()) {
    remainingGroups--
    const live = new Map<number, TextRange[]>()
    yield* markLiveRanges(sources, live)
    const seenBuffers = new Set<PieceTableBuffers>()
    const buffers: PieceTableBuffers[] = []
    for (const source of sources) {
      if (!seenBuffers.has(source.buffers)) buffers.push(source.buffers)
      seenBuffers.add(source.buffers)
      yield
    }
    const replacements = yield* reclaimBufferGroup(buffers, live, result)
    // A yield during publication lets cancellation permanently split a shared history log.
    for (const source of sources) {
      const next = replacements.get(source.buffers)
      if (next && publishSnapshotStorage(source.snapshot, source.buffers, next)) result.snapshots++
    }
    if (remainingGroups > 0) yield
  }
  // Old buffer keys must not keep abandoned measurement caches alive during the sweep.
  groups.clear()
  yield* detachRetiredPages(seen)
  return result
}

function* detachRetiredPages(snapshots: Iterable<PieceTableSnapshot>): Generator<void> {
  const families = new Map<TextPageRegistry, Set<TextPageOwner>>()
  const seen = new Set<PieceTableBuffers>()
  for (const snapshot of snapshots) {
    const buffers = snapshot.buffers
    if (seen.has(buffers)) continue
    seen.add(buffers)
    const registry = bufferTextPages(buffers)
    const retained = families.get(registry) ?? new Set<TextPageOwner>()
    for (const owner of yield* retainedBufferTextOwners(buffers)) {
      retained.add(owner)
      yield
    }
    families.set(registry, retained)
  }
  for (const [registry, retained] of families) yield* registry.detachRetired(retained)
}
