// Modified for Platform from Pierre. Apache-2.0; see LICENSE-pierre and UPSTREAM.md.
import { PathStore } from '../path-store/store'
import type { FileTreePreparedInput } from '../prepared-input'

import { Drag, type DragSessionView } from './drag-session'
import { Expansion } from './expansion'
import { Focus } from './focus'
import { resolveFileTreeInput } from './input-resolution'
import type {
  FileTreeControllerListener,
  FileTreeScrollRequest,
  FileTreeStickyRowCandidate,
} from './internal-types'
import { ItemHandles } from './item-handles'
import { KnownPaths } from './known-paths'
import {
  isPathMutationEvent,
  remapPathThroughMutation,
  toTreesMutationEvent,
} from './mutation-events'
import { MutationListeners } from './mutation-listeners'
import type {
  FileTreeBatchOperation,
  FileTreeControllerOptions,
  FileTreeDragAndDropConfig,
  FileTreeDropTarget,
  FileTreeItemHandle,
  FileTreeMoveOptions,
  FileTreeMutationEventForType,
  FileTreeMutationEventType,
  FileTreeMutationHandle,
  FileTreeRemoveOptions,
  FileTreeResetEvent,
  FileTreeResetOptions,
  FileTreeScrollToPathOptions,
  FileTreeSearchSessionHandle,
  FileTreeVisibleRow,
} from './public-types'
import { Rename, type RenameViewState, type StartRenamingOptions } from './rename'
import { Search } from './search'
import { Selection } from './selection'
import { VisibleProjection } from './visible-projection'

/**
 * Owns the live PathStore instance and exposes a path-first boundary without
 * leaking internal store IDs. Each concern lives in its own module; this class
 * wires them together and orders the rebuilds a store event triggers.
 */
export class FileTreeController implements FileTreeMutationHandle, FileTreeSearchSessionHandle {
  readonly #baseOptions: Omit<FileTreeControllerOptions, 'dragAndDrop' | 'paths' | 'preparedInput'>
  readonly #listeners = new Set<FileTreeControllerListener>()
  readonly #mutationListeners = new MutationListeners()
  readonly #drag: Drag
  readonly #expansion: Expansion
  readonly #focus: Focus
  readonly #handles: ItemHandles
  readonly #knownPaths: KnownPaths
  readonly #projection: VisibleProjection
  readonly #rename: Rename
  readonly #search: Search
  readonly #selection: Selection
  #store: PathStore
  #unsubscribe: (() => void) | null

  public constructor(options: FileTreeControllerOptions) {
    const {
      dragAndDrop,
      fileTreeSearchMode,
      initialSearchQuery,
      initialSelectedPaths,
      renaming,
      onSearchChange,
      paths,
      preparedInput,
      ...baseOptions
    } = options
    const resolvedInput = resolveFileTreeInput(
      { paths, preparedInput },
      'constructor',
      baseOptions.sort,
    )
    this.#baseOptions = baseOptions
    this.#store = this.#createStore(resolvedInput.paths, resolvedInput.preparedInput)

    const store = (): PathStore => this.#store
    const emit = (): void => {
      this.#emit()
    }
    const ensureFull = (): void => {
      this.#ensureFullProjection()
    }
    this.#knownPaths = new KnownPaths(store)
    this.#expansion = new Expansion(store, this.#knownPaths)
    this.#projection = new VisibleProjection({
      ensureFull,
      isFocused: (path) => path === this.#focus.path,
      isSelected: (path) => this.#selection.has(path),
      store,
    })
    this.#focus = new Focus({ emit, ensureFull, projection: this.#projection, store })
    this.#selection = new Selection({
      emit,
      ensureFull,
      focus: this.#focus,
      projection: this.#projection,
      store,
    })
    this.#search = new Search(
      {
        emit,
        expansion: this.#expansion,
        focusedPath: () => this.#focus.path,
        focusPath: (path) => {
          this.#focus.focusPath(path)
        },
        knownPaths: this.#knownPaths,
        rebuild: (candidate, full) => {
          this.#rebuildVisibleProjection(candidate, full)
        },
        selectedPaths: () => this.#selection.paths(),
        store,
      },
      { mode: fileTreeSearchMode, onChange: onSearchChange },
    )
    this.#rename = new Rename(
      {
        closeFilter: () => {
          this.#search.closeForRename()
        },
        emit,
        focusPathWithoutEmit: (path) => {
          this.#focus.focusPathWithoutEmit(path)
        },
        move: (fromPath, toPath) => {
          this.move(fromPath, toPath)
        },
        remove: (path, removeOptions) => {
          this.remove(path, removeOptions)
        },
        selectOnly: (path) => {
          this.#selection.apply([path], path, false)
        },
        store,
      },
      renaming,
    )
    this.#drag = new Drag(
      {
        createStore: (storePaths) => this.#createStore(storePaths),
        emit,
        focusPathWithoutEmit: (path) => {
          this.#focus.focusPathWithoutEmit(path)
        },
        isFilterActive: () => this.#search.isActive(),
        resolvePath: (path) => this.#store.getPathInfo(path)?.path ?? null,
        selectedPaths: () => this.#selection.paths(),
        store,
      },
      dragAndDrop,
    )
    this.#handles = new ItemHandles({
      expansion: this.#expansion,
      focus: this.#focus,
      selection: this.#selection,
      store,
    })

    const initialFocusedPath = this.#selection.initialize(initialSelectedPaths ?? []).at(-1) ?? null
    this.#rebuildVisibleProjection(initialFocusedPath, false)
    if (initialSearchQuery != null) {
      this.#search.set(initialSearchQuery, false)
    }
    this.#unsubscribe = this.#subscribe()
  }

  public destroy(): void {
    this.#unsubscribe?.()
    this.#unsubscribe = null
    this.#mutationListeners.clear()
    this.#listeners.clear()
    this.#handles.clear()
    this.#drag.clear()
    this.#knownPaths.invalidate()
  }

  public subscribe(listener: FileTreeControllerListener): () => void {
    this.#listeners.add(listener)
    listener()
    return () => {
      this.#listeners.delete(listener)
    }
  }

  // Focus and scroll requests.

  public focusFirstItem(): void {
    this.#focus.first()
  }

  public focusLastItem(): void {
    this.#focus.last()
  }

  public focusNextItem(): void {
    this.#focus.move(1)
  }

  public focusPreviousItem(): void {
    this.#focus.move(-1)
  }

  public focusParentItem(): void {
    this.#focus.parent()
  }

  public focusPath(path: string): void {
    this.#focus.focusPath(path)
  }

  public focusMountedPathFromInput(path: string): void {
    this.#focus.focusMountedPath(path)
  }

  public focusNearestPath(path: string | null): string | null {
    return this.#focus.focusNearest(path)
  }

  public resolveNearestVisiblePath(path: string | null): string | null {
    return this.#focus.resolveNearest(path)
  }

  public getFocusedIndex(): number {
    return this.#focus.index
  }

  public getFocusedItem(): FileTreeItemHandle | null {
    const focusedPath = this.#focus.path
    return focusedPath == null ? null : this.#handles.get(focusedPath)
  }

  public getFocusedPath(): string | null {
    return this.#focus.path
  }

  public requestFocus(): void {
    this.#focus.request()
  }

  public getFocusRequestId(): number | null {
    return this.#focus.requestId()
  }

  public clearFocusRequest(id: number): void {
    this.#focus.clearRequest(id)
  }

  public scrollToPath(path: string, options?: FileTreeScrollToPathOptions): void {
    this.#focus.scrollTo(path, options)
  }

  public getScrollRequest(): FileTreeScrollRequest | null {
    return this.#focus.scrollRequest()
  }

  public clearScrollRequest(id: number): void {
    this.#focus.clearScrollRequest(id)
  }

  // Visible rows.

  public getVisibleCount(): number {
    return this.#projection.count
  }

  public getVisibleRows(start: number, end: number): readonly FileTreeVisibleRow[] {
    return this.#projection.rows(start, end)
  }

  public getStickyRowCandidates(
    scrollTop: number,
    itemHeight: number,
  ): readonly FileTreeStickyRowCandidate[] | null {
    return this.#projection.stickyCandidates(scrollTop, itemHeight)
  }

  /**
   * Returns the item handle for the given path.
   *
   * Accepts both canonical directory paths (`src/`) and bare directory lookup
   * paths (`src`) so callers do not need to know the canonical slash rules.
   */
  public getItem(path: string): FileTreeItemHandle | null {
    const itemInfo = this.#store.getPathInfo(path)
    return itemInfo == null ? null : this.#handles.get(itemInfo.path, itemInfo)
  }

  // Only use this for paths sourced from currently mounted directory rows. The
  // mounted-row invariant lets click handling skip public handle creation while
  // still revalidating stale DOM events against the live store.
  public resolveMountedDirectoryPathFromInput(path: string): string | null {
    const pathInfo = this.#store.getPathInfo(path)
    return pathInfo?.kind === 'directory' ? pathInfo.path : null
  }

  // Only use this for paths sourced from currently mounted directory rows. The
  // live-path check prevents stale DOM events from throwing if the row was
  // removed or became a file before the click handler ran.
  public toggleMountedDirectoryFromInput(path: string): void {
    const directoryPath = this.resolveMountedDirectoryPathFromInput(path)
    if (directoryPath == null) {
      return
    }

    this.#search.toggleCollapsedOverride(directoryPath)
    this.#expansion.toggle(directoryPath)
  }

  // Selection.

  /** Returns a fresh snapshot callers may reorder without changing the selection. */
  public getSelectedPaths(): string[] {
    return this.#selection.paths()
  }

  public getSelectionVersion(): number {
    return this.#selection.version
  }

  public selectAllVisiblePaths(): void {
    this.#selection.selectAllVisible()
  }

  public selectOnlyPath(path: string): void {
    this.#selection.selectOnly(path)
  }

  // Only use this for paths sourced from currently mounted rows. Visible rows
  // already provide canonical public paths, so regular row clicks can update
  // selection without re-normalizing the same path through the store.
  public selectOnlyMountedPathFromInput(path: string): void {
    this.#selection.apply([path], path)
  }

  public selectPath(path: string): void {
    this.#selection.select(path)
  }

  public deselectPath(path: string): void {
    this.#selection.deselect(path)
  }

  public toggleFocusedSelection(): void {
    const focusedPath = this.#focus.path
    if (focusedPath == null) {
      return
    }

    this.#selection.toggleFromInput(focusedPath)
  }

  public togglePathSelection(path: string): void {
    this.#selection.toggle(path)
  }

  public togglePathSelectionFromInput(path: string): void {
    this.#selection.toggleFromInput(path)
  }

  public selectPathRange(path: string, unionSelection: boolean): void {
    this.#selection.selectRange(path, unionSelection)
  }

  public extendSelectionFromFocused(offset: -1 | 1): void {
    this.#selection.extendFromFocused(offset)
  }

  // Drag.

  public getDragAndDropConfig(): FileTreeDragAndDropConfig | null {
    return this.#drag.config
  }

  public isDragAndDropEnabled(): boolean {
    return this.#drag.config != null
  }

  public getDragSession(): DragSessionView | null {
    return this.#drag.session()
  }

  public startDrag(path: string): boolean {
    return this.#drag.start(path)
  }

  public setDragTarget(target: FileTreeDropTarget | null): void {
    this.#drag.setTarget(target)
  }

  public cancelDrag(): void {
    this.#drag.cancel()
  }

  public completeDrag(): boolean {
    return this.#drag.complete()
  }

  // Filter.

  public setSearch(value: string | null): void {
    this.#search.set(value, true)
  }

  public openSearch(initialValue?: string): void {
    this.#search.open(initialValue)
  }

  public closeSearch(): void {
    this.#search.set(null, true)
  }

  public isSearchOpen(): boolean {
    return this.#search.value !== null
  }

  public getSearchValue(): string {
    return this.#search.value ?? ''
  }

  public getSearchMatchingPaths(): readonly string[] {
    return this.#search.matchingPaths
  }

  public getSearchFocusRequestId(): number {
    return this.#search.focusRequestId
  }

  public focusNextSearchMatch(): void {
    this.#search.focusRelativeMatch(1)
  }

  public focusPreviousSearchMatch(): void {
    this.#search.focusRelativeMatch(-1)
  }

  // Rename.

  public startRenaming(
    path: string = this.#focus.path ?? '',
    options: StartRenamingOptions = {},
  ): boolean {
    return this.#rename.start(path, options)
  }

  public getRenameView(): RenameViewState {
    return this.#rename.view()
  }

  // Mutations.

  /**
   * Applies one file/directory addition through the shared mutation handle
   * without exposing the raw store to tree consumers.
   */
  public add(path: string): void {
    this.#store.add(path)
  }

  public remove(path: string, options: FileTreeRemoveOptions = {}): void {
    this.#store.remove(path, options)
  }

  public move(fromPath: string, toPath: string, options: FileTreeMoveOptions = {}): void {
    this.#store.move(fromPath, toPath, options)
  }

  public batch(operations: readonly FileTreeBatchOperation[]): void {
    this.#store.batch(operations)
  }

  public onMutation<TType extends FileTreeMutationEventType | '*'>(
    type: TType,
    handler: (event: FileTreeMutationEventForType<TType>) => void,
  ): () => void {
    return this.#mutationListeners.on(type, handler)
  }

  /**
   * Rebuilds the controller around a new full path set. This is intentionally a
   * coarse whole-tree reset path rather than a localized mutation fast path.
   */
  public resetPaths(paths: readonly string[], options: FileTreeResetOptions = {}): void {
    const previousPathCount = this.#store.list().length
    const previousVisibleCount = this.#projection.count
    const resolvedInput = resolveFileTreeInput(
      { paths, preparedInput: options.preparedInput },
      'resetPaths',
      this.#baseOptions.sort,
    )
    const nextStore = this.#createStore(
      resolvedInput.paths,
      resolvedInput.preparedInput,
      options.initialExpandedPaths,
    )
    const previousFocusedPath = this.#focus.path

    this.#unsubscribe?.()
    this.#store = nextStore
    this.#handles.clear()
    this.#knownPaths.invalidate()
    const selectionSurvives = this.#selection.carryInto(nextStore)
    this.#rename.carryInto(nextStore)
    this.#rebuildVisibleProjection(
      previousFocusedPath,
      previousFocusedPath != null || selectionSurvives,
    )
    this.#unsubscribe = this.#subscribe()
    this.#emit()
    this.#mutationListeners.emit({
      canonicalChanged: true,
      operation: 'reset',
      pathCountAfter: resolvedInput.paths.length,
      pathCountBefore: previousPathCount,
      projectionChanged: true,
      usedPreparedInput: options.preparedInput != null,
      visibleCountDelta: this.#projection.count - previousVisibleCount,
    } satisfies FileTreeResetEvent)
  }

  #createStore(
    paths: readonly string[],
    preparedInput?: FileTreePreparedInput,
    initialExpandedPathsOverride?: readonly string[],
  ): PathStore {
    return new PathStore({
      ...this.#baseOptions,
      paths,
      preparedInput:
        preparedInput == null
          ? undefined
          : (preparedInput as unknown as { paths: readonly string[] }),
      ...(initialExpandedPathsOverride !== undefined
        ? { initialExpandedPaths: initialExpandedPathsOverride }
        : {}),
    })
  }

  #emit(): void {
    for (const listener of this.#listeners) {
      listener()
    }
  }

  #rebuildVisibleProjection(focusedPathCandidate: string | null, full: boolean = true): void {
    const focusedIndex = this.#projection.rebuild(
      focusedPathCandidate,
      full,
      this.#search.visibleFilter(),
    )
    this.#focus.assign(focusedIndex)
  }

  #ensureFullProjection(): void {
    if (this.#projection.hasFull) {
      return
    }

    this.#rebuildVisibleProjection(this.#focus.path, true)
  }

  #subscribe(): () => void {
    return this.#store.on('*', (event) => {
      if (this.#expansion.isApplyingBulk()) {
        return
      }
      if (event.canonicalChanged) {
        this.#handles.clear()
        this.#knownPaths.invalidate()
      }
      let focusPathCandidate = this.#focus.path
      if (isPathMutationEvent(event)) {
        this.#drag.clear()
        this.#search.remapThroughMutation(event)
        this.#rename.remapThroughMutation(event)
        focusPathCandidate = remapPathThroughMutation(this.#focus.path, event, true)
        this.#selection.remapThroughMutation(event)
      }
      const searchFocusCandidate = this.#search.resolveFocusCandidate(focusPathCandidate)
      const shouldBuildFullProjection =
        this.#search.value != null ||
        (event.operation !== 'expand' && event.operation !== 'collapse')
      this.#rebuildVisibleProjection(searchFocusCandidate, shouldBuildFullProjection)
      this.#emit()
      const mutationEvent = toTreesMutationEvent(event)
      if (mutationEvent != null) {
        this.#mutationListeners.emit(mutationEvent)
      }
    })
  }
}
