// Modified for Platform from Pierre. Apache-2.0; see LICENSE-pierre and UPSTREAM.md.
import type { PathStore } from '../path-store/store'
import type {
  PathStoreVisibleAncestorRow,
  PathStoreVisibleRowContext,
  PathStoreVisibleRow as PathStoreVisibleRowData,
} from '../path-store/public-types'
import { createTreeError } from '../structured-errors'

import type { FileTreeStickyRowCandidate } from './internal-types'
import { ancestorDirectoryPaths } from '@workspace/utils/slash-paths'
import type { FileTreeVisibleRow } from './public-types'
import { createVisibleProjection, type ProjectionIndexBuffer } from './visible-projection-data'

// Initial render only mounts a tiny viewport slice, so controller startup can
// cap its first projection build and defer the full 494k-row metadata walk
// until the user actually navigates outside that initial window.
const INITIAL_PROJECTION_ROW_LIMIT = 512
const CONTEXT_VISIBLE_ROW_RANGE_LIMIT = 512

export interface VisibleProjectionHost {
  ensureFull(): void
  isFocused(path: string): boolean
  isSelected(path: string): boolean
  store(): PathStore
}

// The rows the view can show: the store's expanded projection, narrowed to the
// filter's visible set while a hide-non-matches filter has matches.
export class VisibleProjection {
  readonly #host: VisibleProjectionHost
  #ancestorIndicesByIndex = new Map<number, readonly number[]>()
  #ancestorPathsByIndex = new Map<number, readonly string[]>()
  #filteredIndexByPath: Map<string, number> | null = null
  #filteredIndices: readonly number[] | null = null
  #filteredPaths: readonly string[] | null = null
  #getParentIndex = (_index: number): number => -1
  #hasFull = false
  #paths: readonly string[] = []
  #posInSetByIndex: ProjectionIndexBuffer = new Int32Array(0)
  #setSizeByIndex: ProjectionIndexBuffer = new Int32Array(0)
  #storeVisibleCount = 0
  #visibleCount = 0

  public constructor(host: VisibleProjectionHost) {
    this.#host = host
  }

  public get count(): number {
    return this.#visibleCount
  }

  public get hasFull(): boolean {
    return this.#hasFull
  }

  public get isFiltered(): boolean {
    return this.#filteredIndices != null
  }

  // True when `index` lies past a partial projection and needs the full walk.
  public needsFullFor(index: number): boolean {
    return !this.#hasFull && index >= this.#paths.length
  }

  // Rebuilds the projection and returns the focused index for the candidate.
  public rebuild(
    focusedPathCandidate: string | null,
    full: boolean,
    filter: ReadonlySet<string> | null,
  ): number {
    const store = this.#host.store()
    const rawVisibleCount = store.getVisibleCount()
    this.#storeVisibleCount = rawVisibleCount
    const projectionData = store.getVisibleTreeProjectionData(
      full ? undefined : Math.min(rawVisibleCount, INITIAL_PROJECTION_ROW_LIMIT),
    )
    const projection = createVisibleProjection(
      projectionData,
      focusedPathCandidate,
      full ? (path) => store.getVisibleIndex(path) : undefined,
    )
    this.#ancestorIndicesByIndex.clear()
    this.#ancestorPathsByIndex.clear()
    this.#hasFull = projection.paths.length >= rawVisibleCount
    this.#getParentIndex = projection.getParentIndex
    this.#paths = projection.paths
    this.#posInSetByIndex = projection.posInSetByIndex
    this.#setSizeByIndex = projection.setSizeByIndex
    this.#applyFilter(filter)
    if (this.#filteredIndices == null) {
      return projection.focusedIndex
    }
    if (focusedPathCandidate != null) {
      return this.resolveFocusedIndex(focusedPathCandidate)
    }
    return this.paths().length > 0 ? 0 : -1
  }

  public paths(): readonly string[] {
    return this.#filteredPaths ?? this.#paths
  }

  public exactIndexOf(path: string): number {
    if (this.#filteredPaths != null) {
      return this.#filteredIndexByPath?.get(path) ?? -1
    }

    return this.#host.store().getVisibleIndex(path) ?? -1
  }

  public indexOf(path: string): number {
    const filteredIndex = this.#filteredIndexByPath?.get(path)
    if (filteredIndex != null) {
      return filteredIndex
    }

    return this.#host.store().getVisibleIndex(path) ?? -1
  }

  public pathAt(index: number): string | null {
    const projectedPath = this.paths()[index]
    if (projectedPath != null) {
      return projectedPath
    }

    if (this.#filteredIndices != null) {
      return null
    }

    return this.#host.store().getVisibleRowContext(index)?.row.path ?? null
  }

  public resolveFocusedIndex(path: string): number {
    const directIndex = this.indexOf(path)
    if (directIndex !== -1) {
      return directIndex
    }

    const ancestorPaths = ancestorDirectoryPaths(path)
    for (let index = ancestorPaths.length - 1; index >= 0; index -= 1) {
      const ancestorPath = ancestorPaths[index]
      if (ancestorPath == null) {
        continue
      }

      const ancestorIndex = this.indexOf(ancestorPath)
      if (ancestorIndex !== -1) {
        return ancestorIndex
      }
    }

    return this.paths().length > 0 ? 0 : -1
  }

  public rows(start: number, end: number): readonly FileTreeVisibleRow[] {
    if (end < start || this.#visibleCount === 0) {
      return []
    }

    const boundedStart = Math.max(0, start)
    const boundedEnd = Math.min(this.#visibleCount - 1, end)
    if (boundedEnd < boundedStart) {
      return []
    }

    const boundedLength = boundedEnd - boundedStart + 1
    if (
      this.#filteredIndices == null &&
      !this.#hasFull &&
      boundedEnd >= this.#paths.length &&
      boundedLength <= CONTEXT_VISIBLE_ROW_RANGE_LIMIT
    ) {
      return this.#rowsFromContext(boundedStart, boundedEnd)
    }

    if (this.needsFullFor(boundedEnd)) {
      this.#host.ensureFull()
    }

    if (this.#filteredIndices != null) {
      return this.#filteredRows(boundedStart, boundedEnd)
    }

    return this.#host
      .store()
      .getVisibleSlice(boundedStart, boundedEnd)
      .map((row, offset) => {
        const index = boundedStart + offset
        const projectionPath = this.#paths[index]
        if (projectionPath == null) {
          throw createTreeError(`Missing projection path for visible index ${String(index)}`)
        }

        return this.#createRow(row, index, index, {
          ancestorPaths: this.#getAncestorPaths(index),
          path: projectionPath,
        })
      })
  }

  public stickyCandidates(
    scrollTop: number,
    itemHeight: number,
  ): readonly FileTreeStickyRowCandidate[] | null {
    if (this.#filteredIndices != null) {
      return null
    }

    if (this.#visibleCount === 0 || scrollTop <= 0 || itemHeight <= 0) {
      return []
    }

    const stickyRows: FileTreeStickyRowCandidate[] = []
    for (let slotDepth = 0; slotDepth < this.#visibleCount; slotDepth += 1) {
      const slotTop = scrollTop + slotDepth * itemHeight
      const thresholdIndex = Math.min(this.#visibleCount - 1, Math.floor(slotTop / itemHeight))
      const candidateContext =
        this.#stickyCandidateContextAt(thresholdIndex, slotDepth) ??
        (thresholdIndex > 0
          ? this.#stickyCandidateContextAt(thresholdIndex - 1, slotDepth)
          : undefined)
      if (candidateContext == null) {
        break
      }

      stickyRows.push({
        row: this.#createRowFromContext(candidateContext),
        subtreeEndIndex: candidateContext.subtreeEndIndex,
      })
    }

    return stickyRows
  }

  #applyFilter(filter: ReadonlySet<string> | null): void {
    if (filter == null) {
      this.#filteredIndices = null
      this.#filteredPaths = null
      this.#filteredIndexByPath = null
      this.#visibleCount = this.#storeVisibleCount
      return
    }

    const visibleIndices: number[] = []
    const visiblePaths: string[] = []
    const visibleIndexByPath = new Map<string, number>()
    for (const [index, path] of this.#paths.entries()) {
      if (!filter.has(path)) {
        continue
      }

      visibleIndexByPath.set(path, visiblePaths.length)
      visibleIndices.push(index)
      visiblePaths.push(path)
    }

    this.#filteredIndices = visibleIndices
    this.#filteredPaths = visiblePaths
    this.#filteredIndexByPath = visibleIndexByPath
    this.#visibleCount = visiblePaths.length
  }

  #rowsFromContext(start: number, end: number): readonly FileTreeVisibleRow[] {
    const rows: FileTreeVisibleRow[] = []
    for (let index = start; index <= end; index += 1) {
      const context = this.#host.store().getVisibleRowContext(index)
      if (context == null) {
        break
      }

      rows.push(this.#createRowFromContext(context))
    }
    return rows
  }

  #filteredRows(start: number, end: number): readonly FileTreeVisibleRow[] {
    const store = this.#host.store()
    const projectionIndices = Array.from({ length: end - start + 1 }, (_, visibleOffset) =>
      this.#projectionIndexAt(start + visibleOffset),
    )
    const visibleRowByProjectionIndex = new Map<number, PathStoreVisibleRowData>()
    let runStartIndex = projectionIndices[0] ?? -1
    let runEndIndex = runStartIndex
    for (let index = 1; index <= projectionIndices.length; index += 1) {
      const projectionIndex = projectionIndices[index]
      if (projectionIndex != null && projectionIndex === runEndIndex + 1) {
        runEndIndex = projectionIndex
        continue
      }

      if (runStartIndex >= 0) {
        const visibleSlice = store.getVisibleSlice(runStartIndex, runEndIndex)
        visibleSlice.forEach((row, offset) => {
          visibleRowByProjectionIndex.set(runStartIndex + offset, row)
        })
      }

      if (projectionIndex == null) {
        runStartIndex = -1
        runEndIndex = -1
        continue
      }

      runStartIndex = projectionIndex
      runEndIndex = projectionIndex
    }

    return Array.from({ length: end - start + 1 }, (_, visibleOffset) => {
      const visibleIndex = start + visibleOffset
      const projectionIndex = this.#projectionIndexAt(visibleIndex)
      const row = visibleRowByProjectionIndex.get(projectionIndex)
      const projectionPath = this.#paths[projectionIndex]
      if (row == null || projectionPath == null) {
        throw createTreeError(
          `Missing projection row for filtered visible index ${String(visibleIndex)}`,
        )
      }

      return this.#createRow(row, visibleIndex, projectionIndex, {
        ancestorPaths: this.#getAncestorPaths(projectionIndex),
        path: projectionPath,
      })
    })
  }

  #projectionIndexAt(index: number): number {
    return this.#filteredIndices?.[index] ?? index
  }

  #createRow(
    row: PathStoreVisibleRowData,
    visibleIndex: number,
    projectionIndex: number,
    projection: {
      ancestorPaths: readonly string[]
      path: string
      posInSet?: number
      setSize?: number
    },
  ): FileTreeVisibleRow {
    return {
      ancestorPaths: projection.ancestorPaths,
      depth: row.depth,
      flattenedSegments: row.flattenedSegments?.map((segment) => ({
        isTerminal: segment.isTerminal,
        name: segment.name,
        path: segment.path,
      })),
      hasChildren: row.hasChildren,
      index: visibleIndex,
      isExpanded: row.isExpanded,
      isFlattened: row.isFlattened,
      isFocused: this.#host.isFocused(projection.path),
      isSelected: this.#host.isSelected(projection.path),
      kind: row.kind,
      level: row.depth,
      name: row.name,
      path: projection.path,
      posInSet: projection.posInSet ?? this.#posInSetByIndex[projectionIndex] ?? 0,
      setSize: projection.setSize ?? this.#setSizeByIndex[projectionIndex] ?? 0,
    }
  }

  #createRowFromContext(
    context: PathStoreVisibleRowContext | PathStoreVisibleAncestorRow,
  ): FileTreeVisibleRow {
    return this.#createRow(context.row, context.index, context.index, {
      ancestorPaths: context.ancestorPaths,
      path: context.row.path,
      posInSet: context.posInSet,
      setSize: context.setSize,
    })
  }

  #stickyCandidateContextAt(
    index: number,
    slotDepth: number,
  ): PathStoreVisibleRowContext | PathStoreVisibleAncestorRow | undefined {
    const context = this.#host.store().getVisibleRowContext(index)
    if (context == null) {
      return undefined
    }

    const ancestorRow = context.ancestorRows[slotDepth]
    if (ancestorRow != null) {
      return ancestorRow
    }

    return slotDepth === context.ancestorRows.length &&
      context.row.kind === 'directory' &&
      context.row.isExpanded
      ? context
      : undefined
  }

  #getAncestorIndices(index: number): readonly number[] {
    const cached = this.#ancestorIndicesByIndex.get(index)
    if (cached != null) {
      return cached
    }

    const parentIndex = this.#getParentIndex(index)
    const ancestorIndices =
      parentIndex < 0 ? [] : [...this.#getAncestorIndices(parentIndex), parentIndex]
    this.#ancestorIndicesByIndex.set(index, ancestorIndices)
    return ancestorIndices
  }

  #getAncestorPaths(index: number): readonly string[] {
    const cached = this.#ancestorPathsByIndex.get(index)
    if (cached != null) {
      return cached
    }

    const ancestorPaths = this.#getAncestorIndices(index)
      .map((ancestorIndex) => this.#paths[ancestorIndex] ?? '')
      .filter((path) => path !== '')
    this.#ancestorPathsByIndex.set(index, ancestorPaths)
    return ancestorPaths
  }
}
