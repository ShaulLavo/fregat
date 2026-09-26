import { getBuiltInSpriteSheet, isColoredBuiltInIconSet } from '@workspace/tree'
import { normalizeFileTreeIcons } from '@workspace/tree'
import { type FileTreeDensityPreset, resolveFileTreeDensity } from '@workspace/tree'
import { FileTreeController } from '@workspace/tree'
import { arePathSetsEqual } from '@workspace/tree'
import {
  applyFileTreeGitStatusPatch,
  type FileTreeGitStatusState,
  resolveFileTreeGitStatusState,
} from '@workspace/tree'
import type { TreeViewProps } from '@/features/workspace/utils/tree-view-props'
import type {
  FileTreeBatchOperation,
  FileTreeCompositionOptions,
  FileTreeGitStatusPatch,
  FileTreeItemHandle,
  FileTreeListener,
  FileTreeMoveOptions,
  FileTreeMutationEventForType,
  FileTreeMutationEventType,
  FileTreeMutationHandle,
  FileTreeOptions,
  FileTreePublicId,
  FileTreeRemoveOptions,
  FileTreeResetOptions,
  FileTreeRowDecorationRenderer,
  FileTreeScrollToPathOptions,
  FileTreeSearchSessionHandle,
  FileTreeSelectionChangeListener,
} from '@workspace/tree'
import { FILE_TREE_DEFAULT_ITEM_HEIGHT, FILE_TREE_DEFAULT_VIEWPORT_HEIGHT } from '@workspace/tree'
import { TreeRowElements, type TreeRowElement } from '@/features/workspace/state/tree-row-elements'

// Translates the public row-budget hint into the pixel height the first render uses before the
// DOM can report a measured scroll viewport.
function resolveInitialViewportHeight({
  initialVisibleRowCount,
  itemHeight,
}: Pick<FileTreeOptions, 'initialVisibleRowCount' | 'itemHeight'>): number {
  return initialVisibleRowCount == null
    ? FILE_TREE_DEFAULT_VIEWPORT_HEIGHT
    : Math.max(0, initialVisibleRowCount) * (itemHeight ?? FILE_TREE_DEFAULT_ITEM_HEIGHT)
}

/** The sprite sheets a mounted tree renders: the built-in glyphs, then the caller's. */
export interface TreeSpriteSheets {
  readonly builtIn: string
  readonly coloredIcons: boolean
  readonly custom: string | null
}

/** What the view renders from the model; its identity changes with every view-visible setter. */
export type TreeViewModelProps = Omit<TreeViewProps, 'instanceId'>

export class TreeViewModel implements FileTreeMutationHandle, FileTreeSearchSessionHandle {
  #composition: FileTreeCompositionOptions | undefined
  readonly #controller: FileTreeController
  readonly #onSelectionChange: FileTreeSelectionChangeListener | undefined
  readonly #rowDecorationSource: FileTreeRowDecorationRenderer | undefined
  #renderRowDecoration: FileTreeRowDecorationRenderer | undefined
  readonly #renamingEnabled: boolean
  readonly #searchBlurBehavior: FileTreeOptions['searchBlurBehavior']
  readonly #searchEnabled: boolean
  readonly #searchFakeFocus: boolean
  readonly #searchPlaceholder: string | undefined
  readonly #rowElements = new TreeRowElements()
  #density: FileTreeDensityPreset
  readonly #viewOptions: Pick<
    FileTreeOptions,
    | 'initialVisibleRowCount'
    | 'itemHeight'
    | 'overscan'
    | 'stickyFolders'
    | 'initialScrollTop'
    | 'onScrollTopChange'
  >
  #gitStatusState: FileTreeGitStatusState | null
  #icons: FileTreeOptions['icons']
  #loadingPaths: ReadonlySet<string> = new Set()
  readonly #densityListeners = new Set<FileTreeListener>()
  #densityVersion = 0
  readonly #viewListeners = new Set<FileTreeListener>()
  #viewVersion = 0
  #viewProps: TreeViewModelProps | null = null
  #selectionVersion: number
  #selectionSubscription: (() => void) | null = null

  public constructor(options: FileTreeOptions) {
    const {
      composition,
      density,
      fileTreeSearchMode,
      gitStatus,
      initialSearchQuery,
      icons,
      itemHeight,
      onSearchChange,
      onSelectionChange,
      overscan,
      renderRowDecoration,
      renaming,
      search,
      searchBlurBehavior,
      searchFakeFocus,
      searchPlaceholder,
      stickyFolders,
      initialVisibleRowCount,
      initialScrollTop,
      onScrollTopChange,
      ...controllerOptions
    } = options
    this.#composition = composition
    this.#gitStatusState = resolveFileTreeGitStatusState(gitStatus)
    this.#icons = icons
    this.#onSelectionChange = onSelectionChange
    this.#rowDecorationSource = renderRowDecoration
    this.#renderRowDecoration = renderRowDecoration
    this.#renamingEnabled = renaming != null && renaming !== false
    this.#searchBlurBehavior = searchBlurBehavior
    this.#searchEnabled = search === true
    this.#searchFakeFocus = searchFakeFocus === true
    this.#searchPlaceholder = searchPlaceholder
    this.#density = resolveFileTreeDensity(density, itemHeight)
    this.#viewOptions = {
      itemHeight: this.#density.itemHeight,
      overscan,
      stickyFolders,
      initialVisibleRowCount,
      initialScrollTop,
      onScrollTopChange,
    }
    this.#controller = new FileTreeController({
      ...controllerOptions,
      fileTreeSearchMode,
      initialSearchQuery,
      onSearchChange,
      renaming,
    })
    this.#selectionVersion = this.#controller.getSelectionVersion()
    this.#selectionSubscription =
      this.#onSelectionChange == null
        ? null
        : this.subscribe(() => {
            this.#emitSelectionChange()
          })
  }

  public cleanUp(): void {
    this.#selectionSubscription?.()
    this.#selectionSubscription = null
    this.#densityListeners.clear()
    this.#viewListeners.clear()
    this.#controller.destroy()
  }

  /** The rows mounted right now, sticky ones included; changes arrive through `subscribeRowElements`. */
  public getRowElements(): readonly TreeRowElement[] {
    return this.#rowElements.rows()
  }

  public subscribeRowElements(listener: () => void): () => void {
    return this.#rowElements.subscribe(listener)
  }

  public getItem(path: string): FileTreeItemHandle | null {
    return this.#controller.getItem(path)
  }

  public getFocusedItem(): FileTreeItemHandle | null {
    return this.#controller.getFocusedItem()
  }

  public getFocusedPath(): string | null {
    return this.#controller.getFocusedPath()
  }

  public getSelectedPaths(): readonly string[] {
    return this.#controller.getSelectedPaths()
  }

  public getComposition(): FileTreeCompositionOptions | undefined {
    return this.#composition
  }

  public getItemHeight(): number {
    return this.#density.itemHeight
  }

  public getDensityFactor(): number {
    return this.#density.factor
  }

  public getDensityVersion(): number {
    return this.#densityVersion
  }

  public setDensity(
    density: FileTreeOptions['density'],
    itemHeight: FileTreeOptions['itemHeight'],
  ): void {
    const nextDensity = resolveFileTreeDensity(density, itemHeight)
    if (
      nextDensity.factor === this.#density.factor &&
      nextDensity.itemHeight === this.#density.itemHeight
    ) {
      return
    }

    this.#density = nextDensity
    this.#viewOptions.itemHeight = nextDensity.itemHeight
    this.#densityVersion += 1
    this.#invalidateView()
    for (const listener of this.#densityListeners) listener()
  }

  public subscribeDensity(listener: FileTreeListener): () => void {
    this.#densityListeners.add(listener)

    return () => {
      this.#densityListeners.delete(listener)
    }
  }

  /** Notifies when the props the view renders change; `getViewProps` then has new ones. */
  public subscribeView(listener: FileTreeListener): () => void {
    this.#viewListeners.add(listener)

    return () => {
      this.#viewListeners.delete(listener)
    }
  }

  public getViewVersion(): number {
    return this.#viewVersion
  }

  /**
   * The view's props at `version`. The version is the cache key: the model changes in place, so
   * a memo keyed on its identity alone would serve stale props.
   */
  public getViewProps(_version: number): TreeViewModelProps {
    this.#viewProps ??= this.#createViewProps()
    return this.#viewProps
  }

  public getSpriteSheets(): TreeSpriteSheets {
    const icons = normalizeFileTreeIcons(this.#icons)
    const custom = icons.spriteSheet?.trim() ?? ''
    return {
      builtIn: getBuiltInSpriteSheet(icons.set),
      coloredIcons: icons.colored && isColoredBuiltInIconSet(icons.set),
      custom: custom.length > 0 ? custom : null,
    }
  }

  public subscribe(listener: FileTreeListener): () => void {
    let hasSeenInitialSnapshot = false

    return this.#controller.subscribe(() => {
      // useSyncExternalStore seeds the initial render through getSnapshot(), so
      // the model-level subscribe wrapper suppresses the controller's immediate
      // replay and only forwards subsequent store changes to React.
      if (!hasSeenInitialSnapshot) {
        hasSeenInitialSnapshot = true
        return
      }

      listener()
    })
  }

  public focusPath(path: string): void {
    this.#controller.focusPath(path)
  }

  public focus(): void {
    this.#controller.requestFocus()
  }

  public scrollToPath(path: FileTreePublicId, options?: FileTreeScrollToPathOptions): void {
    this.#controller.scrollToPath(path, options)
  }

  public focusNearestPath(path: string | null): string | null {
    return this.#controller.focusNearestPath(path)
  }

  public add(path: string): void {
    this.#controller.add(path)
  }

  public batch(operations: readonly FileTreeBatchOperation[]): void {
    this.#controller.batch(operations)
  }

  public applyGitStatusPatch(patch: FileTreeGitStatusPatch): void {
    const nextGitStatusState = applyFileTreeGitStatusPatch(this.#gitStatusState, patch)
    if (nextGitStatusState === this.#gitStatusState) {
      return
    }

    this.#gitStatusState = nextGitStatusState
    this.#invalidateView()
  }

  public move(fromPath: string, toPath: string, options?: FileTreeMoveOptions): void {
    this.#controller.move(fromPath, toPath, options)
  }

  public onMutation<TType extends FileTreeMutationEventType | '*'>(
    type: TType,
    handler: (event: FileTreeMutationEventForType<TType>) => void,
  ): () => void {
    return this.#controller.onMutation(type, handler)
  }

  public setSearch(value: string | null): void {
    this.#controller.setSearch(value)
  }

  public openSearch(initialValue?: string): void {
    this.#controller.openSearch(initialValue)
  }

  public closeSearch(): void {
    this.#controller.closeSearch()
  }

  public isSearchOpen(): boolean {
    return this.#controller.isSearchOpen()
  }

  public getSearchValue(): string {
    return this.#controller.getSearchValue()
  }

  public getSearchMatchingPaths(): readonly string[] {
    return this.#controller.getSearchMatchingPaths()
  }

  public focusNextSearchMatch(): void {
    this.#controller.focusNextSearchMatch()
  }

  public focusPreviousSearchMatch(): void {
    this.#controller.focusPreviousSearchMatch()
  }

  public startRenaming(path?: string, options?: { removeIfCanceled?: boolean }): boolean {
    return this.#controller.startRenaming(path, options)
  }

  public remove(path: string, options?: FileTreeRemoveOptions): void {
    this.#controller.remove(path, options)
  }

  public resetPaths(paths: readonly string[], options?: FileTreeResetOptions): void {
    this.#controller.resetPaths(paths, options)
  }

  // Deliberately rerenders even when the same object reference is passed again.
  // Callers can reuse one composition object while changing what its render
  // callbacks return, so identity alone is not a reliable no-op signal.
  public setComposition(composition?: FileTreeCompositionOptions): void {
    this.#composition = composition
    this.#invalidateView()
  }

  public setGitStatus(gitStatus?: FileTreeOptions['gitStatus']): void {
    const nextGitStatusState = resolveFileTreeGitStatusState(gitStatus, this.#gitStatusState)
    if (nextGitStatusState === this.#gitStatusState) {
      return
    }

    this.#gitStatusState = nextGitStatusState
    this.#invalidateView()
  }

  public setIcons(icons?: FileTreeOptions['icons']): void {
    this.#icons = icons
    this.#invalidateView()
  }

  /**
   * Asks every visible row for its decoration again. The renderer reads state the tree cannot see,
   * so a new identity is what tells the rows their cached decoration is stale.
   */
  public refreshDecorations(): void {
    const render = this.#rowDecorationSource
    if (!render) return

    this.#renderRowDecoration = (context) => render(context)
    this.#invalidateView()
  }

  public setLoadingPaths(paths: readonly FileTreePublicId[]): void {
    if (arePathSetsEqual(this.#loadingPaths, paths)) return

    this.#loadingPaths = new Set(paths)
    this.#invalidateView()
  }

  #invalidateView(): void {
    this.#viewProps = null
    this.#viewVersion += 1
    for (const listener of this.#viewListeners) listener()
  }

  #createViewProps(): TreeViewModelProps {
    return {
      composition: this.#composition,
      controller: this.#controller,
      gitStatusByPath: this.#gitStatusState?.statusByPath,
      ignoredGitDirectories: this.#gitStatusState?.ignoredDirectoryPaths,
      directoriesWithGitChanges: this.#gitStatusState?.directoriesWithChanges,
      icons: this.#icons,
      loadingPaths: this.#loadingPaths,
      renamingEnabled: this.#renamingEnabled,
      renderRowDecoration: this.#renderRowDecoration,
      rowElements: this.#rowElements,
      searchBlurBehavior: this.#searchBlurBehavior,
      searchEnabled: this.#searchEnabled,
      searchFakeFocus: this.#searchFakeFocus,
      searchPlaceholder: this.#searchPlaceholder,
      initialScrollTop: this.#viewOptions.initialScrollTop,
      onScrollTopChange: this.#viewOptions.onScrollTopChange,
      initialViewportHeight: resolveInitialViewportHeight({
        initialVisibleRowCount: this.#viewOptions.initialVisibleRowCount,
        itemHeight: this.#viewOptions.itemHeight,
      }),
      itemHeight: this.#viewOptions.itemHeight,
      overscan: this.#viewOptions.overscan,
      stickyFolders: this.#viewOptions.stickyFolders,
    }
  }

  #emitSelectionChange(): void {
    const onSelectionChange = this.#onSelectionChange
    if (onSelectionChange == null) {
      return
    }

    const nextSelectionVersion = this.#controller.getSelectionVersion()
    if (nextSelectionVersion === this.#selectionVersion) {
      return
    }

    this.#selectionVersion = nextSelectionVersion
    onSelectionChange(this.#controller.getSelectedPaths())
  }
}
