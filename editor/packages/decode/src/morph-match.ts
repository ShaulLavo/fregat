const WORD = /^[\p{L}\p{N}_$]{2,}$/u

// Above this many cells the in-order pass is skipped and only the unique-text
// pass pairs pieces. A full-viewport rewrite of ~1,500 pieces each side fits.
const MAX_TABLE_CELLS = 2_500_000

/**
 * Pairs each new piece with the old piece it continues, by text. Returns one
 * entry per new piece: the old index it moves from, or -1 when it enters.
 *
 * Two passes. The first is an in-order longest common subsequence after
 * trimming the shared head and tail, so text an edit left alone always keeps
 * its identity. The second pairs what is left when a text appears the same
 * number of times on both sides, in order, so a block that moved past other
 * code travels as a block instead of fading out and back in. Only words take
 * part: a lone bracket flying across the screen reads as noise.
 */
export function matchPieces(oldTexts: readonly string[], newTexts: readonly string[]): Int32Array {
  const pairs = new Int32Array(newTexts.length).fill(-1)
  let head = 0
  while (head < oldTexts.length && head < newTexts.length && oldTexts[head] === newTexts[head]) {
    pairs[head] = head
    head += 1
  }
  let oldEnd = oldTexts.length
  let newEnd = newTexts.length
  while (oldEnd > head && newEnd > head && oldTexts[oldEnd - 1] === newTexts[newEnd - 1]) {
    oldEnd -= 1
    newEnd -= 1
    pairs[newEnd] = oldEnd
  }

  const oldUsed = new Uint8Array(oldTexts.length)
  for (const old of pairs) if (old >= 0) oldUsed[old] = 1

  matchInOrder(oldTexts, newTexts, head, oldEnd, newEnd, pairs, oldUsed)
  matchMovedBlocks(oldTexts, newTexts, pairs, oldUsed)
  return pairs
}

function matchInOrder(
  oldTexts: readonly string[],
  newTexts: readonly string[],
  start: number,
  oldEnd: number,
  newEnd: number,
  pairs: Int32Array,
  oldUsed: Uint8Array,
): void {
  const rows = oldEnd - start
  const columns = newEnd - start
  if (rows === 0 || columns === 0) return
  if (rows * columns > MAX_TABLE_CELLS) return

  // lengths[i][j] = LCS of old[start+i..] and new[start+j..], filled back to front.
  const width = columns + 1
  const lengths = new Uint16Array((rows + 1) * width)
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      const here = i * width + j
      lengths[here] =
        oldTexts[start + i] === newTexts[start + j]
          ? (lengths[here + width + 1] ?? 0) + 1
          : Math.max(lengths[here + width] ?? 0, lengths[here + 1] ?? 0)
    }
  }

  let i = 0
  let j = 0
  while (i < rows && j < columns) {
    if (oldTexts[start + i] === newTexts[start + j]) {
      pairs[start + j] = start + i
      oldUsed[start + i] = 1
      i += 1
      j += 1
      continue
    }
    if ((lengths[(i + 1) * width + j] ?? 0) >= (lengths[i * width + j + 1] ?? 0)) i += 1
    else j += 1
  }
}

function matchMovedBlocks(
  oldTexts: readonly string[],
  newTexts: readonly string[],
  pairs: Int32Array,
  oldUsed: Uint8Array,
): void {
  const oldByText = new Map<string, number[]>()
  oldTexts.forEach((text, index) => {
    if (oldUsed[index] || !WORD.test(text)) return
    const list = oldByText.get(text)
    if (list) list.push(index)
    else oldByText.set(text, [index])
  })
  const newByText = new Map<string, number[]>()
  newTexts.forEach((text, index) => {
    if (pairs[index] !== -1 || !WORD.test(text)) return
    const list = newByText.get(text)
    if (list) list.push(index)
    else newByText.set(text, [index])
  })

  for (const [text, newIndices] of newByText) {
    const oldIndices = oldByText.get(text)
    if (!oldIndices || oldIndices.length !== newIndices.length) continue
    newIndices.forEach((newIndex, order) => {
      pairs[newIndex] = oldIndices[order] ?? -1
    })
  }
}
