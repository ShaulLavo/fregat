const WORD = /^[\p{L}\p{N}_$]{2,}$/u

// Above this many cells an in-order pass is skipped and only the unique-text
// pass pairs pieces. A full-viewport rewrite of ~1,500 pieces each side fits.
const MAX_TABLE_CELLS = 2_500_000

/** What matching reads of a piece: its text, the top of the line it sits on, and any gap before it. */
export type MatchPiece = {
  readonly text: string
  readonly top: number
  readonly gapBefore?: boolean
}

type Line = {
  /** The line's text with one space for each gap, the same however highlighting split it. */
  readonly key: string
  readonly pieces: readonly number[]
  /** Where each piece starts in `key`. */
  readonly starts: readonly number[]
  readonly hasWord: boolean
}

/**
 * Pairs each new piece with the old piece it continues, by text. Returns one
 * entry per new piece: the old index it moves from, or -1 when it enters.
 *
 * Lines go first, whole: an unchanged line keeps its identity in order, and a
 * line that moved travels as one piece of text, punctuation included, instead
 * of trading its common tokens with the line it swapped with. The pieces left
 * over then pair in order by text, and finally a word that appears the same
 * number of times on both sides pairs wherever it is. Lone punctuation takes
 * no part in moves: a bracket flying across the screen reads as noise.
 */
export function matchPieces(
  oldPieces: readonly MatchPiece[],
  newPieces: readonly MatchPiece[],
): Int32Array {
  const pairs = new Int32Array(newPieces.length).fill(-1)
  const oldUsed = new Uint8Array(oldPieces.length)
  matchLines(linesOf(oldPieces), linesOf(newPieces), pairs, oldUsed)

  const oldRest = unpaired(oldPieces.length, (index) => oldUsed[index] === 1)
  const newRest = unpaired(newPieces.length, (index) => pairs[index] !== -1)
  matchInOrder(
    oldRest,
    newRest,
    (oldIndex, newIndex) => oldPieces[oldIndex]?.text === newPieces[newIndex]?.text,
    (oldIndex, newIndex) => pair(oldIndex, newIndex, pairs, oldUsed),
  )
  matchUniqueWords(oldPieces, newPieces, pairs, oldUsed)
  return pairs
}

/** Pieces grouped by line top, each line in piece order. */
function linesOf(pieces: readonly MatchPiece[]): Line[] {
  const byTop = new Map<number, number[]>()
  pieces.forEach((piece, index) => {
    const line = byTop.get(piece.top)
    if (line) line.push(index)
    else byTop.set(piece.top, [index])
  })
  return Array.from(byTop.values(), (indices) => {
    const starts: number[] = []
    let key = ''
    for (const index of indices) {
      const piece = pieces[index]
      if (piece?.gapBefore && key.length > 0) key += ' '
      starts.push(key.length)
      key += piece?.text ?? ''
    }
    return {
      key,
      pieces: indices,
      starts,
      hasWord: indices.some((index) => WORD.test(pieces[index]?.text ?? '')),
    }
  })
}

function matchLines(
  oldLines: readonly Line[],
  newLines: readonly Line[],
  pairs: Int32Array,
  oldUsed: Uint8Array,
): void {
  const oldLineUsed = new Uint8Array(oldLines.length)
  const newLineUsed = new Uint8Array(newLines.length)
  const pairLine = (oldLine: number, newLine: number) => {
    oldLineUsed[oldLine] = 1
    newLineUsed[newLine] = 1
    pairLinePieces(oldLines[oldLine], newLines[newLine], pairs, oldUsed)
  }
  matchInOrder(
    Array.from(oldLines, (_, index) => index),
    Array.from(newLines, (_, index) => index),
    (oldLine, newLine) => oldLines[oldLine]?.key === newLines[newLine]?.key,
    pairLine,
  )

  // A moved line pairs with the first unpaired old line that reads the same.
  const movedByKey = new Map<string, number[]>()
  oldLines.forEach((line, index) => {
    if (oldLineUsed[index] || !line.hasWord) return
    const list = movedByKey.get(line.key)
    if (list) list.push(index)
    else movedByKey.set(line.key, [index])
  })
  newLines.forEach((line, newLine) => {
    if (newLineUsed[newLine] || !line.hasWord) return
    const oldLine = movedByKey.get(line.key)?.shift()
    if (oldLine !== undefined) pairLine(oldLine, newLine)
  })
}

/**
 * Pairs the pieces of two lines that read the same by where each starts: highlighting may split
 * the two differently, and a new piece then moves from the old piece it starts at.
 */
function pairLinePieces(
  from: Line | undefined,
  to: Line | undefined,
  pairs: Int32Array,
  oldUsed: Uint8Array,
): void {
  if (!from || !to) return
  const byStart = new Map<number, number>()
  from.starts.forEach((start, order) => byStart.set(start, from.pieces[order] ?? -1))
  to.starts.forEach((start, order) => {
    const newIndex = to.pieces[order]
    if (newIndex !== undefined) pair(byStart.get(start) ?? -1, newIndex, pairs, oldUsed)
  })
}

function unpaired(length: number, used: (index: number) => boolean): number[] {
  const rest: number[] = []
  for (let index = 0; index < length; index += 1) if (!used(index)) rest.push(index)
  return rest
}

function pair(oldIndex: number, newIndex: number, pairs: Int32Array, oldUsed: Uint8Array): void {
  if (oldIndex < 0) return
  pairs[newIndex] = oldIndex
  oldUsed[oldIndex] = 1
}

/** Longest common subsequence of two index lists under `same`, after trimming the shared ends. */
function matchInOrder(
  oldIndices: readonly number[],
  newIndices: readonly number[],
  same: (oldIndex: number, newIndex: number) => boolean,
  onPair: (oldIndex: number, newIndex: number) => void,
): void {
  const sameAt = (i: number, j: number) => same(oldIndices[i] ?? -1, newIndices[j] ?? -1)
  const pairAt = (i: number, j: number) => onPair(oldIndices[i] ?? -1, newIndices[j] ?? -1)
  let start = 0
  while (start < oldIndices.length && start < newIndices.length && sameAt(start, start)) {
    pairAt(start, start)
    start += 1
  }
  let oldEnd = oldIndices.length
  let newEnd = newIndices.length
  while (oldEnd > start && newEnd > start && sameAt(oldEnd - 1, newEnd - 1)) {
    oldEnd -= 1
    newEnd -= 1
    pairAt(oldEnd, newEnd)
  }

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
      lengths[here] = sameAt(start + i, start + j)
        ? (lengths[here + width + 1] ?? 0) + 1
        : Math.max(lengths[here + width] ?? 0, lengths[here + 1] ?? 0)
    }
  }

  let i = 0
  let j = 0
  while (i < rows && j < columns) {
    if (sameAt(start + i, start + j)) {
      pairAt(start + i, start + j)
      i += 1
      j += 1
      continue
    }
    if ((lengths[(i + 1) * width + j] ?? 0) >= (lengths[i * width + j + 1] ?? 0)) i += 1
    else j += 1
  }
}

function matchUniqueWords(
  oldPieces: readonly MatchPiece[],
  newPieces: readonly MatchPiece[],
  pairs: Int32Array,
  oldUsed: Uint8Array,
): void {
  const oldByText = new Map<string, number[]>()
  oldPieces.forEach(({ text }, index) => {
    if (oldUsed[index] || !WORD.test(text)) return
    const list = oldByText.get(text)
    if (list) list.push(index)
    else oldByText.set(text, [index])
  })
  const newByText = new Map<string, number[]>()
  newPieces.forEach(({ text }, index) => {
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
