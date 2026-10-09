// Modified for Platform from Pierre. Apache-2.0; see packages/tree/LICENSE-pierre and UPSTREAM.md.
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
  FileTreeGitStatusPatch,
  FileTreeItemHandle,
  FileTreeListener,
  FileTreeMoveOptions,
  FileTreeMutationEventForType,
  FileTreeMutationEventType,
  FileTreeMutationHandle,
  FileTreeOptions,
  FileTreeRemoveOptions,
  FileTreeResetOptions,
  FileTreeRowDecorationRenderer,
  FileTreeScrollToPathOptions,
  FileTreeSearchSessionHandle,
  FileTreeSelectionChangeListener,
} from '@workspace/tree'
import { TreeRowElements, type TreeRowElement } from '@/features/workspace/state/tree-row-elements'
import { TREE_DEFAULT_ITEM_HEIGHT } from '@/features/workspace/utils/tree-view-layout'

/** What the view renders from the model; its identity changes with every view-visible setter. */
export type TreeViewModelProps = Omit<
  TreeViewProps,
  'instanceId' | 'menuPath' | 'onCloseMenu' | 'onOpenMenu'
>

export class TreeViewModel implements FileTreeMutationHandle, FileTreeSearchSessionHandle {
  readonly #controller: FileTreeController
  readonly #onSelectionChange: FileTreeSelectionChangeListener | undefined
  readonly #rowDecorationSource: FileTreeRowDecorationRenderer | undefined
  #renderRowDecoration: FileTreeRowDecorationRenderer | undefined
  readonly #renamingEnabled: boolean
  readonly #searchBlurBehavior: FileTreeOptions['searchBlurBehavior']
  readonly #searchEnabled: boolean
  readonly #searchPlaceholder: string | undefined
  readonly #rowElements = new TreeRowElements()
  #itemHeight: number
  readonly #viewOptions: Pick<
    FileTreeOptions,
    'overscan' | 'stickyFolders' | 'initialScrollTop' | 'onScrollTopChange'
  >
  #gitStatusState: FileTreeGitStatusState | null
  #loadingPaths: ReadonlySet<string> = new Set()
  readonly #itemHeightListeners = new Set<FileTreeListener>()
  #itemHeightVersion = 0
  readonly #viewListeners = new Set<FileTreeListener>()
  #viewVersion = 0
  #viewProps: TreeViewModelProps | null = null
  #selectionVersion: number

  public constructor(options: FileTreeOptions) {
    const {
      fileTreeSearchMode,
      gitStatus,
      initialSearchQuery,
      itemHeight,
      onSearchChange,
      onSelectionChange,
      overscan,
      renderRowDecoration,
      renaming,
      search,
      searchBlurBehavior,
      searchPlaceholder,
      stickyFolders,
      initialScrollTop,
      onScrollTopChange,
      ...controllerOptions
    } = options
    this.#gitStatusState = resolveFileTreeGitStatusState(gitStatus)
    this.#onSelectionChange = onSelectionChange
    this.#rowDecorationSource = renderRowDecoration
    this.#renderRowDecoration = renderRowDecoration
    this.#renamingEnabled = renaming != null && renaming !== false
    this.#searchBlurBehavior = searchBlurBehavior
    this.#searchEnabled = search === true
    this.#searchPlaceholder = searchPlaceholder
    this.#itemHeight = itemHeight ?? TREE_DEFAULT_ITEM_HEIGHT
    this.#viewOptions = {
      overscan,
      stickyFolders,
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
  }

  /**
   * Reports selection changes to `onSelectionChange` while connected; the host connects it for as
   * long as the tree is mounted. A change made before connecting is reported on connect.
   */
  public connectSelectionChange(): () => void {
    if (this.#onSelectionChange == null) return () => {}

    const disconnect = this.subscribe(() => {
      this.#emitSelectionChange()
    })
    this.#emitSelectionChange()
    return disconnect
  }

  /** The rows mounted right now, sticky ones included; changes arrive through `subscribeRowElements`. */
  public getRowElements(): readonly TreeRowElement[] {
    return this.#rowElements.rows()
  }

  public getRowElement(path: string): HTMLElement | null {
    return this.#rowElements.element(path)
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

  public getSelectedPaths(): string[] {
    return this.#controller.getSelectedPaths()
  }

  public getItemHeight(): number {
    return this.#itemHeight
  }

  public getItemHeightVersion(): number {
    return this.#itemHeightVersion
  }

  public setItemHeight(itemHeight: number | undefined): void {
    const nextItemHeight = itemHeight ?? TREE_DEFAULT_ITEM_HEIGHT
    if (nextItemHeight === this.#itemHeight) return

    this.#itemHeight = nextItemHeight
    this.#itemHeightVersion += 1
    this.#invalidateView()
    for (const listener of this.#itemHeightListeners) listener()
  }

  public subscribeItemHeight(listener: FileTreeListener): () => void {
    this.#itemHeightListeners.add(listener)

    return () => {
      this.#itemHeightListeners.delete(listener)
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

  public scrollToPath(path: string, options?: FileTreeScrollToPathOptions): void {
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

  public setGitStatus(gitStatus?: FileTreeOptions['gitStatus']): void {
    const nextGitStatusState = resolveFileTreeGitStatusState(gitStatus, this.#gitStatusState)
    if (nextGitStatusState === this.#gitStatusState) {
      return
    }

    this.#gitStatusState = nextGitStatusState
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

  public setLoadingPaths(paths: readonly string[]): void {
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
      controller: this.#controller,
      gitStatusByPath: this.#gitStatusState?.statusByPath,
      ignoredGitDirectories: this.#gitStatusState?.ignoredDirectoryPaths,
      directoriesWithGitChanges: this.#gitStatusState?.directoriesWithChanges,
      loadingPaths: this.#loadingPaths,
      renamingEnabled: this.#renamingEnabled,
      renderRowDecoration: this.#renderRowDecoration,
      rowElements: this.#rowElements,
      searchBlurBehavior: this.#searchBlurBehavior,
      searchEnabled: this.#searchEnabled,
      searchPlaceholder: this.#searchPlaceholder,
      initialScrollTop: this.#viewOptions.initialScrollTop,
      onScrollTopChange: this.#viewOptions.onScrollTopChange,
      itemHeight: this.#itemHeight,
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
