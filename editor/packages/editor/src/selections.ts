import {
  anchorAt,
  type AnchorBias,
  type AnchorLiveness,
  type PieceTableAnchor,
  type PieceTableSnapshot,
  resolveAnchor,
} from '@singapore-editor/textbuffer'

export type SelectionGoal =
  | { readonly kind: 'none' }
  // Row-local text x in CSS pixels; gutter and scroll coordinates do not survive vertical runs.
  | { readonly kind: 'horizontal'; readonly x: number }
  // The end of the line is not a column, it is wherever the line happens to stop. A caret sent
  // there by End has to remember that rather than the width of the line it left.
  | { readonly kind: 'lineEnd' }

export const SelectionGoal = {
  none: (): SelectionGoal => ({ kind: 'none' }),
  horizontal: (x: number): SelectionGoal => ({ kind: 'horizontal', x }),
  lineEnd: (): SelectionGoal => ({ kind: 'lineEnd' }),
} as const

export type SelectionAffinity = 'before' | 'after'

export type Selection<T> = {
  readonly id: string
  readonly start: T
  readonly end: T
  readonly reversed: boolean
  readonly goal: SelectionGoal
  readonly affinity: SelectionAffinity
}

export type AnchorSelection = Selection<PieceTableAnchor>

export type SelectionSet<T> = {
  readonly selections: readonly Selection<T>[]
  // Which cursor the user reached for last. Where a cursor sits cannot answer that: the set is kept
  // in document order, and every edit hands it back rebuilt in that same order.
  readonly lastAddedIndex?: number
  readonly normalized: boolean
  readonly normalizedFor?: PieceTableSnapshot
}

export type ResolvedSelection = {
  readonly id: string
  readonly startOffset: number
  readonly endOffset: number
  readonly anchorOffset: number
  readonly headOffset: number
  readonly reversed: boolean
  readonly collapsed: boolean
  readonly goal: SelectionGoal
  readonly affinity: SelectionAffinity
  readonly liveness: AnchorLiveness
  readonly startLiveness: AnchorLiveness
  readonly endLiveness: AnchorLiveness
}

export type SelectionOffsetsWithAffinity = {
  readonly anchor: number
  readonly head: number
  readonly affinity: SelectionAffinity
}

export type CreateAnchorSelectionOptions = {
  readonly id?: string
  readonly idFactory?: SelectionIdFactory
  readonly goal?: SelectionGoal
  readonly cursorBias?: AnchorBias
  readonly reversed?: boolean
  readonly affinity?: SelectionAffinity
}

export type SelectionIdFactory = () => string

type OffsetRange = {
  readonly start: number
  readonly end: number
}

type ResolvedSelectionWithSource = ResolvedSelection & {
  readonly source: AnchorSelection
  readonly lastAdded: boolean
}

type NormalizedSelections = {
  readonly selections: AnchorSelection[]
  readonly lastAddedIndex: number
}

export const createSelectionIdFactory = (prefix = 'selection'): SelectionIdFactory => {
  let nextSelectionId = 0
  return () => `${prefix}:${nextSelectionId++}`
}

const createFallbackSelectionId = (
  anchorOffset: number,
  headOffset: number,
  reversed: boolean,
  affinity: SelectionAffinity,
): string => {
  const direction = reversed ? 'reversed' : 'forward'
  return `selection:${anchorOffset}:${headOffset}:${direction}:${affinity}`
}

/** Where in the run of ids above this one was handed out, or -1 for an id from anywhere else. */
const selectionIdSequence = (id: string): number => {
  const counter = id.slice(id.lastIndexOf(':') + 1)
  if (!/^\d+$/u.test(counter)) return -1
  return Number.parseInt(counter, 10)
}

/**
 * The id a cursor was minted with rides through every rebuild untouched, so the newest of them is
 * the newest cursor wherever it ended up.
 *
 * Ids from anywhere else say nothing about age; a set built only from those falls back to the
 * caller that grew it appending the cursor it just made.
 */
const newestSelectionIndex = <T>(selections: readonly Selection<T>[]): number => {
  let newest = -1
  let index = Math.max(0, selections.length - 1)

  for (const [candidate, selection] of selections.entries()) {
    const sequence = selectionIdSequence(selection.id)
    if (sequence <= newest) continue

    newest = sequence
    index = candidate
  }

  return index
}

const orderOffsets = (first: number, second: number): OffsetRange => ({
  start: Math.min(first, second),
  end: Math.max(first, second),
})

const isLiveSelection = (
  startLiveness: AnchorLiveness,
  endLiveness: AnchorLiveness,
): AnchorLiveness => {
  if (startLiveness === 'live' && endLiveness === 'live') return 'live'
  return 'deleted'
}

const createEndpointAnchors = (
  snapshot: PieceTableSnapshot,
  range: OffsetRange,
  cursorBias: AnchorBias,
): { start: PieceTableAnchor; end: PieceTableAnchor } => {
  if (range.start === range.end) {
    const cursor = anchorAt(snapshot, range.start, cursorBias)
    return { start: cursor, end: cursor }
  }

  return {
    start: anchorAt(snapshot, range.start, 'left'),
    end: anchorAt(snapshot, range.end, 'right'),
  }
}

export const createAnchorSelection = (
  snapshot: PieceTableSnapshot,
  anchorOffset: number,
  headOffset = anchorOffset,
  options: CreateAnchorSelectionOptions = {},
): AnchorSelection => {
  const range = orderOffsets(anchorOffset, headOffset)
  const cursorBias = options.cursorBias ?? 'right'
  const endpoints = createEndpointAnchors(snapshot, range, cursorBias)
  const collapsed = range.start === range.end
  const reversed = collapsed ? false : (options.reversed ?? headOffset < anchorOffset)
  const affinity = options.affinity ?? 'after'
  const id =
    options.id ??
    options.idFactory?.() ??
    createFallbackSelectionId(anchorOffset, headOffset, reversed, affinity)

  return {
    id,
    start: endpoints.start,
    end: endpoints.end,
    reversed,
    goal: options.goal ?? SelectionGoal.none(),
    affinity,
  }
}

/**
 * Which cursor the user reached for last, for a set that may not have been built here.
 *
 * A hand-assembled set carries no answer, and the document-first cursor is the one every caller
 * fell back to before the set could name one.
 */
export const lastAddedSelectionIndex = <T>(set: SelectionSet<T>): number => set.lastAddedIndex ?? 0

export const createSelectionSet = <T>(
  selections: readonly Selection<T>[],
  normalized = false,
  normalizedFor?: PieceTableSnapshot,
): SelectionSet<T> => ({
  selections,
  lastAddedIndex: newestSelectionIndex(selections),
  normalized,
  normalizedFor: normalized ? normalizedFor : undefined,
})

export const markSelectionSetDirty = <T>(set: SelectionSet<T>): SelectionSet<T> => ({
  selections: set.selections,
  lastAddedIndex: set.lastAddedIndex,
  normalized: false,
  normalizedFor: undefined,
})

export const resolveSelection = (
  snapshot: PieceTableSnapshot,
  selection: AnchorSelection,
): ResolvedSelection => {
  const start = resolveAnchor(snapshot, selection.start)
  const end = resolveAnchor(snapshot, selection.end)
  const range = orderOffsets(start.offset, end.offset)
  const collapsed = range.start === range.end
  const reversed = collapsed ? false : selection.reversed

  return {
    id: selection.id,
    startOffset: range.start,
    endOffset: range.end,
    anchorOffset: reversed ? range.end : range.start,
    headOffset: reversed ? range.start : range.end,
    reversed,
    collapsed,
    goal: selection.goal,
    affinity: selection.affinity,
    liveness: isLiveSelection(start.liveness, end.liveness),
    startLiveness: start.liveness,
    endLiveness: end.liveness,
  }
}

/** Rebuilds endpoint offsets without losing which visual side the head owns. */
export const selectionOffsetsWithAffinity = (
  selection: ResolvedSelection,
  anchor: number,
  head: number,
): SelectionOffsetsWithAffinity => ({ anchor, head, affinity: selection.affinity })

/** Relocates a selection to an ordered range while preserving its direction and affinity. */
export const selectionRangeWithAffinity = (
  selection: ResolvedSelection,
  start: number,
  end: number,
): SelectionOffsetsWithAffinity => {
  if (selection.reversed) return selectionOffsetsWithAffinity(selection, end, start)
  return selectionOffsetsWithAffinity(selection, start, end)
}

const resolveSelectionWithSource = (
  snapshot: PieceTableSnapshot,
  selection: AnchorSelection,
  lastAdded: boolean,
): ResolvedSelectionWithSource => ({
  ...resolveSelection(snapshot, selection),
  source: selection,
  lastAdded,
})

const compareResolvedSelections = (
  left: ResolvedSelectionWithSource,
  right: ResolvedSelectionWithSource,
): number => {
  if (left.startOffset !== right.startOffset) return left.startOffset - right.startOffset
  if (left.endOffset !== right.endOffset) return left.endOffset - right.endOffset
  if (left.collapsed && right.collapsed && left.affinity !== right.affinity) {
    return left.affinity === 'before' ? -1 : 1
  }
  return left.id.localeCompare(right.id)
}

// Two selections that share only an edge are two ranges the user built deliberately — collapsing
// `ab|ab` into one range would let the next keystroke overwrite the whole run — so they merge only
// where they genuinely overlap. A collapsed cursor has no text of its own to lose, so a neighbour
// that reaches its offset absorbs it.
const shouldMergeSelections = (left: ResolvedSelection, right: ResolvedSelection): boolean => {
  if (left.collapsed && right.collapsed && left.affinity !== right.affinity) return false
  if (left.collapsed || right.collapsed) return right.startOffset <= left.endOffset
  return right.startOffset < left.endOffset
}

const selectionFromResolved = (
  snapshot: PieceTableSnapshot,
  resolved: ResolvedSelectionWithSource,
): AnchorSelection =>
  createAnchorSelection(snapshot, resolved.anchorOffset, resolved.headOffset, {
    cursorBias: cursorBiasFromResolved(resolved),
    id: resolved.id,
    goal: resolved.goal,
    reversed: resolved.reversed,
    affinity: resolved.affinity,
  })

const cursorBiasFromResolved = (resolved: ResolvedSelectionWithSource): AnchorBias | undefined => {
  if (!resolved.collapsed) return undefined
  if (resolved.source.start !== resolved.source.end) return undefined
  if (resolved.source.start.kind !== 'anchor') return undefined
  return resolved.source.start.bias
}

const normalizeResolvedSelection = (
  snapshot: PieceTableSnapshot,
  resolved: ResolvedSelectionWithSource,
): ResolvedSelectionWithSource => {
  const source = selectionFromResolved(snapshot, resolved)
  return {
    ...resolveSelection(snapshot, source),
    source,
    lastAdded: resolved.lastAdded,
  }
}

const mergeResolvedSelections = (
  snapshot: PieceTableSnapshot,
  left: ResolvedSelectionWithSource,
  right: ResolvedSelectionWithSource,
): ResolvedSelectionWithSource => {
  const startOffset = Math.min(left.startOffset, right.startOffset)
  const endOffset = Math.max(left.endOffset, right.endOffset)
  // The survivor keeps steering the way the cursor the user is holding was steering: resetting the
  // direction would send the next Shift+Arrow the other way, and resetting the goal would strand
  // the next Up/Down on the merged edge instead of the column it was tracking.
  const steering = right.lastAdded ? right : left
  const source = createAnchorSelection(
    snapshot,
    steering.reversed ? endOffset : startOffset,
    steering.reversed ? startOffset : endOffset,
    {
      cursorBias: cursorBiasFromResolved(steering),
      id: steering.id,
      goal: steering.goal,
      affinity: steering.affinity,
    },
  )

  return {
    ...resolveSelection(snapshot, source),
    source,
    lastAdded: left.lastAdded || right.lastAdded,
  }
}

const appendNormalizedSelection = (
  snapshot: PieceTableSnapshot,
  normalized: ResolvedSelectionWithSource[],
  selection: ResolvedSelectionWithSource,
): void => {
  let candidate = normalizeResolvedSelection(snapshot, selection)
  while (normalized.length > 0) {
    const previous = normalized[normalized.length - 1]!
    if (!shouldMergeSelections(previous, candidate)) break

    normalized.pop()
    candidate = mergeResolvedSelections(snapshot, previous, candidate)
  }

  normalized.push(candidate)
}

const normalizeSelections = (
  snapshot: PieceTableSnapshot,
  selections: readonly AnchorSelection[],
  lastAddedIndex: number,
): NormalizedSelections => {
  const resolved = selections.map((selection, index) =>
    resolveSelectionWithSource(snapshot, selection, index === lastAddedIndex),
  )
  const sorted = resolved.toSorted(compareResolvedSelections)
  const normalized: ResolvedSelectionWithSource[] = []

  for (const selection of sorted) appendNormalizedSelection(snapshot, normalized, selection)

  return {
    selections: normalized.map((selection) => selection.source),
    lastAddedIndex: Math.max(
      0,
      normalized.findIndex((selection) => selection.lastAdded),
    ),
  }
}

export const normalizeSelectionSet = (
  snapshot: PieceTableSnapshot,
  set: SelectionSet<PieceTableAnchor>,
): SelectionSet<PieceTableAnchor> => {
  if (set.normalized && set.normalizedFor === snapshot) return set

  const normalized = normalizeSelections(snapshot, set.selections, lastAddedSelectionIndex(set))
  return {
    selections: normalized.selections,
    lastAddedIndex: normalized.lastAddedIndex,
    normalized: true,
    normalizedFor: snapshot,
  }
}
