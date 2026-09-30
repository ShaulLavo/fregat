/**
 * Soft-wrap row ends for one line, fed a chunk of code units at a time, in columns or in measured
 * pixels.
 *
 * With `words`, a row may end before the first non-space after spaces, on either side of a CJK
 * character, and on either edge of an unbreakable run (a replacement painted as one node). Spaces
 * never start a row: they hang past the edge, as `white-space: pre-wrap` lets them. A word wider
 * than the row ends at the unit that overflows; an unbreakable run wider than the row overflows
 * instead. Without `words`, a row ends at whichever unit would overflow it.
 */
export type WordWrapLine = {
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
}

/** The wrap settings of a projection config, spelled out so this module imports nothing back. */
export type WrapConfig = {
  readonly wrapColumn: number | null
  readonly wrapBreak?: 'character' | 'word'
  readonly wrapAdvance?: {
    readonly width: number
    readonly advance: (codePoint: number) => number
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
  }
}

/** Display ranges no break may fall inside, sorted and disjoint. */
export type UnbreakableRuns = readonly (readonly [start: number, end: number])[]

const NO_RUNS: UnbreakableRuns = []

export function createWordWrapLine(): WordWrapLine {
  return {
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
  const { width, words, advance } = rules
  const tabStop = advance ? rules.tabSize * advance(32) : rules.tabSize
  let { length, visual, segmentStart, segmentVisual, breakAt, breakVisual } = line
  let previousSpace = line.previousSpace
  let previousCjk = line.previousCjk
  let run = firstRunEndingAtOrAfter(runs, length)
  let passedRunEnd = -1
  for (let index = from; index < to; index += 1) {
    const code = text.charCodeAt(index)
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

    const cells = unitCells(text, index, code, visual, tabStop, advance)
    const overflows = cells > 0 && segmentVisual > 0 && segmentVisual + cells > width
    if (overflows && !(words && space)) {
      if (breakAt > segmentStart) {
        line.ends.push(breakAt)
        segmentStart = breakAt
        segmentVisual = visual - breakVisual
      } else if (!interior) {
        line.ends.push(length)
        segmentStart = length
        segmentVisual = 0
      }
    }
    visual += cells
    segmentVisual += cells
    length += 1
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
  line.breakAt = breakAt
  line.breakVisual = breakVisual
  line.previousSpace = previousSpace
  line.previousCjk = previousCjk
}

/** A pair's advance rides on its high surrogate; the low one adds nothing and never ends a row. */
function unitCells(
  text: string,
  index: number,
  code: number,
  visual: number,
  tabStop: number,
  advance: ((codePoint: number) => number) | null,
): number {
  if (code === 9) return tabStop - (visual % tabStop)
  if (!advance) return 1
  if (isLowSurrogate(code) && index > 0 && isHighSurrogate(text.charCodeAt(index - 1))) return 0
  return advance(text.codePointAt(index) ?? code)
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
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
