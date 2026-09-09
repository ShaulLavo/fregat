import type { TimelineRow } from '@/agent-stage/utils/timeline'

export type TimelineWindow = {
  readonly start: number
  readonly end: number
  readonly rows: readonly TimelineRow[]
}
export function createTimelineLayout() {
  let measuredWidth = 0
  const heights = new Map<string, { readonly source: string; readonly height: number }>()
  function height(row: TimelineRow, width: number) {
    if (width !== measuredWidth) {
      measuredWidth = width
      heights.clear()
    }
    const source = rowSource(row)
    const cached = heights.get(row.id)
    if (cached?.source === source) return cached.height
    const height = source
      .split('\n')
      .reduce(
        (total, line) =>
          total + Math.max(1, Math.ceil(Bun.stringWidth(line) / Math.max(width - 2, 1))),
        3,
      )
    heights.set(row.id, { source, height })
    return height
  }
  function window(
    rows: readonly TimelineRow[],
    width: number,
    viewport: number,
    endId: string | null,
  ): TimelineWindow {
    const anchor = endId ? rows.findIndex((row) => row.id === endId) : -1
    const end = anchor === -1 ? rows.length : anchor + 1
    const budget = Math.max(viewport * 3, 20)
    let start = end
    let used = 0
    while (start > 0 && end - start < 40 && used < budget) {
      start -= 1
      used += height(rows[start], width)
    }
    return { start, end, rows: rows.slice(start, end) }
  }
  function next(rows: readonly TimelineRow[], width: number, viewport: number, end: number) {
    let used = 0
    let index = end
    while (index < rows.length && index - end < 40 && used < Math.max(viewport * 3, 20)) {
      const rowHeight = height(rows[index], width)
      if (index > end && used + rowHeight > Math.max(viewport * 3, 20)) break
      used += rowHeight
      index += 1
    }
    return index === rows.length ? null : (rows[index - 1]?.id ?? null)
  }
  return { window, next }
}

function rowSource(row: TimelineRow) {
  if (row.kind === 'message') return row.message.text
  if (row.kind === 'plan') return row.plan.planMarkdown
  return row.activity.summary
}
