import { structuredPatch } from 'diff'

import type { TextReadSnapshot } from './documentTextSnapshot'
import type { TextEdit } from './tokens'
import { recordEditorPerformanceDiagnostic } from './editor/performanceDiagnostics'

export type TextOffsetRange = {
  readonly start: number
  readonly end: number
}

export type MergeConflictSide = 'ours' | 'base' | 'theirs'

export type MergeConflictResolution = MergeConflictSide | 'both' | readonly MergeConflictSide[]

export type MergeConflictRegion = {
  readonly index: number
  readonly range: TextOffsetRange
  readonly startMarker: TextOffsetRange
  readonly baseMarker?: TextOffsetRange
  readonly separatorMarker: TextOffsetRange
  readonly endMarker: TextOffsetRange
  /** Zero-based buffer rows of the marker lines; whole-line decorations key on these. */
  readonly startMarkerLine: number
  readonly baseMarkerLine?: number
  readonly separatorMarkerLine: number
  readonly endMarkerLine: number
  readonly ours: TextOffsetRange
  readonly base?: TextOffsetRange
  readonly theirs: TextOffsetRange
  readonly oursLabel: string
  readonly baseLabel?: string
  readonly theirsLabel: string
}

export type MergeConflictResolutionResult = {
  readonly replacement: string
  readonly range: TextOffsetRange
  readonly selection: TextOffsetRange
}

export type CreateMergeConflictDocumentTextOptions = {
  readonly localPath: string
  readonly localText: string
  readonly remotePath?: string | null
  readonly remoteText: string | null
}

type LineRange = {
  readonly line: number
  readonly start: number
  readonly end: number
  /** The whole line; only lines that open with a marker are read. */
  readonly text: string
}

type PendingConflict = {
  readonly startMarker: LineRange
  readonly oursLabel: string
  oursEnd?: number
  baseMarker?: LineRange
  baseLabel?: string
  baseStart?: number
  baseEnd?: number
  separatorMarker?: LineRange
  theirsStart?: number
}

type ParsedPatchFile = {
  readonly hunks?: readonly ParsedPatchHunk[]
}

type ParsedPatchHunk = {
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
}

type LineSlice = {
  readonly start: number
  readonly end: number
  readonly text: string
}

const DEFAULT_OURS_LABEL = 'HEAD'
const DEFAULT_THEIRS_LABEL = 'Incoming'
const LOCAL_CONFLICT_LABEL_PREFIX = 'Local: '
const REMOTE_CONFLICT_LABEL_PREFIX = 'Remote: '

const MARKER_LENGTH = 7
const MARKERS = new Set(['<<<<<<<', '|||||||', '=======', '>>>>>>>'])
const MARKER_CODES = new Set([0x3c, 0x7c, 0x3d, 0x3e])
const NEWLINE = 0x0a
const CARRY_LINE_LIMIT = 1_024
const EMPTY_CONFLICTS: readonly MergeConflictRegion[] = Object.freeze([])

// One scan per immutable source, shared by every caller that asks about it.
const parsedSources = new WeakMap<TextReadSnapshot, readonly MergeConflictRegion[]>()

export function parseMergeConflicts(source: TextReadSnapshot): readonly MergeConflictRegion[] {
  const cached = parsedSources.get(source)
  if (cached) return cached

  const conflicts = scanMergeConflicts(source)
  parsedSources.set(source, conflicts)
  recordEditorPerformanceDiagnostic('mergeConflicts.scan', () => ({
    scannedCodeUnits: source.length,
    conflicts: conflicts.length,
  }))
  return conflicts
}

/**
 * Carries the regions of `previous` to `next` without scanning, when `edits` (one batch in
 * `previous` coordinates) touched no marker line on either side. Regions follow from the ordered
 * marker lines alone, so an unchanged sequence parses the same; only offsets and rows move.
 * Reads 7 units per touched line. Null means the caller must scan.
 */
export function carryMergeConflicts(
  previous: TextReadSnapshot,
  next: TextReadSnapshot,
  edits: readonly TextEdit[],
): readonly MergeConflictRegion[] | null {
  const regions = parsedSources.get(previous)
  if (!regions) return null

  const sorted = edits.toSorted((left, right) => left.from - right.from)
  let shift = 0
  for (const edit of sorted) {
    const from = edit.from + shift
    if (touchesMarkerLine(previous, edit.from, edit.to)) return null
    if (touchesMarkerLine(next, from, from + edit.text.length)) return null
    shift += edit.text.length - (edit.to - edit.from)
  }
  const carried =
    regions.length === 0
      ? EMPTY_CONFLICTS
      : regions.map((region) => shiftedRegion(region, sorted, next))
  parsedSources.set(next, carried)
  return carried
}

function touchesMarkerLine(source: TextReadSnapshot, start: number, end: number): boolean {
  const first = source.lineAt(start)
  const last = source.lineAt(end)
  // Checking a large paste line by line costs more than the one chunk walk a scan takes.
  if (last - first >= CARRY_LINE_LIMIT) return true
  for (let row = first; row <= last; row += 1) {
    const lineStart = source.lineStart(row)
    if (source.lineRange(row).end - lineStart < MARKER_LENGTH) continue
    if (MARKERS.has(source.readRange(lineStart, lineStart + MARKER_LENGTH))) return true
  }
  return false
}

// Every boundary is a marker line's start or end, and no edit touched a marker line, so an edit
// either lies wholly before a boundary or is an insertion at the start of the line after one.
function shiftedRegion(
  region: MergeConflictRegion,
  edits: readonly TextEdit[],
  next: TextReadSnapshot,
): MergeConflictRegion {
  const at = (offset: number): number => shiftedOffset(offset, edits)
  const range = (value: TextOffsetRange): TextOffsetRange =>
    rangeFrom(at(value.start), at(value.end))
  const startMarker = range(region.startMarker)
  const separatorMarker = range(region.separatorMarker)
  const endMarker = range(region.endMarker)
  const baseMarker = region.baseMarker ? range(region.baseMarker) : undefined
  return {
    ...region,
    range: range(region.range),
    startMarker,
    baseMarker,
    separatorMarker,
    endMarker,
    startMarkerLine: next.lineAt(startMarker.start),
    baseMarkerLine: baseMarker ? next.lineAt(baseMarker.start) : undefined,
    separatorMarkerLine: next.lineAt(separatorMarker.start),
    endMarkerLine: next.lineAt(endMarker.start),
    ours: range(region.ours),
    base: region.base ? range(region.base) : undefined,
    theirs: range(region.theirs),
  }
}

function shiftedOffset(offset: number, edits: readonly TextEdit[]): number {
  let shifted = offset
  for (const edit of edits) {
    if (edit.from >= offset) break
    shifted += edit.text.length - (edit.to - edit.from)
  }
  return shifted
}

function scanMergeConflicts(source: TextReadSnapshot): readonly MergeConflictRegion[] {
  const conflicts: MergeConflictRegion[] = []
  let pending: PendingConflict | null = null
  const scanner = new MarkerLineScanner((line) => {
    const startLabel = conflictMarkerLabel(line.text, '<<<<<<<')
    if (startLabel !== null) {
      pending = {
        startMarker: line,
        oursLabel: startLabel || DEFAULT_OURS_LABEL,
      }
      return
    }

    if (!pending) return
    if (readBaseMarker(pending, line)) return
    if (readSeparatorMarker(pending, line)) return

    const endLabel = conflictMarkerLabel(line.text, '>>>>>>>')
    if (endLabel === null) return

    const conflict = completePendingConflict(conflicts.length, pending, line, endLabel)
    if (conflict) conflicts.push(conflict)
    pending = null
  })
  // The source's own chunk strings, read by index: nothing is copied or joined.
  source.forEachTextChunk((text, start) => scanner.feed(text, start))
  scanner.finish(source.length)
  return conflicts.length === 0 ? EMPTY_CONFLICTS : conflicts
}

/**
 * Visits only the lines that open with a marker. Every other line costs one character test and a
 * search for its break; a marker or line split across two chunks carries over in two numbers.
 */
class MarkerLineScanner {
  private line = 0
  private lineStart = 0
  private headCode = 0
  private headRun = 0
  private rest = ''
  private mode: 'head' | 'marker' | 'skip' = 'head'

  constructor(private readonly visit: (line: LineRange) => void) {}

  feed(text: string, offset: number): void {
    let index = 0
    while (index < text.length) {
      if (this.mode === 'head') {
        index = this.readHead(text, offset, index)
        continue
      }

      const newline = text.indexOf('\n', index)
      const contentEnd = newline === -1 ? text.length : newline
      if (this.mode === 'marker') this.rest += text.slice(index, contentEnd)
      if (newline === -1) return

      this.endLine(offset + newline + 1)
      index = newline + 1
    }
  }

  finish(length: number): void {
    if (this.lineStart < length) this.endLine(length)
  }

  private readHead(text: string, offset: number, from: number): number {
    for (let index = from; index < text.length; index += 1) {
      const code = text.charCodeAt(index)
      if (code === NEWLINE) {
        this.endLine(offset + index + 1)
        return index + 1
      }
      if (this.headRun === 0 && !MARKER_CODES.has(code)) return this.skip(index)
      if (this.headRun > 0 && code !== this.headCode) return this.skip(index)

      this.headCode = code
      this.headRun += 1
      if (this.headRun === MARKER_LENGTH) {
        this.mode = 'marker'
        return index + 1
      }
    }
    return text.length
  }

  private skip(index: number): number {
    this.mode = 'skip'
    return index
  }

  private endLine(end: number): void {
    if (this.mode === 'marker') {
      const marker = String.fromCharCode(this.headCode).repeat(MARKER_LENGTH)
      this.visit({ line: this.line, start: this.lineStart, end, text: marker + this.rest })
    }
    this.line += 1
    this.lineStart = end
    this.headCode = 0
    this.headRun = 0
    this.rest = ''
    this.mode = 'head'
  }
}

export function createMergeConflictDocumentText(
  options: CreateMergeConflictDocumentTextOptions,
): string {
  const remotePath = options.remotePath ?? options.localPath
  if (options.remoteText === null) return wholeFileConflictDocument(options, remotePath)
  if (options.localText === options.remoteText) return options.localText

  const hunks = changedPatchHunks(options, remotePath)
  if (hunks.length === 0) return options.localText

  return mergeConflictDocumentFromHunks(options, remotePath, hunks)
}

/** The replacement for one conflict, read from its chosen sides; never the resolved document. */
export function resolveMergeConflict(
  source: TextReadSnapshot,
  conflict: MergeConflictRegion,
  resolution: MergeConflictResolution,
): MergeConflictResolutionResult | null {
  const ranges = resolutionRanges(conflict, resolution)
  if (!ranges) return null

  const replacement = ranges.map((range) => source.readRange(range.start, range.end)).join('')
  const selectionOffset = conflict.range.start + replacement.length

  return {
    replacement,
    range: conflict.range,
    selection: {
      start: selectionOffset,
      end: selectionOffset,
    },
  }
}

function wholeFileConflictDocument(
  options: CreateMergeConflictDocumentTextOptions,
  remotePath: string,
): string {
  return conflictBlock(
    localConflictLabel(options.localPath),
    options.localText,
    remoteConflictLabel(remotePath),
    '',
  )
}

function changedPatchHunks(
  options: CreateMergeConflictDocumentTextOptions,
  remotePath: string,
): readonly ParsedPatchHunk[] {
  const patch = structuredPatch(
    options.localPath,
    remotePath,
    options.localText,
    options.remoteText ?? '',
    undefined,
    undefined,
    { context: 0 },
  ) as ParsedPatchFile

  return patch.hunks ?? []
}

function mergeConflictDocumentFromHunks(
  options: CreateMergeConflictDocumentTextOptions,
  remotePath: string,
  hunks: readonly ParsedPatchHunk[],
): string {
  const localLines = splitTextLineSlices(options.localText)
  const remoteLines = splitTextLineSlices(options.remoteText ?? '')
  const chunks: string[] = []
  let localOffset = 0

  for (const hunk of hunks) {
    const local = textSliceForHunk(options.localText, localLines, hunk.oldStart, hunk.oldLines)
    const remote = textSliceForHunk(
      options.remoteText ?? '',
      remoteLines,
      hunk.newStart,
      hunk.newLines,
    )
    chunks.push(options.localText.slice(localOffset, local.start))
    chunks.push(
      conflictBlock(
        localConflictLabel(options.localPath),
        local.text,
        remoteConflictLabel(remotePath),
        remote.text,
      ),
    )
    localOffset = local.end
  }

  chunks.push(options.localText.slice(localOffset))
  return chunks.join('')
}

function conflictBlock(
  localLabel: string,
  localText: string,
  remoteLabel: string,
  remoteText: string,
): string {
  return [
    `<<<<<<< ${localLabel}\n`,
    markerSectionText(localText),
    '=======\n',
    markerSectionText(remoteText),
    `>>>>>>> ${remoteLabel}\n`,
  ].join('')
}

function markerSectionText(text: string): string {
  if (text.length === 0) return ''
  if (text.endsWith('\n')) return text
  return `${text}\n`
}

function textSliceForHunk(
  text: string,
  lines: readonly LineSlice[],
  startLine: number,
  lineCount: number,
): LineSlice {
  const startIndex = Math.max(0, startLine - 1)
  const start = lines[startIndex]?.start ?? text.length
  if (lineCount === 0) return { start, end: start, text: '' }

  const endIndex = startIndex + lineCount - 1
  const end = lines[endIndex]?.end ?? text.length
  return {
    start,
    end,
    text: text.slice(start, end),
  }
}

function splitTextLineSlices(text: string): readonly LineSlice[] {
  const lines: LineSlice[] = []
  let start = 0
  while (start < text.length) {
    const end = nextLineEnd(text, start)
    lines.push({ start, end, text: text.slice(start, end) })
    start = end
  }

  return lines
}

function nextLineEnd(text: string, start: number): number {
  const newline = text.indexOf('\n', start)
  if (newline === -1) return text.length
  return newline + 1
}

function localConflictLabel(path: string): string {
  return `${LOCAL_CONFLICT_LABEL_PREFIX}${markerLabelPath(path)}`
}

function remoteConflictLabel(path: string): string {
  return `${REMOTE_CONFLICT_LABEL_PREFIX}${markerLabelPath(path)}`
}

function markerLabelPath(path: string): string {
  return path.replace(/[\r\n]+/g, ' ')
}

function readBaseMarker(pending: PendingConflict, line: LineRange): boolean {
  const baseLabel = conflictMarkerLabel(line.text, '|||||||')
  if (baseLabel === null) return false
  if (pending.separatorMarker) return false

  pending.oursEnd = line.start
  pending.baseMarker = line
  pending.baseLabel = baseLabel
  pending.baseStart = line.end
  return true
}

function readSeparatorMarker(pending: PendingConflict, line: LineRange): boolean {
  if (!line.text.startsWith('=======')) return false

  pending.oursEnd ??= line.start
  if (pending.baseStart !== undefined) pending.baseEnd = line.start
  pending.separatorMarker = line
  pending.theirsStart = line.end
  return true
}

function completePendingConflict(
  index: number,
  pending: PendingConflict,
  endMarker: LineRange,
  theirsLabel: string,
): MergeConflictRegion | null {
  if (pending.oursEnd === undefined) return null
  if (!pending.separatorMarker) return null
  if (pending.theirsStart === undefined) return null

  return {
    index,
    range: rangeFrom(pending.startMarker.start, endMarker.end),
    startMarker: lineToRange(pending.startMarker),
    baseMarker: pending.baseMarker ? lineToRange(pending.baseMarker) : undefined,
    separatorMarker: lineToRange(pending.separatorMarker),
    endMarker: lineToRange(endMarker),
    startMarkerLine: pending.startMarker.line,
    baseMarkerLine: pending.baseMarker?.line,
    separatorMarkerLine: pending.separatorMarker.line,
    endMarkerLine: endMarker.line,
    ours: rangeFrom(pending.startMarker.end, pending.oursEnd),
    base: baseRange(pending),
    theirs: rangeFrom(pending.theirsStart, endMarker.start),
    oursLabel: pending.oursLabel,
    baseLabel: pending.baseLabel,
    theirsLabel: theirsLabel || DEFAULT_THEIRS_LABEL,
  }
}

function baseRange(pending: PendingConflict): TextOffsetRange | undefined {
  if (pending.baseStart === undefined) return undefined
  if (pending.baseEnd === undefined) return undefined
  return rangeFrom(pending.baseStart, pending.baseEnd)
}

function resolutionRanges(
  conflict: MergeConflictRegion,
  resolution: MergeConflictResolution,
): readonly TextOffsetRange[] | null {
  if (resolution === 'both') return [conflict.ours, conflict.theirs]
  if (typeof resolution === 'string') return resolutionRange(conflict, resolution)
  return orderedResolutionRanges(conflict, resolution)
}

function orderedResolutionRanges(
  conflict: MergeConflictRegion,
  resolution: readonly MergeConflictSide[],
): readonly TextOffsetRange[] | null {
  const ranges: TextOffsetRange[] = []
  for (const side of resolution) {
    const range = rangeForSide(conflict, side)
    if (!range) return null
    ranges.push(range)
  }

  return ranges
}

function resolutionRange(
  conflict: MergeConflictRegion,
  side: MergeConflictSide,
): readonly TextOffsetRange[] | null {
  const range = rangeForSide(conflict, side)
  if (!range) return null
  return [range]
}

function rangeForSide(
  conflict: MergeConflictRegion,
  side: MergeConflictSide,
): TextOffsetRange | null {
  if (side === 'ours') return conflict.ours
  if (side === 'theirs') return conflict.theirs
  return conflict.base ?? null
}

function conflictMarkerLabel(line: string, marker: string): string | null {
  if (!line.startsWith(marker)) return null
  return line.slice(marker.length).trim()
}

function lineToRange(line: LineRange): TextOffsetRange {
  return rangeFrom(line.start, line.end)
}

function rangeFrom(start: number, end: number): TextOffsetRange {
  return { start, end }
}
