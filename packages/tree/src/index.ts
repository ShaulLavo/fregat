export { CONTEXT_MENU_TRIGGER_TYPE } from './utils/constants'
export {
  GIT_STATUS_DESCENDANT_TITLE,
  GIT_STATUS_LABEL,
  GIT_STATUS_TITLE,
} from './utils/gitStatusPresentation'
export { resolveFileTreeDensity } from './utils/model/density'
export { FileTreeController } from './utils/model/FileTreeController'
export { applyFileTreeGitStatusPatch, resolveFileTreeGitStatusState } from './utils/model/gitStatus'
export { computeFileTreeLayout, computeStickyRows } from './utils/model/layout'
export { arePathSetsEqual } from './utils/model/pathHelpers'
export {
  FILE_TREE_DEFAULT_ITEM_HEIGHT,
  FILE_TREE_DEFAULT_OVERSCAN,
  FILE_TREE_DEFAULT_VIEWPORT_HEIGHT,
} from './utils/model/virtualization'
export { prepareFileTreeInput, preparePresortedFileTreeInput } from './utils/preparedInput'

export type { FileTreeDensityPreset } from './utils/model/density'
export type { FileTreeGitStatusState } from './utils/model/gitStatus'
export type { FileTreeStickyRowCandidate } from './utils/model/internalTypes'
export type { FileTreeLayoutSnapshot, FileTreeLayoutStickyRow } from './utils/model/layout'
export type {
  FileTreeBatchOperation,
  FileTreeCompositionOptions,
  FileTreeContextMenuButtonVisibility,
  FileTreeContextMenuItem,
  FileTreeContextMenuOpenContext,
  FileTreeContextMenuTriggerMode,
  FileTreeDirectoryHandle,
  FileTreeDragAndDropConfig,
  FileTreeDropContext,
  FileTreeDropResult,
  FileTreeDropTarget,
  FileTreeFileHandle,
  FileTreeGitStatusPatch,
  FileTreeInitialExpansion,
  FileTreeItemHandle,
  FileTreeListener,
  FileTreeMoveOptions,
  FileTreeMutationEvent,
  FileTreeMutationEventForType,
  FileTreeMutationEventType,
  FileTreeMutationHandle,
  FileTreeMutationSemanticEvent,
  FileTreeOptions,
  FileTreePublicId,
  FileTreeRemoveOptions,
  FileTreeRenameEvent,
  FileTreeRenamingConfig,
  FileTreeRenderOptions,
  FileTreeResetOptions,
  FileTreeRowDecoration,
  FileTreeRowDecorationAction,
  FileTreeRowDecorationContext,
  FileTreeRowDecorationRenderer,
  FileTreeScrollBehavior,
  FileTreeScrollOffset,
  FileTreeScrollToPathOptions,
  FileTreeSearchBlurBehavior,
  FileTreeSearchMode,
  FileTreeSearchSessionHandle,
  FileTreeSelectionChangeListener,
  FileTreeSortComparator,
  FileTreeVisibleRow,
} from './utils/model/publicTypes'
export type { FileTreePreparedInput } from './utils/preparedInput'
export type { GitStatus, GitStatusEntry } from './utils/publicTypes'
