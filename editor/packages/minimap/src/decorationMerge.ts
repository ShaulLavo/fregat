import type { EditorMinimapDecoration } from './types'

/**
 * Past this many bands sharing one appearance the minimap stops answering the
 * question it was asked. The marks overlap into a solid wash that says no more
 * than a count already did, and the whole flattened list is re-collected and
 * re-posted whenever any source changes.
 */
export const MINIMAP_DECORATION_MERGE_LIMIT = 1000

// Two bands nearer than this cannot be told apart once painted, and neighbouring
// rows are one thing to look at however many pixels the minimap has to spare.
const MERGE_PIXEL_DISTANCE = 3
const MERGE_LINE_DISTANCE_FLOOR = 2

export function mergeDenseDecorations(
  decorations: readonly EditorMinimapDecoration[],
  height: number,
  lineCount: number,
): readonly EditorMinimapDecoration[] {
  if (decorations.length <= MINIMAP_DECORATION_MERGE_LIMIT) return decorations

  const distance = mergeLineDistance(height, lineCount)
  const merged: EditorMinimapDecoration[] = []
  for (const group of groupByAppearance(decorations).values()) {
    if (group.length <= MINIMAP_DECORATION_MERGE_LIMIT) {
      for (const decoration of group) merged.push(decoration)
      continue
    }

    appendMergedBands(merged, group, distance)
  }
  return merged
}

// How many document lines land within one band's width once the document is
// projected onto the height it is drawn at.
function mergeLineDistance(height: number, lineCount: number): number {
  if (height <= 0) return Math.max(MERGE_LINE_DISTANCE_FLOOR, lineCount)

  return Math.max(MERGE_LINE_DISTANCE_FLOOR, Math.ceil((MERGE_PIXEL_DISTANCE * lineCount) / height))
}

// One band standing in for several has to paint as one of them, so only bands
// that already paint alike may be combined: a span covering both an error and a
// search hit would have to pick a colour and be wrong about the other.
function groupByAppearance(
  decorations: readonly EditorMinimapDecoration[],
): Map<string, EditorMinimapDecoration[]> {
  const groups = new Map<string, EditorMinimapDecoration[]>()
  for (const decoration of decorations) {
    const key = `${decoration.position}|${decoration.color ?? ''}|${decoration.zIndex ?? 0}`
    const group = groups.get(key)
    if (group) {
      group.push(decoration)
      continue
    }

    groups.set(key, [decoration])
  }
  return groups
}

function appendMergedBands(
  target: EditorMinimapDecoration[],
  group: readonly EditorMinimapDecoration[],
  distance: number,
): void {
  const ordered = group.toSorted(byStartLineNumber)
  let band = ordered[0]
  if (!band) return

  for (let index = 1; index < ordered.length; index += 1) {
    const next = ordered[index]!
    if (next.startLineNumber - band.endLineNumber > distance) {
      target.push(band)
      band = next
      continue
    }

    if (next.endLineNumber > band.endLineNumber) {
      band = { ...band, endLineNumber: next.endLineNumber }
    }
  }
  target.push(band)
}

function byStartLineNumber(left: EditorMinimapDecoration, right: EditorMinimapDecoration): number {
  return left.startLineNumber - right.startLineNumber
}
