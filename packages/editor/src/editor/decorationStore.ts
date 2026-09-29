import type { AnchorBias } from '@singapore-editor/textbuffer'
import type { EditorMinimapDecoration } from '../plugins'
import type { TextEdit } from '../tokens'
import type { VirtualizedTextRowDecoration } from '../virtualization/virtualizedTextViewTypes'
import { recordEditorPerformanceDiagnostic } from './performanceDiagnostics'
import type { EditorRangeDecoration } from './types'

/**
 * Where a decoration draws. Each surface is stored on its own, so asking which decorations put
 * something in the gutter of one row never walks the ranges that only tint text.
 */
export type EditorDecorationSurface = 'text' | 'row' | 'minimap'

export type EditorDecorationTextSurface = Omit<EditorRangeDecoration, 'end' | 'start'>

type EditorDecorationRowSurface = VirtualizedTextRowDecoration

type EditorDecorationMinimapSurface = Omit<
  EditorMinimapDecoration,
  'endColumn' | 'endLineNumber' | 'startColumn' | 'startLineNumber'
>

/**
 * A range that knows what to do when the text under its edges changes.
 *
 * The two biases are the whole of that: each endpoint either stays where it is when text arrives
 * there (`left`, sticking to the character before it) or is carried along by it (`right`, sticking
 * to the character after it). The four pairs are the four things a decoration can want — absorb
 * what is typed at both of its edges, at neither, or at exactly one of them.
 *
 * The bias is the piece table's own, so a range tracked here and an anchor tracked in the buffer
 * mean the same thing by `left` and `right` rather than each carrying its own convention.
 */
export type EditorDecorationRange = {
  readonly start: number
  readonly end: number
  readonly startBias: AnchorBias
  readonly endBias: AnchorBias
}

export type EditorDecorationSpec = {
  readonly owner: string
  readonly start: number
  readonly end: number
  readonly startBias?: AnchorBias
  readonly endBias?: AnchorBias
  readonly text?: EditorDecorationTextSurface
  readonly row?: EditorDecorationRowSurface
  readonly minimap?: EditorDecorationMinimapSurface
}

export type EditorDecoration = EditorDecorationRange & {
  readonly id: string
  readonly owner: string
  readonly text?: EditorDecorationTextSurface
  readonly row?: EditorDecorationRowSurface
  readonly minimap?: EditorDecorationMinimapSurface
}

type StoredDecoration = {
  readonly id: string
  readonly owner: string
  readonly startBias: AnchorBias
  readonly endBias: AnchorBias
  readonly text?: EditorDecorationTextSurface
  readonly row?: EditorDecorationRowSurface
  readonly minimap?: EditorDecorationMinimapSurface
  start: number
  end: number
}

/**
 * One surface's decorations ordered by start, with the running maximum end beside them. A query
 * walks back from the last decoration that can start inside the window and stops as soon as that
 * running maximum falls short of it, because nothing earlier reaches any further right.
 */
type DecorationSurfaceIndex = {
  entries: StoredDecoration[]
  maxEnds: number[]
  ordered: boolean
}

const DECORATION_SURFACES = ['text', 'row', 'minimap'] as const

/**
 * A decoration describes text that is already there — a squiggle, a match, a marked line — so by
 * default it keeps its edges out of whatever is typed against them. An owner that wants the
 * opposite says so, per endpoint.
 */
const DEFAULT_START_BIAS: AnchorBias = 'right'
const DEFAULT_END_BIAS: AnchorBias = 'left'

/**
 * Decorations that follow the text on their own, keyed by id and attributed to an owner.
 *
 * Registering is the point: an owner hands a range over once and stops thinking about it, rather
 * than re-deriving every offset it holds after each keystroke. Owners still replace their own set
 * when what they mean has changed — a new word under the caret, a fresh batch of diagnostics — but
 * a plain edit is the store's problem, not theirs.
 */
export class EditorDecorationStore {
  private readonly decorations = new Map<string, StoredDecoration>()
  private readonly surfaces = new Map<EditorDecorationSurface, DecorationSurfaceIndex>()
  /**
   * Owners an edit has moved a decoration of since they last replaced their set. What they last
   * painted describes offsets the document no longer has, so specs that read the same as the stored
   * ones are still a repaint rather than a match.
   */
  private readonly movedOwners = new Set<string>()
  private nextId = 0

  add(spec: EditorDecorationSpec): string {
    validateDecorationSpec(spec)

    const decoration = storedDecoration(`${spec.owner}#${this.nextId}`, spec)
    this.nextId += 1
    this.decorations.set(decoration.id, decoration)
    for (const surface of DECORATION_SURFACES) {
      if (!decoration[surface]) continue

      const index = this.surfaceIndex(surface)
      index.entries.push(decoration)
      index.ordered = false
    }

    return decoration.id
  }

  remove(id: string): boolean {
    const decoration = this.decorations.get(id)
    if (!decoration) return false

    this.decorations.delete(id)
    this.forgetIndexed(new Set([decoration]))
    return true
  }

  /**
   * Swaps everything `owner` holds for `specs` and reports whether anything has to be repainted.
   * Owners recompute on every caret move and every scroll, so most of those calls hand back the set
   * that is already stored, and the answer is what spares them the paint.
   */
  replaceOwner(owner: string, specs: readonly EditorDecorationSpec[]): boolean {
    for (const spec of specs) {
      if (spec.owner !== owner)
        throw new Error('Decoration owner must match the owner replacing it')
    }

    const replaced = new Set<StoredDecoration>()
    for (const decoration of this.decorations.values()) {
      if (decoration.owner === owner) replaced.add(decoration)
    }

    if (!this.movedOwners.has(owner) && sameOwnedDecorations([...replaced], specs)) return false

    this.movedOwners.delete(owner)
    for (const decoration of replaced) this.decorations.delete(decoration.id)
    this.forgetIndexed(replaced)
    for (const spec of specs) this.add(spec)
    return true
  }

  /**
   * Moves every decoration through `edits`, dropping the ones the edits swallowed whole.
   *
   * Every decoration after an edit shifts, so all of them are visited; the indexes only lose their
   * running maxima, which the next query rebuilds.
   */
  applyEdits(edits: readonly TextEdit[]): void {
    if (edits.length === 0) return

    const dropped = new Set<StoredDecoration>()
    for (const decoration of this.decorations.values()) {
      const projected = projectDecorationRangeThroughEdits(decoration, edits)
      if (!projected) {
        this.decorations.delete(decoration.id)
        dropped.add(decoration)
        this.movedOwners.add(decoration.owner)
        continue
      }
      if (projected.start !== decoration.start || projected.end !== decoration.end) {
        this.movedOwners.add(decoration.owner)
      }

      decoration.start = projected.start
      decoration.end = projected.end
    }

    for (const index of this.surfaces.values()) index.ordered = false
    this.forgetIndexed(dropped)
  }

  decorationsInRange(
    surface: EditorDecorationSurface,
    start: number,
    end: number,
  ): readonly EditorDecoration[] {
    const index = this.orderedSurfaceIndex(surface)
    const matched: StoredDecoration[] = []
    let examined = 0

    for (
      let position = firstEntryStartingAfter(index.entries, end) - 1;
      position >= 0;
      position--
    ) {
      examined += 1
      if (index.maxEnds[position]! < start) break

      const entry = index.entries[position]!
      if (entry.end >= start) matched.push(entry)
    }

    matched.reverse()
    recordEditorPerformanceDiagnostic('editor.decorationStore.query', () => ({
      surface,
      examined,
      matched: matched.length,
      stored: index.entries.length,
    }))
    return matched
  }

  clear(): void {
    this.decorations.clear()
    this.surfaces.clear()
    this.movedOwners.clear()
  }

  private forgetIndexed(decorations: ReadonlySet<StoredDecoration>): void {
    if (decorations.size === 0) return

    for (const index of this.surfaces.values()) {
      index.entries = index.entries.filter((entry) => !decorations.has(entry))
      index.ordered = false
    }
  }

  private surfaceIndex(surface: EditorDecorationSurface): DecorationSurfaceIndex {
    const existing = this.surfaces.get(surface)
    if (existing) return existing

    const index: DecorationSurfaceIndex = { entries: [], maxEnds: [], ordered: true }
    this.surfaces.set(surface, index)
    return index
  }

  private orderedSurfaceIndex(surface: EditorDecorationSurface): DecorationSurfaceIndex {
    const index = this.surfaceIndex(surface)
    if (index.ordered) return index

    index.entries.sort(byDecorationOffset)
    index.maxEnds = runningMaxEnds(index.entries)
    index.ordered = true
    return index
  }
}

/**
 * Moves a range through a batch of edits, each endpoint following its own bias.
 *
 * Returns null once the range has lost all of its width: a decoration that described a span of text
 * has nothing left to say when that text is gone. A range registered empty stays empty and keeps
 * its place.
 *
 * Edits address the document as it stood before any of them applied, which is how a transaction
 * reports them, so each one is shifted by the length change of the edits already folded in.
 */
export function projectDecorationRangeThroughEdits(
  range: EditorDecorationRange,
  edits: readonly TextEdit[],
): EditorDecorationRange | null {
  let start = range.start
  let end = range.end
  let delta = 0

  for (const edit of edits.toSorted(byEditOffset)) {
    const from = edit.from + delta
    const to = edit.to + delta
    const insertedLength = edit.text.length
    start = projectDecorationOffset(start, range.startBias, from, to, insertedLength)
    end = projectDecorationOffset(end, range.endBias, from, to, insertedLength)
    delta += insertedLength - (edit.to - edit.from)
  }

  // Biases pointing at opposite sides of one edit can cross the endpoints over each other. The
  // start is the endpoint that says where the decoration is, so the end folds back onto it.
  if (end < start) end = start
  if (end === start && range.end > range.start) return null

  return { ...range, start, end }
}

function projectDecorationOffset(
  offset: number,
  bias: AnchorBias,
  from: number,
  to: number,
  insertedLength: number,
): number {
  if (offset < from) return offset
  if (offset > to) return offset + insertedLength - (to - from)

  // Inside the replaced span the endpoint has no character of its own left to follow, so it lands
  // on the side of the new text its bias names. Where that span is empty — a plain insertion — this
  // is the entire stickiness question: `left` stays put and the text arrives after it, `right` is
  // carried along and the text arrives before it.
  return bias === 'left' ? from : from + insertedLength
}

function storedDecoration(id: string, spec: EditorDecorationSpec): StoredDecoration {
  return {
    id,
    owner: spec.owner,
    start: spec.start,
    end: spec.end,
    startBias: spec.startBias ?? DEFAULT_START_BIAS,
    endBias: spec.endBias ?? DEFAULT_END_BIAS,
    ...(spec.text === undefined ? {} : { text: spec.text }),
    ...(spec.row === undefined ? {} : { row: spec.row }),
    ...(spec.minimap === undefined ? {} : { minimap: spec.minimap }),
  }
}

function validateDecorationSpec(spec: EditorDecorationSpec): void {
  if (spec.owner.length === 0) throw new Error('Decoration owner is required')
  if (!Number.isInteger(spec.start) || !Number.isInteger(spec.end)) {
    throw new Error('Decoration offsets must be integers')
  }
  if (spec.end < spec.start) throw new Error('Decoration end must be at or after its start')
  // A decoration on no surface would be tracked forever and found by nobody.
  if (DECORATION_SURFACES.some((surface) => spec[surface])) return

  throw new Error('Decoration must declare at least one surface')
}

/**
 * Owners re-supply the same surface payloads frame after frame, so those compare by identity; only
 * the range and its biases are read for a difference.
 */
function sameOwnedDecorations(
  decorations: readonly StoredDecoration[],
  specs: readonly EditorDecorationSpec[],
): boolean {
  if (decorations.length !== specs.length) return false

  return decorations.every((decoration, index) => {
    const spec = specs[index]
    if (!spec) return false
    if (decoration.start !== spec.start) return false
    if (decoration.end !== spec.end) return false
    if (decoration.startBias !== (spec.startBias ?? DEFAULT_START_BIAS)) return false
    if (decoration.endBias !== (spec.endBias ?? DEFAULT_END_BIAS)) return false
    if (decoration.text !== spec.text) return false
    if (decoration.row !== spec.row) return false

    return decoration.minimap === spec.minimap
  })
}

function runningMaxEnds(entries: readonly StoredDecoration[]): number[] {
  const maxEnds: number[] = []
  let maxEnd = Number.NEGATIVE_INFINITY

  for (const entry of entries) {
    maxEnd = Math.max(maxEnd, entry.end)
    maxEnds.push(maxEnd)
  }

  return maxEnds
}

function firstEntryStartingAfter(entries: readonly StoredDecoration[], offset: number): number {
  let low = 0
  let high = entries.length

  while (low < high) {
    const middle = (low + high) >>> 1
    if (entries[middle]!.start <= offset) low = middle + 1
    else high = middle
  }

  return low
}

function byDecorationOffset(left: StoredDecoration, right: StoredDecoration): number {
  return left.start - right.start || left.end - right.end || left.id.localeCompare(right.id)
}

function byEditOffset(left: TextEdit, right: TextEdit): number {
  return left.from - right.from || left.to - right.to
}
