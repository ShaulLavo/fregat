import { tabAdvance } from './tabAdvance'
import {
  isCombiningMark,
  isVariationSelector,
  segmentGraphemes,
  type TextSegment,
} from '../graphemes'

/**
 * Soft-wrap row ends for one line, fed a chunk of code units at a time, in columns or in measured
 * pixels.
 *
 * With `words`, a row may end before the first non-space after spaces, on either side of a CJK
 * character, and on either edge of an unbreakable run (a replacement painted as one node). Spaces
 * never start a row: they hang past the edge, as `white-space: pre-wrap` lets them. A word wider
 * than the row ends before the grapheme that overflows; an unbreakable run wider than the row overflows
 * instead. Without `words`, a row ends before whichever grapheme would overflow it.
 */
export type WordWrapLine = {
  pending: string
  segmentText: string
  length: number
  visual: number
  segmentStart: number
  segmentVisual: number
  breakAt: number
  breakVisual: number
  previousSpace: boolean
  previousCjk: boolean
  readonly ends: number[]
}

export type LineBreakRules = {
  /** Row width, in columns without `advance`, in the advance's pixels with it. */
  readonly width: number
  readonly tabSize: number
  readonly words: boolean
  /** Pixel advance of one code point; null counts every code unit as one column. */
  readonly advance: ((codePoint: number) => number) | null
  readonly measure?: (text: string) => number
  readonly minimumTabAdvance?: number
}

/** The wrap settings of a projection config, spelled out so this module imports nothing back. */
export type WrapConfig = {
  readonly wrapColumn: number | null
  readonly wrapBreak?: 'character' | 'word'
  readonly wrapAdvance?: {
    readonly width: number
    readonly advance: (codePoint: number) => number
    readonly measure?: (text: string) => number
    readonly minimumTabAdvance?: number
  } | null
  readonly tabSize: number
}

/** Whether a wrap needs these rules; plain column wrap keeps its own leaner scan. */
export function needsLineBreakRules(config: WrapConfig): boolean {
  return config.wrapBreak === 'word' || Boolean(config.wrapAdvance)
}

export function lineBreakRules(config: WrapConfig): LineBreakRules {
  const measured = config.wrapAdvance ?? null
  return {
    width: measured ? measured.width : Math.max(1, Math.floor(config.wrapColumn ?? 1)),
    tabSize: config.tabSize,
    words: config.wrapBreak === 'word',
    advance: measured ? measured.advance : null,
    measure: measured?.measure,
    minimumTabAdvance: measured?.minimumTabAdvance,
  }
}

/** Display ranges no break may fall inside, sorted and disjoint. */
export type UnbreakableRuns = readonly (readonly [start: number, end: number])[]

const NO_RUNS: UnbreakableRuns = []
let lastSegmentedChunk: string | null = null
let lastChunkSegments: readonly TextSegment[] | null = null

export function createWordWrapLine(): WordWrapLine {
  return {
    pending: '',
    segmentText: '',
    length: 0,
    visual: 0,
    segmentStart: 0,
    segmentVisual: 0,
    breakAt: 0,
    breakVisual: 0,
    previousSpace: false,
    previousCjk: false,
    ends: [],
  }
}

export function resetWordWrapLine(line: WordWrapLine): void {
  line.pending = ''
  line.segmentText = ''
  line.length = 0
  line.visual = 0
  line.segmentStart = 0
  line.segmentVisual = 0
  line.breakAt = 0
  line.breakVisual = 0
  line.previousSpace = false
  line.previousCjk = false
  line.ends.length = 0
}

/**
 * Appends `text[from, to)`, which holds no line break. The state lives in locals for the loop: a
 * whole-document wrap feeds every character of the file through here.
 */
export function appendWordWrapText(
  line: WordWrapLine,
  text: string,
  from: number,
  to: number,
  rules: LineBreakRules,
  runs: UnbreakableRuns = NO_RUNS,
): void {
  const chunk = line.pending + text.slice(from, to)
  if (chunk.length === 0) return
  const segments = chunk === lastSegmentedChunk ? lastChunkSegments : wrapSegments(chunk)
  lastSegmentedChunk = chunk
  lastChunkSegments = segments
  const tail = pendingClusterStart(chunk, segments)
  line.pending = chunk.slice(tail)
  appendCompleteWrapText(line, chunk, tail, rules, runs, segments)
}

function wrapSegments(text: string): readonly TextSegment[] | null {
  return /[\u0300-\uffff]/.test(text) ? segmentGraphemes(text) : null
}

function pendingClusterStart(text: string, segments: readonly TextSegment[] | null): number {
  if (!segments) return text.length - 1
  const last = text.charCodeAt(text.length - 1)
  // A high surrogate may become a joining modifier or regional indicator in the next chunk.
  const pending = last >= 0xd800 && last <= 0xdbff ? -2 : -1
  return segments.at(pending)?.index ?? 0
}

/** The last cluster may continue in the next storage chunk; a line ending settles it. */
export function finishWordWrapLine(
  line: WordWrapLine,
  rules: LineBreakRules,
  runs: UnbreakableRuns = NO_RUNS,
): void {
  const text = line.pending
  line.pending = ''
  appendCompleteWrapText(line, text, text.length, rules, runs, wrapSegments(text))
}

function appendCompleteWrapText(
  line: WordWrapLine,
  text: string,
  to: number,
  rules: LineBreakRules,
  runs: UnbreakableRuns,
  segments: readonly TextSegment[] | null,
): void {
  const { width, words, advance, measure } = rules
  const minimumTabAdvance = rules.minimumTabAdvance ?? 0
  const tabStop = advance ? rules.tabSize * advance(32) : rules.tabSize
  let { length, visual, segmentStart, segmentVisual, breakAt, breakVisual } = line
  let segmentText = line.segmentText
  let previousSpace = line.previousSpace
  let previousCjk = line.previousCjk
  let run = firstRunEndingAtOrAfter(runs, length)
  let passedRunEnd = -1
  let cluster = 0
  for (let index = 0; index < to;) {
    let end = segments ? (segments[++cluster]?.index ?? text.length) : index + 1
    const code = text.charCodeAt(index)
    // Hanging whitespace cannot open a row; measure its whole run once.
    if (measure && words && spaceCode(code) && !segments && runs.length === 0) {
      while (end < to && spaceCode(text.charCodeAt(end))) end += 1
    }
    const space = code === 32 || code === 9
    const cjk = code >= 0x2e80 && isCjkCodeUnit(code)
    const current = runs[run]
    const interior = current !== undefined && length > current[0] && length < current[1]
    const runEdge =
      length === passedRunEnd ||
      (current !== undefined && (length === current[0] || length === current[1]))
    const opens = runEdge || previousSpace || cjk || previousCjk
    if (words && !space && !interior && length > 0 && opens) {
      breakAt = length
      breakVisual = visual
    }

    const unit = measure ? text.slice(index, end) : ''
    let cells = measure
      ? appendedShapedWidth(segmentText, unit, segmentVisual, tabStop, measure, minimumTabAdvance) -
        segmentVisual
      : clusterCells(text, index, end, segmentVisual, tabStop, advance)
    const overflows = cells > 0 && segmentVisual > 0 && segmentVisual + cells > width
    if (overflows && !(words && space)) {
      if (breakAt > segmentStart) {
        line.ends.push(breakAt)
        if (measure) segmentText = segmentText.slice(breakAt - segmentStart)
        segmentStart = breakAt
        segmentVisual = measure
          ? shapedWidth(segmentText, tabStop, measure, minimumTabAdvance)
          : visual - breakVisual
      } else if (!interior) {
        line.ends.push(length)
        segmentStart = length
        segmentVisual = 0
        segmentText = ''
      }
      cells = measure
        ? appendedShapedWidth(
            segmentText,
            unit,
            segmentVisual,
            tabStop,
            measure,
            minimumTabAdvance,
          ) - segmentVisual
        : clusterCells(text, index, end, segmentVisual, tabStop, advance)
      if (!interior && segmentVisual > 0 && segmentVisual + cells > width) {
        line.ends.push(length)
        segmentStart = length
        segmentVisual = 0
        segmentText = ''
        cells = measure
          ? appendedShapedWidth(
              segmentText,
              unit,
              segmentVisual,
              tabStop,
              measure,
              minimumTabAdvance,
            ) - segmentVisual
          : clusterCells(text, index, end, segmentVisual, tabStop, advance)
      }
    }
    if (measure) segmentText += unit
    visual += cells
    segmentVisual += cells
    length += end - index
    index = end
    previousSpace = space
    previousCjk = cjk
    if (current !== undefined && length >= current[1]) {
      passedRunEnd = current[1]
      run += 1
    }
  }
  line.length = length
  line.visual = visual
  line.segmentStart = segmentStart
  line.segmentVisual = segmentVisual
  line.segmentText = segmentText
  line.breakAt = breakAt
  line.breakVisual = breakVisual
  line.previousSpace = previousSpace
  line.previousCjk = previousCjk
}

function spaceCode(code: number): boolean {
  return code === 32 || code === 9
}

/** Earlier tab-separated runs are settled; only the current shaping run can change. */
function appendedShapedWidth(
  text: string,
  unit: string,
  width: number,
  tabStop: number,
  measure: (text: string) => number,
  minimumTabAdvance: number,
): number {
  const tab = text.lastIndexOf('\t')
  if (tab < 0) return shapedWidth(text + unit, tabStop, measure, minimumTabAdvance)
  const tail = text.slice(tab + 1)
  const settled = tail.length > 0 ? width - measure(tail) : width
  return settled + shapedWidth(tail + unit, tabStop, measure, minimumTabAdvance)
}

/** Tabs end shaping runs and reach the next stop from the wrapped row's origin. */
function shapedWidth(
  text: string,
  tabStop: number,
  measure: (text: string) => number,
  minimumTabAdvance: number,
): number {
  let width = 0
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 9) continue
    if (index > start) width += measure(text.slice(start, index))
    width += tabAdvance(width, tabStop, minimumTabAdvance)
    start = index + 1
  }
  return start < text.length ? width + measure(text.slice(start)) : width
}

/** Advances belong to complete graphemes, so a row never starts inside a glyph. */
function clusterCells(
  text: string,
  start: number,
  end: number,
  visual: number,
  tabStop: number,
  advance: ((codePoint: number) => number) | null,
): number {
  if (text.charCodeAt(start) === 9) return tabStop - (visual % tabStop)
  let cells = 0
  for (let index = start; index < end;) {
    const point = text.codePointAt(index)!
    const units = point > 0xffff ? 2 : 1
    if (!isCombiningMark(point) && !isVariationSelector(point) && point !== 0x200d) {
      cells += advance ? advance(point) : units
    }
    index += units
  }
  return cells
}

function firstRunEndingAtOrAfter(runs: UnbreakableRuns, offset: number): number {
  let index = 0
  while (index < runs.length && runs[index]![1] < offset) index += 1
  return index
}

/** Han, kana, Hangul and full-width forms: scripts that break between any two characters. */
function isCjkCodeUnit(code: number): boolean {
  if (code <= 0x9fff) return true
  if (code >= 0xac00 && code <= 0xd7af) return true
  if (code >= 0xf900 && code <= 0xfaff) return true
  return code >= 0xff00 && code <= 0xffef
}
