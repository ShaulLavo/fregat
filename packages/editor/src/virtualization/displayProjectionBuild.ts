import { buildWrappedSpan } from './displayProjectionWrap'
import type { InjectedTextRow } from '../displayTransforms'
import type { TextSnapshot } from '../documentTextSnapshot'
import { entryNode, join, runNode, type ProjectionNode } from './displayProjectionIndex'
import { inlineSummary, summarizeDocumentWrap, summarizeReadWrap } from './displayProjectionText'
import type {
  DisplayProjectionConfig,
  InjectedSummary,
  ProjectionCounters,
} from './displayProjectionTypes'

export type SourceLineRange = { readonly start: number; readonly end: number }
export type BuildContext = {
  readonly snapshot: TextSnapshot
  readonly config: DisplayProjectionConfig
  readonly hidden: readonly SourceLineRange[]
  readonly sparseRows: readonly number[]
  readonly injected: ReadonlyMap<number, readonly InjectedTextRow[]>
  readonly counters: ProjectionCounters
}

export function buildContext(
  snapshot: TextSnapshot,
  config: DisplayProjectionConfig,
  counters: ProjectionCounters,
): BuildContext {
  const injected = indexInjections(config.injectedTextRows)
  const hidden =
    config.foldMap?.ranges
      .map((range) => ({ start: range.startPoint.row + 1, end: range.endPoint.row + 1 }))
      .filter((range) => range.end > range.start) ?? []
  const rows = new Set([...(config.inlineMap?.rowReplacements.keys() ?? []), ...injected.keys()])
  return {
    snapshot,
    config,
    counters,
    hidden,
    injected,
    sparseRows: [...rows].sort((a, b) => a - b),
  }
}

function indexInjections(
  inputs: readonly InjectedTextRow[],
): ReadonlyMap<number, readonly InjectedTextRow[]> {
  const map = new Map<number, InjectedTextRow[]>()
  const sorted = inputs
    .filter((input) => input.id.length > 0 && input.anchorBufferRow >= 0)
    .toSorted(
      (a, b) =>
        a.anchorBufferRow - b.anchorBufferRow ||
        placement(a) - placement(b) ||
        (a.order ?? 0) - (b.order ?? 0) ||
        a.id.localeCompare(b.id),
    )
  for (const input of sorted) {
    const rows = map.get(input.anchorBufferRow)
    if (rows) rows.push(input)
    else map.set(input.anchorBufferRow, [input])
  }
  return map
}

function placement(input: InjectedTextRow): number {
  return input.placement === 'before' ? 0 : 1
}

export function buildSpan(context: BuildContext, from: number, to: number): ProjectionNode | null {
  const end = Math.min(context.snapshot.lineCount, to)
  let row = Math.max(0, from)
  let root: ProjectionNode | null = null
  while (row < end) {
    const hidden = hiddenRangeAtOrAfter(context.hidden, row)
    if (hidden && hidden.start <= row) {
      const next = Math.min(end, hidden.end)
      root = join(root, runNode(next - row, true))
      row = next
      continue
    }
    const plainEnd = plainSpanEnd(context, row, end, hidden)
    if (plainEnd > row) {
      const span =
        context.config.wrapColumn && context.config.wrapColumn > 0
          ? buildWrappedSpan(context, row, plainEnd)
          : runNode(plainEnd - row)
      root = join(root, span)
      row = plainEnd
      continue
    }
    root = join(root, buildLine(context, row))
    row += 1
  }
  return root
}

function hiddenRangeAtOrAfter(
  ranges: readonly SourceLineRange[],
  row: number,
): SourceLineRange | undefined {
  let low = 0
  let high = ranges.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (ranges[middle]!.end <= row) low = middle + 1
    else high = middle
  }
  return ranges[low]
}

function plainSpanEnd(
  context: BuildContext,
  row: number,
  end: number,
  hidden: SourceLineRange | undefined,
): number {
  const sparse = firstAtOrAfter(context.sparseRows, row)
  return Math.min(end, sparse ?? end, hidden?.start ?? end)
}

function firstAtOrAfter(rows: readonly number[], row: number): number | undefined {
  let low = 0
  let high = rows.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (rows[middle]! < row) low = middle + 1
    else high = middle
  }
  return rows[low]
}

function buildLine(context: BuildContext, row: number): ProjectionNode {
  const { snapshot, config, counters } = context
  const { start, end } = snapshot.lineRange(row)
  const inline = inlineSummary(end - start, config.inlineMap?.rowReplacements.get(row) ?? [])
  const wrap = summarizeDocumentWrap(snapshot, start, end, inline, config, counters)
  const injections = context.injected.get(row) ?? []
  const before = injections
    .filter((input) => input.placement === 'before')
    .map((input) => injectedSummary(input, config))
  const after = injections
    .filter((input) => input.placement === 'after')
    .map((input) => injectedSummary(input, config))
  const rows = wrap.rows + injectedRowCount(before) + injectedRowCount(after)
  counters.indexEntriesTouched += 1
  return entryNode({ kind: 'line', sourceLines: 1, rows, inline, wrap, before, after })
}

function injectedSummary(input: InjectedTextRow, config: DisplayProjectionConfig): InjectedSummary {
  return {
    input,
    wrap: summarizeReadWrap(input.text.length, (from, to) => input.text.slice(from, to), config),
  }
}

export function injectedRowCount(rows: readonly InjectedSummary[]): number {
  return rows.reduce((sum, row) => sum + row.wrap.rows, 0)
}

export function mergeLineRanges(ranges: readonly SourceLineRange[]): SourceLineRange[] {
  const merged: SourceLineRange[] = []
  for (const range of ranges.toSorted((a, b) => a.start - b.start)) {
    const previous = merged.at(-1)
    if (previous && range.start <= previous.end) {
      merged[merged.length - 1] = { start: previous.start, end: Math.max(previous.end, range.end) }
      continue
    }
    if (range.end > range.start) merged.push(range)
  }
  return merged
}
