import { inlineColumnToSourceColumn } from '../displayTransforms'
import type { TextLineRange, TextSnapshot } from '../documentTextSnapshot'
import {
  wrappedRowPrefix,
  wrappedSourceLine,
  wrappedLineSummary,
  type ProjectionLocation,
} from './displayProjectionIndex'
import { injectedRowCount } from './displayProjectionBuild'
import { uniformWrap, wrapRange } from './displayProjectionText'
import type {
  DisplayRowMetrics,
  InjectedSummary,
  InlineSummary,
  WrapSummary,
} from './displayProjectionTypes'

export type ResolvedProjectionRow = {
  readonly metrics: DisplayRowMetrics
  readonly inline: InlineSummary | null
  readonly injected: InjectedSummary | null
}

export function resolveProjectionRow(
  snapshot: TextSnapshot,
  location: ProjectionLocation,
  index: number,
): ResolvedProjectionRow {
  const { entry, sourceStart, rowStart } = location
  if (entry.kind === 'wrapped') {
    const localLine = wrappedSourceLine(entry, index - rowStart)
    const bufferRow = sourceStart + localLine
    const range = snapshot.lineRange(bufferRow)
    return documentRow(
      range,
      bufferRow,
      index,
      wrappedLineSummary(entry, localLine, range.end - range.start),
      null,
      index - rowStart - wrappedRowPrefix(entry, localLine),
    )
  }
  if (entry.kind === 'run') {
    const bufferRow = sourceStart + index - rowStart
    const range = snapshot.lineRange(bufferRow)
    const wrap = uniformWrap(range.end - range.start, null)
    return documentRow(range, bufferRow, index, wrap, null, 0)
  }
  const before = injectedRowCount(entry.before)
  const local = index - rowStart
  if (local < before) return injectedRow(snapshot, sourceStart, index, entry.before, local)
  if (local >= before + entry.wrap.rows)
    return injectedRow(snapshot, sourceStart, index, entry.after, local - before - entry.wrap.rows)
  const range = snapshot.lineRange(sourceStart)
  return documentRow(range, sourceStart, index, entry.wrap, entry.inline, local - before)
}

function documentRow(
  range: TextLineRange,
  bufferRow: number,
  index: number,
  wrap: WrapSummary,
  inline: InlineSummary | null,
  segment: number,
): ResolvedProjectionRow {
  const [start, end] = wrapRange(wrap, segment)
  const sourceStartColumn = inline
    ? inlineColumnToSourceColumn(inline.mapping, start, 'before')
    : start
  const sourceEndColumn = inline ? inlineColumnToSourceColumn(inline.mapping, end, 'after') : end
  const lineStart = range.start
  const metrics: DisplayRowMetrics = {
    kind: 'text',
    source: 'document',
    index,
    bufferRow,
    startOffset: lineStart + sourceStartColumn,
    endOffset: lineStart + sourceEndColumn,
    sourceStartColumn,
    sourceEndColumn,
    displayStartColumn: start,
    displayEndColumn: end,
    wrapSegment: segment,
    textLength: end - start,
    sourceLength: range.end - lineStart,
    ...(inline ? { inlineRow: inline.mapping } : {}),
  }
  return { metrics, inline, injected: null }
}

function injectedRow(
  snapshot: TextSnapshot,
  bufferRow: number,
  index: number,
  rows: readonly InjectedSummary[],
  local: number,
): ResolvedProjectionRow {
  let segment = local
  for (const row of rows) {
    if (segment >= row.wrap.rows) {
      segment -= row.wrap.rows
      continue
    }
    return injectedSegment(snapshot, bufferRow, index, row, segment)
  }
  return documentRow(snapshot.lineRange(bufferRow), bufferRow, index, uniformWrap(0, null), null, 0)
}

function injectedSegment(
  snapshot: TextSnapshot,
  bufferRow: number,
  index: number,
  injected: InjectedSummary,
  segment: number,
): ResolvedProjectionRow {
  const { input, wrap } = injected
  const [start, end] = wrapRange(wrap, segment)
  const offset =
    input.placement === 'before' ? snapshot.lineStart(bufferRow) : snapshot.lineRange(bufferRow).end
  const metrics: DisplayRowMetrics = {
    kind: 'text',
    source: 'injected',
    index,
    bufferRow,
    anchorBufferRow: bufferRow,
    placement: input.placement,
    order: input.order ?? 0,
    id: input.id,
    startOffset: offset,
    endOffset: offset,
    sourceStartColumn: start,
    sourceEndColumn: end,
    displayStartColumn: start,
    displayEndColumn: end,
    wrapSegment: segment,
    textLength: end - start,
    sourceLength: input.text.length,
    ...(input.className === undefined ? {} : { className: input.className }),
    ...(input.gutterClassName === undefined ? {} : { gutterClassName: input.gutterClassName }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  }
  return { metrics, inline: null, injected }
}
