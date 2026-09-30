import type { PieceTableEdit, PieceTableTreeSnapshot } from './pieceTableTypes'
import { readPieceTableTextRange } from './reads'
import { createPieceTableWalker, type PieceTableWalker } from './walker'

const SUFFIX_WINDOW = 4096

// Computes the single minimal edit turning `previous` into `next`, or null
// when the texts are identical. Matches the edit shape produced by diffing the
// materialized texts (common prefix, then common suffix capped so it cannot
// overlap the prefix) without materializing either document.
export const diffPieceTableSnapshots = (
  previous: PieceTableTreeSnapshot,
  next: PieceTableTreeSnapshot,
): PieceTableEdit | null => {
  if (previous === next) return null
  if (previous.length === next.length && previous.root === next.root) return null

  const previousWalker = createPieceTableWalker(previous)
  const nextWalker = createPieceTableWalker(next)

  const prefix = commonPrefixLength(previousWalker, nextWalker)
  if (prefix === previous.length && prefix === next.length) return null

  const suffix = commonSuffixLength(
    previousWalker,
    nextWalker,
    previous.length,
    next.length,
    prefix,
  )
  return {
    from: prefix,
    to: previous.length - suffix,
    text: readPieceTableTextRange(next, prefix, next.length - suffix),
  }
}

const commonPrefixLength = (left: PieceTableWalker, right: PieceTableWalker): number => {
  for (;;) {
    const leftChunk = left.chunk()
    const rightChunk = right.chunk()
    if (!leftChunk || !rightChunk) return left.offset()

    const length = Math.min(leftChunk.end - leftChunk.start, rightChunk.end - rightChunk.start)
    const leftText =
      leftChunk.text.length === length ? leftChunk.text : leftChunk.text.slice(0, length)
    const rightText =
      rightChunk.text.length === length ? rightChunk.text : rightChunk.text.slice(0, length)
    if (leftText !== rightText) {
      let index = 0
      while (leftText.charCodeAt(index) === rightText.charCodeAt(index)) index += 1
      return left.offset() + index
    }

    left.skip(length)
    right.skip(length)
  }
}

const commonSuffixLength = (
  previousWalker: PieceTableWalker,
  nextWalker: PieceTableWalker,
  previousLength: number,
  nextLength: number,
  prefix: number,
): number => {
  const maxSuffix = Math.min(previousLength, nextLength) - prefix
  let suffix = 0

  while (suffix < maxSuffix) {
    const windowLength = Math.min(SUFFIX_WINDOW, maxSuffix - suffix)
    const previousWindow = readWindow(
      previousWalker,
      previousLength - suffix - windowLength,
      windowLength,
    )
    const nextWindow = readWindow(nextWalker, nextLength - suffix - windowLength, windowLength)
    if (previousWindow === nextWindow) {
      suffix += windowLength
      continue
    }

    let matched = 0
    while (
      matched < windowLength &&
      previousWindow.charCodeAt(windowLength - 1 - matched) ===
        nextWindow.charCodeAt(windowLength - 1 - matched)
    ) {
      matched += 1
    }
    return suffix + matched
  }

  return suffix
}

const readWindow = (walker: PieceTableWalker, start: number, length: number): string => {
  walker.seek(start)
  const parts: string[] = []
  let remaining = length

  while (remaining > 0) {
    const piece = walker.chunk()
    if (!piece) break
    const available = piece.end - piece.start
    if (available >= remaining) {
      parts.push(available === remaining ? piece.text : piece.text.slice(0, remaining))
      break
    }
    parts.push(piece.text)
    remaining -= available
    walker.nextChunk()
  }

  return parts.length === 1 ? (parts[0] ?? '') : parts.join('')
}
