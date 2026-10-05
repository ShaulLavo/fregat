import {
  createTextDiff,
  joinRenderLines,
  type DiffGutterSide,
  type DiffRenderRow,
} from '@singapore-editor/diff'
import type { EditorViewSnapshot, EditorResolvedSelection } from '@singapore-editor/core/extensions'

type Side = 'old' | 'new'
type SourceLines = Readonly<Record<Side, readonly string[] | null>>
type SourceAnchor = {
  readonly kind: 'source'
  readonly side: Side
  readonly line: number
  readonly character: number
}
type DisplayAnchor = {
  readonly kind: 'display'
  readonly region: string | null
  readonly hunk: number | null
  readonly row: number
  readonly character: number
}
type Anchor = SourceAnchor | DisplayAnchor

export type DiffPaneAnchors = {
  readonly selections: readonly {
    readonly anchor: Anchor
    readonly head: Anchor
    readonly affinity: EditorResolvedSelection['affinity']
  }[]
  readonly viewport: { readonly anchor: Anchor; readonly withinRow: number } | null
  readonly left: number
}

export function captureDiffAnchors(
  lines: SourceLines,
  rows: readonly DiffRenderRow[],
  side: DiffGutterSide,
  snapshot: EditorViewSnapshot,
): DiffPaneAnchors {
  const starts = rowStarts(rows)
  const capture = (offset: number) => anchorAt(rows, starts, lines, side, offset)
  const visible = snapshot.visibleRows.find(
    (row) =>
      row.top + row.height > snapshot.viewport.scrollTop &&
      capture(row.startOffset).kind === 'source',
  )
  const first =
    visible ??
    snapshot.visibleRows.find((row) => row.top + row.height > snapshot.viewport.scrollTop)
  return {
    selections: snapshot.selections.map((selection) => ({
      anchor: capture(selection.anchorOffset),
      head: capture(selection.headOffset),
      affinity: selection.affinity,
    })),
    viewport: first
      ? { anchor: capture(first.startOffset), withinRow: first.top - snapshot.viewport.scrollTop }
      : null,
    left: snapshot.viewport.scrollLeft,
  }
}

export function resolveDiffAnchors(
  anchors: DiffPaneAnchors,
  oldLines: SourceLines | null,
  nextLines: SourceLines,
  rows: readonly DiffRenderRow[],
  rowHeight: number,
  sameInput: boolean,
) {
  const starts = rowStarts(rows)
  const maps = {
    old: oldLines?.old && nextLines.old ? sourceLineMap(oldLines.old, nextLines.old) : null,
    new: oldLines?.new && nextLines.new ? sourceLineMap(oldLines.new, nextLines.new) : null,
  }
  const resolve = (anchor: Anchor, viewport = false) => {
    if (anchor.kind === 'display' && !sameInput) return { offset: 0, bufferRow: 0 }
    return resolveAnchor(anchor, rows, starts, maps, viewport)
  }
  const viewport = anchors.viewport
  const position = viewport ? resolve(viewport.anchor, true) : null
  return {
    selections: anchors.selections.map((selection) => ({
      anchor: resolve(selection.anchor).offset,
      head: resolve(selection.head).offset,
      affinity: selection.affinity,
    })),
    scroll: {
      left: anchors.left,
      top:
        position && viewport ? Math.max(0, position.bufferRow * rowHeight - viewport.withinRow) : 0,
    },
  }
}

function rowStarts(rows: readonly DiffRenderRow[]): readonly number[] {
  let offset = 0
  return rows.map((row) => {
    const start = offset
    offset += row.text.length + 1
    return start
  })
}

function anchorAt(
  rows: readonly DiffRenderRow[],
  starts: readonly number[],
  lines: Readonly<Record<Side, readonly string[] | null>>,
  pane: DiffGutterSide,
  offset: number,
): Anchor {
  let index = starts.findIndex(
    (start, row) => offset >= start && offset <= start + (rows[row]?.text.length ?? 0),
  )
  if (index < 0) index = Math.max(0, rows.length - 1)
  const row = rows[index]
  const character = Math.max(0, Math.min(offset - (starts[index] ?? 0), row?.text.length ?? 0))
  const candidates: readonly Side[] = pane === 'stacked' ? ['new', 'old'] : [pane]
  for (const side of candidates) {
    const line = sourceLine(row, side)
    if (line !== null && lines[side]?.[line] === row?.text)
      return { kind: 'source', side, line, character }
  }
  return {
    kind: 'display',
    row: index,
    region: row?.expandKey ?? null,
    hunk: row?.hunkIndex ?? null,
    character,
  }
}

function sourceLine(row: DiffRenderRow | undefined, side: Side): number | null {
  const number = side === 'old' ? row?.oldLineNumber : row?.newLineNumber
  return number === undefined ? null : number - 1
}

function resolveAnchor(
  anchor: Anchor,
  rows: readonly DiffRenderRow[],
  starts: readonly number[],
  maps: Readonly<Record<Side, readonly number[] | null>>,
  viewport: boolean,
) {
  if (anchor.kind === 'display') {
    const index = displayRow(anchor, rows)
    return projectedPosition(rows, starts, index, anchor.character)
  }
  const line = maps[anchor.side]?.[anchor.line] ?? anchor.line
  if (line < 0) return { offset: 0, bufferRow: 0 }
  const exact = rows.findIndex((row) => sourceLine(row, anchor.side) === line)
  if (exact >= 0) return projectedPosition(rows, starts, exact, anchor.character)
  if (viewport) {
    const separator = collapsedRow(rows, anchor.side, line)
    if (separator >= 0) return projectedPosition(rows, starts, separator, 0)
  }
  const nearest = nearestSourceRow(rows, anchor.side, line)
  if (nearest >= 0) return projectedPosition(rows, starts, nearest, anchor.character)
  const other: Side = anchor.side === 'old' ? 'new' : 'old'
  const boundary = nearestSourceRow(rows, other, line)
  return projectedPosition(
    rows,
    starts,
    Math.max(0, boundary),
    boundary >= 0 ? anchor.character : 0,
  )
}

function displayRow(anchor: DisplayAnchor, rows: readonly DiffRenderRow[]): number {
  if (anchor.region !== null) {
    const region = rows.findIndex((row) => row.expandKey === anchor.region)
    if (region >= 0) return region
  }
  const same = rows[anchor.row]
  if (same && (anchor.hunk === null || same.hunkIndex === anchor.hunk)) return anchor.row
  const hunk = anchor.hunk === null ? -1 : rows.findIndex((row) => row.hunkIndex === anchor.hunk)
  return Math.max(0, hunk)
}

function collapsedRow(rows: readonly DiffRenderRow[], side: Side, line: number): number {
  let predecessor = -1
  for (const [index, row] of rows.entries()) {
    const current = sourceLine(row, side)
    if (current !== null && current > line) return predecessor
    if (row.type === 'hunk' && row.expandKey) predecessor = index
    if (current !== null && current <= line) predecessor = -1
  }
  return predecessor
}

function nearestSourceRow(rows: readonly DiffRenderRow[], side: Side, line: number): number {
  let index = -1
  let distance = Infinity
  let candidateLine = Infinity
  for (const [rowIndex, row] of rows.entries()) {
    const current = sourceLine(row, side)
    if (current === null) continue
    const delta = Math.abs(current - line)
    if (delta > distance || (delta === distance && current > candidateLine)) continue
    distance = delta
    candidateLine = current
    index = rowIndex
  }
  return index
}

function projectedPosition(
  rows: readonly DiffRenderRow[],
  starts: readonly number[],
  index: number,
  character: number,
) {
  const row = rows[index]
  const column = Math.max(0, Math.min(character, row?.text.length ?? 0))
  const offset = (starts[index] ?? 0) + column
  const earlierBreaks = rows
    .slice(0, index)
    .reduce((count, entry) => count + entry.text.split('\n').length, 0)
  const segment = (row?.text.slice(0, column).match(/\n/g) ?? []).length
  return { offset, bufferRow: earlierBreaks + segment }
}

function sourceLineMap(
  previous: readonly string[],
  next: readonly string[],
): readonly number[] | null {
  if (sameLines(previous, next)) return null
  if (previous.some((line) => line.includes('\n')) || next.some((line) => line.includes('\n')))
    return previous.map(() => -1)
  const file = createTextDiff({
    oldFile: { path: 'source', text: joinRenderLines(previous.map((text) => ({ text }))) },
    newFile: { path: 'source', text: joinRenderLines(next.map((text) => ({ text }))) },
    contextLines: 0,
  })
  const mapped: number[] = []
  const removed: { start: number; lines: readonly string[]; boundary: number }[] = []
  const added: { start: number; lines: readonly string[] }[] = []
  let oldCursor = 0
  let newCursor = 0
  for (const hunk of file.hunks) {
    const oldStart = Math.max(0, hunk.oldStart - 1)
    const newStart = Math.max(0, hunk.newStart - 1)
    while (oldCursor < oldStart) mapped[oldCursor++] = newCursor++
    removed.push({
      start: oldStart,
      lines: previous.slice(oldStart, oldStart + hunk.oldLines),
      boundary: newStart,
    })
    added.push({ start: newStart, lines: next.slice(newStart, newStart + hunk.newLines) })
    for (let line = oldStart; line < oldStart + hunk.oldLines; line += 1)
      mapped[line] = Math.min(newStart, Math.max(0, next.length - 1))
    oldCursor = oldStart + hunk.oldLines
    newCursor = newStart + hunk.newLines
  }
  while (oldCursor < previous.length) mapped[oldCursor++] = newCursor++
  for (const block of removed) mapUniqueMove(block, added, previous, next, mapped)
  return mapped
}

function mapUniqueMove(
  block: { start: number; lines: readonly string[] },
  added: readonly { start: number; lines: readonly string[] }[],
  previous: readonly string[],
  next: readonly string[],
  mapped: number[],
): void {
  if (block.lines.length === 0) return
  const candidates = added.flatMap((candidate) =>
    blockStarts(candidate.lines, block.lines).map((offset) => candidate.start + offset),
  )
  if (
    candidates.length !== 1 ||
    occurrences(previous, block.lines) !== 1 ||
    occurrences(next, block.lines) !== 1
  )
    return
  const destination = candidates[0]!
  for (const [index] of block.lines.entries()) mapped[block.start + index] = destination + index
}

function sameLines(left: readonly string[], right: readonly string[]): boolean {
  return (
    left === right ||
    (left.length === right.length && left.every((line, index) => line === right[index]))
  )
}

function occurrences(source: readonly string[], block: readonly string[]): number {
  return blockStarts(source, block).length
}

function blockStarts(source: readonly string[], block: readonly string[]): readonly number[] {
  const starts: number[] = []
  for (let index = 0; index <= source.length - block.length; index += 1) {
    if (block.every((line, offset) => source[index + offset] === line)) starts.push(index)
  }
  return starts
}
