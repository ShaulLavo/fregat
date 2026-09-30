import { createFoldMap } from '../foldMap'
import {
  anchorAfter,
  anchorBefore,
  offsetToPoint,
  type PieceTableSnapshot,
  resolveAnchor,
} from '@singapore-editor/textbuffer'

import type { FoldRange } from '../syntax/session'
import type {
  VirtualizedFoldMarker,
  VirtualizedTextView,
} from '../virtualization/virtualizedTextView'
import type { EditorDisplayProjection } from './displayProjectionRegistry'
import { EMPTY_FOLD_MARKERS, foldMarkerFromRange, foldRangeKey, foldRangesEqual } from './folds'
import { collapsedFoldsHidingRow, foldSpanHidesRow } from './foldOperations'
import type { IndentationFoldIndex } from './indentationFoldIndex'
import type { FoldMarkerSource } from '../virtualization/foldMarkerSource'
import type { EditorCollapsedRegion } from '../viewFolds'

type FoldView = Pick<VirtualizedTextView, 'setFoldState' | 'setIndexedFoldState'>
type FoldDisplayProjection = EditorDisplayProjection<'folds'>

/**
 * What the user collapsed, expressed in terms that survive editing: the buffer positions the
 * region's first and last character are pinned to, and how many rows it covered when it was
 * collapsed. Recording offsets instead would lose the collapse on the next parse, because every
 * edit anywhere earlier in the document renumbers them.
 */
type CollapsedRegion = EditorCollapsedRegion

type ResolvedCollapsedRegion = {
  readonly region: CollapsedRegion
  readonly startRow: number
  readonly endRow: number
}

/** A range that could carry a collapse recorded on its header row, and how far their extents differ. */
type CollapseInheritance = {
  readonly fold: FoldRange
  readonly entry: ResolvedCollapsedRegion
  readonly rowSpanDelta: number
}

/**
 * The collapses an incoming set of ranges carries, and the ones it took away: a collapse no range
 * carries is one no gesture can reach, so a collapse withheld here is withheld for good.
 */
type CollapseInheritanceResult = {
  readonly byFoldKey: Map<string, CollapsedRegion>
  readonly withheld: ReadonlySet<CollapsedRegion>
}

/** Where a fold or a rendered marker says a region begins and how far it reaches. */
type CollapseTarget = {
  readonly key: string
  readonly startOffset: number
  readonly endOffset: number
  readonly rowSpan: number
}

const EMPTY_FOLDS: readonly FoldRange[] = []

export class EditorFoldState {
  private readonly view: FoldView
  private readonly getSnapshot: () => PieceTableSnapshot | null
  private readonly getCaretRows: () => readonly number[]
  private projectedFolds: readonly FoldRange[] = EMPTY_FOLDS
  private indexedFolds: IndentationFoldIndex | null = null
  private inheritedFolds: readonly FoldRange[] = EMPTY_FOLDS
  private collapsedRegions: CollapsedRegion[] = []
  private collapsedRegionsByFoldKey = new Map<string, CollapsedRegion>()

  public constructor(
    view: FoldView,
    getSnapshot: () => PieceTableSnapshot | null,
    getCaretRows: () => readonly number[],
    private readonly onCollapsedRegionsChange?: (regions: readonly CollapsedRegion[]) => void,
  ) {
    this.view = view
    this.getSnapshot = getSnapshot
    this.getCaretRows = getCaretRows
  }

  public get folds(): readonly FoldRange[] {
    if (!this.indexedFolds) return this.projectedFolds
    return [...this.indexedFolds.all(), ...this.projectedFolds]
  }

  public ranges(startRow: number, endRow: number): readonly FoldRange[] {
    const contributed = this.projectedFolds.filter(
      (fold) => fold.startLine <= endRow && fold.endLine >= startRow,
    )
    if (!this.indexedFolds) return contributed
    return [...this.indexedFolds.ranges(startRow, endRow), ...contributed]
  }

  public get collapsedFoldCount(): number {
    return this.collapsedRegionsByFoldKey.size
  }

  public setFoldProjections(
    projections: readonly FoldDisplayProjection[],
    index: IndentationFoldIndex | null = null,
  ): void {
    const folds = foldRangesFromProjections(projections)
    if (this.indexedFolds === index && foldRangesEqual(this.projectedFolds, folds)) return

    this.indexedFolds = index
    this.adoptFolds(folds)
  }

  public clear(): void {
    this.projectedFolds = EMPTY_FOLDS
    this.indexedFolds = null
    this.inheritedFolds = EMPTY_FOLDS
    this.collapsedRegions = []
    this.collapsedRegionsByFoldKey = new Map()
    this.view.setFoldState(EMPTY_FOLD_MARKERS, null)
  }

  public restore(regions: readonly CollapsedRegion[]): void {
    this.collapsedRegions = regions.slice()
    this.adoptFolds(this.projectedFolds)
  }

  public toggle(marker: VirtualizedFoldMarker): boolean {
    return this.toggleTarget(collapseTargetFromMarker(marker))
  }

  public toggleFold(fold: FoldRange): boolean {
    return this.toggleTarget(collapseTargetFromFold(fold))
  }

  public fold(fold: FoldRange): boolean {
    if (!this.collapseTarget(collapseTargetFromFold(fold))) return false

    this.syncFoldView()
    return true
  }

  public unfold(fold: FoldRange): boolean {
    if (!this.expandFoldKey(foldRangeKey(fold))) return false

    this.syncFoldView()
    return true
  }

  public foldAll(): boolean {
    let collapsed = false
    for (const fold of this.folds) {
      if (this.collapseTarget(collapseTargetFromFold(fold))) collapsed = true
    }
    if (collapsed) this.syncFoldView()

    return collapsed
  }

  /**
   * Opens whatever is hiding `row`, and reports how many regions that took.
   *
   * One pass over the whole set rather than one call per region: several nested regions can be closed
   * over the same row, and each of them opening the view separately would draw rows that are about to
   * move again.
   */
  public revealRow(row: number): number {
    let expanded = 0
    for (const fold of collapsedFoldsHidingRow(
      this.inheritedFolds,
      (candidate) => this.isCollapsed(candidate),
      row,
    )) {
      if (this.expandFoldKey(foldRangeKey(fold))) expanded += 1
    }
    if (expanded > 0) this.syncFoldView()

    return expanded
  }

  public unfoldAll(): boolean {
    if (this.collapsedRegions.length === 0) return false

    this.collapsedRegions = []
    this.collapsedRegionsByFoldKey = new Map()
    this.syncFoldView()
    return true
  }

  public isCollapsed(fold: FoldRange): boolean {
    return this.collapsedRegionsByFoldKey.has(foldRangeKey(fold))
  }

  /**
   * A fresh set of ranges says nothing about what the user collapsed, so the collapse store is
   * re-read against the buffer and matched onto the new ranges. A region the ranges no longer
   * mention is kept: providers hand us ranges for the parsed window, and a region can also be
   * described differently by whichever provider answered, neither of which is the user expanding it.
   */
  private adoptFolds(folds: readonly FoldRange[]): void {
    const snapshot = this.getSnapshot()
    const resolved = snapshot ? liveCollapsedRegions(snapshot, this.collapsedRegions) : []
    this.projectedFolds = folds
    const candidates = this.collapseCandidates(resolved)
    const inheritance = inheritCollapsedRegions(candidates, resolved, this.getCaretRows)
    this.collapsedRegions = resolved
      .map((entry) => entry.region)
      .filter((region) => !inheritance.withheld.has(region))
    this.collapsedRegionsByFoldKey = inheritance.byFoldKey
    this.inheritedFolds = candidates.filter((fold) => this.isCollapsed(fold))
    this.syncFoldView()
  }

  private collapseCandidates(resolved: readonly ResolvedCollapsedRegion[]): readonly FoldRange[] {
    if (resolved.length === 0) return EMPTY_FOLDS
    if (!this.indexedFolds) return this.projectedFolds
    const rows = new Set(resolved.map((entry) => entry.startRow))
    const candidates: FoldRange[] = []
    for (const row of rows) {
      candidates.push(...this.indexedFolds.headers(row, row))
      candidates.push(...this.projectedFolds.filter((fold) => fold.startLine === row))
    }
    return candidates
  }

  private toggleTarget(target: CollapseTarget): boolean {
    const toggled = this.expandFoldKey(target.key) || this.collapseTarget(target)
    if (toggled) this.syncFoldView()

    return toggled
  }

  private collapseTarget(target: CollapseTarget): boolean {
    if (this.collapsedRegionsByFoldKey.has(target.key)) return false

    const snapshot = this.getSnapshot()
    if (!snapshot) return false

    const region = anchorCollapsedRegion(snapshot, target)
    this.collapsedRegions.push(region)
    this.collapsedRegionsByFoldKey.set(target.key, region)
    return true
  }

  private expandFoldKey(key: string): boolean {
    const region = this.collapsedRegionsByFoldKey.get(key)
    if (!region) return false

    this.collapsedRegionsByFoldKey.delete(key)
    this.collapsedRegions = this.collapsedRegions.filter((candidate) => candidate !== region)
    return true
  }

  private syncFoldView(): void {
    // Session state can seed another view; its array must outlive this renderer's next fold.
    this.onCollapsedRegionsChange?.(this.collapsedRegions.slice())
    const snapshot = this.getSnapshot()
    if (!snapshot || (this.projectedFolds.length === 0 && !this.indexedFolds?.count)) {
      this.view.setFoldState(EMPTY_FOLD_MARKERS, null)
      return
    }

    const resolved = liveCollapsedRegions(snapshot, this.collapsedRegions)
    const collapsedFolds = this.collapseCandidates(resolved).filter((fold) =>
      this.isCollapsed(fold),
    )
    this.inheritedFolds = collapsedFolds
    const foldMap = collapsedFolds.length > 0 ? createFoldMap(snapshot, collapsedFolds) : null
    if (this.indexedFolds) {
      this.view.setIndexedFoldState(this.markerSource(), foldMap)
      return
    }
    this.view.setFoldState(this.markers(), foldMap)
  }

  private markers(): readonly VirtualizedFoldMarker[] {
    return this.folds
      .map((fold) => foldMarkerFromRange(fold, this.isCollapsed(fold)))
      .sort((left, right) => left.startRow - right.startRow || left.endRow - right.endRow)
  }

  private markerSource(): FoldMarkerSource {
    const index = this.indexedFolds
    const contributed = this.projectedFolds
    const collapsedKeys = new Set(this.collapsedRegionsByFoldKey.keys())
    let markers: readonly VirtualizedFoldMarker[] | undefined
    return {
      size: (index?.count ?? 0) + contributed.length,
      readRows: (rows) => indexedMarkersForRows(index, contributed, collapsedKeys, rows),
      all: () => {
        markers ??= [...(index?.all() ?? EMPTY_FOLDS), ...contributed]
          .map((fold) => foldMarkerFromRange(fold, collapsedKeys.has(foldRangeKey(fold))))
          .sort((left, right) => left.startRow - right.startRow || left.endRow - right.endRow)
        return markers
      },
    }
  }
}

function indexedMarkersForRows(
  index: IndentationFoldIndex | null,
  contributed: readonly FoldRange[],
  collapsedKeys: ReadonlySet<string>,
  rows: readonly number[],
): ReadonlyMap<number, VirtualizedFoldMarker> {
  const requested = new Set(rows)
  const nearest = new Map<number, FoldRange>()
  for (const run of foldHeaderRuns(requested)) {
    for (const fold of index?.headers(run.start, run.end) ?? EMPTY_FOLDS) {
      retainNearestFold(nearest, fold)
    }
  }
  for (const fold of contributed) {
    if (!requested.has(fold.startLine)) continue
    retainNearestFold(nearest, fold)
  }
  const markers = new Map<number, VirtualizedFoldMarker>()
  for (const [row, fold] of nearest) {
    markers.set(row, foldMarkerFromRange(fold, collapsedKeys.has(foldRangeKey(fold))))
  }
  return markers
}

function foldHeaderRuns(rows: ReadonlySet<number>): Array<{ start: number; end: number }> {
  const runs: Array<{ start: number; end: number }> = []
  for (const row of [...rows].sort((left, right) => left - right)) {
    const previous = runs.at(-1)
    if (previous && previous.end + 1 === row) {
      previous.end = row
      continue
    }
    runs.push({ start: row, end: row })
  }
  return runs
}

function retainNearestFold(nearest: Map<number, FoldRange>, fold: FoldRange): void {
  const previous = nearest.get(fold.startLine)
  if (previous && previous.endLine <= fold.endLine) return
  nearest.set(fold.startLine, fold)
}

function foldRangesFromProjections(
  projections: readonly FoldDisplayProjection[],
): readonly FoldRange[] {
  if (projections.length === 0) return EMPTY_FOLDS

  const folds: FoldRange[] = []
  for (const projection of projections) folds.push(...projection.value)
  return folds
}

function collapseTargetFromFold(fold: FoldRange): CollapseTarget {
  return {
    key: foldRangeKey(fold),
    startOffset: fold.startIndex,
    endOffset: fold.endIndex,
    rowSpan: fold.endLine - fold.startLine,
  }
}

function collapseTargetFromMarker(marker: VirtualizedFoldMarker): CollapseTarget {
  return {
    key: marker.key,
    startOffset: marker.startOffset,
    endOffset: marker.endOffset,
    rowSpan: marker.endRow - marker.startRow,
  }
}

function anchorCollapsedRegion(
  snapshot: PieceTableSnapshot,
  target: CollapseTarget,
): CollapsedRegion {
  const startOffset = clampOffset(snapshot, target.startOffset)
  const endOffset = clampOffset(snapshot, target.endOffset)

  return {
    // Biased inwards, onto the characters that delimit the region, so text typed against either
    // edge falls outside it — the same answer the next parse gives for the same insertion.
    start: anchorAfter(snapshot, startOffset),
    end: anchorBefore(snapshot, endOffset),
    rowSpan: target.rowSpan,
  }
}

function liveCollapsedRegions(
  snapshot: PieceTableSnapshot,
  regions: readonly CollapsedRegion[],
): readonly ResolvedCollapsedRegion[] {
  const resolved: ResolvedCollapsedRegion[] = []

  for (const region of regions) {
    const start = resolveAnchor(snapshot, region.start)
    const end = resolveAnchor(snapshot, region.end)
    // The text the region was pinned to has been deleted, so the region went with it.
    if (start.liveness !== 'live' || end.liveness !== 'live') continue
    if (end.offset <= start.offset) continue

    resolved.push({
      region,
      startRow: offsetToPoint(snapshot, start.offset).row,
      endRow: offsetToPoint(snapshot, end.offset).row,
    })
  }

  return resolved
}

/**
 * Matches collapsed regions onto incoming ranges by row rather than by offset, because two providers
 * describing the same region disagree about where on the header row it starts — and about where it
 * ends, since indentation stops at the last indented row while a grammar carries on to the closing
 * delimiter. A region restated is still the region the user collapsed.
 */
function inheritCollapsedRegions(
  folds: readonly FoldRange[],
  resolved: readonly ResolvedCollapsedRegion[],
  getCaretRows: () => readonly number[],
): CollapseInheritanceResult {
  const inherited = new Map<string, CollapsedRegion>()
  const withheld = new Set<CollapsedRegion>()
  if (resolved.length === 0) return { byFoldKey: inherited, withheld }

  const caretRows = getCaretRows()
  const regionsByStartRow = groupByStartRow(resolved, (entry) => entry.startRow)
  const foldsByStartRow = groupByStartRow(
    folds.filter((fold) => regionsByStartRow.has(fold.startLine)),
    (fold) => fold.startLine,
  )

  for (const [row, regions] of regionsByStartRow) {
    for (const pair of pairedByNearestRowSpan(foldsByStartRow.get(row) ?? EMPTY_FOLDS, regions)) {
      if (reachesOverCaret(pair, caretRows)) {
        withheld.add(pair.entry.region)
        continue
      }

      inherited.set(foldRangeKey(pair.fold), pair.entry.region)
    }
  }

  return { byFoldKey: inherited, withheld }
}

/**
 * Whether taking the collapse onto the restated range would hide a row the reader is on that the
 * collapse was not already hiding.
 *
 * A parse lands whenever it lands, and a region that has grown since the reader collapsed it must not
 * take the row they are working on with it — they asked for the region they saw, not for this one. A
 * row already inside it stays inside: that is a region folded around the caret on purpose, by Fold All
 * or by a fold aimed elsewhere, and reopening it on the next parse would be the editor undoing them.
 */
function reachesOverCaret(pair: CollapseInheritance, caretRows: readonly number[]): boolean {
  return caretRows.some(
    (row) =>
      foldSpanHidesRow(pair.fold.startLine, pair.fold.endLine, row) &&
      !foldSpanHidesRow(pair.entry.startRow, pair.entry.endRow, row),
  )
}

/**
 * Pairs one row's ranges against its collapses, closest agreement about the number of rows covered
 * first, setting both sides aside once paired.
 *
 * Order alone would let whichever range a provider listed first take a collapse that describes
 * another. Leaving a collapse available after pairing would close two ranges at once; leaving a range
 * available would bind it to a collapse it does not answer for, which then shuts the region again the
 * moment the user opens it.
 */
function pairedByNearestRowSpan(
  folds: readonly FoldRange[],
  regions: readonly ResolvedCollapsedRegion[],
): readonly CollapseInheritance[] {
  const candidates = folds.flatMap((fold) =>
    regions.map((entry) => ({
      fold,
      entry,
      rowSpanDelta: Math.abs(entry.region.rowSpan - (fold.endLine - fold.startLine)),
    })),
  )

  const paired: CollapseInheritance[] = []
  const takenFolds = new Set<FoldRange>()
  const takenRegions = new Set<ResolvedCollapsedRegion>()
  for (const candidate of candidates.toSorted((a, b) => a.rowSpanDelta - b.rowSpanDelta)) {
    if (takenFolds.has(candidate.fold) || takenRegions.has(candidate.entry)) continue

    takenFolds.add(candidate.fold)
    takenRegions.add(candidate.entry)
    paired.push(candidate)
  }

  return paired
}

function groupByStartRow<T>(items: readonly T[], startRow: (item: T) => number): Map<number, T[]> {
  const byStartRow = new Map<number, T[]>()

  for (const item of items) {
    const row = byStartRow.get(startRow(item))
    if (row) {
      row.push(item)
      continue
    }
    byStartRow.set(startRow(item), [item])
  }

  return byStartRow
}

function clampOffset(snapshot: PieceTableSnapshot, offset: number): number {
  return Math.max(0, Math.min(offset, snapshot.length))
}
