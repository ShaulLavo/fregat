import { createError } from '../logging/errors'
import type { EditorToken, EditorTokenStyle } from '../tokens'
import {
  createPackedEditorTokenWriter,
  finishPackedEditorTokenWriter,
  writePackedEditorToken,
  type PackedEditorTokenPatch,
  type PackedEditorTokens,
} from './packedTokens'

/** Which store a store was made from, and whether token `i` there is still token `i` here. */
export type EditorTokenStoreOrigin = {
  readonly revision: number
  readonly keepsLiveRanges: boolean
}

export type EditorTokenStoreRetentionSnapshot = {
  readonly storeCount: number
  readonly tokenCount: number
  readonly segmentCount: number
  readonly backingBufferCount: number
  /** Full retained buffers, deduplicated across all stores and overlapping views. */
  readonly backingBytes: number
  readonly unmeasuredBytes: readonly ('javascript-objects' | 'styles')[]
}

/** What a host may hand in: a store, or object tokens converted at the boundary. */
export type EditorTokenInput = EditorTokenStore | readonly EditorToken[]

export function toEditorTokenStore(tokens: EditorTokenInput): EditorTokenStore {
  // Not `instanceof`: a host may bundle its own copy of this module.
  if (Array.isArray(tokens)) return EditorTokenStore.fromTokens(tokens)
  return tokens as EditorTokenStore
}

/** A run of tokens to put into a store; its style ids already index the target palette. */
export type EditorTokenRun = {
  readonly starts: Uint32Array
  readonly ends: Uint32Array
  readonly styleIds: Uint32Array
}

export type EditorTokenStoreReplaceOptions = {
  /** Added to the start and end of every token after the replaced range. */
  readonly delta: number
  /** `null` marks an answer with no claim about the store it replaces. */
  readonly keepsLiveRanges: boolean | null
  readonly styles?: readonly EditorTokenStyle[]
}

/** A window of shared, never-written arrays, read with `delta` added to both offsets. */
type TokenSegment = {
  readonly starts: Uint32Array
  readonly ends: Uint32Array
  readonly styleIds: Uint32Array
  readonly from: number
  readonly to: number
  readonly delta: number
}

type TokenStoreFlags = {
  readonly monotonicEnd: boolean
  readonly nonOverlapping: boolean
}

// Two neighbours this small are copied into one, so typing at one place keeps three segments.
const SMALL_SEGMENT_TOKENS = 64
// Each distant edit leaves two boundaries; a read bisects the segments before the tokens.
const MAX_SEGMENTS = 128
const NO_SEGMENTS: readonly TokenSegment[] = []

let nextRevision = 1

/**
 * The document's syntax tokens: packed offsets and palette ids, sorted by start, immutable.
 *
 * An edit shifts every token after it. Stores share their arrays and keep that shift per segment,
 * so deriving a store costs the edited tokens, not the document.
 */
export class EditorTokenStore {
  readonly length: number
  readonly revision: number
  private readonly segmentStarts: readonly number[]
  private maxEnds: Uint32Array | null = null
  // The segment the last read landed in; a row is read front to back.
  private cursor = 0

  private constructor(
    private readonly segments: readonly TokenSegment[],
    readonly styles: readonly EditorTokenStyle[],
    readonly monotonicEnd: boolean,
    readonly nonOverlapping: boolean,
    readonly derivedFrom: EditorTokenStoreOrigin | null,
  ) {
    const segmentStarts: number[] = []
    let length = 0
    for (const segment of segments) {
      segmentStarts.push(length)
      length += segment.to - segment.from
    }
    this.segmentStarts = segmentStarts
    this.length = length
    this.revision = nextRevision
    nextRevision += 1
  }

  private static readonly EMPTY = new EditorTokenStore([], [], true, true, null)

  static empty(): EditorTokenStore {
    return EditorTokenStore.EMPTY
  }

  static inspectRetention(stores: Iterable<EditorTokenStore>): EditorTokenStoreRetentionSnapshot {
    const retained = new Set(stores)
    const buffers = new Set<ArrayBufferLike>()
    let tokenCount = 0
    let segmentCount = 0
    for (const store of retained) {
      tokenCount += store.length
      segmentCount += store.segments.length
      if (store.maxEnds) buffers.add(store.maxEnds.buffer)
      for (const segment of store.segments) {
        buffers.add(segment.starts.buffer)
        buffers.add(segment.ends.buffer)
        buffers.add(segment.styleIds.buffer)
      }
    }
    let backingBytes = 0
    for (const buffer of buffers) backingBytes += buffer.byteLength
    return {
      storeCount: retained.size,
      tokenCount,
      segmentCount,
      backingBufferCount: buffers.size,
      backingBytes,
      unmeasuredBytes: ['javascript-objects', 'styles'],
    }
  }

  /** Takes ownership of the packed arrays; nothing may write to them afterwards. */
  static fromPacked(packed: PackedEditorTokens): EditorTokenStore {
    if (packed.starts.length === 0) return EditorTokenStore.EMPTY

    assertStyleIds(packed.styleIds, packed.styles.length)
    const run = packed.sortedByStart ? packed : sortRunByStart(packed)
    const flags = packed.sortedByStart ? packed : runFlags(run)
    return new EditorTokenStore(
      [wholeRunSegment(run)],
      packed.styles,
      flags.monotonicEnd,
      flags.nonOverlapping,
      null,
    )
  }

  /** The boundary for hosts that build tokens by hand; costs the input, not the document. */
  static fromTokens(tokens: readonly EditorToken[]): EditorTokenStore {
    if (tokens.length === 0) return EditorTokenStore.EMPTY

    const writer = createPackedEditorTokenWriter(tokens.length)
    const styles: EditorTokenStyle[] = []
    const idByStyle = new Map<EditorTokenStyle, number>()
    for (const token of tokens) {
      let id = idByStyle.get(token.style)
      if (id === undefined) {
        id = styles.length
        styles.push(token.style)
        idByStyle.set(token.style, id)
      }
      writePackedEditorToken(writer, token.start, token.end, id)
    }
    return EditorTokenStore.fromPacked(finishPackedEditorTokenWriter(writer, styles))
  }

  startAt(index: number): number {
    const segment = this.segmentAt(index)
    return segment.starts[segment.from + index - this.segmentStarts[this.cursor]!]! + segment.delta
  }

  endAt(index: number): number {
    const segment = this.segmentAt(index)
    return segment.ends[segment.from + index - this.segmentStarts[this.cursor]!]! + segment.delta
  }

  styleIdAt(index: number): number {
    const segment = this.segmentAt(index)
    return segment.styleIds[segment.from + index - this.segmentStarts[this.cursor]!]!
  }

  styleAt(index: number): EditorTokenStyle {
    return this.styles[this.styleIdAt(index)]!
  }

  tokenAt(index: number): EditorToken {
    return { start: this.startAt(index), end: this.endAt(index), style: this.styleAt(index) }
  }

  /** Object tokens for `[from, to)`. The whole-document form is for exports, never for an edit. */
  toTokens(from = 0, to = this.length): EditorToken[] {
    const tokens: EditorToken[] = []
    this.forEachInRange(from, to, (start, end, styleId) => {
      tokens.push({ start, end, style: this.styles[styleId]! })
    })
    return tokens
  }

  forEachInRange(
    from: number,
    to: number,
    visit: (start: number, end: number, styleId: number, index: number) => void,
  ): void {
    const last = Math.min(to, this.length)
    let index = Math.max(0, from)
    if (index >= last) return

    let segmentIndex = this.segmentIndexAt(index)
    while (index < last) {
      const segment = this.segments[segmentIndex]!
      const segmentStart = this.segmentStarts[segmentIndex]!
      const stop = Math.min(last, segmentStart + segment.to - segment.from)
      for (; index < stop; index += 1) {
        const at = segment.from + index - segmentStart
        visit(
          segment.starts[at]! + segment.delta,
          segment.ends[at]! + segment.delta,
          segment.styleIds[at]!,
          index,
        )
      }
      segmentIndex += 1
    }
  }

  firstStartingAtOrAfter(offset: number): number {
    return this.lowerBoundByStart(offset)
  }

  firstStartingAfter(offset: number): number {
    return this.lowerBoundByStart(offset + 1)
  }

  /** First index below `endIndex` whose running maximum end is past `offset`. */
  firstEndingAfter(offset: number, endIndex = this.length): number {
    return this.lowerBoundByMaxEnd(offset + 1, endIndex)
  }

  firstEndingAtOrAfter(offset: number, endIndex = this.length): number {
    return this.lowerBoundByMaxEnd(offset, endIndex)
  }

  /**
   * This store with tokens `[first, last)` replaced by `inserted` and every later token shifted.
   * A projection through an edit and a highlighter's re-tokenized lines are both this operation.
   */
  replaceRange(
    first: number,
    last: number,
    inserted: EditorTokenRun,
    options: EditorTokenStoreReplaceOptions,
  ): EditorTokenStore {
    const styles = options.styles ?? this.styles
    const derivedFrom =
      options.keepsLiveRanges === null
        ? null
        : { revision: this.revision, keepsLiveRanges: options.keepsLiveRanges }
    const segments = [
      ...this.segmentsInRange(0, first, 0),
      ...(inserted.starts.length > 0 ? [wholeRunSegment(inserted)] : NO_SEGMENTS),
      ...this.segmentsInRange(last, this.length, options.delta),
    ]
    const flags = this.monotonicEnd ? this.flagsAfterReplace(first, last, inserted, options) : null
    if (!flags) return EditorTokenStore.fromUnchecked(segments, styles, derivedFrom)

    return new EditorTokenStore(
      compactSegments(segments),
      styles,
      true,
      flags.nonOverlapping,
      derivedFrom,
    )
  }

  /** Re-tokenized lines spliced in. Patch styles join the palette by value. */
  applyPatch(patch: PackedEditorTokenPatch): EditorTokenStore {
    const first = this.firstStartingAtOrAfter(patch.fromOffset)
    const last = Math.max(first, this.firstStartingAtOrAfter(patch.oldEndOffset))
    return this.insertPacked(
      first,
      last,
      patch.tokensPacked,
      patch.newEndOffset - patch.oldEndOffset,
    )
  }

  /** A fresh answer for `[startOffset, endOffset)`; every token reaching into it is replaced. */
  replaceOffsetRange(
    startOffset: number,
    endOffset: number,
    tokens: EditorTokenStore,
  ): EditorTokenStore {
    const last = this.firstStartingAtOrAfter(endOffset)
    const first = this.firstEndingAfter(startOffset, last)
    return this.insertPacked(first, last, tokens.toPacked(), 0)
  }

  private insertPacked(
    first: number,
    last: number,
    packed: PackedEditorTokens,
    delta: number,
  ): EditorTokenStore {
    assertStyleIds(packed.styleIds, packed.styles.length)
    const merged = mergeStyles(this.styles, packed.styles)
    const sorted = packed.sortedByStart ? packed : sortRunByStart(packed)
    const styleIds = new Uint32Array(sorted.styleIds.length)
    for (let index = 0; index < styleIds.length; index += 1) {
      styleIds[index] = merged.remap[sorted.styleIds[index]!]!
    }

    return this.replaceRange(
      first,
      last,
      { starts: sorted.starts, ends: sorted.ends, styleIds },
      { delta, keepsLiveRanges: null, styles: merged.styles },
    )
  }

  /** One contiguous copy, for a worker transfer or a JSON snapshot. Costs the document. */
  toPacked(): PackedEditorTokens {
    const run = materializeSegments(this.segments, this.length)
    return {
      ...run,
      styles: this.styles,
      monotonicEnd: this.monotonicEnd,
      nonOverlapping: this.nonOverlapping,
      sortedByStart: true,
    }
  }

  /** True when both hold the same tokens. Segments the two share are skipped, not compared. */
  equals(other: EditorTokenStore): boolean {
    return storesMatch(this, other, true)
  }

  /** True when token `i` has the same style in both, whatever its offsets. */
  stylesEqual(other: EditorTokenStore): boolean {
    return storesMatch(this, other, false)
  }

  /**
   * The smallest replacement that turns this store into `next`: tokens `[start, start + deleteCount)`
   * here become `[start, insertEnd)` there. Segments the two share are skipped, not compared.
   */
  changedRangeTo(next: EditorTokenStore): {
    readonly start: number
    readonly deleteCount: number
    readonly insertEnd: number
  } {
    const canSkipShared = palettesAgree(this.styles, next.styles)
    const limit = Math.min(this.length, next.length)
    let start = 0
    while (start < limit) {
      const shared = canSkipShared ? this.sharedRunAhead(start, next, start, true) : 0
      if (shared === 0 && !tokensMatch(this, start, next, start, true)) break
      start += Math.max(1, shared)
    }

    let end = this.length
    let insertEnd = next.length
    while (end > start && insertEnd > start) {
      const shared = canSkipShared ? this.sharedRunBehind(end, next, insertEnd) : 0
      if (shared === 0 && !tokensMatch(this, end - 1, next, insertEnd - 1, true)) break
      const step = Math.min(Math.max(1, shared), end - start, insertEnd - start)
      end -= step
      insertEnd -= step
    }
    return { start, deleteCount: end - start, insertEnd }
  }

  /** @internal Tokens from `index` on that are `other`'s from `otherIndex` on by construction. */
  sharedRunAhead(
    index: number,
    other: EditorTokenStore,
    otherIndex: number,
    withOffsets: boolean,
  ): number {
    const mine = this.segmentAt(index)
    const mineAt = mine.from + index - this.segmentStarts[this.cursor]!
    const theirs = other.segmentAt(otherIndex)
    const theirsAt = theirs.from + otherIndex - other.segmentStarts[other.cursor]!
    if (mineAt !== theirsAt || !segmentsShareArrays(mine, theirs, withOffsets)) return 0
    return Math.min(mine.to - mineAt, theirs.to - theirsAt)
  }

  /** @internal Tokens before `index` that are `other`'s before `otherIndex` by construction. */
  sharedRunBehind(index: number, other: EditorTokenStore, otherIndex: number): number {
    const mine = this.segmentAt(index - 1)
    const mineAt = mine.from + index - 1 - this.segmentStarts[this.cursor]!
    const theirs = other.segmentAt(otherIndex - 1)
    const theirsAt = theirs.from + otherIndex - 1 - other.segmentStarts[other.cursor]!
    if (mineAt !== theirsAt || !segmentsShareArrays(mine, theirs, true)) return 0
    return Math.min(mineAt - mine.from, theirsAt - theirs.from) + 1
  }

  private static fromUnchecked(
    segments: readonly TokenSegment[],
    styles: readonly EditorTokenStyle[],
    derivedFrom: EditorTokenStoreOrigin | null,
  ): EditorTokenStore {
    const length = segments.reduce((sum, segment) => sum + segment.to - segment.from, 0)
    if (length === 0) return new EditorTokenStore([], styles, true, true, derivedFrom)

    const copied = materializeSegments(segments, length)
    const run = isSortedByStart(copied.starts) ? copied : sortRunByStart(copied)
    const flags = runFlags(run)
    return new EditorTokenStore(
      [wholeRunSegment(run)],
      styles,
      flags.monotonicEnd,
      flags.nonOverlapping,
      derivedFrom,
    )
  }

  /** Flags for a replace that keeps the store sorted with growing ends, else `null`. */
  private flagsAfterReplace(
    first: number,
    last: number,
    inserted: EditorTokenRun,
    options: EditorTokenStoreReplaceOptions,
  ): TokenStoreFlags | null {
    const count = inserted.starts.length
    const insertedFlags = count > 0 ? runFlags(inserted) : null
    if (insertedFlags && !isSortedByStart(inserted.starts)) return null
    if (insertedFlags && !insertedFlags.monotonicEnd) return null

    let previousStart = first > 0 ? this.startAt(first - 1) : -Infinity
    let previousEnd = first > 0 ? this.endAt(first - 1) : -Infinity
    let nonOverlapping = this.nonOverlapping && (insertedFlags?.nonOverlapping ?? true)
    if (count > 0) {
      if (inserted.starts[0]! < previousStart || inserted.ends[0]! < previousEnd) return null
      if (inserted.starts[0]! < previousEnd) nonOverlapping = false
      previousStart = inserted.starts[count - 1]!
      previousEnd = inserted.ends[count - 1]!
    }
    if (last >= this.length) return { monotonicEnd: true, nonOverlapping }

    const nextStart = this.startAt(last) + options.delta
    if (nextStart < previousStart || this.endAt(last) + options.delta < previousEnd) return null
    if (nextStart < previousEnd) nonOverlapping = false
    return { monotonicEnd: true, nonOverlapping }
  }

  private segmentsInRange(from: number, to: number, delta: number): TokenSegment[] {
    const result: TokenSegment[] = []
    if (from >= to) return result

    for (let index = this.segmentIndexAt(from); index < this.segments.length; index += 1) {
      const segment = this.segments[index]!
      const segmentStart = this.segmentStarts[index]!
      if (segmentStart >= to) break

      result.push({
        ...segment,
        from: segment.from + Math.max(0, from - segmentStart),
        to: Math.min(segment.to, segment.from + to - segmentStart),
        delta: segment.delta + delta,
      })
    }
    return result
  }

  private segmentAt(index: number): TokenSegment {
    const cursorStart = this.segmentStarts[this.cursor]
    const current = this.segments[this.cursor]
    if (
      current &&
      cursorStart !== undefined &&
      index >= cursorStart &&
      index < cursorStart + current.to - current.from
    ) {
      return current
    }
    if (index < 0 || index >= this.length) throw tokenIndexOutOfRange(index, this.length)

    this.cursor = this.segmentIndexAt(index)
    return this.segments[this.cursor]!
  }

  /** The segment holding token `index`; `index` must be below `length`. */
  private segmentIndexAt(index: number): number {
    let low = 0
    let high = this.segmentStarts.length - 1
    while (low < high) {
      const middle = (low + high + 1) >>> 1
      if (this.segmentStarts[middle]! <= index) low = middle
      else high = middle - 1
    }
    return low
  }

  private lowerBoundByStart(offset: number): number {
    let low = 0
    let high = this.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (this.startAt(middle) < offset) low = middle + 1
      else high = middle
    }
    return low
  }

  private lowerBoundByMaxEnd(offset: number, endIndex: number): number {
    const maxEnds = this.monotonicEnd ? null : this.runningMaxEnds()
    let low = 0
    let high = Math.min(endIndex, this.length)
    while (low < high) {
      const middle = (low + high) >>> 1
      const end = maxEnds ? maxEnds[middle]! : this.endAt(middle)
      if (end < offset) low = middle + 1
      else high = middle
    }
    return low
  }

  // Only a store with overlapping input reaches this, and that store is one flat segment.
  private runningMaxEnds(): Uint32Array {
    if (this.maxEnds) return this.maxEnds

    const maxEnds = new Uint32Array(this.length)
    let maxEnd = 0
    this.forEachInRange(0, this.length, (_start, end, _styleId, index) => {
      if (end > maxEnd) maxEnd = end
      maxEnds[index] = maxEnd
    })
    this.maxEnds = maxEnds
    return maxEnds
  }
}

function storesMatch(
  left: EditorTokenStore,
  right: EditorTokenStore,
  withOffsets: boolean,
): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false

  const canSkipShared = palettesAgree(left.styles, right.styles)
  let index = 0
  while (index < left.length) {
    const shared = canSkipShared ? left.sharedRunAhead(index, right, index, withOffsets) : 0
    if (shared === 0 && !tokensMatch(left, index, right, index, withOffsets)) return false
    index += Math.max(1, shared)
  }
  return true
}

function tokensMatch(
  left: EditorTokenStore,
  leftIndex: number,
  right: EditorTokenStore,
  rightIndex: number,
  withOffsets: boolean,
): boolean {
  if (withOffsets && left.startAt(leftIndex) !== right.startAt(rightIndex)) return false
  if (withOffsets && left.endAt(leftIndex) !== right.endAt(rightIndex)) return false
  return editorTokenStylesEqual(left.styleAt(leftIndex), right.styleAt(rightIndex))
}

function segmentsShareArrays(
  left: TokenSegment,
  right: TokenSegment,
  withOffsets: boolean,
): boolean {
  if (left.styleIds !== right.styleIds) return false
  if (!withOffsets) return true
  return left.starts === right.starts && left.ends === right.ends && left.delta === right.delta
}

/** Shared arrays mean the same tokens only while an id names the same style in both palettes. */
function palettesAgree(
  left: readonly EditorTokenStyle[],
  right: readonly EditorTokenStyle[],
): boolean {
  if (left === right) return true

  const shared = Math.min(left.length, right.length)
  for (let index = 0; index < shared; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function editorTokenStylesEqual(left: EditorTokenStyle, right: EditorTokenStyle): boolean {
  if (left === right) return true

  return (
    (left.color || undefined) === (right.color || undefined) &&
    (left.backgroundColor || undefined) === (right.backgroundColor || undefined) &&
    (left.fontStyle || undefined) === (right.fontStyle || undefined) &&
    (left.fontWeight || undefined) === (right.fontWeight || undefined) &&
    (left.textDecoration || undefined) === (right.textDecoration || undefined)
  )
}

function wholeRunSegment(run: EditorTokenRun): TokenSegment {
  return {
    starts: run.starts,
    ends: run.ends,
    styleIds: run.styleIds,
    from: 0,
    to: run.starts.length,
    delta: 0,
  }
}

function compactSegments(segments: readonly TokenSegment[]): readonly TokenSegment[] {
  const compacted: TokenSegment[] = []
  for (const segment of segments) {
    if (segment.to <= segment.from) continue

    const previous = compacted[compacted.length - 1]
    const joined = previous ? joinSegments(previous, segment) : null
    if (joined) compacted[compacted.length - 1] = joined
    else compacted.push(segment)
  }
  while (compacted.length > MAX_SEGMENTS) mergeSmallestNeighbours(compacted)
  return compacted
}

// Over the cap, copy the cheapest pair rather than the document: no edit pays for a flat copy.
function mergeSmallestNeighbours(segments: TokenSegment[]): void {
  let at = 0
  let smallest = Infinity
  for (let index = 0; index + 1 < segments.length; index += 1) {
    const length = segmentLength(segments[index]!) + segmentLength(segments[index + 1]!)
    if (length >= smallest) continue
    smallest = length
    at = index
  }
  const pair = [segments[at]!, segments[at + 1]!]
  segments.splice(at, 2, wholeRunSegment(materializeSegments(pair, smallest)))
}

function segmentLength(segment: TokenSegment): number {
  return segment.to - segment.from
}

function joinSegments(left: TokenSegment, right: TokenSegment): TokenSegment | null {
  const continues = left.starts === right.starts && left.to === right.from
  if (continues && left.delta === right.delta && left.styleIds === right.styleIds) {
    return { ...left, to: right.to }
  }

  const length = left.to - left.from + right.to - right.from
  if (length > SMALL_SEGMENT_TOKENS) return null
  return wholeRunSegment(materializeSegments([left, right], length))
}

function materializeSegments(segments: readonly TokenSegment[], length: number): EditorTokenRun {
  const starts = new Uint32Array(length)
  const ends = new Uint32Array(length)
  const styleIds = new Uint32Array(length)
  let target = 0
  for (const segment of segments) {
    const count = segment.to - segment.from
    styleIds.set(segment.styleIds.subarray(segment.from, segment.to), target)
    copyShifted(starts, segment.starts, segment, target)
    copyShifted(ends, segment.ends, segment, target)
    target += count
  }
  return { starts, ends, styleIds }
}

function copyShifted(
  target: Uint32Array,
  source: Uint32Array,
  segment: TokenSegment,
  targetStart: number,
): void {
  if (segment.delta === 0) {
    target.set(source.subarray(segment.from, segment.to), targetStart)
    return
  }

  for (let index = segment.from; index < segment.to; index += 1) {
    target[targetStart + index - segment.from] = source[index]! + segment.delta
  }
}

function isSortedByStart(starts: Uint32Array): boolean {
  for (let index = 1; index < starts.length; index += 1) {
    if (starts[index]! < starts[index - 1]!) return false
  }
  return true
}

// Stable, so tokens that share a start keep the order their producer gave them.
function sortRunByStart(run: EditorTokenRun): EditorTokenRun {
  const order = Array.from({ length: run.starts.length }, (_, index) => index)
  order.sort((left, right) => run.starts[left]! - run.starts[right]! || left - right)
  return {
    starts: Uint32Array.from(order, (index) => run.starts[index]!),
    ends: Uint32Array.from(order, (index) => run.ends[index]!),
    styleIds: Uint32Array.from(order, (index) => run.styleIds[index]!),
  }
}

function runFlags(run: EditorTokenRun): TokenStoreFlags {
  let monotonicEnd = true
  let nonOverlapping = true
  let maxEnd = 0
  let previousEnd = -Infinity
  for (let index = 0; index < run.starts.length; index += 1) {
    const end = run.ends[index]!
    if (run.starts[index]! < previousEnd) nonOverlapping = false
    if (end < maxEnd) monotonicEnd = false
    if (end > maxEnd) maxEnd = end
    previousEnd = end
  }
  return { monotonicEnd, nonOverlapping }
}

const styleIdsByKey = new WeakMap<readonly EditorTokenStyle[], Map<string, number>>()

/** `base` extended with the styles of `added` it lacks by value; `base` itself when it has all. */
function mergeStyles(
  base: readonly EditorTokenStyle[],
  added: readonly EditorTokenStyle[],
): { readonly styles: readonly EditorTokenStyle[]; readonly remap: readonly number[] } {
  const baseIds = styleIdsFor(base)
  let styles: EditorTokenStyle[] | null = null
  let ids = baseIds
  const remap = added.map((style) => {
    const key = JSON.stringify(style)
    const existing = ids.get(key)
    if (existing !== undefined) return existing

    if (!styles) {
      styles = [...base]
      ids = new Map(baseIds)
      styleIdsByKey.set(styles, ids)
    }
    styles.push(style)
    ids.set(key, styles.length - 1)
    return styles.length - 1
  })
  return { styles: styles ?? base, remap }
}

function styleIdsFor(styles: readonly EditorTokenStyle[]): Map<string, number> {
  const cached = styleIdsByKey.get(styles)
  if (cached) return cached

  const ids = new Map<string, number>()
  for (let index = 0; index < styles.length; index += 1) {
    const key = JSON.stringify(styles[index])
    if (!ids.has(key)) ids.set(key, index)
  }
  styleIdsByKey.set(styles, ids)
  return ids
}

function assertStyleIds(styleIds: Uint32Array, styleCount: number): void {
  for (let index = 0; index < styleIds.length; index += 1) {
    if (styleIds[index]! < styleCount) continue

    throw createError({
      code: 'EDITOR_TOKEN_STYLE_ID_UNKNOWN',
      status: 500,
      message: `Token ${index} names style ${styleIds[index]} in a palette of ${styleCount}`,
      why: 'A packed token must index a style in the palette it arrived with.',
      fix: 'Send the palette that the style ids were written against, or re-tokenize.',
    })
  }
}

function tokenIndexOutOfRange(index: number, length: number): Error {
  return createError({
    code: 'EDITOR_TOKEN_INDEX_OUT_OF_RANGE',
    status: 500,
    message: `Token index ${index} is outside a store of ${length}`,
    why: 'A token index was read from a different store than the one it was computed against.',
    fix: 'Take indices and tokens from the same store; a derived store renumbers its tokens.',
  })
}
