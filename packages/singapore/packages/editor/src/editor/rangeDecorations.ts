import type { EditorRangeDecoration } from './types'

type RangeDecorationGroup = {
  readonly name: string
  readonly ranges: EditorRangeDecoration[]
  readonly style: ReturnType<typeof rangeDecorationStyle>
}

type PendingRangeDecorationGroup = RangeDecorationGroup & {
  readonly key: string
}

/**
 * Flattens per-projection decorations into one paint-ordered list. Projections
 * arrive already ordered by layer then priority, so a projection's position in
 * that order is the stacking its decorations inherit when they declare none.
 */
export function rangeDecorationsWithProjectionStacking(
  projections: readonly (readonly EditorRangeDecoration[])[],
): readonly EditorRangeDecoration[] {
  const decorations: EditorRangeDecoration[] = []
  for (const [zIndex, projection] of projections.entries()) {
    for (const decoration of projection) {
      decorations.push(decoration.zIndex === undefined ? { ...decoration, zIndex } : decoration)
    }
  }

  return decorations
}

export function groupedRangeDecorations(
  decorations: readonly EditorRangeDecoration[],
  highlightPrefix: string,
): readonly RangeDecorationGroup[] {
  const groups: PendingRangeDecorationGroup[] = []

  // Group names carry the index they were minted at, so the input has to arrive in paint order:
  // a group that changes index between frames changes name, which re-registers it at the end of
  // the highlight registry and silently restacks it against whatever it overlaps.
  for (const decoration of decorations.toSorted(byRangeDecorationZIndex)) {
    const style = rangeDecorationStyle(decoration)
    const key = rangeDecorationGroupKey(decoration.className, style)
    const previous = groups.at(-1)
    if (!previous || previous.key !== key) {
      groups.push(rangeDecorationGroup(highlightPrefix, decoration, style, key, groups.length))
      continue
    }

    previous.ranges.push(decoration)
  }

  return groups
}

export function sameEditorRangeDecorations(
  left: readonly EditorRangeDecoration[],
  right: readonly EditorRangeDecoration[],
): boolean {
  if (left.length !== right.length) return false

  return left.every((decoration, index) => {
    const next = right[index]
    return next ? sameEditorRangeDecoration(decoration, next) : false
  })
}

function byRangeDecorationZIndex(
  left: EditorRangeDecoration,
  right: EditorRangeDecoration,
): number {
  return rangeDecorationZIndex(left) - rangeDecorationZIndex(right)
}

function rangeDecorationZIndex(decoration: EditorRangeDecoration): number {
  return decoration.zIndex ?? 0
}

function rangeDecorationStyle(decoration: EditorRangeDecoration): {
  readonly backgroundColor?: string
  readonly color?: string
  readonly textDecoration?: string
  readonly zIndex: number
} {
  return {
    backgroundColor: decoration.style?.backgroundColor || undefined,
    color: decoration.style?.color || undefined,
    textDecoration: decoration.style?.textDecoration || undefined,
    zIndex: rangeDecorationZIndex(decoration),
  }
}

function rangeDecorationGroup(
  highlightPrefix: string,
  decoration: EditorRangeDecoration,
  style: ReturnType<typeof rangeDecorationStyle>,
  key: string,
  index: number,
): PendingRangeDecorationGroup {
  return {
    key,
    name: rangeDecorationGroupName(highlightPrefix, decoration.className, index),
    ranges: [decoration],
    style,
  }
}

function rangeDecorationGroupName(
  highlightPrefix: string,
  className: string | undefined,
  index: number,
): string {
  const semanticName = sanitizedHighlightName(className)
  if (semanticName) return `${highlightPrefix}-range-${semanticName}-${index}`
  return `${highlightPrefix}-range-decoration-${index}`
}

function rangeDecorationGroupKey(
  className: string | undefined,
  style: ReturnType<typeof rangeDecorationStyle>,
): string {
  return [
    className ?? '',
    style.backgroundColor ?? '',
    style.color ?? '',
    style.textDecoration ?? '',
    String(style.zIndex),
  ].join('\u0000')
}

function sameEditorRangeDecoration(
  left: EditorRangeDecoration,
  right: EditorRangeDecoration,
): boolean {
  if (left.start !== right.start) return false
  if (left.end !== right.end) return false
  if (left.className !== right.className) return false
  if (left.zIndex !== right.zIndex) return false

  return sameRangeDecorationStyle(left, right)
}

function sameRangeDecorationStyle(
  left: EditorRangeDecoration,
  right: EditorRangeDecoration,
): boolean {
  const leftStyle = rangeDecorationStyle(left)
  const rightStyle = rangeDecorationStyle(right)
  if (leftStyle.backgroundColor !== rightStyle.backgroundColor) return false
  if (leftStyle.color !== rightStyle.color) return false

  return leftStyle.textDecoration === rightStyle.textDecoration
}

function sanitizedHighlightName(value: string | undefined): string | null {
  const firstClassName = value?.split(/\s+/).find(Boolean)
  if (!firstClassName) return null

  const sanitized = firstClassName.replaceAll(/[^a-zA-Z0-9_-]/g, '-')
  if (sanitized.length === 0) return null
  if (/^[a-zA-Z_]/.test(sanitized)) return sanitized
  return `_${sanitized}`
}
