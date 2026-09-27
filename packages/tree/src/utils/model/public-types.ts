// Modified for Platform from Pierre. Apache-2.0; see LICENSE-pierre and UPSTREAM.md.
import type { FileTreePreparedInput } from '../prepared-input'
import type { ContextMenuAnchorRect, GitStatusEntry } from '../public-types'

// The types below intentionally duplicate private path-store shapes
// (PathStoreCompareEntry, PathStorePathComparator, PathStoreInitialExpansion,
// PathStoreRemoveOptions, PathStoreCollisionStrategy, PathStoreMoveOptions,
// PathStoreOperation, and the relevant PathStoreConstructorOptions fields).
//
// They are NOT re-exports. Keeping a parallel set of `FileTree*` types lets
// this package presents a self-contained public API: consumers never need to
// import from path-store internals to call `controller.batch(...)`,
// `controller.move(...)`, etc. Path-store remains a runtime dependency but is
// not part of the documented surface.
//
// Trade-off: there is no compile-time link between the two. If `path-store`
// changes one of these shapes, update the matching `FileTree*` type here by
// hand. The structural equivalence is exercised in tests via the values that
// flow between the two layers.

interface FileTreeSortEntry {
  basename: string
  depth: number
  isDirectory: boolean
  path: string
  segments: readonly string[]
}

export type FileTreeSortComparator = (left: FileTreeSortEntry, right: FileTreeSortEntry) => number

type FileTreeInitialExpansion = 'closed' | 'open' | number

export interface FileTreeRemoveOptions {
  recursive?: boolean
}

type FileTreeCollisionStrategy = 'error' | 'replace' | 'skip'

export interface FileTreeMoveOptions {
  collision?: FileTreeCollisionStrategy
}

export type FileTreeBatchOperation =
  | { path: string; type: 'add' }
  | ({ path: string; type: 'remove' } & FileTreeRemoveOptions)
  | ({
      from: string
      to: string
      type: 'move'
    } & FileTreeMoveOptions)

export interface FileTreeGitStatusPatch {
  remove?: readonly string[]
  set?: readonly GitStatusEntry[]
}

// Mirrors the subset of PathStoreConstructorOptions that trees forwards to its
// underlying store. See the duplication note above the FileTree* type cluster.
interface FileTreeStoreOptions {
  flattenEmptyDirectories?: boolean
  initialExpansion?: FileTreeInitialExpansion
  initialExpandedPaths?: readonly string[]
  sort?: 'default' | FileTreeSortComparator
}

type FileTreeInputOptions =
  | {
      paths: readonly string[]
      preparedInput?: FileTreePreparedInput
    }
  | {
      paths?: readonly string[]
      preparedInput: FileTreePreparedInput
    }

type FileTreeControllerBehaviorOptions = FileTreeStoreOptions & {
  dragAndDrop?: boolean | FileTreeDragAndDropConfig
  fileTreeSearchMode?: FileTreeSearchMode
  initialSearchQuery?: string | null
  initialSelectedPaths?: readonly string[]
  onSearchChange?: FileTreeSearchChangeListener
  renaming?: boolean | FileTreeRenamingConfig
}

export type FileTreeControllerOptions = FileTreeControllerBehaviorOptions & FileTreeInputOptions

interface FileTreeVisibleSegment {
  isTerminal: boolean
  name: string
  path: string
}

export interface FileTreeVisibleRow {
  ancestorPaths: readonly string[]
  depth: number
  flattenedSegments?: readonly FileTreeVisibleSegment[]
  hasChildren: boolean
  index: number
  isFocused: boolean
  isSelected: boolean
  isExpanded: boolean
  isFlattened: boolean
  kind: 'directory' | 'file'
  level: number
  name: string
  path: string
  posInSet: number
  setSize: number
}

interface FileTreeItemHandleBase {
  deselect(): void
  focus(): void
  getPath(): string
  isFocused(): boolean
  isDirectory(): boolean
  isSelected(): boolean
  select(): void
  toggleSelect(): void
}

export interface FileTreeDirectoryHandle extends FileTreeItemHandleBase {
  collapse(): void
  expand(): void
  isDirectory(): true
  isExpanded(): boolean
  toggle(): void
}

export interface FileTreeFileHandle extends FileTreeItemHandleBase {
  isDirectory(): false
}

export type FileTreeItemHandle = FileTreeDirectoryHandle | FileTreeFileHandle

export interface FileTreeRenderOptions {
  initialScrollTop?: number
  onScrollTopChange?: (scrollTop: number) => void
  itemHeight?: number
  overscan?: number
  stickyFolders?: boolean
}

export type FileTreeScrollOffset = 'top' | 'center' | 'nearest'
export type FileTreeScrollBehavior = 'auto' | 'smooth'

export interface FileTreeScrollToPathOptions {
  behavior?: FileTreeScrollBehavior
  focus?: boolean
  offset?: FileTreeScrollOffset
}

export type FileTreeSearchMode = 'expand-matches' | 'collapse-non-matches' | 'hide-non-matches'

// Controls what happens to the search session when the search input loses
// focus. `'close'` (the default, and the legacy behavior) clears the query and
// closes the search session as soon as the input is blurred. `'retain'` keeps
// the current query and leaves the session open, so the filter stays applied
// until the caller explicitly closes it (via Escape, Enter, or a programmatic
// `closeSearch()`). `'retain'` is useful for trees mounted with an
// `initialSearchQuery` that should survive concurrent siblings stealing focus
// during mount.
export type FileTreeSearchBlurBehavior = 'close' | 'retain'

type FileTreeSearchChangeListener = (value: string | null) => void

export interface FileTreeSearchSessionHandle {
  closeSearch(): void
  focusNextSearchMatch(): void
  focusPreviousSearchMatch(): void
  getSearchMatchingPaths(): readonly string[]
  getSearchValue(): string
  isSearchOpen(): boolean
  openSearch(initialValue?: string): void
  setSearch(value: string | null): void
}

export interface FileTreeDropTarget {
  directoryPath: string | null
  flattenedSegmentPath: string | null
  hoveredPath: string | null
  kind: 'directory' | 'root'
}

export interface FileTreeDropContext {
  draggedPaths: readonly string[]
  target: FileTreeDropTarget
}

export interface FileTreeDropResult extends FileTreeDropContext {
  operation: 'batch' | 'move'
}

export interface FileTreeDragAndDropConfig {
  canDrag?: (paths: readonly string[]) => boolean
  canDrop?: (event: FileTreeDropContext) => boolean
  onDropComplete?: (event: FileTreeDropResult) => void
  onDropError?: (error: string, event: FileTreeDropContext) => void
  openOnDropDelay?: number
}

interface FileTreeRenamingItem {
  isFolder: boolean
  path: string
}

export interface FileTreeRenameEvent {
  destinationPath: string
  isFolder: boolean
  sourcePath: string
}

export interface FileTreeRenamingConfig {
  canRename?: (item: FileTreeRenamingItem) => boolean
  onError?: (error: string) => void
  onRename?: (event: FileTreeRenameEvent) => void
}

type FileTreeOptionSurface = FileTreeRenderOptions & {
  composition?: FileTreeCompositionOptions
  gitStatus?: readonly GitStatusEntry[]
  onSelectionChange?: FileTreeSelectionChangeListener
  renderRowDecoration?: FileTreeRowDecorationRenderer
  search?: boolean
  searchBlurBehavior?: FileTreeSearchBlurBehavior
  searchPlaceholder?: string
}

export type FileTreeOptions = FileTreeControllerOptions & FileTreeOptionSurface

interface FileTreeMutationEventInvalidation {
  canonicalChanged: boolean
  projectionChanged: boolean
  visibleCountDelta: number | null
}

interface FileTreeAddEvent extends FileTreeMutationEventInvalidation {
  operation: 'add'
  path: string
}

interface FileTreeRemoveEvent extends FileTreeMutationEventInvalidation {
  operation: 'remove'
  path: string
  recursive: boolean
}

interface FileTreeMoveEvent extends FileTreeMutationEventInvalidation {
  from: string
  operation: 'move'
  to: string
}

export interface FileTreeResetEvent extends FileTreeMutationEventInvalidation {
  operation: 'reset'
  pathCountAfter: number
  pathCountBefore: number
  usedPreparedInput: boolean
}

export type FileTreeMutationSemanticEvent =
  | FileTreeAddEvent
  | FileTreeRemoveEvent
  | FileTreeMoveEvent
  | FileTreeResetEvent

export interface FileTreeBatchEvent extends FileTreeMutationEventInvalidation {
  events: readonly FileTreeMutationSemanticEvent[]
  operation: 'batch'
}

export type FileTreeMutationEvent = FileTreeMutationSemanticEvent | FileTreeBatchEvent

export type FileTreeMutationEventType = FileTreeMutationEvent['operation']

export type FileTreeMutationEventForType<TType extends FileTreeMutationEventType | '*'> =
  TType extends '*' ? FileTreeMutationEvent : Extract<FileTreeMutationEvent, { operation: TType }>

export interface FileTreeResetOptions {
  // When provided, replaces the baseline expansion set stored at construction
  // time. Useful when the caller is swapping in a dramatically different path
  // list (e.g. upgrading from an SSR preview to a full dataset) and wants the
  // fresh store to start with expansion state that reflects the new paths.
  initialExpandedPaths?: readonly string[]
  // Must describe the same path list passed to resetPaths(paths, ...).
  preparedInput?: FileTreePreparedInput
}

export interface FileTreeMutationHandle {
  add(path: string): void
  batch(operations: readonly FileTreeBatchOperation[]): void
  move(fromPath: string, toPath: string, options?: FileTreeMoveOptions): void
  onMutation<TType extends FileTreeMutationEventType | '*'>(
    type: TType,
    handler: (event: FileTreeMutationEventForType<TType>) => void,
  ): () => void
  remove(path: string, options?: FileTreeRemoveOptions): void
  resetPaths(paths: readonly string[], options?: FileTreeResetOptions): void
}

export type FileTreeListener = () => void

export type FileTreeSelectionChangeListener = (selectedPaths: readonly string[]) => void

export interface FileTreeContextMenuItem {
  kind: 'directory' | 'file'
  name: string
  path: string
}

export interface FileTreeContextMenuOpenContext {
  anchorElement: HTMLElement
  anchorRect: ContextMenuAnchorRect
  /**
   * Closes the current context menu. Pass `{ restoreFocus: false }` when the
   * caller is about to transfer focus into another owned surface, such as the
   * inline rename input, so the menu close path does not steal focus back to
   * the row first.
   */
  close: (options?: { restoreFocus?: boolean }) => void
  restoreFocus: () => void
}

export type FileTreeContextMenuTriggerMode = 'both' | 'button' | 'right-click'
export type FileTreeContextMenuButtonVisibility = 'always' | 'when-needed'

interface FileTreeContextMenuCompositionOptions {
  enabled?: boolean
  triggerMode?: FileTreeContextMenuTriggerMode
  buttonVisibility?: FileTreeContextMenuButtonVisibility
  onOpen?: (item: FileTreeContextMenuItem, context: FileTreeContextMenuOpenContext) => void
  onClose?: () => void
  /** The menu element, mounted inside the row's menu anchor. */
  render?: (
    item: FileTreeContextMenuItem,
    context: FileTreeContextMenuOpenContext,
  ) => HTMLElement | null
}

export interface FileTreeCompositionOptions {
  contextMenu?: FileTreeContextMenuCompositionOptions
}

/** A small button after the decoration text, such as "Fix with AI" beside an error. */
export interface FileTreeRowDecorationAction {
  label: string
  onActivate: () => void
}

export interface FileTreeRowDecoration {
  text: string
  title?: string
  action?: FileTreeRowDecorationAction
}

export interface FileTreeRowDecorationContext {
  item: FileTreeContextMenuItem
  row: FileTreeVisibleRow
}

export type FileTreeRowDecorationRenderer = (
  context: FileTreeRowDecorationContext,
) => FileTreeRowDecoration | null
