import {
  anchorAfter,
  anchorBefore,
  offsetToPoint,
  type PieceTableAnchor,
  type PieceTableEdit,
  type PieceTableSnapshot,
  type Point,
  pointToOffset,
  resolveAnchor,
  type ResolvedAnchor,
} from '@singapore-editor/textbuffer'
import type { InvalidatedRange } from './displayTransforms'

import type { FoldRange } from './syntax/session'

declare const foldPointBrand: unique symbol

export type FoldPoint = Point & {
  readonly [foldPointBrand]: true
}

export type AnchorFoldRange = {
  readonly start: PieceTableAnchor
  readonly end: PieceTableAnchor
  readonly startOffset: number
  readonly endOffset: number
  readonly startPoint: Point
  readonly endPoint: Point
  readonly type: string
  readonly languageId?: FoldRange['languageId']
}

export type FoldMap = {
  readonly snapshot: PieceTableSnapshot
  readonly ranges: readonly AnchorFoldRange[]
}

type FoldMapInvalidationReason = 'external-edit' | 'fold-placeholder' | 'fold-expanded'

type FoldMapInvalidatedRange = InvalidatedRange<FoldPoint> & {
  readonly reason: FoldMapInvalidationReason
}

export type FoldMapUpdate = {
  readonly map: FoldMap
  readonly invalidations: readonly FoldMapInvalidatedRange[]
}

const createAnchorFoldRanges = (
  snapshot: PieceTableSnapshot,
  folds: readonly FoldRange[],
): AnchorFoldRange[] => {
  const ranges = folds.map((fold) => anchorFoldRangeFromSyntaxFold(snapshot, fold))
  return normalizeAnchorFoldRanges(snapshot, ranges)
}

export const createFoldMap = (
  snapshot: PieceTableSnapshot,
  folds: readonly FoldRange[],
): FoldMap => ({
  snapshot,
  ranges: createAnchorFoldRanges(snapshot, folds),
})

const refreshFoldMap = (map: FoldMap, snapshot: PieceTableSnapshot): FoldMap => ({
  snapshot,
  ranges: normalizeAnchorFoldRanges(snapshot, map.ranges),
})

export const updateFoldMapForEdit = (
  map: FoldMap,
  edit: PieceTableEdit,
  nextSnapshot: PieceTableSnapshot,
): FoldMapUpdate => {
  const nextMap = refreshFoldMap(map, nextSnapshot)
  const invalidations = invalidateFoldMapEdit(map, edit, nextMap)

  return { map: nextMap, invalidations }
}

export const bufferPointToFoldPoint = (map: FoldMap, point: Point): FoldPoint => {
  const normalized = pointWithFoldRowDelta(map, point)
  return asFoldPoint(normalized)
}

export const foldPointToBufferPoint = (map: FoldMap, point: FoldPoint): Point => {
  let rowDelta = 0

  for (const range of map.ranges) {
    const foldedStartRow = range.startPoint.row - rowDelta
    if (point.row < foldedStartRow) return { row: point.row + rowDelta, column: point.column }
    if (point.row === foldedStartRow) return range.startPoint
    rowDelta += hiddenLineCount(range)
  }

  return { row: point.row + rowDelta, column: point.column }
}

const invalidateFoldMapEdit = (
  map: FoldMap,
  edit: PieceTableEdit,
  nextMap: FoldMap,
): readonly FoldMapInvalidatedRange[] => {
  const boundaryInvalidations = boundaryFoldInvalidations(map, edit, nextMap)
  if (boundaryInvalidations.length > 0) return mergeFoldInvalidations(boundaryInvalidations)
  if (isEditInsideFoldInterior(map, edit)) return []

  return [externalEditInvalidation(map, edit)]
}

const anchorFoldRangeFromSyntaxFold = (
  snapshot: PieceTableSnapshot,
  fold: FoldRange,
): AnchorFoldRange => {
  const startOffset = clampOffset(snapshot, fold.startIndex)
  const endOffset = clampOffset(snapshot, fold.endIndex)

  return {
    start: anchorBefore(snapshot, startOffset),
    end: anchorAfter(snapshot, endOffset),
    startOffset,
    endOffset,
    startPoint: offsetToPoint(snapshot, startOffset),
    endPoint: offsetToPoint(snapshot, endOffset),
    type: fold.type,
    languageId: fold.languageId,
  }
}

const normalizeAnchorFoldRanges = (
  snapshot: PieceTableSnapshot,
  ranges: readonly AnchorFoldRange[],
): AnchorFoldRange[] => {
  const resolved = ranges
    .map((range) => resolveFoldRange(snapshot, range))
    .filter((range) => range !== null)
    .filter((range) => range.endPoint.row > range.startPoint.row)
    .toSorted(
      (left, right) => left.startOffset - right.startOffset || right.endOffset - left.endOffset,
    )

  const normalized: AnchorFoldRange[] = []
  for (const range of resolved) {
    if (isNestedInLastRange(normalized, range)) continue
    normalized.push(range)
  }

  return normalized
}

const resolveFoldRange = (
  snapshot: PieceTableSnapshot,
  range: AnchorFoldRange,
): AnchorFoldRange | null => {
  const start = resolveAnchor(snapshot, range.start)
  const end = resolveAnchor(snapshot, range.end)
  if (isDeletedBoundary(start, end)) return null
  if (end.offset <= start.offset) return null

  return {
    ...range,
    startOffset: start.offset,
    endOffset: end.offset,
    startPoint: offsetToPoint(snapshot, start.offset),
    endPoint: offsetToPoint(snapshot, end.offset),
  }
}

const isDeletedBoundary = (start: ResolvedAnchor, end: ResolvedAnchor): boolean =>
  start.liveness === 'deleted' || end.liveness === 'deleted'

const isNestedInLastRange = (
  ranges: readonly AnchorFoldRange[],
  range: AnchorFoldRange,
): boolean => {
  const previous = ranges.at(-1)
  if (!previous) return false
  return range.startOffset >= previous.startOffset && range.endOffset <= previous.endOffset
}

const pointWithFoldRowDelta = (map: FoldMap, point: Point): Point => {
  const offset = pointToOffset(map.snapshot, point)
  let rowDelta = 0

  for (const range of map.ranges) {
    if (offset > range.endOffset) {
      rowDelta += hiddenLineCount(range)
      continue
    }

    if (offset > range.startOffset) {
      return { row: range.startPoint.row - rowDelta, column: range.startPoint.column }
    }

    break
  }

  return { row: point.row - rowDelta, column: point.column }
}

const hiddenLineCount = (range: AnchorFoldRange): number =>
  Math.max(0, range.endPoint.row - range.startPoint.row)

const boundaryFoldInvalidations = (
  map: FoldMap,
  edit: PieceTableEdit,
  nextMap: FoldMap,
): FoldMapInvalidatedRange[] => {
  const invalidations: FoldMapInvalidatedRange[] = []

  for (const range of map.ranges) {
    if (!editTouchesFoldBoundary(edit, range)) continue
    invalidations.push(boundaryFoldInvalidation(map, edit, range, nextMap))
  }

  return invalidations
}

const boundaryFoldInvalidation = (
  map: FoldMap,
  edit: PieceTableEdit,
  range: AnchorFoldRange,
  nextMap: FoldMap,
): FoldMapInvalidatedRange => {
  const start = bufferPointToFoldPoint(map, range.startPoint)
  const end = nextFoldLine(start)
  const survives = foldRangeSurvives(nextMap, range)

  if (survives) {
    return { start, end, lineCountDelta: 0, reason: 'fold-placeholder' }
  }

  return {
    start,
    end,
    lineCountDelta: hiddenLineCount(range) + editLineCountDelta(map.snapshot, edit),
    reason: 'fold-expanded',
  }
}

const editTouchesFoldBoundary = (edit: PieceTableEdit, range: AnchorFoldRange): boolean =>
  editTouchesOffset(edit, range.startOffset) || editTouchesOffset(edit, range.endOffset)

const editTouchesOffset = (edit: PieceTableEdit, offset: number): boolean => {
  if (edit.from === edit.to) return edit.from === offset
  return edit.from <= offset && edit.to >= offset
}

const foldRangeSurvives = (map: FoldMap, range: AnchorFoldRange): boolean =>
  map.ranges.some((candidate) => sameFoldAnchors(candidate, range))

const sameFoldAnchors = (left: AnchorFoldRange, right: AnchorFoldRange): boolean =>
  left.start === right.start && left.end === right.end

const isEditInsideFoldInterior = (map: FoldMap, edit: PieceTableEdit): boolean =>
  map.ranges.some((range) => editInsideRangeInterior(edit, range))

const editInsideRangeInterior = (edit: PieceTableEdit, range: AnchorFoldRange): boolean => {
  if (edit.from <= range.startOffset) return false
  if (edit.to >= range.endOffset) return false
  return edit.from <= edit.to
}

const externalEditInvalidation = (map: FoldMap, edit: PieceTableEdit): FoldMapInvalidatedRange => {
  const start = bufferPointToFoldPoint(map, offsetToPoint(map.snapshot, edit.from))
  const end = bufferPointToFoldPoint(map, offsetToPoint(map.snapshot, edit.to))
  const lineCountDelta = editLineCountDelta(map.snapshot, edit)

  return { start, end, lineCountDelta, reason: 'external-edit' }
}

const editLineCountDelta = (snapshot: PieceTableSnapshot, edit: PieceTableEdit): number => {
  const start = offsetToPoint(snapshot, edit.from)
  const end = offsetToPoint(snapshot, edit.to)
  return countLineBreaks(edit.text) - (end.row - start.row)
}

const countLineBreaks = (text: string): number => {
  let count = 0

  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\n') count++
  }

  return count
}

const mergeFoldInvalidations = (
  invalidations: readonly FoldMapInvalidatedRange[],
): readonly FoldMapInvalidatedRange[] => {
  const sorted = invalidations.toSorted(compareInvalidations)
  const merged: FoldMapInvalidatedRange[] = []

  for (const invalidation of sorted) {
    appendInvalidation(merged, invalidation)
  }

  return merged
}

const appendInvalidation = (
  invalidations: FoldMapInvalidatedRange[],
  invalidation: FoldMapInvalidatedRange,
): void => {
  const previous = invalidations.at(-1)
  if (!previous || invalidation.start.row > previous.end.row) {
    invalidations.push(invalidation)
    return
  }

  invalidations[invalidations.length - 1] = mergeInvalidation(previous, invalidation)
}

const mergeInvalidation = (
  left: FoldMapInvalidatedRange,
  right: FoldMapInvalidatedRange,
): FoldMapInvalidatedRange => ({
  start: left.start,
  end: maxFoldPoint(left.end, right.end),
  lineCountDelta: left.lineCountDelta + right.lineCountDelta,
  reason: left.reason === right.reason ? left.reason : 'fold-expanded',
})

const compareInvalidations = (
  left: FoldMapInvalidatedRange,
  right: FoldMapInvalidatedRange,
): number => left.start.row - right.start.row || left.start.column - right.start.column

const maxFoldPoint = (left: FoldPoint, right: FoldPoint): FoldPoint => {
  if (right.row > left.row) return right
  if (right.row < left.row) return left
  if (right.column > left.column) return right
  return left
}

const nextFoldLine = (point: FoldPoint): FoldPoint => asFoldPoint({ row: point.row + 1, column: 0 })

const clampOffset = (snapshot: PieceTableSnapshot, offset: number): number =>
  Math.max(0, Math.min(offset, snapshot.length))

const asFoldPoint = (point: Point): FoldPoint => point as FoldPoint
