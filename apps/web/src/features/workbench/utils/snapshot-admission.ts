type SnapshotAdmission = {
  readonly reason: string
  readonly differs?: readonly string[]
  readonly savedWidth?: number
  readonly savedHeight?: number
  readonly width?: number
  readonly height?: number
}

/**
 * The editor judges an offered paint while it constructs, before its logger plugin exists, so the
 * verdict only reaches us through the performance mark it publishes.
 */
export function latestSnapshotAdmission(paintKey: string): SnapshotAdmission | null {
  const marks = performance.getEntriesByName('editor.snapshot.admission', 'mark')
  for (let index = marks.length - 1; index >= 0; index -= 1) {
    const detail: unknown = (marks[index] as PerformanceMark).detail
    if (!isAdmission(detail) || detail.documentKey !== paintKey) continue
    const { reason, differs, savedWidth, savedHeight, width, height } = detail
    return { reason, differs, savedWidth, savedHeight, width, height }
  }
  return null
}

function isAdmission(value: unknown): value is SnapshotAdmission & { documentKey: string } {
  return typeof value === 'object' && value !== null && 'reason' in value && 'documentKey' in value
}
