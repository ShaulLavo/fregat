import type { FileTreeVisibleRow } from '@workspace/tree'

export function getTreeRowPath(row: FileTreeVisibleRow): string {
  return row.isFlattened
    ? (row.flattenedSegments?.findLast((segment) => segment.isTerminal)?.path ?? row.path)
    : row.path
}

export function getTreeRowAriaLabel(row: FileTreeVisibleRow): string {
  const flattenedSegments = row.flattenedSegments
  if (flattenedSegments == null || flattenedSegments.length === 0) {
    return row.name
  }

  return flattenedSegments.map((segment) => segment.name).join(' / ')
}

// Search keeps DOM focus on the built-in input, so the focused row still needs
// a stable DOM id for aria-activedescendant and visual-focus parity.
export function getTreeFocusedRowDomId(
  instanceId: string | undefined,
  path: string,
  parked: boolean,
): string | undefined {
  if (instanceId == null) {
    return undefined
  }

  return `${instanceId}__focused-item-${encodeURIComponent(path)}${parked ? '__parked' : ''}`
}
