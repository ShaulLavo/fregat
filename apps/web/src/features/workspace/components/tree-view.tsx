// Modified for Platform from Pierre. Apache-2.0; see packages/tree/LICENSE-pierre and UPSTREAM.md.
/** @jsxImportSource react */

import { type JSX, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FilterFieldHandle } from '@workspace/ui/patterns/filter-field'
import type { FileTreeRowDecoration, FileTreeVisibleRow } from '@workspace/tree'

import { TreeFilterInput } from '@/features/workspace/components/tree-filter-input'
import type { TreeRenderRowFrame } from '@/features/workspace/components/tree-row'
import { TreeRowWindow } from '@/features/workspace/components/tree-row-window'
import { TreeStickyOverlay } from '@/features/workspace/components/tree-sticky-overlay'
import { useTreeActiveItem } from '@/features/workspace/hooks/use-tree-active-item'
import { useTreeDrag } from '@/features/workspace/hooks/use-tree-drag'
import { useTreeFocusSync } from '@/features/workspace/hooks/use-tree-focus-sync'
import { useTreeKeyboard } from '@/features/workspace/hooks/use-tree-keyboard'
import { useTreeLayout } from '@/features/workspace/hooks/use-tree-layout'
import {
  useTreeRenameHandoff,
  useTreeRenameStart,
} from '@/features/workspace/hooks/use-tree-rename'
import { useTreeRowClick } from '@/features/workspace/hooks/use-tree-row-click'
import { type TreeRowDom, useTreeRowDom } from '@/features/workspace/hooks/use-tree-row-dom'
import { useTreeStickyReveal } from '@/features/workspace/hooks/use-tree-sticky-reveal'
import { useTreeViewportSync } from '@/features/workspace/hooks/use-tree-viewport-sync'
import { createContextMenuItem } from '@/features/workspace/utils/tree-context-menu-anchor'
import { focusElement } from '@/features/workspace/utils/tree-focus'
import {
  getTreeFocusedRowDomId,
  getTreeRowPath,
} from '@/features/workspace/utils/tree-row-identity'
import {
  getTreeRootDomId,
  TREE_DEFAULT_ITEM_HEIGHT,
  TREE_DEFAULT_OVERSCAN,
} from '@/features/workspace/utils/tree-view-layout'
import type { TreeViewProps } from '@/features/workspace/utils/tree-view-props'
import { treeWindowFrame } from '@/features/workspace/utils/tree-window-frame'
import {
  openTreeRowMenu,
  type TreeMenuTrigger,
} from '@/features/workspace/utils/tree-row-menu-open'

export function TreeView({
  controller,
  gitStatusByPath,
  ignoredGitDirectories,
  directoriesWithGitChanges,
  instanceId,
  loadingPaths,
  menuPath = null,
  onCloseMenu,
  onOpenMenu,
  itemHeight = TREE_DEFAULT_ITEM_HEIGHT,
  overscan = TREE_DEFAULT_OVERSCAN,
  renamingEnabled = false,
  renderRowDecoration,
  rowElements,
  searchBlurBehavior = 'close',
  searchEnabled = false,
  searchPlaceholder = 'Search…',
  stickyFolders = false,
  initialScrollTop,
  onScrollTopChange,
}: TreeViewProps): JSX.Element {
  'use no memo'
  // The tree intentionally mutates its stable DOM-ref registry during layout and native events;
  // compiler freezing would break that imperative ownership contract.
  const filterField = useRef<FilterFieldHandle>(null)
  const isScrollingRef = useRef(false)
  const {
    getList,
    getRenameInput,
    getRoot,
    getRowButtons,
    getScroll,
    getSearchInput,
    getStickyRowButtons,
    listRef,
    registerRenameInput,
    registerRowButton,
    registerStickyRowButton,
    rootRef,
    scrollRef,
    searchInputRef,
  } = useTreeRowDom(rowElements)
  const dom: TreeRowDom = {
    getList,
    getRenameInput,
    getRoot,
    getRowButtons,
    getScroll,
    getSearchInput,
    getStickyRowButtons,
  }
  const { layoutState, setLayoutState, setUpdateViewport, updateViewportRef } = useTreeLayout({
    controller,
    getRoot,
    getScroll,
    initialScrollTop,
    itemHeight,
    overscan,
    stickyFolders,
  })
  const ignoredInheritanceCache = useMemo(() => new Map<string, boolean>(), [])
  const [, setControllerRevision] = useState(0)
  const invalidateControllerView = useCallback((): void => {
    setControllerRevision((revision) => revision + 1)
  }, [])
  const [activeItemPath, setActiveItemPath] = useState<string | null>(null)
  const markContextMenuActiveItem = useCallback(
    (path: string): void => {
      setActiveItemPath((previousPath) => (previousPath === path ? previousPath : path))
    },
    [setActiveItemPath],
  )
  const [, setScrollSettledRevision] = useState(0)

  // Trees that mount with an already-open search session (because a caller
  // passed `initialSearchQuery`) should not steal focus from sibling trees
  // during mount when the consumer opted into `'retain'` blur behavior. The
  // legacy `'close'` behavior still auto-focuses so that existing keybind-driven
  // search sessions continue to work.
  const skipInitialSearchAutoFocusRef = useRef(
    searchBlurBehavior === 'retain' && controller.isSearchOpen(),
  )

  const [hasStickyUiMount, setHasStickyUiMount] = useState(false)
  useEffect(() => {
    let mounted = true
    queueMicrotask(() => {
      if (mounted) setHasStickyUiMount(true)
    })
    return () => {
      mounted = false
    }
  }, [])

  const gitLaneActive =
    gitStatusByPath != null || ignoredGitDirectories != null || directoriesWithGitChanges != null
  const renameView = controller.getRenameView()
  const renamingPath = renameView.getPath()
  const isRenaming = renamingPath != null
  const isSearchOpen = controller.isSearchOpen()
  const searchValue = controller.getSearchValue()
  const focusedPath = controller.getFocusedPath()
  const focusedIndex = controller.getFocusedIndex()
  const focusRequestId = controller.getFocusRequestId()
  const scrollRequest = controller.getScrollRequest()
  const searchFocusRequestId = controller.getSearchFocusRequestId()
  const dragAndDropEnabled = controller.isDragAndDropEnabled()
  const dragSession = controller.getDragSession()
  const draggedPathSet = useMemo(
    () => (dragSession == null ? null : new Set(dragSession.draggedPaths)),
    [dragSession],
  )
  const draggedPrimaryPath = dragSession?.primaryPath ?? null
  const treeDomId = getTreeRootDomId(instanceId)
  const {
    overlayHeight: overlayRowsHeight,
    overlayRows,
    snapshot: layoutSnapshot,
    visibleRows,
  } = layoutState
  const resolvedViewportHeight = layoutSnapshot.physical.viewportHeight
  const range = useMemo(
    () => ({
      end: layoutSnapshot.window.endIndex,
      start: layoutSnapshot.window.startIndex,
    }),
    [layoutSnapshot.window.endIndex, layoutSnapshot.window.startIndex],
  )
  // The overlay DOM mirrors `overlayRows` (which includes the scrollTop=0
  // preview). The virtualized scroll content, on the other hand, must only
  // hide rows that the overlay is *actually* sticky-covering — at rest the
  // overlay is CSS-hidden, so filtering out preview rows would leave empty
  // slots where the real rows belong.
  const stickyRows = overlayRows
  const occludedStickyRows = layoutSnapshot.sticky.rows
  const totalScrollableHeight = layoutSnapshot.physical.totalHeight
  const stickyOverlayHeight = layoutSnapshot.sticky.height
  const stickyRowPathSet = useMemo(
    () => new Set(occludedStickyRows.map((entry) => getTreeRowPath(entry.row))),
    [occludedStickyRows],
  )

  const focusedRowIsMounted =
    focusedIndex >= 0 && focusedIndex >= range.start && focusedIndex <= range.end
  const focusCoordinator = useTreeFocusSync({
    controller,
    dom,
    focusedIndex,
    focusedPath,
    focusedRowIsMounted,
    focusRequestId,
    isRenaming,
    isSearchOpen,
    itemHeight,
    range,
    resolvedViewportHeight,
    scrollRequest,
    searchEnabled,
    stickyFolders,
    stickyOverlayHeight,
    totalScrollableHeight,
    updateViewport: updateViewportRef,
    visibleRows,
  })
  const {
    claimDomFocus,
    clearCanonicalStickyReveal,
    preserveStickyAtScrollTop,
    releaseDomFocus,
    requestCanonicalStickyReveal,
    requestSearchCloseFocusRestore,
    shouldRestoreSearchCloseFocus,
    suppressNextPointerFocusScroll,
  } = focusCoordinator
  const renderDecorationForRow = useCallback(
    (row: FileTreeVisibleRow, targetPath: string): FileTreeRowDecoration | null =>
      renderRowDecoration?.({
        item: createContextMenuItem(row, targetPath),
        row,
      }) ?? null,
    [renderRowDecoration],
  )
  const startRenameFromPath = useTreeRenameStart({
    controller,
    getScroll,
    invalidateControllerView,
    itemHeight,
    renamingEnabled,
    requestSearchCloseFocusRestore,
    resolvedViewportHeight,
  })

  // Sticky overlay clicks should land on the canonical row so rename inputs and
  // roving focus stay owned by the in-flow treeitem, not the aria-hidden mirror.
  const revealCanonicalRowAtStickyOffset = useTreeStickyReveal({
    claimDomFocus,
    controller,
    getScroll,
    itemHeight,
    overscan,
    requestCanonicalStickyReveal,
    resolvedViewportHeight,
    stickyFolders,
    updateViewportRef,
  })

  function shouldSuppressContextMenu(): boolean {
    return isScrollingRef.current === true || isTouchInteractionActive()
  }

  useLayoutEffect(() => {
    if (!searchEnabled || !isSearchOpen) {
      return
    }

    if (skipInitialSearchAutoFocusRef.current) {
      skipInitialSearchAutoFocusRef.current = false
      return
    }

    focusElement(getSearchInput())
  }, [getSearchInput, isSearchOpen, searchEnabled, searchFocusRequestId])

  useTreeRenameHandoff({
    clearCanonicalStickyReveal,
    getRenameInput,
    range,
    renamingPath,
    revealCanonicalRowAtStickyOffset,
    stickyRowPathSet,
  })

  useTreeActiveItem({ claimDomFocus, getRoot, releaseDomFocus, setActiveItemPath })

  useTreeViewportSync({
    controller,
    getRoot,
    getScroll,
    initialScrollTop,
    invalidateControllerView,
    itemHeight,
    layoutScrollTop: layoutSnapshot.physical.scrollTop,
    onScrollTopChange,
    overscan,
    setLayoutState,
    setScrollSettledRevision,
    setScrolling: (scrolling) => {
      isScrollingRef.current = scrolling
    },
    setUpdateViewport,
    stickyFolders,
  })

  // The host's list menu closes itself on scroll and when its row goes; the view only reports.
  const contextMenuEnabled = onOpenMenu != null
  const contextMenuOpenPath = menuPath
  const isContextMenuOpen = menuPath != null
  const closeContextMenu = (): void => onCloseMenu?.()
  const openContextMenuForRow = (
    row: FileTreeVisibleRow,
    targetPath: string,
    trigger: TreeMenuTrigger,
  ): void => {
    if (onOpenMenu == null) return

    openTreeRowMenu({
      claimDomFocus,
      controller,
      dom,
      markActiveItem: markContextMenuActiveItem,
      onOpenMenu,
      preserveStickyAtScrollTop,
      row,
      targetPath,
      trigger,
    })
  }
  const onTreeKeyDown = useTreeKeyboard({
    seedSearch: (character) => filterField.current?.seed(character),
    closeContextMenu,
    contextMenuEnabled,
    controller,
    dom,
    focus: focusCoordinator,
    focusedIndex,
    focusedPath,
    invalidateControllerView,
    isContextMenuOpen,
    isSearchOpen,
    itemHeight,
    markActiveItem: markContextMenuActiveItem,
    openContextMenuForRow,
    renameView,
    renamingEnabled,
    resolvedViewportHeight,
    searchBlurBehavior,
    searchEnabled,
    startRenameFromPath,
    stickyOverlayHeight,
    stickyRowPathSet,
  })

  const {
    getDraggedRowSnapshot,
    handleRowDragEnd,
    handleRowDragStart,
    handleRowTouchStart,
    handleTreeDragLeave,
    handleTreeDragOver,
    handleTreeDrop,
    isTouchInteractionActive,
  } = useTreeDrag({
    controller,
    dom,
    dragAndDropEnabled,
    itemHeight,
    updateViewport: updateViewportRef,
  })

  const windowFrame = treeWindowFrame({
    controller,
    draggedPrimaryPath,
    draggedRowSnapshot: getDraggedRowSnapshot(),
    focusedIndex,
    focusedPath,
    focusedRowIsMounted,
    itemHeight,
    layoutSnapshot,
    range,
    resolvedViewportHeight,
    shouldRenderParkedFocusedRow: activeItemPath === focusedPath || shouldRestoreSearchCloseFocus(),
    stickyOverlayHeight,
    visibleRows,
  })
  const focusedVisibleRow =
    focusedIndex >= 0
      ? (visibleRows[focusedIndex] ??
        controller.getVisibleRows(focusedIndex, focusedIndex)[0] ??
        null)
      : null
  const activeDescendantId =
    isSearchOpen && focusedPath != null
      ? getTreeFocusedRowDomId(instanceId, focusedPath, !focusedRowIsMounted)
      : undefined
  const visualFocusPath = contextMenuOpenPath ?? (isSearchOpen ? focusedPath : activeItemPath)
  // The row a mouse press focused draws no ring until the keyboard moves; `:focus-visible` cannot
  // tell, because the row takes focus from script.
  const [pointerFocusPath, setPointerFocusPath] = useState<string | null>(null)
  // Any key, in the tree or before focus reaches it (a shortcut), makes the next focus keyboard's.
  useEffect(() => {
    const clear = () => setPointerFocusPath(null)
    window.addEventListener('keydown', clear, true)
    return () => window.removeEventListener('keydown', clear, true)
  }, [])
  const handleRowClick = useTreeRowClick({
    claimDomFocus,
    controller,
    isSearchOpen,
    revealCanonicalRowAtStickyOffset,
    searchBlurBehavior,
    setActiveItemPath,
    suppressNextPointerFocusScroll,
    visibleEndIndex: layoutSnapshot.visible.endIndex,
    visibleStartIndex: layoutSnapshot.visible.startIndex,
  })

  // Everything renderStyledRow needs that does not vary per row. Splitting
  // sticky vs flow here means the two paths share an identical contract except
  // for where each ref is registered, which is the invariant sticky reuse
  // depends on.
  const flowRowFrame: TreeRenderRowFrame = {
    pointerFocusPath,
    guideFocusPath: focusedVisibleRow?.ancestorPaths.at(-1) ?? null,
    contextMenuOpenPath,
    contextMenuEnabled,
    controller,
    directoriesWithGitChanges,
    dragAndDropEnabled,
    draggedPathSet,
    gitLaneActive,
    gitStatusByPath,
    handleRowDragEnd,
    handleRowDragStart,
    handleRowTouchStart,
    ignoredGitDirectories,
    ignoredInheritanceCache,
    instanceId,
    itemHeight,
    loadingPaths,
    markPointerFocusPath: (path) => {
      setPointerFocusPath(path)
      if (controller.getFocusedPath() === path) return

      suppressNextPointerFocusScroll(path)
    },
    onKeyDown: onTreeKeyDown,
    onRowClick: handleRowClick,
    openContextMenuForRow,
    registerButton: registerRowButton,
    registerRenameInput,
    renameView,
    renderDecorationForRow,
    shouldSuppressContextMenu,
    visualFocusPath,
  }
  const stickyRowFrame: TreeRenderRowFrame = {
    ...flowRowFrame,
    registerButton: registerStickyRowButton,
  }
  const rangeRows =
    range.end < range.start
      ? []
      : controller
          .getVisibleRows(range.start, range.end)
          .filter((row) => !stickyRowPathSet.has(getTreeRowPath(row)))

  return (
    <div
      ref={rootRef}
      id={treeDomId}
      data-file-tree-has-git-lane={gitLaneActive ? 'true' : undefined}
      data-file-tree-virtualized-root='true'
      onDragLeave={dragAndDropEnabled ? handleTreeDragLeave : undefined}
      onDragOver={dragAndDropEnabled ? handleTreeDragOver : undefined}
      onDrop={dragAndDropEnabled ? handleTreeDrop : undefined}
      onKeyDown={onTreeKeyDown}
      role='tree'
      tabIndex={-1}
      style={{
        outline: 'none',
        position: 'relative',
      }}
    >
      {searchEnabled ? (
        <TreeFilterInput
          activeDescendantId={activeDescendantId}
          controller={controller}
          inputRef={searchInputRef}
          fieldRef={filterField}
          onArrowDown={() => controller.requestFocus()}
          placeholder={searchPlaceholder}
          searchBlurBehavior={searchBlurBehavior}
          treeDomId={treeDomId}
          value={searchValue}
        />
      ) : null}
      <div ref={scrollRef} data-file-tree-virtualized-scroll='true'>
        {stickyFolders && hasStickyUiMount && stickyRows.length > 0 ? (
          <TreeStickyOverlay
            frame={stickyRowFrame}
            height={overlayRowsHeight}
            itemHeight={itemHeight}
            rows={stickyRows}
          />
        ) : null}
        <TreeRowWindow
          clipTop={windowFrame.clipTop}
          draggedPrimaryPath={draggedPrimaryPath}
          frame={flowRowFrame}
          height={windowFrame.height}
          listRef={listRef}
          offsetTop={windowFrame.offsetTop}
          parkedDraggedRow={windowFrame.parkedDragged}
          parkedFocusedRow={windowFrame.parkedFocused}
          rangeStart={range.start}
          rows={rangeRows}
          stickyBottomInset={windowFrame.stickyBottomInset}
          stickyTopInset={windowFrame.stickyTopInset}
          stickyOverlayHeight={stickyOverlayHeight}
          viewportHeight={resolvedViewportHeight}
          totalHeight={totalScrollableHeight}
        />
      </div>
    </div>
  )
}
