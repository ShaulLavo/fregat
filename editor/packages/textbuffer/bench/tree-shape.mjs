import assert from 'node:assert/strict'

// Height counts levels: empty = 0, root alone = 1. Depth starts at 0 for the root.
// Upstream's NIL sentinel has a null piece and points at itself, so it is skipped, not walked.
export function measureTree(root) {
  const stack = root ? [[root, 0]] : []
  const seen = new Set()
  const depthCounts = []
  let pieces = 0
  let tombstones = 0
  let storedLength = 0
  let visibleLength = 0
  let depthTotal = 0
  let visibleDepthTotal = 0
  let textDepthTotal = 0
  while (stack.length) {
    const [node, depth] = stack.pop()
    if (!node?.piece) continue
    assert(!seen.has(node), 'Cycle or repeated child in tree')
    seen.add(node)
    pieces += 1
    depthTotal += depth
    depthCounts[depth] = (depthCounts[depth] ?? 0) + 1
    storedLength += node.piece.length
    if (node.piece.visible === false) tombstones += 1
    else {
      visibleLength += node.piece.length
      visibleDepthTotal += depth
      textDepthTotal += depth * node.piece.length
    }
    if (node.left) stack.push([node.left, depth + 1])
    if (node.right) stack.push([node.right, depth + 1])
  }
  for (let depth = 0; depth < depthCounts.length; depth += 1) depthCounts[depth] ??= 0
  const visiblePieces = pieces - tombstones
  const ratio = (total, count) => (count ? total / count : null)
  return {
    height: depthCounts.length,
    minimumHeight: Math.ceil(Math.log2(pieces + 1)),
    heightOverLog2: pieces ? depthCounts.length / Math.log2(pieces + 1) : null,
    pieces,
    visiblePieces,
    tombstones,
    storedLength,
    visibleLength,
    depthCounts,
    meanDepth: ratio(depthTotal, pieces),
    p95Depth: nearestRankDepth(depthCounts, pieces, 0.95),
    meanVisibleDepth: ratio(visibleDepthTotal, visiblePieces),
    meanTextDepth: ratio(textDepthTotal, visibleLength),
  }
}

function nearestRankDepth(depthCounts, pieces, quantile) {
  const rank = Math.ceil(pieces * quantile)
  let cumulative = 0
  for (let depth = 0; depth < depthCounts.length; depth += 1) {
    cumulative += depthCounts[depth]
    if (cumulative >= rank) return depth
  }
  return null
}

// Read-only: the adapter exposes the live roots and nothing here writes to them.
export function measureBuffer(buffer) {
  // The reverse index is a vector since E039: it has no shape to sample.
  return { sequence: measureTree(buffer.snapshot ? buffer.snapshot.root : buffer.tree.root) }
}
