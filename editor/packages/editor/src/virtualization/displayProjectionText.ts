import {
  inlineColumnToSourceColumn,
  type InlineRow,
  type TransformBias,
  inlineReplacementSegment,
  inlineSourceSegment,
  normalizeInlineReplacements,
  type InlineReplacement,
  type InlineRowSegment,
} from '../displayTransforms'
import { measureTextSnapshotRange, type TextSnapshot } from '../documentTextSnapshot'
import type { TextMeasurements } from '../textMeasurements'
import type {
  InlineSummary,
  InlineTextPart,
  ProjectionCounters,
  WrapSummary,
} from './displayProjectionTypes'
import {
  appendWordWrapText,
  createWordWrapLine,
  lineBreakRules,
  needsLineBreakRules,
  type UnbreakableRuns,
  type WrapConfig,
} from './wordWrap'

export function inlineSummary(
  length: number,
  replacements: readonly InlineReplacement[],
): InlineSummary | null {
  const normalized = normalizeInlineReplacements(length, replacements)
  if (!normalized.length) return null
  const segments: InlineRowSegment[] = []
  const parts: InlineTextPart[] = []
  let source = 0
  let display = 0
  for (const replacement of normalized) {
    if (replacement.startColumn > source) {
      const count = replacement.startColumn - source
      segments.push(inlineSourceSegment(source, replacement.startColumn, display))
      parts.push({ start: display, end: display + count, sourceStart: source, replacement: null })
      display += count
    }
    segments.push(inlineReplacementSegment(replacement, display))
    parts.push({
      start: display,
      end: display + replacement.text.length,
      sourceStart: replacement.startColumn,
      replacement: replacement.text,
    })
    display += replacement.text.length
    source = replacement.endColumn
  }
  if (source < length) {
    segments.push(inlineSourceSegment(source, length, display))
    parts.push({
      start: display,
      end: display + length - source,
      sourceStart: source,
      replacement: null,
    })
    display += length - source
  }
  return { mapping: { sourceLength: length, displayLength: display, segments }, parts }
}

export function readProjectedText(
  snapshot: TextSnapshot,
  sourceStart: number,
  inline: InlineSummary | null,
  start: number,
  end: number,
  counters: ProjectionCounters,
): string {
  if (!inline) return read(snapshot, sourceStart + start, sourceStart + end, counters)
  const slices: string[] = []
  for (const part of inline.parts) {
    const from = Math.max(start, part.start)
    const to = Math.min(end, part.end)
    if (to <= from) continue
    slices.push(readPart(snapshot, sourceStart, part, from, to, counters))
  }
  return slices.join('')
}

function readPart(
  snapshot: TextSnapshot,
  sourceStart: number,
  part: InlineTextPart,
  start: number,
  end: number,
  counters: ProjectionCounters,
): string {
  if (part.replacement !== null) return part.replacement.slice(start - part.start, end - part.start)
  return read(
    snapshot,
    sourceStart + part.sourceStart + start - part.start,
    sourceStart + part.sourceStart + end - part.start,
    counters,
  )
}

export function read(
  snapshot: TextSnapshot,
  start: number,
  end: number,
  counters: ProjectionCounters,
): string {
  counters.sourceBytesRead += Math.max(0, end - start) * 2
  return snapshot.readRange(start, end)
}

export function uniformWrap(length: number, width: number | null): WrapSummary {
  const segmentWidth =
    width && Number.isFinite(width) && width > 0
      ? Math.max(1, Math.floor(width))
      : Math.max(1, length)
  return {
    kind: 'uniform',
    length,
    width: segmentWidth,
    rows: Math.max(1, Math.ceil(length / segmentWidth)),
  }
}

export function summarizeDocumentWrap(
  snapshot: TextSnapshot,
  start: number,
  end: number,
  inline: InlineSummary | null,
  config: WrapConfig,
  counters: ProjectionCounters,
): WrapSummary {
  const length = inline?.mapping.displayLength ?? end - start
  const width = config.wrapColumn
  if (!width || !Number.isFinite(width) || width <= 0) return uniformWrap(length, null)
  counters.summaryLinesMeasured += 1
  if (needsLineBreakRules(config)) {
    const readRange = inline
      ? (from: number, to: number) => readProjectedText(snapshot, start, inline, from, to, counters)
      : (from: number, to: number) => read(snapshot, start + from, start + to, counters)
    return summarizeRuleWrap(length, readRange, config, unbreakableRuns(inline))
  }
  if (inline)
    return summarizeReadWrap(
      length,
      (from, to) => readProjectedText(snapshot, start, inline, from, to, counters),
      config,
    )
  return summarizeMeasuredWrap(
    measureTextSnapshotRange(snapshot, start, end),
    width,
    config.tabSize,
  )
}

function summarizeMeasuredWrap(
  measured: TextMeasurements,
  width: number,
  tabSize: number,
): WrapSummary {
  const uniform = uniformWrap(measured.length, width)
  if (!measured.hasTabs) return uniform
  const ends: number[] = []
  let start = 0
  const normalizedWidth = Math.max(1, Math.floor(width))
  while (start < measured.length) {
    const column = measured.columnAt(start, tabSize, 'utf16')
    start = Math.max(
      start + 1,
      measured.offsetAt(column + normalizedWidth, 'before', tabSize, 'utf16'),
    )
    ends.push(start)
  }
  return {
    kind: 'indexed',
    length: measured.length,
    ends: Uint32Array.from(ends),
    rows: Math.max(1, ends.length),
  }
}

export function summarizeReadWrap(
  length: number,
  readRange: (start: number, end: number) => string,
  config: WrapConfig,
): WrapSummary {
  const width = config.wrapColumn
  const tabSize = config.tabSize
  if (!width || !Number.isFinite(width) || width <= 0) return uniformWrap(length, null)
  if (needsLineBreakRules(config)) return summarizeRuleWrap(length, readRange, config, [])
  const ends: number[] = []
  const state = { visual: 0, segmentVisual: 0, hasTabs: false }
  const normalizedWidth = Math.max(1, Math.floor(width))
  for (let start = 0; start < length; start += 4096) {
    appendWrapEnds(
      readRange(start, Math.min(length, start + 4096)),
      start,
      normalizedWidth,
      tabSize,
      ends,
      state,
    )
  }
  if (!state.hasTabs) return uniformWrap(length, width)
  ends.push(length)
  return { kind: 'indexed', length, ends: Uint32Array.from(ends), rows: ends.length }
}

/**
 * A line that never breaks can still be longer than a uniform row holds (spaces hanging past the
 * edge, narrow glyphs, a run too wide to split), so any such line comes back explicit.
 */
function summarizeRuleWrap(
  length: number,
  readRange: (start: number, end: number) => string,
  config: WrapConfig,
  runs: UnbreakableRuns,
): WrapSummary {
  const line = createWordWrapLine()
  const rules = lineBreakRules(config)
  for (let start = 0; start < length; start += 4096) {
    const text = readRange(start, Math.min(length, start + 4096))
    appendWordWrapText(line, text, 0, text.length, rules, runs)
  }
  if (line.ends.length === 0) return uniformWrap(length, null)
  const ends = Uint32Array.from([...line.ends, length])
  return { kind: 'indexed', length, ends, rows: ends.length }
}

/** A replacement is painted as one box, so no row break may fall inside its display span. */
function unbreakableRuns(inline: InlineSummary | null): UnbreakableRuns {
  if (!inline) return []
  return inline.parts
    .filter((part) => part.replacement !== null && part.end > part.start)
    .map((part) => [part.start, part.end] as const)
}

function appendWrapEnds(
  text: string,
  start: number,
  width: number,
  tabSize: number,
  ends: number[],
  state: { visual: number; segmentVisual: number; hasTabs: boolean },
): void {
  for (let column = 0; column < text.length; column += 1) {
    const tab = text.charCodeAt(column) === 9
    const cells = tab ? tabSize - (state.visual % tabSize) : 1
    state.hasTabs ||= tab
    if (state.segmentVisual > 0 && state.segmentVisual + cells > width) {
      ends.push(start + column)
      state.segmentVisual = 0
    }
    state.visual += cells
    state.segmentVisual += cells
  }
}

export function wrapRange(wrap: WrapSummary, segment: number): readonly [number, number] {
  if (wrap.kind === 'uniform')
    return [segment * wrap.width, Math.min(wrap.length, (segment + 1) * wrap.width)]
  return [segment === 0 ? 0 : wrap.ends[segment - 1]!, wrap.ends[segment] ?? wrap.length]
}

export function wrapSegmentForColumn(
  wrap: WrapSummary,
  column: number,
  bias: 'before' | 'after' | 'nearest',
): number {
  const target = Math.max(0, Math.min(wrap.length, column))
  if (wrap.kind === 'uniform') {
    if (target > 0 && target % wrap.width === 0 && bias !== 'after')
      return Math.min(wrap.rows - 1, target / wrap.width - 1)
    return Math.min(wrap.rows - 1, Math.floor(target / wrap.width))
  }
  let low = 0
  let high = wrap.rows - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const end = wrap.ends[middle]!
    if (end < target || (end === target && bias === 'after')) low = middle + 1
    else high = middle
  }
  return low
}

export function inlineWrapSegmentForSourceColumn(
  wrap: WrapSummary,
  mapping: InlineRow,
  column: number,
  bias: TransformBias,
): number {
  let low = 0
  let high = wrap.rows - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const end = inlineColumnToSourceColumn(mapping, wrapRange(wrap, middle)[1], 'after')
    if (end < column) low = middle + 1
    else high = middle
  }
  if (bias !== 'after' || low + 1 >= wrap.rows) return low
  const end = inlineColumnToSourceColumn(mapping, wrapRange(wrap, low)[1], 'after')
  if (end !== column) return low
  const nextStart = inlineColumnToSourceColumn(mapping, wrapRange(wrap, low + 1)[0], 'before')
  return nextStart === column ? low + 1 : low
}
