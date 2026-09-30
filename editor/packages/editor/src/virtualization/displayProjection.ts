import { type DisplayRow, type TransformBias } from '../displayTransforms'
import {
  createStringTextSnapshot,
  getPieceTreeSnapshot,
  measureTextSnapshotRange,
  type TextSnapshot,
} from '../documentTextSnapshot'
import { updateFoldMapForEdit } from '../foldMap'
import { updateInlineMapForEdit } from '../inlineMap'
import { measureString, TextMeasurements } from '../textMeasurements'
import { RangeText, type TextContent } from '../textContent'
import { createTextEditBatch, mapTextEditBatchOffset, type TextEditBatch } from '../textEditBatch'
import {
  buildContext,
  buildSpan,
  injectedRowCount,
  mergeLineRanges,
  type BuildContext,
  type SourceLineRange,
} from './displayProjectionBuild'
import {
  locateSourceLine,
  locateDisplayRow,
  sourceLineIndex,
  displayRowIndex,
  splice,
  wrappedRowPrefix,
  wrappedLineSummary,
  type ProjectionNode,
} from './displayProjectionIndex'
import { resolveProjectionRow, type ResolvedProjectionRow } from './displayProjectionRows'
import {
  inlineWrapSegmentForSourceColumn,
  read,
  readProjectedText,
  wrapSegmentForColumn,
} from './displayProjectionText'
import type {
  DisplayProjectionConfig,
  DisplayProjectionInput,
  DisplayProjectionTransition,
  DisplayRowMetrics,
  ProjectionCounters,
} from './displayProjectionTypes'

export type {
  DisplayProjectionConfig,
  DisplayProjectionInput,
  DisplayRowMetrics,
} from './displayProjectionTypes'

const MAX_CACHED_ROWS = 256
const MAX_CACHED_TEXT_BYTES = 1024 * 1024

type CachedRow = { readonly row: DisplayRow; readonly bytes: number }
type ProjectionTransition = DisplayProjectionTransition | TextEditBatch

export class DisplayProjection {
  private context: BuildContext
  private root: ProjectionNode | null
  private readonly cache = new Map<number, CachedRow>()
  private cachedTextBytes = 0
  private readonly counters: ProjectionCounters = {
    sourceBytesRead: 0,
    materializedRows: 0,
    materializedTextBytes: 0,
    indexEntriesTouched: 0,
    summaryLinesMeasured: 0,
  }
  private revisionValue = 0

  constructor(input: DisplayProjectionInput) {
    this.context = buildContext(
      input.textSnapshot,
      validConfig(input, input.textSnapshot),
      this.counters,
    )
    this.root = buildSpan(this.context, 0, input.textSnapshot.lineCount)
  }

  get supportsIncrementalRowPatch(): boolean {
    const { foldMap, inlineMap, injectedTextRows, wrapColumn } = this.config
    return (
      foldMap === null && inlineMap === null && injectedTextRows.length === 0 && wrapColumn === null
    )
  }

  get rowCount(): number {
    return this.root?.rows ?? 0
  }
  get revision(): number {
    return this.revisionValue
  }
  get config(): DisplayProjectionConfig {
    return this.context.config
  }
  get textSnapshot(): TextSnapshot {
    return this.context.snapshot
  }
  get diagnostics() {
    return {
      ...this.counters,
      cachedRows: this.cache.size,
      cachedTextBytes: this.cachedTextBytes,
      indexNodes: this.root?.nodes ?? 0,
      summaryBytes: this.root?.bytes ?? 0,
    }
  }

  getRowMetrics(index: number): DisplayRowMetrics | undefined {
    return this.resolve(index)?.metrics
  }

  getRow(index: number): DisplayRow | undefined {
    const cached = this.cache.get(index)
    if (cached) {
      this.cache.delete(index)
      this.cache.set(index, cached)
      return cached.row
    }
    const resolved = this.resolve(index)
    if (!resolved) return undefined
    const row = this.materialize(resolved)
    const bytes = retainedRowBytes(row)
    this.counters.materializedRows += 1
    this.counters.materializedTextBytes += bytes
    this.cacheRow(index, row, bytes)
    return row
  }

  getRowTextWindow(index: number, start: number, end: number): string {
    const resolved = this.resolve(index)
    if (!resolved) return ''
    const { metrics, injected, inline } = resolved
    const from = Math.max(0, Math.min(metrics.textLength, start)) + metrics.displayStartColumn
    const to = Math.max(from, Math.min(metrics.textLength, end) + metrics.displayStartColumn)
    if (injected) return injected.input.text.slice(from, to)
    return readProjectedText(
      this.textSnapshot,
      this.textSnapshot.lineStart(metrics.bufferRow),
      inline,
      from,
      to,
      this.counters,
    )
  }

  getRowMeasurements(index: number): TextMeasurements | undefined {
    const resolved = this.resolve(index)
    if (!resolved) return undefined
    const { metrics, injected, inline } = resolved
    if (injected)
      return measureString(injected.input.text).slice(
        metrics.displayStartColumn,
        metrics.displayEndColumn,
      )
    if (inline)
      return this.lineMeasurements(resolved).slice(
        metrics.displayStartColumn,
        metrics.displayEndColumn,
      )
    return measureTextSnapshotRange(this.textSnapshot, metrics.startOffset, metrics.endOffset)
  }

  getLineText(index: number): TextContent {
    const cached = this.cache.get(index)?.row
    if (
      cached &&
      cached.displayStartColumn === 0 &&
      cached.displayEndColumn === cached.text.length &&
      !this.config.wrapColumn
    )
      return cached.text
    const resolved = this.resolve(index)
    if (!resolved) return ''
    if (resolved.injected) return resolved.injected.input.text
    const { metrics, inline } = resolved
    const length = inline?.mapping.displayLength ?? metrics.sourceLength
    const start = this.textSnapshot.lineStart(metrics.bufferRow)
    const snapshot = this.textSnapshot
    const counters = this.counters
    const readRange = (from: number, to: number) =>
      readProjectedText(snapshot, start, inline, from, to, counters)
    if (length < 4096) return readRange(0, length)
    return rangedText(length, readRange, this.lineMeasurements(resolved), counters)
  }

  private lineMeasurements(resolved: ResolvedProjectionRow): TextMeasurements {
    const { metrics, inline, injected } = resolved
    if (injected) return measureString(injected.input.text)
    const start = this.textSnapshot.lineStart(metrics.bufferRow)
    if (!inline)
      return measureTextSnapshotRange(this.textSnapshot, start, start + metrics.sourceLength)
    const parts = inline.parts.map((part) =>
      part.replacement === null
        ? measureTextSnapshotRange(
            this.textSnapshot,
            start + part.sourceStart,
            start + part.sourceStart + part.end - part.start,
          )
        : measureString(part.replacement),
    )
    return TextMeasurements.concat(parts)
  }

  materializeWindow(start: number, end: number): readonly DisplayRow[] {
    const from = Math.max(0, Math.floor(start))
    const to = Math.min(this.rowCount, Math.ceil(end))
    this.evictOutside(from, to)
    const rows: DisplayRow[] = []
    for (let index = from; index < to; index += 1) {
      const row = this.getRow(index)
      if (row) rows.push(row)
    }
    return rows
  }

  rowForBufferRow(bufferRow: number): number {
    if (!this.root) return 0
    const row = clamp(bufferRow, this.textSnapshot.lineCount - 1)
    const location = locateSourceLine(this.root, sourceLineIndex(row))
    if (!location) return 0
    if (location.entry.kind === 'wrapped')
      return location.rowStart + wrappedRowPrefix(location.entry, row - location.sourceStart)
    if (location.entry.kind === 'line')
      return location.rowStart + injectedRowCount(location.entry.before)
    if (!location.entry.hidden) return location.rowStart + row - location.sourceStart
    return this.rowForBufferRow(Math.max(0, location.sourceStart - 1))
  }

  /** Null for a row the projection does not have; a caller that wants a nearest row clamps first. */
  bufferRowForRow(index: number): number | null {
    return this.getRowMetrics(index)?.bufferRow ?? null
  }

  rowForOffset(offset: number, bias: TransformBias = 'nearest'): number {
    const target = clamp(offset, this.textSnapshot.length)
    const row = this.textSnapshot.lineAt(target)
    const location = locateSourceLine(this.root, sourceLineIndex(row))
    if (!location || location.entry.kind === 'run') return this.rowForBufferRow(row)
    const { entry } = location
    const range = this.textSnapshot.lineRange(row)
    if (entry.kind === 'wrapped') {
      return (
        this.rowForBufferRow(row) +
        wrapSegmentForColumn(
          wrappedLineSummary(entry, row - location.sourceStart, range.end - range.start),
          target - range.start,
          bias,
        )
      )
    }
    const column = Math.min(range.end, target) - range.start
    const segment = entry.inline
      ? inlineWrapSegmentForSourceColumn(entry.wrap, entry.inline.mapping, column, bias)
      : wrapSegmentForColumn(entry.wrap, column, bias)
    return location.rowStart + injectedRowCount(entry.before) + segment
  }

  nextDocumentRow(index: number, step: number): number | null {
    if (!this.root || this.rowCount === 0) return null
    const direction = step < 0 ? -1 : 1
    let target = index + direction
    while (target >= 0 && target < this.rowCount) {
      const location = locateDisplayRow(this.root, displayRowIndex(target))
      if (!location) return null
      if (location.entry.kind !== 'line') return target
      const first = location.rowStart + injectedRowCount(location.entry.before)
      const last = first + location.entry.wrap.rows - 1
      if (target >= first && target <= last) return target
      if (target < first && direction > 0) return first
      if (target > last && direction < 0) return last
      target = direction > 0 ? location.rowStart + location.entry.rows : location.rowStart - 1
    }
    return null
  }

  reconfigure(input: Partial<DisplayProjectionInput>): void {
    const snapshot = input.textSnapshot ?? this.textSnapshot
    const config = validConfig({ ...this.config, ...input }, snapshot)
    if (snapshot !== this.textSnapshot || globalMetricsChanged(this.config, config)) {
      this.reset(snapshot, config)
      return
    }
    const context = buildContext(snapshot, config, this.counters)
    const ranges = changedSparseRanges(this.context, context)
    if (!ranges.length) {
      this.context = context
      return
    }
    this.replaceRanges(context, ranges)
  }

  update(transition: ProjectionTransition, input: Partial<DisplayProjectionConfig> = {}): void {
    if (!('changes' in transition) && transition.edits.length > 1)
      transition = createTextEditBatch(transition.before, transition.after, transition.edits)
    const config = validConfig(
      { ...updatedMaps(this.config, transition), ...input },
      transition.after,
    )
    if (
      transition.before !== this.textSnapshot ||
      transition.edits.length === 0 ||
      globalMetricsChanged(this.config, config)
    ) {
      this.reset(transition.after, config)
      return
    }
    const context = buildContext(transition.after, config, this.counters)
    const ranges = editRanges(transition)
    for (const range of ranges.toReversed()) {
      this.root = splice(
        this.root,
        range.oldStart,
        range.oldEnd - range.oldStart,
        buildSpan(context, range.newStart, range.newEnd),
        () => {
          this.counters.indexEntriesTouched += 1
        },
      )
    }
    const sparse = changedSparseRanges(this.context, context, transition)
    this.replaceRanges(context, sparse)
  }

  retainWindow(start: number, end: number): void {
    this.evictOutside(start, end)
  }

  clearCache(): void {
    this.cache.clear()
    this.cachedTextBytes = 0
  }

  dispose(): void {
    this.clearCache()
    this.root = null
    const empty = createStringTextSnapshot('')
    this.context = buildContext(
      empty,
      { foldMap: null, inlineMap: null, injectedTextRows: [], wrapColumn: null, tabSize: 4 },
      this.counters,
    )
  }

  private resolve(index: number): ResolvedProjectionRow | undefined {
    if (!Number.isInteger(index) || index < 0) return undefined
    const location = locateDisplayRow(this.root, displayRowIndex(index))
    return location ? resolveProjectionRow(this.textSnapshot, location, index) : undefined
  }

  private materialize(resolved: ResolvedProjectionRow): DisplayRow {
    const { metrics, injected } = resolved
    const measurements =
      metrics.textLength >= 1024 ? this.getRowMeasurements(metrics.index) : undefined
    const snapshot = this.textSnapshot
    const start = snapshot.lineStart(metrics.bufferRow)
    const counters = this.counters
    const readRange = (from: number, to: number) =>
      injected
        ? injected.input.text.slice(
            metrics.displayStartColumn + from,
            metrics.displayStartColumn + to,
          )
        : readProjectedText(
            snapshot,
            start,
            resolved.inline,
            metrics.displayStartColumn + from,
            metrics.displayStartColumn + to,
            counters,
          )
    const text =
      metrics.textLength >= 4096 && measurements
        ? rangedText(metrics.textLength, readRange, measurements, counters)
        : readRange(0, metrics.textLength)
    const sourceText = injected?.input.text ?? this.sourceText(resolved, text)
    const { textLength: _, sourceLength: __, ...fields } = metrics
    return { ...fields, text, sourceText, ...(measurements ? { measurements } : {}) }
  }

  private sourceText(resolved: ResolvedProjectionRow, text: TextContent): TextContent {
    const { metrics, inline } = resolved
    if (!inline && metrics.wrapSegment === 0 && metrics.textLength === metrics.sourceLength)
      return text
    const start = this.textSnapshot.lineStart(metrics.bufferRow)
    const snapshot = this.textSnapshot
    const counters = this.counters
    if (metrics.sourceLength < 4096)
      return read(snapshot, start, start + metrics.sourceLength, counters)
    return rangedText(
      metrics.sourceLength,
      (from, to) => read(snapshot, start + from, start + to, counters),
      measureTextSnapshotRange(snapshot, start, start + metrics.sourceLength),
      counters,
    )
  }

  private cacheRow(index: number, row: DisplayRow, bytes: number): void {
    if (bytes > MAX_CACHED_TEXT_BYTES) return
    while (
      this.cache.size >= MAX_CACHED_ROWS ||
      this.cachedTextBytes + bytes > MAX_CACHED_TEXT_BYTES
    )
      this.evictOldest()
    this.cache.set(index, { row, bytes })
    this.cachedTextBytes += bytes
  }

  private evictOldest(): void {
    const first = this.cache.keys().next().value
    if (first === undefined) return
    this.cachedTextBytes -= this.cache.get(first)!.bytes
    this.cache.delete(first)
  }

  private evictOutside(start: number, end: number): void {
    for (const [index, cached] of this.cache) {
      if (index >= start && index < end) continue
      this.cachedTextBytes -= cached.bytes
      this.cache.delete(index)
    }
  }

  private reset(snapshot: TextSnapshot, config: DisplayProjectionConfig): void {
    const context = buildContext(snapshot, config, this.counters)
    this.root = buildSpan(context, 0, snapshot.lineCount)
    this.context = context
    this.clearCache()
    this.revisionValue += 1
  }

  private replaceRanges(context: BuildContext, ranges: readonly SourceLineRange[]): void {
    for (const range of ranges) {
      const end = Math.min(context.snapshot.lineCount, range.end)
      this.root = splice(
        this.root,
        range.start,
        end - range.start,
        buildSpan(context, range.start, end),
        () => {
          this.counters.indexEntriesTouched += 1
        },
      )
    }
    this.context = context
    this.clearCache()
    this.revisionValue += 1
  }
}

function retainedRowBytes(row: DisplayRow): number {
  const textBytes = typeof row.text === 'string' ? row.text.length * 2 : 0
  const sourceBytes =
    typeof row.sourceText === 'string' && row.sourceText !== row.text
      ? row.sourceText.length * 2
      : 0
  return textBytes + sourceBytes
}

function clamp(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(Math.max(0, maximum), Math.floor(value)))
}

function validConfig(
  config: DisplayProjectionConfig,
  snapshot: TextSnapshot,
): DisplayProjectionConfig {
  return {
    wrapColumn: config.wrapColumn,
    wrapBreak: config.wrapBreak ?? 'character',
    wrapAdvance: config.wrapAdvance ?? null,
    tabSize: config.tabSize,
    injectedTextRows: config.injectedTextRows,
    foldMap: config.foldMap?.snapshot.length === snapshot.length ? config.foldMap : null,
    inlineMap: config.inlineMap?.snapshot.length === snapshot.length ? config.inlineMap : null,
  }
}

function globalMetricsChanged(
  before: DisplayProjectionConfig,
  after: DisplayProjectionConfig,
): boolean {
  return (
    before.wrapColumn !== after.wrapColumn ||
    before.wrapBreak !== after.wrapBreak ||
    before.wrapAdvance !== after.wrapAdvance ||
    before.tabSize !== after.tabSize
  )
}

function changedSparseRanges(
  before: BuildContext,
  after: BuildContext,
  transition?: ProjectionTransition,
): SourceLineRange[] {
  if (
    !transition &&
    before.config.foldMap === after.config.foldMap &&
    before.config.inlineMap === after.config.inlineMap &&
    before.config.injectedTextRows === after.config.injectedTextRows
  )
    return []
  const ranges: SourceLineRange[] = []
  const oldHidden = before.hidden.map((range) => mapLineRange(range, transition))
  const oldKeys = new Set(oldHidden.map((range) => `${range.start}:${range.end}`))
  const newKeys = new Set(after.hidden.map((range) => `${range.start}:${range.end}`))
  for (const range of oldHidden) if (!newKeys.has(`${range.start}:${range.end}`)) ranges.push(range)
  for (const range of after.hidden)
    if (!oldKeys.has(`${range.start}:${range.end}`)) ranges.push(range)
  const oldRows = new Map(
    before.sparseRows.map((row) => [
      mapLineRange({ start: row, end: row + 1 }, transition).start,
      row,
    ]),
  )
  const candidates = new Set([...oldRows.keys(), ...after.sparseRows])
  for (const row of candidates) {
    const previous = oldRows.get(row)
    if (previous !== undefined && sameLineTransforms(before, previous, after, row)) continue
    ranges.push({ start: row, end: row + 1 })
  }
  return mergeLineRanges(ranges)
}

function sameLineTransforms(
  before: BuildContext,
  beforeRow: number,
  after: BuildContext,
  afterRow: number,
): boolean {
  const beforeInline = before.config.inlineMap?.rowReplacements.get(beforeRow) ?? []
  const afterInline = after.config.inlineMap?.rowReplacements.get(afterRow) ?? []
  const beforeInjected = before.injected.get(beforeRow) ?? []
  const afterInjected = after.injected.get(afterRow) ?? []
  return sameObjects(beforeInline, afterInline) && sameObjects(beforeInjected, afterInjected)
}

function sameObjects<T extends object>(before: readonly T[], after: readonly T[]): boolean {
  if (before.length !== after.length) return false
  return before.every((value, index) => {
    const next = after[index]!
    const keys = Object.keys(value)
    return (
      keys.length === Object.keys(next).length &&
      keys.every((key) => Reflect.get(value, key) === Reflect.get(next, key))
    )
  })
}

function mapLineRange(range: SourceLineRange, transition?: ProjectionTransition): SourceLineRange {
  if (!transition) return range
  const { before, after } = transition
  return {
    start: after.lineAt(mapOffset(before.lineStart(range.start), transition, 'before')),
    end:
      range.end >= before.lineCount
        ? after.lineCount
        : after.lineAt(mapOffset(before.lineStart(range.end), transition, 'after')),
  }
}

function updatedMaps(
  config: DisplayProjectionConfig,
  transition: ProjectionTransition,
): DisplayProjectionConfig {
  const snapshot = getPieceTreeSnapshot(transition.after)
  const edit = transition.edits[0]
  if (!snapshot || !edit) return config
  const foldMap = config.foldMap ? updateFoldMapForEdit(config.foldMap, edit, snapshot).map : null
  const inlineMap = config.inlineMap
    ? updateInlineMapForEdit(config.inlineMap, edit, snapshot).map
    : null
  return { ...config, foldMap, inlineMap }
}

type EditLineRange = {
  readonly oldStart: number
  readonly oldEnd: number
  readonly newStart: number
  readonly newEnd: number
}

function editRanges(transition: ProjectionTransition): EditLineRange[] {
  const { before, after, edits } = transition
  const ranges = mergeLineRanges(
    edits.map((edit) => ({ start: before.lineAt(edit.from), end: before.lineAt(edit.to) + 1 })),
  )
  return ranges.map((range) => {
    const from = mapOffset(before.lineStart(range.start), transition, 'before')
    const newStart = after.lineAt(from)
    if (range.end >= before.lineCount)
      return { oldStart: range.start, oldEnd: range.end, newStart, newEnd: after.lineCount }
    const end = mapOffset(before.lineStart(range.end), transition, 'after')
    return { oldStart: range.start, oldEnd: range.end, newStart, newEnd: after.lineAt(end) }
  })
}

function mapOffset(
  offset: number,
  transition: ProjectionTransition,
  bias: 'before' | 'after',
): number {
  if ('changes' in transition) return mapTextEditBatchOffset(transition, offset, bias)

  let delta = 0
  for (const edit of transition.edits) {
    if (offset < edit.from || (offset === edit.from && bias === 'before')) break
    if (offset <= edit.to) return edit.from + delta + (bias === 'after' ? edit.text.length : 0)
    delta += edit.text.length - (edit.to - edit.from)
  }
  return offset + delta
}

function rangedText(
  length: number,
  readRange: (start: number, end: number) => string,
  measurements: TextMeasurements,
  counters: ProjectionCounters,
): RangeText {
  return new RangeText(length, readRange, measurements, (count) => {
    counters.sourceBytesRead += count * 2
  })
}
