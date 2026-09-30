import type { FoldRange } from '../syntax/session'
import { EDITOR_FOLD_LEVELS, type EditorCommandId, type EditorFoldLevel } from './commands'

export type FoldOperation = 'fold' | 'unfold' | 'toggle'

/** The fold commands answered by collapsing or expanding regions the document already describes. */
export type EditorFoldPlanCommandId =
  | 'editor.fold'
  | 'editor.unfold'
  | 'editor.foldRecursively'
  | 'editor.unfoldRecursively'
  | `editor.foldLevel${EditorFoldLevel}`

export type EditorFoldCommandId =
  | EditorFoldPlanCommandId
  | 'editor.foldAll'
  | 'editor.unfoldAll'
  | 'editor.createFoldingRangeFromSelection'
  | 'editor.removeManualFoldingRanges'

export type FoldCommandLocation = {
  readonly row: number
  readonly offset: number
}

export type FoldCommandRequest = {
  readonly folds: readonly FoldRange[]
  readonly locations: readonly FoldCommandLocation[]
  readonly isCollapsed: (fold: FoldRange) => boolean
}

export type FoldCommandPlan = {
  readonly collapse: readonly FoldRange[]
  readonly expand: readonly FoldRange[]
}

/**
 * A region and where it sits in the nesting: the entry enclosing it, and how deep that makes it,
 * counting the outermost regions as level 1.
 *
 * One pass over the ranges answers both, so every command that asks which regions are inside another
 * or which are a given depth reads the same numbering instead of deriving containment again — and
 * disagreeing about it, which is how folding by level and folding a subtree drift apart.
 */
type FoldNestingEntry = {
  readonly fold: FoldRange
  readonly parentIndex: number
  readonly level: number
}

type FoldNesting = readonly FoldNestingEntry[]

export type FoldRowSpan = {
  readonly startRow: number
  readonly endRow: number
}

/** A row span a manual fold is being drawn over, with the offsets its two edge rows end at. */
export type ManualFoldSpan = FoldRowSpan & {
  readonly startIndex: number
  readonly endIndex: number
}

/** What marks a range as hand-drawn, for the projection that has to treat one differently. */
export const MANUAL_FOLD_TYPE = 'manual'

const NO_FOLDS: readonly FoldRange[] = []

const FOLD_LEVEL_BY_COMMAND = new Map<EditorFoldPlanCommandId, EditorFoldLevel>(
  EDITOR_FOLD_LEVELS.map((level) => [`editor.foldLevel${level}`, level] as const),
)

const FOLD_COMMANDS = new Set<EditorCommandId>([
  'editor.fold',
  'editor.unfold',
  'editor.foldRecursively',
  'editor.unfoldRecursively',
  'editor.foldAll',
  'editor.unfoldAll',
  'editor.createFoldingRangeFromSelection',
  'editor.removeManualFoldingRanges',
  ...EDITOR_FOLD_LEVELS.map((level) => `editor.foldLevel${level}` as const),
])

export function isEditorFoldCommand(command: EditorCommandId): command is EditorFoldCommandId {
  return FOLD_COMMANDS.has(command)
}

/**
 * Numbers the ranges by containment in one pass, taking them outermost-first so a region is always
 * numbered after whatever encloses it. Ranges reaching the fold state never cross — the fan-in
 * refuses a set where two do — so the run of entries after a parent is exactly its subtree.
 */
export function foldNesting(folds: readonly FoldRange[]): FoldNesting {
  const entries: FoldNestingEntry[] = []
  const openIndexes: number[] = []
  const innermostOpenEnd = (): number => entries[openIndexes.at(-1)!]!.fold.endIndex

  for (const fold of [...folds].toSorted(compareFoldsOutermostFirst)) {
    while (openIndexes.length > 0 && innermostOpenEnd() <= fold.startIndex) openIndexes.pop()

    entries.push({ fold, parentIndex: openIndexes.at(-1) ?? -1, level: openIndexes.length + 1 })
    openIndexes.push(entries.length - 1)
  }

  return entries
}

/**
 * The regions nested inside `parent`, or every region when it is null, with the level each one sits
 * at relative to `parent`. Every level operation is this query plus a predicate.
 */
function foldsInside(
  nesting: FoldNesting,
  parent: FoldRange | null,
  filter: (fold: FoldRange, level: number) => boolean,
): readonly FoldRange[] {
  const parentIndex = parent ? nesting.findIndex((entry) => entry.fold === parent) : -1
  if (parent && parentIndex < 0) return NO_FOLDS

  const parentLevel = nesting[parentIndex]?.level ?? 0
  const inside: FoldRange[] = []
  for (let index = parentIndex + 1; index < nesting.length; index += 1) {
    if (!foldDescendsFrom(nesting, index, parentIndex)) break

    const entry = nesting[index]!
    if (filter(entry.fold, entry.level - parentLevel)) inside.push(entry.fold)
  }

  return inside
}

export function planFoldCommand(
  command: EditorFoldPlanCommandId,
  request: FoldCommandRequest,
): FoldCommandPlan {
  const level = FOLD_LEVEL_BY_COMMAND.get(command)
  if (level !== undefined) return foldLevelPlan(request, level)
  if (command === 'editor.fold') return caretFoldPlan(request, 'fold')
  if (command === 'editor.unfold') return caretFoldPlan(request, 'unfold')

  return subtreeFoldPlan(request, command === 'editor.foldRecursively' ? 'fold' : 'unfold')
}

/** Turns the spans a user drew into ranges, minus the single-row ones, which would hide no text. */
export function manualFoldRangesForSpans(
  spans: readonly ManualFoldSpan[],
  folds: readonly FoldRange[],
): readonly FoldRange[] {
  const candidates = spans.filter(isFoldableSpan).map(manualFoldRangeForSpan)
  return nestableFoldRanges(candidates, folds)
}

/**
 * Drops the candidates that cannot take a place in the nesting the rest of the ranges form: one that
 * half-overlaps another has no level, and one on the rows an existing region already covers would put
 * a second control on a row that has one.
 *
 * This is where a hand-drawn region meets the ranges a provider produced, and providers keep
 * producing: the drawn region can promise nothing about what the next parse describes, so the
 * offender sits out — for as long as the eclipse lasts — rather than the whole set being refused.
 */
export function nestableFoldRanges(
  candidates: readonly FoldRange[],
  folds: readonly FoldRange[],
): readonly FoldRange[] {
  const nestable: FoldRange[] = []
  for (const candidate of candidates) {
    if (!foldRangeFitsAmong(candidate, folds)) continue
    if (!foldRangeFitsAmong(candidate, nestable)) continue

    nestable.push(candidate)
  }

  return nestable
}

export function foldRangesOutsideSpans(
  ranges: readonly FoldRange[],
  spans: readonly FoldRowSpan[],
): readonly FoldRange[] {
  return ranges.filter((range) => !spans.some((span) => foldRangeMeetsSpan(range, span)))
}

/**
 * Whether a region running from `startRow` to `endRow` takes `row` off the screen when it closes.
 *
 * Strictly past the first row, because a collapsed region keeps that one drawn: everywhere a reader
 * can put the caret on it — including the columns after the point a provider measures the region
 * from — is somewhere they can still look.
 */
export function foldSpanHidesRow(startRow: number, endRow: number, row: number): boolean {
  return row > startRow && row <= endRow
}

/**
 * The collapsed regions hiding `row` — everything that would have to open for a reader sent there to
 * see where they landed.
 *
 * Asked by row rather than by offset: where along its first row a provider says a region begins says
 * nothing about which rows it takes away.
 */
export function collapsedFoldsHidingRow(
  folds: readonly FoldRange[],
  isCollapsed: (fold: FoldRange) => boolean,
  row: number,
): readonly FoldRange[] {
  return folds.filter(
    (fold) => foldSpanHidesRow(fold.startLine, fold.endLine, row) && isCollapsed(fold),
  )
}

export function foldCandidateAtLocation(
  folds: readonly FoldRange[],
  row: number,
  offset: number,
  isCollapsed: (fold: FoldRange) => boolean,
  operation: FoldOperation,
): FoldRange | null {
  let candidate: FoldRange | null = null

  for (const fold of folds) {
    if (!foldContainsLocation(fold, row, offset)) continue
    if (!foldMatchesOperation(fold, isCollapsed, operation)) continue
    if (candidate && compareFoldCandidates(candidate, fold, row, isCollapsed, operation) <= 0)
      continue
    candidate = fold
  }

  return candidate
}

function caretFoldPlan(request: FoldCommandRequest, operation: 'fold' | 'unfold'): FoldCommandPlan {
  const folds = request.locations.flatMap((location) => {
    const fold = foldCandidateAtLocation(
      request.folds,
      location.row,
      location.offset,
      request.isCollapsed,
      operation,
    )
    return fold ? [fold] : []
  })

  return foldPlan(request, operation, folds)
}

function subtreeFoldPlan(
  request: FoldCommandRequest,
  operation: 'fold' | 'unfold',
): FoldCommandPlan {
  const nesting = foldNesting(request.folds)
  const folds = request.locations.flatMap((location) => {
    const entry = innermostFoldEntryAt(nesting, location)
    if (!entry) return NO_FOLDS

    return [entry.fold, ...foldsInside(nesting, entry.fold, () => true)]
  })

  return foldPlan(request, operation, folds)
}

/**
 * Regions a caret sits in are left alone: collapsing one takes the row the caret is on out of the
 * document, which reads as the caret having jumped somewhere else.
 */
function foldLevelPlan(request: FoldCommandRequest, level: number): FoldCommandPlan {
  const nesting = foldNesting(request.folds)
  const caretRows = request.locations.map((location) => location.row)
  const folds = foldsInside(
    nesting,
    null,
    (fold, foldLevel) => foldLevel === level && !caretRows.some((row) => foldCoversRow(fold, row)),
  )

  return foldPlan(request, 'fold', folds)
}

/** Regions already in the state the operation wants are dropped, so an empty plan means no work. */
function foldPlan(
  request: FoldCommandRequest,
  operation: 'fold' | 'unfold',
  folds: readonly FoldRange[],
): FoldCommandPlan {
  const collapsing = operation === 'fold'
  const changing: FoldRange[] = []
  for (const fold of new Set(folds)) {
    if (request.isCollapsed(fold) === collapsing) continue

    changing.push(fold)
  }

  return collapsing
    ? { collapse: changing, expand: NO_FOLDS }
    : { collapse: NO_FOLDS, expand: changing }
}

function innermostFoldEntryAt(
  nesting: FoldNesting,
  location: FoldCommandLocation,
): FoldNestingEntry | null {
  let innermost: FoldNestingEntry | null = null
  for (const entry of nesting) {
    if (!foldContainsLocation(entry.fold, location.row, location.offset)) continue
    if (innermost && innermost.level >= entry.level) continue

    innermost = entry
  }

  return innermost
}

function foldDescendsFrom(nesting: FoldNesting, index: number, ancestorIndex: number): boolean {
  if (ancestorIndex < 0) return true

  let parentIndex = nesting[index]?.parentIndex ?? -1
  while (parentIndex >= 0) {
    if (parentIndex === ancestorIndex) return true

    parentIndex = nesting[parentIndex]!.parentIndex
  }

  return false
}

function compareFoldsOutermostFirst(left: FoldRange, right: FoldRange): number {
  return left.startIndex - right.startIndex || right.endIndex - left.endIndex
}

function isFoldableSpan(span: ManualFoldSpan): boolean {
  return span.endRow > span.startRow && span.endIndex > span.startIndex
}

function manualFoldRangeForSpan(span: ManualFoldSpan): FoldRange {
  return {
    startIndex: span.startIndex,
    endIndex: span.endIndex,
    startLine: span.startRow,
    endLine: span.endRow,
    type: MANUAL_FOLD_TYPE,
  }
}

function foldRangeFitsAmong(range: FoldRange, folds: readonly FoldRange[]): boolean {
  return !folds.some((fold) => foldRangesCross(fold, range) || foldRangesCoverSameRows(fold, range))
}

function foldRangesCross(left: FoldRange, right: FoldRange): boolean {
  if (left.endIndex <= right.startIndex || right.endIndex <= left.startIndex) return false

  return !foldContainsFold(left, right) && !foldContainsFold(right, left)
}

function foldContainsFold(outer: FoldRange, inner: FoldRange): boolean {
  return outer.startIndex <= inner.startIndex && inner.endIndex <= outer.endIndex
}

function foldRangesCoverSameRows(left: FoldRange, right: FoldRange): boolean {
  return left.startLine === right.startLine && left.endLine === right.endLine
}

function foldRangeMeetsSpan(fold: FoldRange, span: FoldRowSpan): boolean {
  return fold.startLine <= span.endRow && span.startRow <= fold.endLine
}

function foldCoversRow(fold: FoldRange, row: number): boolean {
  return fold.startLine <= row && row <= fold.endLine
}

function foldContainsLocation(fold: FoldRange, row: number, offset: number): boolean {
  if (fold.startLine === row) return true
  // Inclusive of the far edge: a region's end offset is the end of its last row, and a caret parked
  // there is still inside the rows the region hides.
  return offset >= fold.startIndex && offset <= fold.endIndex
}

function foldMatchesOperation(
  fold: FoldRange,
  isCollapsed: (fold: FoldRange) => boolean,
  operation: FoldOperation,
): boolean {
  const collapsed = isCollapsed(fold)
  if (operation === 'fold') return !collapsed
  if (operation === 'unfold') return collapsed
  return true
}

function compareFoldCandidates(
  left: FoldRange,
  right: FoldRange,
  row: number,
  isCollapsed: (fold: FoldRange) => boolean,
  operation: FoldOperation,
): number {
  const startRowDelta = foldStartRowScore(left, row) - foldStartRowScore(right, row)
  if (startRowDelta !== 0) return startRowDelta

  const collapsedDelta =
    foldCollapsedScore(left, isCollapsed, operation) -
    foldCollapsedScore(right, isCollapsed, operation)
  if (collapsedDelta !== 0) return collapsedDelta

  const spanDelta = foldSpanCandidateDelta(left, right, isCollapsed, operation)
  if (spanDelta !== 0) return spanDelta

  return left.startIndex - right.startIndex
}

function foldCollapsedScore(
  fold: FoldRange,
  isCollapsed: (fold: FoldRange) => boolean,
  operation: FoldOperation,
): number {
  if (operation !== 'toggle') return 0
  return isCollapsed(fold) ? 0 : 1
}

function foldSpanCandidateDelta(
  left: FoldRange,
  right: FoldRange,
  isCollapsed: (fold: FoldRange) => boolean,
  operation: FoldOperation,
): number {
  if (shouldPreferOutermostFold(left, right, isCollapsed, operation)) {
    return foldSpan(right) - foldSpan(left)
  }

  return foldSpan(left) - foldSpan(right)
}

function shouldPreferOutermostFold(
  left: FoldRange,
  right: FoldRange,
  isCollapsed: (fold: FoldRange) => boolean,
  operation: FoldOperation,
): boolean {
  if (operation === 'unfold') return true
  if (operation !== 'toggle') return false
  return isCollapsed(left) && isCollapsed(right)
}

function foldStartRowScore(fold: FoldRange, row: number): number {
  return fold.startLine === row ? 0 : 1
}

function foldSpan(fold: FoldRange): number {
  return fold.endIndex - fold.startIndex
}
