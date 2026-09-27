// Modified for Platform from Pierre. Apache-2.0; see packages/tree/LICENSE-pierre and UPSTREAM.md.
/** @jsxImportSource react */

import { type JSX, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FileTreeRowDecoration, FileTreeVisibleRow } from '@workspace/tree'
import {
  FILE_TREE_DEFAULT_ITEM_HEIGHT,
  FILE_TREE_DEFAULT_OVERSCAN,
  FILE_TREE_DEFAULT_VIEWPORT_HEIGHT,
} from '@workspace/tree'

import { TreeContextMenuWash } from '@/features/workspace/components/tree-context-menu-wash'
import { TreeFilterInput } from '@/features/workspace/components/tree-filter-input'
import { MenuTrigger } from '@/features/workspace/components/tree-menu-trigger'
import type { TreeRenderRowFrame } from '@/features/workspace/components/tree-row'
import { TreeRowWindow } from '@/features/workspace/components/tree-row-window'
import { TreeStickyOverlay } from '@/features/workspace/components/tree-sticky-overlay'
import { useTreeActiveItem } from '@/features/workspace/hooks/use-tree-active-item'
import { useContextMenu } from '@/features/workspace/hooks/use-tree-context-menu'
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
import { getTreeRootDomId } from '@/features/workspace/utils/tree-view-layout'
import type { TreeViewProps } from '@/features/workspace/utils/tree-view-props'
import { treeWindowFrame } from '@/features/workspace/utils/tree-window-frame'

export function TreeView({
  composition,
  controller,
  gitStatusByPath,
  ignoredGitDirectories,
  directoriesWithGitChanges,
  instanceId,
  loadingPaths,
  itemHeight = FILE_TREE_DEFAULT_ITEM_HEIGHT,
  overscan = FILE_TREE_DEFAULT_OVERSCAN,
  renamingEnabled = false,
  renderRowDecoration,
  rowElements,
  searchBlurBehavior = 'close',
  searchEnabled = false,
  searchFakeFocus = false,
  searchPlaceholder = 'Search…',
  stickyFolders = false,
  initialScrollTop,
  onScrollTopChange,
  initialViewportHeight = FILE_TREE_DEFAULT_VIEWPORT_HEIGHT,
}: TreeViewProps): JSX.Element {
  'use no memo'
  // The tree intentionally mutates its stable DOM-ref registry during layout and native events;
  // compiler freezing would break that imperative ownership contract.
  const isScrollingRef = useRef(false)
  const contextMenuScrollActionsRef = useRef({
    clearHoverPath: (): void => {},
    closeContextMenu: (): void => {},
    isContextMenuOpen: (): boolean => false,
  })
  const contextMenuFocusInteractionRef = useRef<() => void>(() => {})
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
    initialViewportHeight,
    itemHeight,
    overscan,
    stickyFolders,
  })
  const ignoredInheritanceCache = useMemo(() => new Map<string, boolean>(), [])
  const [, setControllerRevision] = useState(0)
  const invalidateControllerView = useCallback((): void => {
    setControllerRevision((revision) => revision + 1)
  }, [])
  const noteContextMenuInteraction = useCallback((): void => {
    contextMenuFocusInteractionRef.current()
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

  // When `searchFakeFocus` is enabled, render a synthetic focus ring on the
  // search input until the user actually interacts with it. The flag flips off
  // on the first real focus, pointer-down, or input event so normal focus
  // behavior takes over once the user engages.
  const [fakeSearchFocusActive, setFakeSearchFocusActive] = useState<boolean>(searchFakeFocus)
  useEffect(() => {
    if (searchFakeFocus) return

    let active = true
    queueMicrotask(() => {
      if (active) setFakeSearchFocusActive(false)
    })
    return () => {
      active = false
    }
  }, [searchFakeFocus])

  const markSearchInputInteracted = useCallback(() => {
    setFakeSearchFocusActive((previous) => (previous ? false : previous))
  }, [])

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
    ownsDomFocus,
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
    noteContextMenuInteraction,
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
    contextMenuScrollActionsRef,
    controller,
    getRoot,
    getScroll,
    initialScrollTop,
    initialViewportHeight,
    invalidateControllerView,
    isScrollingRef,
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

  const focusedRowIsVisible =
    focusedIndex >= 0 &&
    focusedIndex >= layoutSnapshot.visible.startIndex &&
    focusedIndex <= layoutSnapshot.visible.endIndex
  const focusedRowIsSticky =
    focusedPath != null && stickyRows.some((entry) => getTreeRowPath(entry.row) === focusedPath)
  const focusedRowHasVisibleAnchor = focusedRowIsVisible || focusedRowIsSticky
  const {
    anchorRef: contextMenuAnchorRef,
    contentHostRef: contextMenuContentHostRef,
    clearHoverPath,
    closeContextMenu,
    closeContextMenuRef,
    triggerStore,
    focusTriggerPath,
    contextMenuButtonTriggerEnabled,
    contextMenuButtonVisibility,
    contextMenuEnabled,
    contextMenuOpenPath,
    contextMenuPointerAnchorRect,
    contextMenuRightClickEnabled,
    contextMenuTriggerMode,
    handleTreePointerLeave,
    handleTreePointerOver,
    isContextMenuOpen,
    isContextMenuOpenNow,
    isPointerContextMenuOpen,
    noteFocusInteraction,
    openContextMenuForRow,
    openMenuFromTrigger,
    triggerRef: contextMenuTriggerRef,
  } = useContextMenu({
    composition,
    controller,
    dom,
    claimDomFocus,
    focusedPath,
    focusedRowHasVisibleAnchor,
    isScrolling: isScrollingRef,
    markActiveItem: markContextMenuActiveItem,
    ownsDomFocus,
    preserveStickyAtScrollTop,
  })
  useLayoutEffect(() => {
    contextMenuScrollActionsRef.current.clearHoverPath = clearHoverPath
    contextMenuScrollActionsRef.current.closeContextMenu = closeContextMenuRef.current
    contextMenuScrollActionsRef.current.isContextMenuOpen = isContextMenuOpenNow
    contextMenuFocusInteractionRef.current = noteFocusInteraction
  }, [clearHoverPath, closeContextMenuRef, isContextMenuOpenNow, noteFocusInteraction])
  const onTreeKeyDown = useTreeKeyboard({
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
    noteContextMenuInteraction,
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
  const handleRowClick = useTreeRowClick({
    claimDomFocus,
    controller,
    isSearchOpen,
    noteContextMenuInteraction,
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
    contextMenuButtonTriggerEnabled,
    contextMenuButtonVisibility,
    contextMenuEnabled,
    contextMenuRightClickEnabled,
    contextMenuTriggerMode,
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
      data-file-tree-context-menu-button-visibility={
        contextMenuEnabled && contextMenuButtonTriggerEnabled
          ? contextMenuButtonVisibility
          : undefined
      }
      data-file-tree-context-menu-trigger-mode={
        contextMenuEnabled ? contextMenuTriggerMode : undefined
      }
      data-file-tree-has-context-menu-action-lane={
        contextMenuEnabled && contextMenuButtonTriggerEnabled ? 'true' : undefined
      }
      data-file-tree-has-git-lane={gitLaneActive ? 'true' : undefined}
      data-file-tree-virtualized-root='true'
      onDragLeave={dragAndDropEnabled ? handleTreeDragLeave : undefined}
      onDragOver={dragAndDropEnabled ? handleTreeDragOver : undefined}
      onDrop={dragAndDropEnabled ? handleTreeDrop : undefined}
      onKeyDown={onTreeKeyDown}
      onKeyDownCapture={() => setPointerFocusPath(null)}
      onPointerLeave={
        contextMenuEnabled && contextMenuButtonTriggerEnabled ? handleTreePointerLeave : undefined
      }
      onPointerOver={
        contextMenuEnabled && contextMenuButtonTriggerEnabled ? handleTreePointerOver : undefined
      }
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
          fakeFocus={fakeSearchFocusActive}
          inputRef={searchInputRef}
          isOpen={isSearchOpen}
          onInteract={markSearchInputInteracted}
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
          totalHeight={totalScrollableHeight}
        />
      </div>
      {contextMenuEnabled ? (
        <MenuTrigger
          anchorRef={contextMenuAnchorRef}
          contentHostRef={contextMenuContentHostRef}
          triggerRef={contextMenuTriggerRef}
          store={triggerStore}
          dom={dom}
          focusPath={focusTriggerPath}
          openPath={contextMenuOpenPath}
          pointerRect={contextMenuPointerAnchorRect}
          isPointerMenu={isPointerContextMenuOpen}
          isRenaming={isRenaming}
          isScrolling={isScrollingRef}
          buttonEnabled={contextMenuButtonTriggerEnabled}
          closeMenu={closeContextMenu}
          openMenu={openMenuFromTrigger}
        />
      ) : null}

      {isContextMenuOpen ? <TreeContextMenuWash onClose={closeContextMenu} /> : null}
    </div>
  )
}
