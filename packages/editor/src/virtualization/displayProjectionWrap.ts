import { join, wrappedNode, type ProjectionNode } from './displayProjectionIndex'
import { read } from './displayProjectionText'
import type { BuildContext } from './displayProjectionBuild'
import {
  appendWordWrapText,
  createWordWrapLine,
  lineBreakRules,
  needsLineBreakRules,
  resetWordWrapLine,
  type LineBreakRules,
  type WordWrapLine,
} from './wordWrap'

const BLOCK_LINES = 256
const READ_WINDOW = 16384

type WrapScan = {
  prefixes: number[]
  readonly tabOffsets: number[]
  readonly tabEnds: number[]
  length: number
  visual: number
  segmentVisual: number
  rows: number
  explicitEnds: boolean
  ends: number[]
  completed: number
  readonly width: number
  readonly tabSize: number
  /** Present unless rows end at plain column counts, which keep the leaner loop below. */
  readonly word: WordWrapLine | null
  readonly rules: LineBreakRules
}

export function buildWrappedSpan(
  context: BuildContext,
  startRow: number,
  endRow: number,
): ProjectionNode | null {
  let root: ProjectionNode | null = null
  for (let row = startRow; row < endRow; row += BLOCK_LINES) {
    root = join(root, buildWrappedBlock(context, row, Math.min(endRow, row + BLOCK_LINES)))
  }
  return root
}

function buildWrappedBlock(
  context: BuildContext,
  startRow: number,
  endRow: number,
): ProjectionNode | null {
  const { snapshot, config, counters } = context
  const state: WrapScan = {
    prefixes: [0],
    tabOffsets: [0],
    tabEnds: [],
    length: 0,
    visual: 0,
    segmentVisual: 0,
    rows: 1,
    explicitEnds: false,
    ends: [],
    completed: 0,
    width: Math.max(1, Math.floor(config.wrapColumn!)),
    tabSize: config.tabSize,
    word: needsLineBreakRules(config) ? createWordWrapLine() : null,
    rules: lineBreakRules(config),
  }
  const start = snapshot.lineStart(startRow)
  const end = endRow >= snapshot.lineCount ? snapshot.length : snapshot.lineStart(endRow)
  for (let offset = start; offset < end; offset += READ_WINDOW) {
    scanWrapChunk(read(snapshot, offset, Math.min(end, offset + READ_WINDOW), counters), state)
  }
  if (state.completed < endRow - startRow) finishLine(state)
  counters.summaryLinesMeasured += endRow - startRow
  counters.indexEntriesTouched += 1
  const breaks =
    state.tabEnds.length > 0
      ? { offsets: Uint32Array.from(state.tabOffsets), ends: Uint32Array.from(state.tabEnds) }
      : null
  return wrappedNode(Uint32Array.from(state.prefixes), state.width, breaks)
}

function scanWrapChunk(text: string, state: WrapScan): void {
  if (state.word) {
    scanWordWrapChunk(text, state, state.word)
    return
  }
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code === 10) {
      finishLine(state)
      continue
    }
    appendCodeUnit(code, state)
  }
}

function scanWordWrapChunk(text: string, state: WrapScan, word: WordWrapLine): void {
  let start = 0
  for (let end = text.indexOf('\n'); end !== -1; end = text.indexOf('\n', start)) {
    appendWordWrapText(word, text, start, end, state.rules)
    finishLine(state)
    start = end + 1
  }
  appendWordWrapText(word, text, start, text.length, state.rules)
}

function appendCodeUnit(code: number, state: WrapScan): void {
  if (code === 9 && !state.explicitEnds) discoverTabs(state)
  const cells = code === 9 ? state.tabSize - (state.visual % state.tabSize) : 1
  if (state.segmentVisual > 0 && state.segmentVisual + cells > state.width) {
    if (state.explicitEnds) state.ends.push(state.length)
    state.rows += 1
    state.segmentVisual = 0
  }
  state.visual += cells
  state.segmentVisual += cells
  state.length += 1
}

function discoverTabs(state: WrapScan): void {
  state.explicitEnds = true
  for (let row = 1; row < state.rows; row += 1) state.ends.push(row * state.width)
}

function finishLine(state: WrapScan): void {
  if (state.word) adoptWordLine(state, state.word)
  if (state.explicitEnds) appendTabbedLine(state)
  state.prefixes.push(state.prefixes[state.prefixes.length - 1]! + state.rows)
  state.tabOffsets.push(state.tabEnds.length)
  state.completed += 1
  state.length = 0
  state.visual = 0
  state.segmentVisual = 0
  state.rows = 1
  state.explicitEnds = false
  state.ends = []
}

function appendTabbedLine(state: WrapScan): void {
  for (const end of state.ends) state.tabEnds.push(end)
  state.tabEnds.push(state.length)
}

/** A word-wrapped line with breaks stores them explicitly, the way a tabbed line does. */
function adoptWordLine(state: WrapScan, word: WordWrapLine): void {
  state.length = word.length
  state.rows = word.ends.length + 1
  // A uniform row holds `width` code units, so a longer line that did not break (spaces hanging
  // past the edge, narrow glyphs) needs its one end written out.
  if (word.ends.length > 0 || word.length > state.width) {
    state.explicitEnds = true
    state.ends = word.ends.slice()
  }
  resetWordWrapLine(word)
}
