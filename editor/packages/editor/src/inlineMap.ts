import {
  anchorAfter,
  anchorBefore,
  offsetToPoint,
  type PieceTableAnchor,
  type PieceTableEdit,
  type PieceTableSnapshot,
  type Point,
  resolveAnchor,
} from '@singapore-editor/textbuffer'
import {
  createInlineRow,
  type InlineCursorStops,
  type InlineReplacementRender,
  type InlineReplacement,
  type InlineRow,
  type MaterializedInlineRow,
  type InvalidatedRange,
  inlineColumnToSourceColumn,
  sourceColumnToInlineColumn,
  type TransformBias,
} from './displayTransforms'

import type { TextOffsetRange } from './textRanges'

declare const inlinePointBrand: unique symbol

export type InlinePoint = Point & {
  readonly [inlinePointBrand]: true
}

/**
 * When a caret or selection shows the source under a replacement: on touching it (edges included),
 * only from strictly inside it, or never.
 */
export type InlineReplacementReveal = 'touch' | 'inside' | 'never'

export type InlineReplacementSpec = {
  readonly id: string
  readonly startIndex: number
  readonly endIndex: number
  readonly text: string
  /** Phantom text hung off the point `startIndex === endIndex`, standing in for nothing. */
  readonly insertion?: boolean
  readonly kind?: string
  readonly className?: string
  readonly cursorStops?: InlineCursorStops
  /** Wraps textual paint into independently rendered display-row fragments. */
  readonly wrap?: 'text'
  /** Paints the supplied display text as a node and returns its mount's cleanup. */
  readonly render?: InlineReplacementRender
  /** Replacements sharing a group reveal together, so both `**` fences of one construct unhide. */
  readonly groupId?: string
  /** Defaults to `'touch'`. */
  readonly reveal?: InlineReplacementReveal
  readonly revealRange?: TextOffsetRange
  /** Deletes take the whole span, and caret motion never rests strictly inside it. */
  readonly atomic?: boolean
  /**
   * Identity of a rendered node across maps. A replacement whose key a live mount already holds keeps
   * that node, so an id derived from an offset does not remount the widget on every edit before it.
   */
  readonly key?: string
  readonly metadata?: unknown
}

export type InlineReplacementRange = {
  readonly id: string
  readonly start: PieceTableAnchor
  readonly end: PieceTableAnchor
  readonly startOffset: number
  readonly endOffset: number
  readonly startPoint: Point
  readonly endPoint: Point
  readonly text: string
  readonly insertion?: boolean
  readonly kind?: string
  readonly className?: string
  readonly cursorStops?: InlineCursorStops
  /** Wraps textual paint into independently rendered display-row fragments. */
  readonly wrap?: 'text'
  readonly render?: InlineReplacementRender
  readonly groupId?: string
  readonly reveal?: InlineReplacementReveal
  readonly revealRange?: {
    readonly start: PieceTableAnchor
    readonly end: PieceTableAnchor
    readonly offsets: TextOffsetRange
  }
  readonly atomic?: boolean
  readonly key?: string
  readonly metadata?: unknown
}

export type InlineMap = {
  readonly snapshot: PieceTableSnapshot
  readonly ranges: readonly InlineReplacementRange[]
  readonly rowReplacements: ReadonlyMap<number, readonly InlineReplacement[]>
}

type InlineMapInvalidationReason = 'external-edit' | 'replacement-changed' | 'replacement-dropped'

type InlineMapInvalidatedRange = InvalidatedRange<InlinePoint> & {
  readonly reason: InlineMapInvalidationReason
}

export type InlineMapUpdate = {
  readonly map: InlineMap
  readonly invalidations: readonly InlineMapInvalidatedRange[]
}

const EMPTY_REPLACEMENTS: readonly InlineReplacement[] = []

export const createInlineMap = (
  snapshot: PieceTableSnapshot,
  specs: readonly InlineReplacementSpec[],
): InlineMap => {
  const ranges = specs
    .map((spec) => inlineRangeFromSpec(snapshot, spec))
    .filter((range) => range !== null)

  return inlineMapFromRanges(snapshot, ranges)
}

export const updateInlineMapForEdit = (
  map: InlineMap,
  edit: PieceTableEdit,
  nextSnapshot: PieceTableSnapshot,
): InlineMapUpdate => {
  const nextMap = inlineMapFromRanges(nextSnapshot, map.ranges)

  return { map: nextMap, invalidations: invalidateInlineMapEdit(map, edit, nextMap) }
}

/**
 * The map's replacements as specs at a later snapshot, found through their anchors: what a provider
 * that only reruns when its input changes keeps contributing while the text moves under it.
 */
export const inlineSpecsAtSnapshot = (
  map: InlineMap,
  snapshot: PieceTableSnapshot,
): readonly InlineReplacementSpec[] =>
  inlineMapFromRanges(snapshot, map.ranges).ranges.map(inlineSpecFromRange)

const inlineSpecFromRange = (range: InlineReplacementRange): InlineReplacementSpec => ({
  id: range.id,
  startIndex: range.startOffset,
  endIndex: range.endOffset,
  text: range.text,
  ...(range.insertion === undefined ? {} : { insertion: range.insertion }),
  ...(range.kind === undefined ? {} : { kind: range.kind }),
  ...(range.className === undefined ? {} : { className: range.className }),
  ...(range.cursorStops === undefined ? {} : { cursorStops: range.cursorStops }),
  ...(range.wrap === undefined ? {} : { wrap: range.wrap }),
  ...(range.render === undefined ? {} : { render: range.render }),
  ...(range.groupId === undefined ? {} : { groupId: range.groupId }),
  ...(range.reveal === undefined ? {} : { reveal: range.reveal }),
  ...(range.revealRange === undefined ? {} : { revealRange: range.revealRange.offsets }),
  ...(range.atomic === undefined ? {} : { atomic: range.atomic }),
  ...(range.key === undefined ? {} : { key: range.key }),
  ...(range.metadata === undefined ? {} : { metadata: range.metadata }),
})

/**
 * Drops every replacement the given ranges touch, along with the rest of each touched group. Feeding
 * the caret and selections through this is what makes markdown source reappear under the cursor:
 * mapping and painting both read the revealed map, so they can never disagree about what is hidden.
 */
export const revealInlineMap = (map: InlineMap, ranges: readonly TextOffsetRange[]): InlineMap => {
  if (ranges.length === 0) return map

  const revealedIds = new Set<string>()
  const revealedGroups = new Set<string>()
  const groupSpans = inlineGroupSpans(map.ranges)

  for (const range of map.ranges) {
    if (isPhantomInlineRange(range)) continue
    const reveal = range.reveal ?? 'touch'
    if (reveal === 'never') continue
    const span = revealSpanForRange(range, groupSpans)
    if (!ranges.some((target) => spanRevealedBy(span, target, reveal))) continue
    revealedIds.add(range.id)
    if (range.groupId !== undefined) revealedGroups.add(range.groupId)
  }

  if (revealedIds.size === 0) return map

  const remaining = map.ranges.filter((range) => {
    if (isPhantomInlineRange(range)) return true
    if (range.reveal === 'never') return true
    if (revealedIds.has(range.id)) return false
    return range.groupId === undefined || !revealedGroups.has(range.groupId)
  })

  return inlineMapFromRanges(map.snapshot, remaining)
}

export const inlineReplacementsForBufferRow = (
  map: InlineMap,
  bufferRow: number,
): readonly InlineReplacement[] => map.rowReplacements.get(bufferRow) ?? EMPTY_REPLACEMENTS

export const inlineRowForBufferRow = (
  map: InlineMap,
  bufferRow: number,
  sourceText: string,
): MaterializedInlineRow =>
  createInlineRow(sourceText, inlineReplacementsForBufferRow(map, bufferRow))

export const bufferPointToInlinePoint = (
  row: InlineRow,
  point: Point,
  bias: TransformBias = 'nearest',
): InlinePoint =>
  asInlinePoint({ row: point.row, column: sourceColumnToInlineColumn(row, point.column, bias) })

export const inlinePointToBufferPoint = (
  row: InlineRow,
  point: InlinePoint,
  bias: TransformBias = 'nearest',
): Point => ({ row: point.row, column: inlineColumnToSourceColumn(row, point.column, bias) })

const inlineMapFromRanges = (
  snapshot: PieceTableSnapshot,
  ranges: readonly InlineReplacementRange[],
): InlineMap => {
  const normalized = normalizeInlineRanges(snapshot, ranges)

  return { snapshot, ranges: normalized, rowReplacements: rowReplacementIndex(normalized) }
}

/**
 * Replacements do not absorb edits at their edges: the start anchors right and the end anchors left,
 * so text typed immediately before or after `**bold**` lands outside the hidden markers rather than
 * inside them. This is deliberately the opposite of FoldMap, whose ranges grow at their boundaries.
 */
const inlineRangeFromSpec = (
  snapshot: PieceTableSnapshot,
  spec: InlineReplacementSpec,
): InlineReplacementRange | null => {
  const startOffset = clampOffset(snapshot, Math.min(spec.startIndex, spec.endIndex))
  const endOffset = clampOffset(snapshot, Math.max(spec.startIndex, spec.endIndex))
  const insertion = spec.insertion === true
  // Zero width is phantom text at a point, so it survives only where the spec asked for one: an empty
  // span from a grammar is still dropped, and an insertion given a span is a contradiction.
  if (insertion !== (endOffset === startOffset)) return null
  if (spec.id.length === 0) return null

  const anchors = inlineAnchorPair(snapshot, startOffset, endOffset)
  if (!anchors) return null
  const revealAnchors = spec.revealRange
    ? inlineAnchorPair(snapshot, spec.revealRange.start, spec.revealRange.end)
    : null
  if (spec.revealRange && !revealAnchors) return null

  return {
    id: spec.id,
    start: anchors.start,
    end: anchors.end,
    startOffset,
    endOffset,
    startPoint: offsetToPoint(snapshot, startOffset),
    endPoint: offsetToPoint(snapshot, endOffset),
    text: spec.text,
    ...(insertion ? { insertion: true } : {}),
    ...(spec.className === undefined ? {} : { className: spec.className }),
    ...(spec.cursorStops === undefined ? {} : { cursorStops: spec.cursorStops }),
    ...(spec.kind === undefined ? {} : { kind: spec.kind }),
    ...(spec.groupId === undefined ? {} : { groupId: spec.groupId }),
    ...(spec.wrap === undefined ? {} : { wrap: spec.wrap }),
    ...(spec.render === undefined ? {} : { render: spec.render }),
    ...(spec.reveal === undefined ? {} : { reveal: spec.reveal }),
    ...(revealAnchors && spec.revealRange
      ? { revealRange: { ...revealAnchors, offsets: spec.revealRange } }
      : {}),
    ...(spec.atomic === true ? { atomic: true } : {}),
    ...(spec.key === undefined ? {} : { key: spec.key }),
    ...(spec.metadata === undefined ? {} : { metadata: spec.metadata }),
  }
}

const inlineAnchorPair = (
  snapshot: PieceTableSnapshot,
  startOffset: number,
  endOffset: number,
): { readonly start: PieceTableAnchor; readonly end: PieceTableAnchor } | null => {
  try {
    return { start: anchorAfter(snapshot, startOffset), end: anchorBefore(snapshot, endOffset) }
  } catch {
    // anchorAt rejects offsets that split a surrogate pair. A replacement that cannot be anchored is
    // dropped so one bad range from a grammar cannot throw through the transform layer.
    return null
  }
}

const normalizeInlineRanges = (
  snapshot: PieceTableSnapshot,
  ranges: readonly InlineReplacementRange[],
): readonly InlineReplacementRange[] => {
  const resolved = ranges
    .map((range) => resolveInlineRange(snapshot, range))
    .filter((range) => range !== null)
    .filter((range) => range.startPoint.row === range.endPoint.row)
    .filter((range) => !range.text.includes('\n'))
    .sort((left, right) => {
      return (
        left.startOffset - right.startOffset ||
        insertionOrder(left) - insertionOrder(right) ||
        right.endOffset - left.endOffset ||
        left.id.localeCompare(right.id)
      )
    })

  const kept: InlineReplacementRange[] = []
  for (const range of resolved) {
    const previous = kept.at(-1)
    if (previous && range.startOffset < previous.endOffset) continue
    kept.push(range)
  }

  return kept
}

const insertionOrder = (range: InlineReplacementRange): number =>
  isPhantomInlineRange(range) ? 0 : 1

const resolveInlineRange = (
  snapshot: PieceTableSnapshot,
  range: InlineReplacementRange,
): InlineReplacementRange | null => {
  const start = resolveAnchor(snapshot, range.start)
  const end = resolveAnchor(snapshot, range.end)
  if (start.liveness === 'deleted' || end.liveness === 'deleted') return null

  const offsets = resolvedInlineOffsets(range, start.offset, end.offset)
  if (!offsets) return null
  const revealRange = resolveRevealRange(snapshot, range.revealRange)
  if (range.revealRange && !revealRange) return null

  return {
    ...range,
    ...(revealRange ? { revealRange } : {}),
    startOffset: offsets.start,
    endOffset: offsets.end,
    startPoint: offsetToPoint(snapshot, offsets.start),
    endPoint: offsetToPoint(snapshot, offsets.end),
  }
}

function resolveRevealRange(
  snapshot: PieceTableSnapshot,
  range: InlineReplacementRange['revealRange'],
): InlineReplacementRange['revealRange'] {
  if (!range) return undefined
  const start = resolveAnchor(snapshot, range.start),
    end = resolveAnchor(snapshot, range.end)
  if (start.liveness === 'deleted' || end.liveness === 'deleted') return undefined
  return { ...range, offsets: { start: start.offset, end: end.offset } }
}

/**
 * Typing at an insertion's point pulls its two ends apart, since they carry the same opposing biases
 * a substitution's do. Collapsing back onto the earlier one keeps the phantom text where it stood and
 * leaves the typed characters beyond it, instead of letting the run grow over them.
 */
const resolvedInlineOffsets = (
  range: InlineReplacementRange,
  startOffset: number,
  endOffset: number,
): { readonly start: number; readonly end: number } | null => {
  if (range.insertion === true) {
    const offset = Math.min(startOffset, endOffset)
    return { start: offset, end: offset }
  }

  if (endOffset <= startOffset) return null
  return { start: startOffset, end: endOffset }
}

const rowReplacementIndex = (
  ranges: readonly InlineReplacementRange[],
): ReadonlyMap<number, readonly InlineReplacement[]> => {
  const index = new Map<number, InlineReplacement[]>()
  const keys = new Set<string>()

  for (const range of ranges) {
    // One node cannot paint in two places, so a repeated key falls back to the replacement's id.
    const key = range.key === undefined || keys.has(range.key) ? undefined : range.key
    if (key !== undefined) keys.add(key)
    const replacement = inlineReplacementFromRange(range, key)
    replacementsAtBufferRow(index, range.startPoint.row).push(replacement)
  }

  return index
}

const replacementsAtBufferRow = (
  index: Map<number, InlineReplacement[]>,
  bufferRow: number,
): InlineReplacement[] => {
  const existing = index.get(bufferRow)
  if (existing) return existing

  const replacements: InlineReplacement[] = []
  index.set(bufferRow, replacements)
  return replacements
}

const inlineReplacementFromRange = (
  range: InlineReplacementRange,
  key: string | undefined,
): InlineReplacement => ({
  id: range.id,
  startColumn: range.startPoint.column,
  endColumn: range.endPoint.column,
  text: range.text,
  ...(range.insertion === undefined ? {} : { insertion: range.insertion }),
  ...(range.className === undefined ? {} : { className: range.className }),
  ...(range.cursorStops === undefined ? {} : { cursorStops: range.cursorStops }),
  ...(range.kind === undefined ? {} : { kind: range.kind }),
  ...(range.wrap === undefined ? {} : { wrap: range.wrap }),
  ...(range.render === undefined ? {} : { render: range.render }),
  ...(key === undefined ? {} : { key }),
  ...(range.metadata === undefined ? {} : { metadata: range.metadata }),
})

const invalidateInlineMapEdit = (
  map: InlineMap,
  edit: PieceTableEdit,
  nextMap: InlineMap,
): readonly InlineMapInvalidatedRange[] => {
  if (isEditAbsorbedByHiddenRange(map, edit, nextMap)) return []

  const touched = map.ranges
    .filter((range) => editTouchesInlineRange(edit, range))
    .map((range) => touchedRangeInvalidation(range, nextMap))

  return mergeInlineInvalidations(touched.concat([externalEditInvalidation(map, edit)]))
}

/**
 * An edit wholly inside a hidden span changes no display column on any row, so the layer above has
 * nothing to repaint. This is the inline analogue of FoldMap absorbing edits inside a fold interior.
 */
const isEditAbsorbedByHiddenRange = (
  map: InlineMap,
  edit: PieceTableEdit,
  nextMap: InlineMap,
): boolean => {
  if (countLineBreaks(edit.text) !== 0) return false

  return map.ranges.some((range) => {
    if (range.text.length !== 0) return false
    if (edit.from <= range.startOffset) return false
    if (edit.to >= range.endOffset) return false
    return inlineRangeSurvives(nextMap, range)
  })
}

const touchedRangeInvalidation = (
  range: InlineReplacementRange,
  nextMap: InlineMap,
): InlineMapInvalidatedRange => ({
  start: asInlinePoint({ row: range.startPoint.row, column: 0 }),
  end: asInlinePoint({ row: range.startPoint.row + 1, column: 0 }),
  // The inline layer never adds or removes rows; row deltas ride on the external-edit invalidation.
  lineCountDelta: 0,
  reason: inlineRangeSurvives(nextMap, range) ? 'replacement-changed' : 'replacement-dropped',
})

const externalEditInvalidation = (
  map: InlineMap,
  edit: PieceTableEdit,
): InlineMapInvalidatedRange => {
  const start = offsetToPoint(map.snapshot, edit.from)
  const end = offsetToPoint(map.snapshot, edit.to)

  return {
    start: asInlinePoint({ row: start.row, column: 0 }),
    end: asInlinePoint({ row: end.row + 1, column: 0 }),
    lineCountDelta: countLineBreaks(edit.text) - (end.row - start.row),
    reason: 'external-edit',
  }
}

const editTouchesInlineRange = (edit: PieceTableEdit, range: InlineReplacementRange): boolean => {
  if (edit.to < range.startOffset) return false
  return edit.from <= range.endOffset
}

const inlineRangeSurvives = (map: InlineMap, range: InlineReplacementRange): boolean =>
  map.ranges.some((candidate) => candidate.id === range.id)

/**
 * Reveal is construct-scoped, not marker-scoped: a caret anywhere between the first and last
 * replacement of a group counts as touching all of them, so putting the cursor inside `bold` unhides
 * the `**` fences on both sides rather than only the one it happens to sit next to.
 */
const inlineGroupSpans = (
  ranges: readonly InlineReplacementRange[],
): ReadonlyMap<string, TextOffsetRange> => {
  const spans = new Map<string, TextOffsetRange>()

  for (const range of ranges) {
    if (range.groupId === undefined || isPhantomInlineRange(range)) continue
    const existing = spans.get(range.groupId)
    spans.set(range.groupId, {
      start: existing ? Math.min(existing.start, range.startOffset) : range.startOffset,
      end: existing ? Math.max(existing.end, range.endOffset) : range.endOffset,
    })
  }

  return spans
}

/**
 * An insertion stands in for no source text, so there is nothing under it a caret could ask to see.
 * It takes no part in reveal at all: it neither unhides on contact, nor widens the span of a group it
 * decorates, nor goes away with that group — a hint that blinked out as the caret passed would read
 * as a rendering fault.
 */
const isPhantomInlineRange = (range: InlineReplacementRange): boolean => range.insertion === true

const revealSpanForRange = (
  range: InlineReplacementRange,
  groupSpans: ReadonlyMap<string, TextOffsetRange>,
): TextOffsetRange => {
  if (range.revealRange) return range.revealRange.offsets
  const span = range.groupId === undefined ? undefined : groupSpans.get(range.groupId)
  return span ?? { start: range.startOffset, end: range.endOffset }
}

const spanRevealedBy = (
  span: TextOffsetRange,
  target: TextOffsetRange,
  reveal: 'touch' | 'inside',
): boolean => {
  const low = Math.min(target.start, target.end)
  const high = Math.max(target.start, target.end)
  if (reveal === 'touch') return high >= span.start && low <= span.end
  // A caret needs to sit strictly between the edges; a selection needs to overlap the interior.
  if (low === high) return low > span.start && low < span.end
  return high > span.start && low < span.end
}

const mergeInlineInvalidations = (
  invalidations: InlineMapInvalidatedRange[],
): readonly InlineMapInvalidatedRange[] => {
  const sorted = invalidations.sort((left, right) => left.start.row - right.start.row)
  const merged: InlineMapInvalidatedRange[] = []

  for (const invalidation of sorted) {
    appendInlineInvalidation(merged, invalidation)
  }

  return merged
}

const appendInlineInvalidation = (
  invalidations: InlineMapInvalidatedRange[],
  invalidation: InlineMapInvalidatedRange,
): void => {
  const previous = invalidations.at(-1)
  if (!previous || invalidation.start.row > previous.end.row) {
    invalidations.push(invalidation)
    return
  }

  invalidations[invalidations.length - 1] = {
    start: previous.start,
    end: previous.end.row >= invalidation.end.row ? previous.end : invalidation.end,
    lineCountDelta: previous.lineCountDelta + invalidation.lineCountDelta,
    reason: strongerInvalidationReason(previous.reason, invalidation.reason),
  }
}

const INVALIDATION_REASON_RANK: Record<InlineMapInvalidationReason, number> = {
  'external-edit': 0,
  'replacement-changed': 1,
  'replacement-dropped': 2,
}

/** Merging must not bury why a row changed; the most specific reason wins. */
const strongerInvalidationReason = (
  left: InlineMapInvalidationReason,
  right: InlineMapInvalidationReason,
): InlineMapInvalidationReason =>
  INVALIDATION_REASON_RANK[right] > INVALIDATION_REASON_RANK[left] ? right : left

const countLineBreaks = (text: string): number => {
  let count = 0

  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\n') count++
  }

  return count
}

const clampOffset = (snapshot: PieceTableSnapshot, offset: number): number =>
  Math.max(0, Math.min(offset, snapshot.length))

const asInlinePoint = (point: Point): InlinePoint => point as InlinePoint
