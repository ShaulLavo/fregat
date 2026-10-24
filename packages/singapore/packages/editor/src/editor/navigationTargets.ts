import type { TextSnapshot } from '../documentTextSnapshot'
import { offsetToPoint, type PieceTableSnapshot, pointToOffset } from '@singapore-editor/textbuffer'

import { type AtomicRanges, atomicCaretOffset } from '../atomicRanges'
import { SelectionGoal, type ResolvedSelection, type SelectionAffinity } from '../selections'
import {
  nextCodePointOffset,
  nextWordOffset,
  nextWordPartOffset,
  nextWordStartOffset,
  previousCodePointOffset,
  previousWordEndOffset,
  previousWordOffset,
  previousWordPartOffset,
} from '../textRanges'
import type { EditorCommandId } from './commands'

export type NavigationTarget = {
  readonly offset: number
  readonly extend: boolean
  readonly affinity: SelectionAffinity
  readonly goal?: SelectionGoal
  readonly timingName: string
}

/** One buffer line and the document offset it starts at, so a scan can report absolute offsets. */
export type NavigationLine = {
  readonly text: string
  readonly start: number
}

type NavigationLineReader = (offset: number) => NavigationLine

type VerticalCaretView = {
  readonly caretXForOffset: (offset: number, affinity: SelectionAffinity) => number
  readonly verticalCaretTarget: (
    offset: number,
    affinity: SelectionAffinity,
    rowDelta: number,
    goal: VerticalSelectionGoal,
  ) => { readonly offset: number; readonly affinity: SelectionAffinity }
}

type VerticalSelectionGoal = Exclude<SelectionGoal, { readonly kind: 'none' }>

type LineBoundaryView = {
  readonly offsetAtLineBoundary: (offset: number, boundary: 'start' | 'end') => number
}

type NavigationTargetView = VerticalCaretView &
  LineBoundaryView & {
    readonly offsetByDisplayRows: (offset: number, rowDelta: number, goalColumn: number) => number
    readonly pageRowDelta: () => number
    readonly visualHorizontalTarget: (
      offset: number,
      affinity: SelectionAffinity,
      direction: 'left' | 'right',
    ) => { readonly offset: number; readonly affinity: SelectionAffinity } | null
  }

type NavigationTargetContext = {
  readonly command: EditorCommandId
  readonly resolved: ResolvedSelection
  readonly readLine: NavigationLineReader
  readonly documentLength: number
  readonly rtlMoveVisually: boolean
  readonly wordSeparators?: string
  readonly view: NavigationTargetView
  /** Whether the offset sits on a row a contribution keeps the caret off. */
  readonly nonCaretOffset?: (offset: number) => boolean
  readonly atomicRanges?: AtomicRanges
}

// Consecutive non-caret rows a move steps over before it gives up in that direction.
const MAX_NON_CARET_HOPS = 64

export function defaultRtlMoveVisually(platform: 'mac' | 'windows' | 'linux'): boolean {
  return platform !== 'windows'
}

// The position conversion clamps this deliberately unreachable column to the buffer line's end.
const PAST_LINE_END_COLUMN = Number.MAX_SAFE_INTEGER

/**
 * Reads the single line an offset falls on, so caret motion never scales with the file.
 *
 * The cache deliberately spans one command and no longer: several selections moving together
 * usually share a line, while the next command arrives over a snapshot this one cannot see.
 */
export function createNavigationLineReader(
  snapshot: PieceTableSnapshot,
  textSnapshot: TextSnapshot,
): NavigationLineReader {
  let cached: NavigationLine | null = null

  return (offset) => {
    if (cached && offset >= cached.start && offset <= cached.start + cached.text.length) {
      return cached
    }

    const point = offsetToPoint(snapshot, offset)
    const start = offset - point.column
    const end = pointToOffset(snapshot, { row: point.row, column: PAST_LINE_END_COLUMN })
    cached = { start, text: textSnapshot.readRange(start, end) }
    return cached
  }
}

export function navigationTargetForCommand(
  context: NavigationTargetContext,
): NavigationTarget | null {
  const target = commandNavigationTarget(context)
  if (!target) return null

  return atomicTarget(context, caretRowTarget(context, renderedRowTarget(context, target)))
}

/** A move that lands inside an atomic replacement carries on to the edge it was heading for. */
function atomicTarget(
  context: NavigationTargetContext,
  target: NavigationTarget,
): NavigationTarget {
  const ranges = context.atomicRanges
  if (!ranges || ranges.length === 0) return target

  const direction = target.offset < context.resolved.headOffset ? -1 : 1
  const offset = atomicCaretOffset(ranges, target.offset, direction)
  if (offset === target.offset) return target
  return targetAtLogicalOffset(target, offset)
}

/**
 * Steps a target off a row a contribution marks non-caret, such as a diff separator whose label is
 * buffer text, onward in the move's direction; when nothing lies that way it turns back.
 */
function caretRowTarget(
  context: NavigationTargetContext,
  target: NavigationTarget,
): NavigationTarget {
  const nonCaret = context.nonCaretOffset
  if (!nonCaret?.(target.offset)) return target

  const direction = target.offset < context.resolved.headOffset ? -1 : 1
  const offset =
    nearestCaretOffset(context, target, direction, nonCaret) ??
    nearestCaretOffset(context, target, -direction, nonCaret) ??
    context.resolved.headOffset
  return targetAtLogicalOffset(target, offset)
}

function nearestCaretOffset(
  context: NavigationTargetContext,
  target: NavigationTarget,
  direction: number,
  nonCaret: (offset: number) => boolean,
): number | null {
  let offset = target.offset
  for (let hop = 0; hop < MAX_NON_CARET_HOPS; hop += 1) {
    const next = adjacentRowOffset(context.view, target, offset, direction)
    if (next === offset) return null
    if (!nonCaret(next)) return next
    offset = next
  }
  return null
}

/** Vertical moves keep their goal column; a horizontal move enters a row from its near edge. */
function adjacentRowOffset(
  view: NavigationTargetView,
  target: NavigationTarget,
  offset: number,
  direction: number,
): number {
  if (target.goal && target.goal.kind !== 'none') {
    return view.verticalCaretTarget(offset, target.affinity, direction, target.goal).offset
  }
  const rowStart = view.offsetByDisplayRows(offset, direction, 0)
  if (direction > 0) return rowStart
  return view.offsetAtLineBoundary(rowStart, 'end')
}

/**
 * Pulls an offset back onto a row that is drawn.
 *
 * The rows a collapsed region swallowed are drawn nowhere, so the row that answers for an offset on
 * one of them is the region's header, and it ends before that offset does. A caret left beyond that
 * end draws on the header while addressing text no row shows: it reads as a caret that refused to
 * move, and the next keystroke edits where the user cannot watch it happen.
 */
export function renderedRowCaretOffset(view: LineBoundaryView, offset: number): number {
  const rowEnd = view.offsetAtLineBoundary(offset, 'end')
  return rowEnd < offset ? rowEnd : offset
}

/**
 * A move heading forward crosses the whole region rather than stopping on its header, so holding the
 * key keeps making progress through the file. Everything else — and a forward move with no row left
 * beyond the region — settles onto the header, the last row the caret was visibly on.
 */
function renderedRowTarget(
  context: NavigationTargetContext,
  target: NavigationTarget,
): NavigationTarget {
  const rendered = renderedRowCaretOffset(context.view, target.offset)
  if (rendered === target.offset) return target
  if (target.offset <= context.resolved.headOffset) {
    return targetAtLogicalOffset(target, rendered)
  }

  const beyondRegion = context.view.offsetByDisplayRows(target.offset, 1, 0)
  const offset = beyondRegion > target.offset ? beyondRegion : rendered
  return targetAtLogicalOffset(target, offset)
}

function targetAtLogicalOffset(target: NavigationTarget, offset: number): NavigationTarget {
  return { ...target, offset }
}

function commandNavigationTarget(context: NavigationTargetContext): NavigationTarget | null {
  const { command, resolved } = context
  if (command === 'cursorLeft') return horizontalTarget(context, 'left', false)
  if (command === 'cursorRight') return horizontalTarget(context, 'right', false)
  if (command === 'selectLeft') return horizontalTarget(context, 'left', true)
  if (command === 'selectRight') return horizontalTarget(context, 'right', true)
  if (command === 'cursorWordLeft') return wordTarget(context, 'left', false)
  if (command === 'cursorWordRight') return wordTarget(context, 'right', false)
  if (command === 'cursorWordPartLeft') return wordPartTarget(context, 'left', false)
  if (command === 'cursorWordPartRight') return wordPartTarget(context, 'right', false)
  if (command === 'cursorWordPartLeftSelect') return wordPartTarget(context, 'left', true)
  if (command === 'cursorWordPartRightSelect') return wordPartTarget(context, 'right', true)
  if (command === 'selectWordLeft') return wordTarget(context, 'left', true)
  if (command === 'selectWordRight') return wordTarget(context, 'right', true)
  if (command === 'cursorUp') return verticalTarget(context, -1, false, 'input.cursorUp')
  if (command === 'cursorDown') return verticalTarget(context, 1, false, 'input.cursorDown')
  if (command === 'selectUp') return verticalTarget(context, -1, true, 'input.selectUp')
  if (command === 'selectDown') return verticalTarget(context, 1, true, 'input.selectDown')

  return boundaryNavigationTarget(context, resolved)
}

function horizontalTarget(
  context: NavigationTargetContext,
  direction: 'left' | 'right',
  extend: boolean,
): NavigationTarget {
  const { resolved } = context
  const collapsedOffset = direction === 'left' ? resolved.startOffset : resolved.endOffset
  const shouldMoveHead = extend || resolved.collapsed
  const timingName = extend
    ? `input.select${capitalize(direction)}`
    : `input.cursor${capitalize(direction)}`
  if (!shouldMoveHead) {
    return {
      offset: collapsedOffset,
      affinity: logicalHorizontalAffinity(context, collapsedOffset, direction),
      extend,
      timingName,
    }
  }

  if (context.rtlMoveVisually) {
    const target = context.view.visualHorizontalTarget(
      resolved.headOffset,
      resolved.affinity,
      direction,
    )
    if (target) return { ...target, extend, timingName }
  }

  const offset = codePointOffset(context, resolved.headOffset, direction)
  return {
    offset,
    affinity: logicalHorizontalAffinity(context, offset, direction),
    extend,
    timingName,
  }
}

function logicalHorizontalAffinity(
  context: NavigationTargetContext,
  offset: number,
  direction: 'left' | 'right',
): SelectionAffinity {
  if (offset <= 0) return 'after'
  if (offset >= context.documentLength) return 'before'
  return direction === 'left' ? 'after' : 'before'
}

function wordTarget(
  context: NavigationTargetContext,
  direction: 'left' | 'right',
  extend: boolean,
): NavigationTarget {
  // Word and subword commands follow document order under visual character motion, matching Monaco.
  const line = context.readLine(context.resolved.headOffset)
  const column = context.resolved.headOffset - line.start
  const offset =
    direction === 'left'
      ? previousWordOffset(line.text, column, context.wordSeparators)
      : nextWordOffset(line.text, column, context.wordSeparators)
  const target = line.start + offset

  return {
    offset: target,
    affinity: logicalHorizontalAffinity(context, target, direction),
    extend,
    timingName: extend
      ? `input.selectWord${capitalize(direction)}`
      : `input.cursorWord${capitalize(direction)}`,
  }
}

function wordPartTarget(
  context: NavigationTargetContext,
  direction: 'left' | 'right',
  extend: boolean,
): NavigationTarget {
  const line = context.readLine(context.resolved.headOffset)
  const column = context.resolved.headOffset - line.start
  const offset = line.start + wordPartColumn(line.text, column, direction, context.wordSeparators)

  return {
    extend,
    offset,
    affinity: logicalHorizontalAffinity(context, offset, direction),
    timingName: extend
      ? `input.selectWordPart${capitalize(direction)}`
      : `input.cursorWordPart${capitalize(direction)}`,
  }
}

/**
 * Word motion bounds the subword scanner, never the other way round.
 *
 * The scanner only understands identifier shape, so left to itself it walks through whitespace and
 * punctuation hunting for the next camel hump. Taking whichever candidate is nearest the caret
 * lets it shorten a word move but never overshoot one.
 */
function wordPartColumn(
  line: string,
  column: number,
  direction: 'left' | 'right',
  separators: string | undefined,
): number {
  if (direction === 'left') {
    return Math.max(
      previousWordPartOffset(line, column),
      previousWordOffset(line, column, separators),
      previousWordEndOffset(line, column, separators),
    )
  }

  return Math.min(nextWordPartOffset(line, column), nextWordStartOffset(line, column, separators))
}

function verticalTarget(
  context: NavigationTargetContext,
  rowDelta: number,
  extend: boolean,
  timingName: string,
): NavigationTarget {
  const origin = verticalOrigin(context, rowDelta, extend)
  const goal = verticalMoveGoal(context.resolved.goal, origin.offset, origin.affinity, context.view)
  const target = context.view.verticalCaretTarget(origin.offset, origin.affinity, rowDelta, goal)
  return {
    ...target,
    extend,
    goal,
    timingName,
  }
}

/**
 * Up and Down without Shift leave a selection from the edge they are heading towards, the way
 * every native text control does; only an extending move keeps pivoting on the head.
 */
function verticalOrigin(
  context: NavigationTargetContext,
  rowDelta: number,
  extend: boolean,
): { readonly offset: number; readonly affinity: SelectionAffinity } {
  const { resolved } = context
  if (extend || resolved.collapsed) {
    return { offset: resolved.headOffset, affinity: resolved.affinity }
  }
  if (rowDelta < 0) return { offset: resolved.startOffset, affinity: 'after' }
  return { offset: resolved.endOffset, affinity: 'before' }
}

function boundaryNavigationTarget(
  context: NavigationTargetContext,
  resolved: ResolvedSelection,
): NavigationTarget | null {
  const { command } = context
  if (command === 'cursorLineStart') return lineBoundaryTarget(context, 'start', false)
  if (command === 'cursorLineEnd') return lineBoundaryTarget(context, 'end', false)
  if (command === 'selectLineStart') return lineBoundaryTarget(context, 'start', true)
  if (command === 'selectLineEnd') return lineBoundaryTarget(context, 'end', true)
  if (command === 'cursorDocumentStart') return documentBoundaryTarget(context, 'start', false)
  if (command === 'cursorDocumentEnd') return documentBoundaryTarget(context, 'end', false)
  if (command === 'selectDocumentStart') return documentBoundaryTarget(context, 'start', true)
  if (command === 'selectDocumentEnd') return documentBoundaryTarget(context, 'end', true)
  if (command === 'cursorPageUp') return pageTarget(context, resolved, -1, false)
  if (command === 'cursorPageDown') return pageTarget(context, resolved, 1, false)
  if (command === 'selectPageUp') return pageTarget(context, resolved, -1, true)
  if (command === 'selectPageDown') return pageTarget(context, resolved, 1, true)
  return null
}

function lineBoundaryTarget(
  context: NavigationTargetContext,
  boundary: 'start' | 'end',
  extend: boolean,
): NavigationTarget {
  const head = context.resolved.headOffset
  return {
    offset:
      boundary === 'start'
        ? lineStartTargetOffset(context)
        : context.view.offsetAtLineBoundary(head, 'end'),
    affinity: boundary === 'start' ? 'after' : 'before',
    extend,
    goal: boundary === 'end' ? SelectionGoal.lineEnd() : undefined,
    timingName: extend
      ? `input.selectLine${capitalize(boundary)}`
      : `input.cursorLine${capitalize(boundary)}`,
  }
}

/**
 * Home reaches the first non-blank character before it reaches the margin, so the start of an
 * indented statement is one press away and column zero stays one press further.
 *
 * A wrapped continuation row carries no indentation of its own and a blank line has nothing to
 * escalate to, so both offer only their own start.
 */
function lineStartTargetOffset(context: NavigationTargetContext): number {
  const head = context.resolved.headOffset
  const rowStart = context.view.offsetAtLineBoundary(head, 'start')
  const line = context.readLine(head)
  if (rowStart > line.start) return rowStart

  const indent = line.text.search(/\S/u)
  if (indent <= 0) return line.start

  const firstNonBlank = line.start + indent
  return head === firstNonBlank ? line.start : firstNonBlank
}

function documentBoundaryTarget(
  context: NavigationTargetContext,
  boundary: 'start' | 'end',
  extend: boolean,
): NavigationTarget {
  return {
    offset: boundary === 'start' ? 0 : context.documentLength,
    affinity: boundary === 'start' ? 'after' : 'before',
    extend,
    timingName: extend
      ? `input.selectDocument${capitalize(boundary)}`
      : `input.cursorDocument${capitalize(boundary)}`,
  }
}

function pageTarget(
  context: NavigationTargetContext,
  resolved: ResolvedSelection,
  direction: -1 | 1,
  extend: boolean,
): NavigationTarget {
  const rowDelta = direction * context.view.pageRowDelta()
  const goal = verticalMoveGoal(resolved.goal, resolved.headOffset, resolved.affinity, context.view)
  const target = context.view.verticalCaretTarget(
    resolved.headOffset,
    resolved.affinity,
    rowDelta,
    goal,
  )
  return {
    ...target,
    extend,
    goal,
    timingName: pageTimingName(direction, extend),
  }
}

/**
 * Where a vertical move aims, and the goal it hands to the selection it produces.
 *
 * A run of Up/Down presses keeps aiming at its first painted x, so an existing pixel goal outlives
 * the move and only a selection without one measures the caret. Line-end remains a separate logical
 * aim because a logical RTL end need not be the row's visual-right edge.
 */
export function verticalMoveGoal(
  goal: SelectionGoal,
  offset: number,
  affinity: SelectionAffinity,
  view: VerticalCaretView,
): VerticalSelectionGoal {
  switch (goal.kind) {
    case 'horizontal':
      return goal
    case 'lineEnd':
      return goal
    case 'none':
      return { kind: 'horizontal', x: view.caretXForOffset(offset, affinity) }
    default:
      return unhandledSelectionGoal(goal)
  }
}

function unhandledSelectionGoal(goal: never): never {
  throw new Error(`unhandled selection goal: ${JSON.stringify(goal)}`)
}

function pageTimingName(direction: -1 | 1, extend: boolean): string {
  if (extend) return direction < 0 ? 'input.selectPageUp' : 'input.selectPageDown'
  return direction < 0 ? 'input.cursorPageUp' : 'input.cursorPageDown'
}

function codePointOffset(
  context: NavigationTargetContext,
  offset: number,
  direction: 'left' | 'right',
): number {
  const line = context.readLine(offset)
  const column = offset - line.start

  // At either edge the neighbouring character is the line break, which the buffer stores as one
  // character, so stepping over it needs no line of its own to be read.
  if (direction === 'left') {
    if (column === 0) return Math.max(0, offset - 1)
    return line.start + previousCodePointOffset(line.text, column)
  }

  if (column >= line.text.length) return Math.min(context.documentLength, offset + 1)
  return line.start + nextCodePointOffset(line.text, column)
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}
