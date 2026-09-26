import type {
  FileTreeContextMenuButtonVisibility,
  FileTreeContextMenuTriggerMode,
  FileTreeVisibleRow,
} from '@workspace/tree'
import type { GitStatus } from '@workspace/tree'
import type { TreeRowClickMode } from '@/features/workspace/utils/tree-row-click-plan'

// Visual/interaction state that shows up as data attributes on the row. Kept as
// plain booleans (rather than references to dragSession, selectionSets, etc.)
// so the attribute helper is fully pure and table-testable.
type TreeRowStateFlags = {
  isFocusRinged: boolean
  isContextHovered: boolean
  isDragging: boolean
  effectiveGitStatus: GitStatus | null
  containsGitChange: boolean
  isLoading: boolean
}

// Feature-level flags derived from the tree's configuration. These translate
// 1:1 into data attributes that downstream CSS and integration tests rely on.
type TreeRowFeatureFlags = {
  contextMenuEnabled: boolean
  actionLaneEnabled: boolean
  contextMenuButtonVisibility: FileTreeContextMenuButtonVisibility | null
  contextMenuTriggerMode: FileTreeContextMenuTriggerMode | null
  gitLaneActive: boolean
}

export type TreeRowElementAttributesInput = {
  row: FileTreeVisibleRow
  mode: TreeRowClickMode
  targetPath: string
  ariaLabel: string
  domId: string | undefined
  isParked: boolean
  itemHeight: number
  features: TreeRowFeatureFlags
  state: TreeRowStateFlags
  extraStyle?: Record<string, string | undefined>
}

// Builds the HTML attribute bag for a file-tree row — everything except event
// handlers, ref callbacks, and the JSX `key`. Splitting `flow` vs `sticky` here
// ensures aria/role/id/tabIndex/focus semantics differ in exactly one place,
// and that the sticky mirror never leaks `treeitem` semantics to AT.
export function computeTreeRowElementAttributes(
  input: TreeRowElementAttributesInput,
): Record<string, unknown> {
  const {
    row,
    mode,
    targetPath,
    ariaLabel,
    domId,
    isParked,
    itemHeight,
    features,
    state,
    extraStyle,
  } = input
  const isSticky = mode === 'sticky'
  const parentPath = row.ancestorPaths.at(-1) ?? ''

  const stateAttributes: Record<string, unknown> = {}
  if (state.isFocusRinged) {
    stateAttributes['data-item-focused'] = true
  }
  if (row.isSelected) {
    stateAttributes['data-item-selected'] = true
  }
  if (state.isContextHovered) {
    stateAttributes['data-item-context-hover'] = 'true'
  }
  if (state.isDragging) {
    stateAttributes['data-item-dragging'] = true
  }
  if (state.effectiveGitStatus != null) {
    stateAttributes['data-item-git-status'] = state.effectiveGitStatus
  }
  if (state.containsGitChange) {
    stateAttributes['data-item-contains-git-change'] = 'true'
  }
  if (state.isLoading) {
    stateAttributes['aria-busy'] = 'true'
    stateAttributes['data-item-loading'] = 'true'
  }

  return {
    'aria-expanded': !isSticky && row.kind === 'directory' ? row.isExpanded : undefined,
    'aria-haspopup': features.contextMenuEnabled ? 'menu' : undefined,
    'aria-label': ariaLabel,
    'aria-level': !isSticky ? row.level + 1 : undefined,
    'aria-posinset': !isSticky ? row.posInSet + 1 : undefined,
    'aria-selected': !isSticky ? (row.isSelected ? 'true' : 'false') : undefined,
    'aria-setsize': !isSticky ? row.setSize : undefined,
    'data-file-tree-sticky-path': isSticky ? targetPath : undefined,
    'data-file-tree-sticky-row': isSticky ? 'true' : undefined,
    'data-item-context-menu-button-visibility': features.actionLaneEnabled
      ? features.contextMenuButtonVisibility
      : undefined,
    'data-item-context-menu-trigger-mode': features.contextMenuEnabled
      ? features.contextMenuTriggerMode
      : undefined,
    'data-item-has-context-menu-action-lane': features.actionLaneEnabled ? 'true' : undefined,
    'data-item-has-git-lane': features.gitLaneActive ? 'true' : undefined,
    'data-item-parent-path': parentPath.length > 0 ? parentPath : undefined,
    'data-item-parked': isParked ? 'true' : undefined,
    'data-item-path': targetPath,
    'data-item-type': row.kind === 'directory' ? 'folder' : 'file',
    'data-type': 'item',
    id: !isSticky ? domId : undefined,
    role: !isSticky ? 'treeitem' : undefined,
    style: { minHeight: `${itemHeight}px`, ...extraStyle },
    tabIndex: !isSticky && row.isFocused ? 0 : -1,
    ...stateAttributes,
  }
}
