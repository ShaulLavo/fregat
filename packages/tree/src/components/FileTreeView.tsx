/** @jsxImportSource react */

import {
  type JSX,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { MenuTrigger } from './menu-trigger'
import {
  FileTreeRow,
  type FileTreeRenderedRowMode,
  type FileTreeRenderRowFrame,
} from './FileTreeRow'
import { useContextMenu } from '../hooks/use-context-menu'
import { useFileTreeDrag } from '../hooks/useFileTreeDrag'
import { useFileTreeFocusSync } from '../hooks/useFileTreeFocusSync'
import { useFileTreeKeyboard } from '../hooks/useFileTreeKeyboard'
import { type FileTreeRowDom, useFileTreeRowDom } from '../hooks/useFileTreeRowDom'
import { HEADER_SLOT_NAME } from '../utils/constants'
import { FileTreeController } from '../utils/model/FileTreeController'
import type { FileTreeStickyRowCandidate, FileTreeViewProps } from '../utils/model/internalTypes'
import {
  computeFileTreeLayout,
  computeStickyRows,
  type FileTreeLayoutSnapshot,
  type FileTreeLayoutStickyRow,
} from '../utils/model/layout'
import type { FileTreeRowDecoration, FileTreeVisibleRow } from '../utils/model/publicTypes'
import {
  FILE_TREE_DEFAULT_ITEM_HEIGHT,
  FILE_TREE_DEFAULT_OVERSCAN,
  FILE_TREE_DEFAULT_VIEWPORT_HEIGHT,
} from '../utils/model/virtualization'
import {
  focusElement,
  getActiveTreeElement,
  getCachedViewportHeight,
  getParkedFocusedRowOffset,
  getResizeObserverViewportHeight,
  readMeasuredViewportHeight,
  scrollFocusedRowIntoView,
  scrollFocusedRowToViewportOffset,
} from '../utils/render/focusHelpers'
import { createFileTreeIconResolver } from '../utils/render/iconResolver'
import { classifyFileTreeRenameHandoff } from '../utils/render/renameHandoff'
import { transitionControllerSnapshotSubscription } from '../utils/render/controllerSnapshotSubscription'
import { createContextMenuItem } from '../utils/render/contextMenuAnchor'
import { computeFileTreeRowClickPlan } from '../utils/render/rowClickPlan'
import { getFileTreeFocusedRowDomId, getFileTreeRowPath } from '../utils/render/rowIdentity'

type FileTreeViewLayoutState = {
  snapshot: FileTreeLayoutSnapshot<FileTreeVisibleRow>
  // Rows rendered inside the sticky overlay. Usually equal to
  // `snapshot.sticky.rows`, but at scrollTop=0 we keep this populated with
  // what the overlay would contain at scrollTop=1 so the DOM is ready before
  // the first scroll lands (CSS hides the overlay until the user scrolls, so
  // there's no visual impact at rest). Without this, the overlay has to be
  // created in the same frame that the first scroll happens, and the compositor
  // paints the scrolled rows one frame before React can mount it — showing up
  // as a brief upward jump of the first sticky folder.
  overlayRows: readonly FileTreeLayoutStickyRow<FileTreeVisibleRow>[]
  overlayHeight: number
  visibleRows: readonly FileTreeVisibleRow[]
}

interface DensityScrollAnchor {
  itemHeight: number
  logicalScrollTop: number
}

function computeStickyRowsFromCandidates(
  candidates: readonly FileTreeStickyRowCandidate[],
  scrollTop: number,
  itemHeight: number,
  totalRowCount: number,
): readonly FileTreeLayoutStickyRow<FileTreeVisibleRow>[] {
  return candidates
    .map((candidate, slotDepth) => {
      const defaultTop = slotDepth * itemHeight
      const nextBoundaryIndex = candidate.subtreeEndIndex + 1
      if (nextBoundaryIndex >= totalRowCount) {
        return { row: candidate.row, top: defaultTop }
      }

      const nextBoundaryTop = nextBoundaryIndex * itemHeight - scrollTop
      return {
        row: candidate.row,
        top: Math.min(defaultTop, nextBoundaryTop - itemHeight),
      }
    })
    .filter((entry) => entry.top + itemHeight > 0)
}

// Builds one visible-row snapshot so the layout engine and renderer consume the
// same projection, sticky chain, occlusion window, and mounted list slice.
//
// When sticky folders are disabled we skip materializing the full visible-row
// array — the layout engine only needs the total row count for geometry in
// that case, and the renderer can range-fetch the window slice directly from
// the controller. That keeps scroll work O(window) instead of O(total rows).
function computeFileTreeViewLayoutState({
  controller,
  itemHeight,
  overscan,
  scrollTop,
  stickyFolders,
  viewportHeight,
}: {
  controller: FileTreeController
  itemHeight: number
  overscan: number
  scrollTop: number
  stickyFolders: boolean
  viewportHeight: number
}): FileTreeViewLayoutState {
  const visibleCount = controller.getVisibleCount()
  const stickyCandidates =
    stickyFolders && visibleCount > 0
      ? controller.getStickyRowCandidates(scrollTop, itemHeight)
      : []
  const visibleRows =
    stickyCandidates == null && stickyFolders && visibleCount > 0
      ? controller.getVisibleRows(0, visibleCount - 1)
      : []
  const stickyRows =
    stickyCandidates == null
      ? undefined
      : computeStickyRowsFromCandidates(stickyCandidates, scrollTop, itemHeight, visibleCount)
  const snapshot = computeFileTreeLayout(visibleRows, {
    itemHeight,
    overscan,
    scrollTop,
    stickyRows,
    totalRowCount: visibleCount,
    viewportHeight,
  })

  const previewStickyCandidates =
    stickyFolders && scrollTop <= 0 && visibleCount > 0
      ? controller.getStickyRowCandidates(1, itemHeight)
      : []
  const overlayRows =
    previewStickyCandidates != null && scrollTop <= 0
      ? computeStickyRowsFromCandidates(previewStickyCandidates, 1, itemHeight, visibleCount)
      : stickyFolders && scrollTop <= 0 && visibleRows.length > 0
        ? computeStickyRows(visibleRows, 1, itemHeight)
        : snapshot.sticky.rows
  const overlayHeight = overlayRows.reduce(
    (maxBottom, entry) => Math.max(maxBottom, entry.top + itemHeight),
    0,
  )

  return {
    overlayHeight,
    overlayRows,
    snapshot,
    visibleRows,
  }
}

// Reads the live scroll element's border-box height when an exact viewport
// height is required. `clientHeight` rounds fractional CSS pixels, which
// misaligns sticky virtualization in layouts where a slotted header leaves a
// half-pixel scrollport.

function getFileTreeGuideStyleText(focusedParentPath: string | null): string {
  if (focusedParentPath == null) {
    return ''
  }

  const escapedPath = focusedParentPath.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  // Focus reveals the ancestor; its level colour deliberately stays unchanged.
  return `[data-item-section="spacing-item"][data-ancestor-path="${escapedPath}"] { opacity: var(--trees-indent-guide-active-opacity); }`
}

function getFileTreeRootDomId(instanceId: string | undefined): string | undefined {
  return instanceId == null ? undefined : `${instanceId}__tree`
}

export function FileTreeView({
  composition,
  controller,
  gitStatusByPath,
  ignoredGitDirectories,
  directoriesWithGitChanges,
  icons,
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
  slotHost,
  stickyFolders = false,
  initialScrollTop,
  onScrollTopChange,
  initialViewportHeight = FILE_TREE_DEFAULT_VIEWPORT_HEIGHT,
}: FileTreeViewProps): JSX.Element {
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
  } = useFileTreeRowDom(rowElements)
  const dom: FileTreeRowDom = {
    getList,
    getRenameInput,
    getRoot,
    getRowButtons,
    getScroll,
    getSearchInput,
    getStickyRowButtons,
  }
  const updateViewportRef = useRef<() => void>(() => {})
  const densityScrollAnchorRef = useRef<DensityScrollAnchor | null>(null)
  const measuredViewportHeightRef = useRef<number | null>(null)
  const initialFocusedScrollAppliedRef = useRef(false)
  const initialFocusedScrollControllerRef = useRef(controller)
  useLayoutEffect(() => {
    if (initialFocusedScrollControllerRef.current === controller) return

    initialFocusedScrollAppliedRef.current = false
    initialFocusedScrollControllerRef.current = controller
  }, [controller])
  const previousRenamingPathRef = useRef<string | null>(null)
  const ignoredInheritanceCache = useMemo(() => new Map<string, boolean>(), [])
  const [, setControllerRevision] = useState(0)
  const invalidateControllerView = useCallback((): void => {
    setControllerRevision((revision) => revision + 1)
  }, [])
  const noteContextMenuInteraction = useCallback((): void => {
    contextMenuFocusInteractionRef.current()
  }, [])
  const hasSeenInitialControllerSnapshotRef = useRef(false)
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

  const [layoutState, setLayoutState] = useState<FileTreeViewLayoutState>(() =>
    computeFileTreeViewLayoutState({
      controller,
      itemHeight,
      overscan,
      scrollTop: initialScrollTop ?? 0,
      stickyFolders,
      viewportHeight: initialViewportHeight,
    }),
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
  const { resolveIcon } = useMemo(() => createFileTreeIconResolver(icons), [icons])
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
  const treeDomId = getFileTreeRootDomId(instanceId)
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
    () => new Set(occludedStickyRows.map((entry) => getFileTreeRowPath(entry.row))),
    [occludedStickyRows],
  )

  // Capture against the old rows, then restore only after the new scroll height
  // lands so density growth cannot clamp the anchor to the previous maximum.
  useLayoutEffect(() => {
    const scrollElement = getScroll()
    if (scrollElement == null) return

    const renderedItemHeight = layoutSnapshot.physical.itemHeight
    const pendingAnchor = densityScrollAnchorRef.current
    if (renderedItemHeight !== itemHeight) {
      const logicalScrollTop =
        renderedItemHeight > 0 ? scrollElement.scrollTop / renderedItemHeight : 0
      densityScrollAnchorRef.current = {
        itemHeight,
        logicalScrollTop: pendingAnchor?.logicalScrollTop ?? logicalScrollTop,
      }
      return
    }

    if (pendingAnchor == null) return
    densityScrollAnchorRef.current = null
    if (pendingAnchor.itemHeight !== itemHeight) return

    const nextScrollTop = Math.min(
      pendingAnchor.logicalScrollTop * itemHeight,
      layoutSnapshot.physical.maxScrollTop,
    )
    scrollElement.scrollTop = nextScrollTop
    updateViewportRef.current()
  }, [
    getScroll,
    itemHeight,
    layoutSnapshot.physical.itemHeight,
    layoutSnapshot.physical.maxScrollTop,
  ])

  const focusedRowIsMounted =
    focusedIndex >= 0 && focusedIndex >= range.start && focusedIndex <= range.end
  const focusCoordinator = useFileTreeFocusSync({
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
  const startRenameFromPath = useCallback(
    (path?: string): void => {
      if (!renamingEnabled) {
        return
      }

      if (controller.isSearchOpen()) {
        // Read at call time: a render-time copy in the deps is a value React Compiler cannot
        // prove unmodified, and it then refuses the whole component.
        const currentFocusedIndex = controller.getFocusedIndex()
        const scrollElement = getScroll()
        const viewportHeight = readMeasuredViewportHeight(scrollElement, resolvedViewportHeight)
        const restoreViewportOffset =
          currentFocusedIndex < 0 || scrollElement == null
            ? null
            : Math.max(
                0,
                Math.min(
                  currentFocusedIndex * itemHeight - scrollElement.scrollTop,
                  Math.max(0, viewportHeight - itemHeight),
                ),
              )
        requestSearchCloseFocusRestore(restoreViewportOffset)
      }

      if (controller.startRenaming(path) === false) {
        return
      }

      noteContextMenuInteraction()
      invalidateControllerView()
    },
    [
      controller,
      getScroll,
      invalidateControllerView,
      itemHeight,
      noteContextMenuInteraction,
      renamingEnabled,
      requestSearchCloseFocusRestore,
      resolvedViewportHeight,
    ],
  )

  // Sticky overlay clicks should land on the canonical row so rename inputs and
  // roving focus stay owned by the in-flow treeitem, not the aria-hidden mirror.
  const revealCanonicalRowAtStickyOffset = useCallback(
    (
      path: string,
      {
        restoreTreeFocus = true,
        targetOffset = 'live-overlay',
      }: {
        restoreTreeFocus?: boolean
        targetOffset?: 'live-overlay' | 'sticky-parents'
      } = {},
    ): boolean => {
      const scrollElement = getScroll()
      if (scrollElement == null) {
        return false
      }

      controller.focusPath(path)
      const visibleIndex = controller.getFocusedIndex()
      if (visibleIndex < 0) {
        return false
      }

      const focusedRow = controller.getVisibleRows(visibleIndex, visibleIndex)[0] ?? null
      if (focusedRow == null) {
        return false
      }

      const liveViewportHeight = readMeasuredViewportHeight(scrollElement, resolvedViewportHeight)
      const liveTotalHeight = controller.getVisibleCount() * itemHeight
      const targetViewportOffset =
        targetOffset === 'sticky-parents'
          ? focusedRow.ancestorPaths.length * itemHeight
          : computeFileTreeViewLayoutState({
              controller,
              itemHeight,
              overscan,
              scrollTop: scrollElement.scrollTop,
              stickyFolders,
              viewportHeight: liveViewportHeight,
            }).snapshot.sticky.height

      // A sticky interaction can mutate the tree before we reveal the canonical
      // row. Collapsing the interacted sticky row should leave only its parents
      // pinned, while rename handoff keeps using the live overlay geometry.
      claimDomFocus()
      scrollFocusedRowToViewportOffset(
        scrollElement,
        visibleIndex,
        itemHeight,
        liveViewportHeight,
        liveTotalHeight,
        targetViewportOffset,
      )
      updateViewportRef.current()
      requestCanonicalStickyReveal(restoreTreeFocus ? path : null)
      return true
    },
    [
      claimDomFocus,
      controller,
      getScroll,
      itemHeight,
      overscan,
      requestCanonicalStickyReveal,
      resolvedViewportHeight,
      stickyFolders,
    ],
  )

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

  // Re-triggers on range / stickyRowPathSet changes so that once a sticky reveal
  // lands the canonical row inside the window, the follow-up render finds the
  // rendered input and grabs focus. The classifier here turns the ref state +
  // rendered-input presence into a single action so the transitions are
  // explicit instead of buried in early-return logic.
  useLayoutEffect(() => {
    const input = getRenameInput()
    const action = classifyFileTreeRenameHandoff({
      hasRenderedInput: input != null,
      previousRenamingPath: previousRenamingPathRef.current,
      renamingPath,
    })

    switch (action) {
      case 'reset':
        previousRenamingPathRef.current = null
        return
      case 'reveal-canonical':
        if (renamingPath != null) {
          revealCanonicalRowAtStickyOffset(renamingPath, {
            restoreTreeFocus: false,
            targetOffset: 'live-overlay',
          })
        }
        return
      case 'ignore':
        return
      case 'focus-input':
        if (input != null) {
          clearCanonicalStickyReveal()
          previousRenamingPathRef.current = renamingPath
          focusElement(input)
          input.select()
        }
        return
    }
  }, [
    getRenameInput,
    clearCanonicalStickyReveal,
    range.end,
    range.start,
    renamingPath,
    revealCanonicalRowAtStickyOffset,
    stickyRowPathSet,
  ])

  useLayoutEffect(() => {
    const rootElement = getRoot()
    if (rootElement == null) {
      return
    }
    let nullFocusOutTimer: ReturnType<typeof setTimeout> | null = null

    const clearNullFocusOutTimer = (): void => {
      if (nullFocusOutTimer == null) {
        return
      }

      clearTimeout(nullFocusOutTimer)
      nullFocusOutTimer = null
    }

    const updateActiveItemPath = (): void => {
      const activeTreeElement = getActiveTreeElement(rootElement)
      const nextActiveItemPath = activeTreeElement?.dataset.itemPath ?? null
      setActiveItemPath((previousPath) =>
        previousPath === nextActiveItemPath ? previousPath : nextActiveItemPath,
      )
    }

    const onFocusIn = (): void => {
      clearNullFocusOutTimer()
      claimDomFocus()
      updateActiveItemPath()
    }
    const onFocusOut = (event: FocusEvent): void => {
      const nextTarget = event.relatedTarget
      if (nextTarget == null) {
        // Virtualization can swap the focused row between rendered and parked
        // states before the replacement element receives focus. Defer the
        // ownership check so a true blur to the page can still clear visual
        // focus once the browser has finished moving focus.
        clearNullFocusOutTimer()
        nullFocusOutTimer = setTimeout(() => {
          nullFocusOutTimer = null
          if (getActiveTreeElement(rootElement) != null) {
            updateActiveItemPath()
            return
          }

          releaseDomFocus()
          setActiveItemPath(null)
        }, 0)
        return
      }

      if (!(nextTarget instanceof Node) || !rootElement.contains(nextTarget)) {
        clearNullFocusOutTimer()
        releaseDomFocus()
        setActiveItemPath(null)
        return
      }

      const nextActiveItemPath =
        nextTarget instanceof HTMLElement ? (nextTarget.dataset.itemPath ?? null) : null
      setActiveItemPath((previousPath) =>
        previousPath === nextActiveItemPath ? previousPath : nextActiveItemPath,
      )
    }

    rootElement.addEventListener('focusin', onFocusIn)
    rootElement.addEventListener('focusout', onFocusOut)
    return () => {
      clearNullFocusOutTimer()
      rootElement.removeEventListener('focusin', onFocusIn)
      rootElement.removeEventListener('focusout', onFocusOut)
    }
  }, [claimDomFocus, getRoot, releaseDomFocus])

  // Mirror `scrollTop <= 0` onto the root element as a data attribute so CSS
  // can hide the pre-populated sticky overlay when the list is at rest at the
  // top. We drive this from the layout snapshot (synced on every scroll +
  // layout update) rather than only the scroll event, because programmatic
  // scrolling via keyboard navigation doesn't always fire a `scroll` event
  // across environments, and we want the attribute to track state reliably.
  useLayoutEffect(() => {
    const rootElement = getRoot()
    if (rootElement == null) {
      return
    }
    if (layoutSnapshot.physical.scrollTop <= 0) {
      rootElement.dataset.scrollAtTop = 'true'
    } else {
      delete rootElement.dataset.scrollAtTop
    }
  }, [getRoot, layoutSnapshot.physical.scrollTop])

  useLayoutEffect(() => {
    let scrollTimer: ReturnType<typeof setTimeout> | null = null
    const scrollElement = getScroll()
    const listElement = getList()
    const rootElement = getRoot()
    if (scrollElement == null) {
      return
    }

    measuredViewportHeightRef.current = readMeasuredViewportHeight(
      scrollElement,
      initialViewportHeight,
    )

    const update = (): void => {
      const nextItemCount = controller.getVisibleCount()
      const nextViewportHeight = getCachedViewportHeight(
        measuredViewportHeightRef.current,
        initialViewportHeight,
      )
      const maxScrollTop = Math.max(0, nextItemCount * itemHeight - nextViewportHeight)
      // Collapse can shrink total height under the current scroll position, so
      // clamp scrollTop before recomputing the projected layout snapshot.
      if (scrollElement.scrollTop > maxScrollTop) {
        scrollElement.scrollTop = maxScrollTop
      }

      setLayoutState(
        computeFileTreeViewLayoutState({
          controller,
          itemHeight,
          overscan,
          scrollTop: Math.min(scrollElement.scrollTop, maxScrollTop),
          stickyFolders,
          viewportHeight: nextViewportHeight,
        }),
      )
    }

    // Seed the physical scroll position from the controller's initial focus
    // before the first viewport snapshot, so an initially selected row mounts
    // inside the virtualized window instead of starting at the top of the tree.
    if (!initialFocusedScrollAppliedRef.current) {
      initialFocusedScrollAppliedRef.current = true
      if (initialScrollTop !== undefined) scrollElement.scrollTop = initialScrollTop
      const initialFocusedIndex = controller.getFocusedIndex()
      if (initialScrollTop === undefined && initialFocusedIndex >= 0) {
        const initialViewportHeightPx = getCachedViewportHeight(
          measuredViewportHeightRef.current,
          initialViewportHeight,
        )
        const initialFocusedRow =
          controller.getVisibleRows(initialFocusedIndex, initialFocusedIndex)[0] ?? null
        const initialTopInset =
          stickyFolders && initialFocusedRow != null
            ? Math.max(
                0,
                Math.min(
                  initialFocusedRow.ancestorPaths.length * itemHeight,
                  Math.max(0, initialViewportHeightPx - itemHeight),
                ),
              )
            : 0
        scrollFocusedRowIntoView(
          scrollElement,
          initialFocusedIndex,
          itemHeight,
          initialViewportHeightPx,
          initialTopInset,
        )
      }
    }

    updateViewportRef.current = update
    const unsubscribe = controller.subscribe(() => {
      const transition = transitionControllerSnapshotSubscription(
        hasSeenInitialControllerSnapshotRef.current,
      )
      hasSeenInitialControllerSnapshotRef.current = transition.hasSeenInitialSnapshot
      if (transition.shouldBumpRevision) {
        invalidateControllerView()
      }
      update()
    })
    // Flip a plain DOM attribute on the root (not React state) so the anchor
    // can be hidden via CSS before the compositor paints a scrolled frame.
    // Using state here would require a re-render to land, which is one frame
    // too late — the user would see the floating trigger sit at its old row
    // position for a frame while the rows themselves have already scrolled.
    const markScrolling = (): void => {
      if (listElement != null) {
        if (listElement.dataset.isScrolling == null) listElement.dataset.isScrolling = ''
      }
      if (rootElement != null) {
        if (rootElement.dataset.isScrolling == null) rootElement.dataset.isScrolling = ''
      }
      isScrollingRef.current = true
      if (scrollTimer != null) {
        clearTimeout(scrollTimer)
      }
      scrollTimer = setTimeout(() => {
        if (listElement != null) {
          delete listElement.dataset.isScrolling
        }
        if (rootElement != null) {
          delete rootElement.dataset.isScrolling
        }
        isScrollingRef.current = false
        setScrollSettledRevision((revision) => revision + 1)
        scrollTimer = null
      }, 50)
    }

    // A distinct signal from `is-scrolling`: set *only* when the user initiates
    // a scroll while already at the top. It overrides the "hide overlay at
    // rest" CSS rule for long enough that the overlay is on screen by the time
    // the compositor paints the first scrolled frame. Unlike `is-scrolling`,
    // it is not set during a scroll *to* the top, so the overlay re-hides the
    // instant the user returns there.
    let overlayRevealTimer: ReturnType<typeof setTimeout> | null = null
    const clearOverlayReveal = (): void => {
      if (rootElement != null) {
        delete rootElement.dataset.overlayReveal
      }
      if (overlayRevealTimer != null) {
        clearTimeout(overlayRevealTimer)
        overlayRevealTimer = null
      }
    }
    const markOverlayReveal = (): void => {
      if (rootElement == null) {
        return
      }
      if (scrollElement.scrollTop > 0) {
        // Already past the top; overlay is already visible via scroll-at-top
        // being absent, and we don't want to arm the reveal for the next time
        // the scroll returns to 0.
        return
      }
      rootElement.dataset.overlayReveal = 'true'
      if (overlayRevealTimer != null) {
        clearTimeout(overlayRevealTimer)
      }
      // Fallback cleanup if no scroll event follows (e.g. the user wheeled
      // while already pinned at the top). Long enough for the compositor to
      // commit a frame, short enough that a leftover reveal can't outlive an
      // intended "at rest" state.
      overlayRevealTimer = setTimeout(() => {
        clearOverlayReveal()
      }, 200)
    }

    const onScroll = (): void => {
      onScrollTopChange?.(scrollElement.scrollTop)
      update()
      if (scrollElement.scrollTop > 0) {
        clearOverlayReveal()
      }
      // Only dismiss the context menu when the user drove the scroll
      // (wheel/touch/keyboard). A programmatic scroll — browser-initiated to
      // bring a newly-focused menu item into view, Playwright's scroll-into-
      // view before a click, or React DOM updates adjusting scrollTop — must
      // not close the menu the user is actively interacting with.
      const contextMenuActions = contextMenuScrollActionsRef.current
      if (contextMenuActions.isContextMenuOpen() && isScrollingRef.current) {
        contextMenuActions.closeContextMenu()
      }
      contextMenuActions.clearHoverPath()
      markScrolling()
    }

    // `wheel` / `touchmove` fire on the main thread before the compositor
    // commits the scroll, so setting the scrolling flag here hides the
    // context-menu anchor in the same frame the user sees the content move —
    // no one-frame drift of the floating trigger over the wrong row. When the
    // scroll starts from the very top we also arm the overlay-reveal flag so
    // the pre-mounted sticky overlay is visible through that first frame.
    const onPreScroll = (): void => {
      markScrolling()
      markOverlayReveal()
    }

    // Only the keys that actually move the scroll position should mark the
    // tree as scrolling — otherwise Shift+F10 / ContextMenu / Enter / letter
    // keys all trip the 50ms suppression and, for the ContextMenu case, hide
    // the keyboard-opened menu that was the whole point of the keypress.
    const SCROLL_KEYS = new Set([
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'PageUp',
      'PageDown',
      'Home',
      'End',
      ' ',
      'Spacebar',
    ])
    const onKeyDownPreScroll = (event: KeyboardEvent): void => {
      if (!SCROLL_KEYS.has(event.key)) {
        return
      }
      onPreScroll()
    }

    scrollElement.addEventListener('scroll', onScroll, { passive: true })
    scrollElement.addEventListener('wheel', onPreScroll, { passive: true })
    scrollElement.addEventListener('touchmove', onPreScroll, { passive: true })
    scrollElement.addEventListener('keydown', onKeyDownPreScroll)
    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver((entries) => {
            const observedViewportHeight =
              entries[0] == null ? null : getResizeObserverViewportHeight(entries[0])
            measuredViewportHeightRef.current =
              observedViewportHeight ??
              readMeasuredViewportHeight(scrollElement, initialViewportHeight)
            update()
          })
        : null
    resizeObserver?.observe(scrollElement)

    return () => {
      updateViewportRef.current = () => {}
      unsubscribe()
      scrollElement.removeEventListener('scroll', onScroll)
      scrollElement.removeEventListener('wheel', onPreScroll)
      scrollElement.removeEventListener('touchmove', onPreScroll)
      scrollElement.removeEventListener('keydown', onKeyDownPreScroll)
      if (scrollTimer != null) {
        clearTimeout(scrollTimer)
      }
      if (overlayRevealTimer != null) {
        clearTimeout(overlayRevealTimer)
      }
      if (listElement != null) {
        delete listElement.dataset.isScrolling
      }
      if (rootElement != null) {
        delete rootElement.dataset.isScrolling
        delete rootElement.dataset.overlayReveal
      }
      // `data-scroll-at-top` is owned by the separate sync layout effect —
      // deleting it here would strand the attribute off if this effect
      // rebinds (e.g. viewportHeight changes) while scrollTop is still 0,
      // because the sync effect only fires when scrollTop itself changes.
      isScrollingRef.current = false
      measuredViewportHeightRef.current = null
      resizeObserver?.disconnect()
    }
  }, [
    controller,
    getList,
    getRoot,
    getScroll,
    initialViewportHeight,
    onScrollTopChange,
    initialScrollTop,
    invalidateControllerView,
    itemHeight,
    overscan,
    stickyFolders,
  ])

  const focusedRowIsVisible =
    focusedIndex >= 0 &&
    focusedIndex >= layoutSnapshot.visible.startIndex &&
    focusedIndex <= layoutSnapshot.visible.endIndex
  const focusedRowIsSticky =
    focusedPath != null && stickyRows.some((entry) => getFileTreeRowPath(entry.row) === focusedPath)
  const focusedRowHasVisibleAnchor = focusedRowIsVisible || focusedRowIsSticky
  const {
    anchorRef: contextMenuAnchorRef,
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
    slotHost,
    ownsDomFocus,
    preserveStickyAtScrollTop,
  })
  useLayoutEffect(() => {
    contextMenuScrollActionsRef.current.clearHoverPath = clearHoverPath
    contextMenuScrollActionsRef.current.closeContextMenu = closeContextMenuRef.current
    contextMenuScrollActionsRef.current.isContextMenuOpen = isContextMenuOpenNow
    contextMenuFocusInteractionRef.current = noteFocusInteraction
  }, [clearHoverPath, closeContextMenuRef, isContextMenuOpenNow, noteFocusInteraction])
  const onTreeKeyDown = useFileTreeKeyboard({
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
  } = useFileTreeDrag({
    controller,
    dom,
    dragAndDropEnabled,
    itemHeight,
    updateViewport: updateViewportRef,
  })

  const windowHeight = layoutSnapshot.window.height
  const windowOffsetTop = layoutSnapshot.window.offsetTop
  const windowClipTop =
    stickyOverlayHeight > 0 ? Math.max(0, layoutSnapshot.projected.paneTop - windowOffsetTop) : 0
  // The virtualized window is usually taller than the viewport once overscan
  // is included, so a negative sticky inset lets the overscanned slice hang
  // above and below the scroll container without pinning the element during
  // normal scrolling. Both edges together catch the window when React falls
  // behind a fast scroll in either direction, which is what keeps the list
  // from blanking mid-flick.
  //
  // The bottom edge gets the `stickyOverlayHeight` allowance because sticky
  // folders can bump `windowOffsetTop` below `scrollTop`; loosening only that
  // edge keeps the synced window from being pulled upward. The top edge stays
  // tied to the viewport bottom so a lagging window still fills the view while
  // the user scrolls quickly downward.
  const windowStickyTopInset = Math.min(0, resolvedViewportHeight - windowHeight)
  const windowStickyBottomInset = Math.min(
    0,
    resolvedViewportHeight - windowHeight - stickyOverlayHeight,
  )
  const shouldRenderParkedFocusedRow =
    activeItemPath === focusedPath || shouldRestoreSearchCloseFocus()
  const parkedFocusedRow =
    focusedPath != null && shouldRenderParkedFocusedRow && !focusedRowIsMounted && focusedIndex >= 0
      ? (visibleRows[focusedIndex] ??
        controller.getVisibleRows(focusedIndex, focusedIndex)[0] ??
        null)
      : null
  const parkedFocusedRowOffset =
    parkedFocusedRow == null
      ? null
      : getParkedFocusedRowOffset(focusedIndex, itemHeight, range, windowHeight)
  const draggedRowSnapshot = getDraggedRowSnapshot()
  const draggedRowIsMounted =
    draggedPrimaryPath != null &&
    draggedRowSnapshot != null &&
    draggedRowSnapshot.path === draggedPrimaryPath &&
    draggedRowSnapshot.index >= range.start &&
    draggedRowSnapshot.index <= range.end
  const parkedDraggedRow =
    draggedPrimaryPath != null &&
    draggedRowSnapshot != null &&
    draggedRowSnapshot.path === draggedPrimaryPath &&
    !draggedRowIsMounted &&
    draggedRowSnapshot.path !== parkedFocusedRow?.path
      ? draggedRowSnapshot
      : null
  const parkedDraggedRowOffset =
    parkedDraggedRow == null
      ? null
      : getParkedFocusedRowOffset(parkedDraggedRow.index, itemHeight, range, windowHeight)
  const focusedVisibleRow =
    focusedIndex >= 0
      ? (visibleRows[focusedIndex] ??
        controller.getVisibleRows(focusedIndex, focusedIndex)[0] ??
        null)
      : null
  const guideStyleText = getFileTreeGuideStyleText(focusedVisibleRow?.ancestorPaths.at(-1) ?? null)
  const activeDescendantId =
    isSearchOpen && focusedPath != null
      ? getFileTreeFocusedRowDomId(instanceId, focusedPath, !focusedRowIsMounted)
      : undefined
  const visualFocusPath = contextMenuOpenPath ?? (isSearchOpen ? focusedPath : activeItemPath)
  const handleRowClick = useCallback(
    (
      event: ReactMouseEvent<HTMLElement>,
      row: FileTreeVisibleRow,
      targetPath: string,
      mode: FileTreeRenderedRowMode,
    ): void => {
      const plan = computeFileTreeRowClickPlan({
        event: {
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        },
        isDirectory: row.kind === 'directory',
        isSearchOpen,
        mode,
        searchBlurBehavior,
      })

      const shouldToggleDirectory = plan.toggleDirectory && row.kind === 'directory'
      const mountedDirectoryPath = shouldToggleDirectory
        ? controller.resolveMountedDirectoryPathFromInput(targetPath)
        : null
      if (shouldToggleDirectory && mountedDirectoryPath == null) {
        return
      }
      const actionTargetPath = mountedDirectoryPath ?? targetPath

      switch (plan.selection.kind) {
        case 'range':
          controller.selectPathRange(actionTargetPath, plan.selection.additive)
          break
        case 'toggle':
          controller.togglePathSelectionFromInput(actionTargetPath)
          break
        case 'single':
          controller.selectOnlyMountedPathFromInput(actionTargetPath)
          break
      }

      const clickedElement = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
      const clickedRowIsVisible =
        row.index >= layoutSnapshot.visible.startIndex &&
        row.index <= layoutSnapshot.visible.endIndex
      const shouldExposeFocusedTrigger =
        mode === 'flow' &&
        clickedRowIsVisible &&
        clickedElement != null &&
        clickedElement.dataset.itemParked !== 'true'

      if (event.detail > 0 && mode === 'flow' && controller.getFocusedPath() !== actionTargetPath) {
        suppressNextPointerFocusScroll(actionTargetPath)
      }
      controller.focusMountedPathFromInput(actionTargetPath)
      if (shouldExposeFocusedTrigger) {
        claimDomFocus()
        setActiveItemPath((previousPath) =>
          previousPath === actionTargetPath ? previousPath : actionTargetPath,
        )
        noteContextMenuInteraction()
      }
      if (shouldToggleDirectory) {
        controller.toggleMountedDirectoryFromInput(actionTargetPath)
      }
      if (plan.closeSearch) {
        controller.closeSearch()
      }
      if (plan.revealCanonical) {
        revealCanonicalRowAtStickyOffset(actionTargetPath, {
          targetOffset: 'sticky-parents',
        })
      }
    },
    [
      controller,
      claimDomFocus,
      isSearchOpen,
      layoutSnapshot.visible.endIndex,
      layoutSnapshot.visible.startIndex,
      noteContextMenuInteraction,
      revealCanonicalRowAtStickyOffset,
      searchBlurBehavior,
      setActiveItemPath,
      suppressNextPointerFocusScroll,
    ],
  )

  // Everything renderStyledRow needs that does not vary per row. Splitting
  // sticky vs flow here means the two paths share an identical contract except
  // for where each ref is registered, which is the invariant sticky reuse
  // depends on.
  const flowRowFrame: FileTreeRenderRowFrame = {
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
    resolveIcon,
    shouldSuppressContextMenu,
    visualFocusPath,
  }
  const stickyRowFrame: FileTreeRenderRowFrame = {
    ...flowRowFrame,
    registerButton: registerStickyRowButton,
  }
  const rangeRows =
    range.end < range.start
      ? []
      : controller
          .getVisibleRows(range.start, range.end)
          .filter((row) => !stickyRowPathSet.has(getFileTreeRowPath(row)))

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
      <style
        data-file-tree-guide-style='true'
        dangerouslySetInnerHTML={{ __html: guideStyleText }}
      />
      <slot name={HEADER_SLOT_NAME} data-type='header-slot' />
      {searchEnabled ? (
        <div data-file-tree-search-container data-open={isSearchOpen ? 'true' : 'false'}>
          <input
            ref={searchInputRef}
            aria-activedescendant={activeDescendantId}
            aria-controls={treeDomId}
            placeholder={searchPlaceholder}
            data-file-tree-search-input
            data-file-tree-search-input-fake-focus={fakeSearchFocusActive ? 'true' : undefined}
            value={searchValue}
            onBlur={() => {
              if (searchBlurBehavior === 'retain') return

              controller.closeSearch()
            }}
            onFocus={markSearchInputInteracted}
            onPointerDown={markSearchInputInteracted}
            onInput={(event) => {
              markSearchInputInteracted()
              const target = event.currentTarget
              controller.setSearch(target.value)
            }}
          />
        </div>
      ) : null}
      <div ref={scrollRef} data-file-tree-virtualized-scroll='true'>
        {stickyFolders && hasStickyUiMount && stickyRows.length > 0 ? (
          <div aria-hidden='true' data-file-tree-sticky-overlay='true'>
            <div
              data-file-tree-sticky-overlay-content='true'
              style={{ height: `${overlayRowsHeight}px` }}
            >
              {stickyRows.map((entry, index) => (
                <FileTreeRow
                  key={`sticky:${getFileTreeRowPath(entry.row)}`}
                  frame={stickyRowFrame}
                  row={entry.row}
                  options={{
                    mode: 'sticky',
                    style: {
                      clipPath:
                        entry.top < index * itemHeight
                          ? `inset(${index * itemHeight - entry.top}px 0 0)`
                          : undefined,
                      left: '0',
                      position: 'absolute',
                      right: '0',
                      top: `${entry.top}px`,
                      zIndex: `${stickyRows.length - index}`,
                    },
                  }}
                />
              ))}
            </div>
          </div>
        ) : null}
        <div
          ref={listRef}
          data-file-tree-virtualized-list='true'
          style={{ height: `${totalScrollableHeight}px` }}
        >
          <div
            data-file-tree-virtualized-sticky-offset='true'
            aria-hidden='true'
            style={{ height: `${windowOffsetTop}px` }}
          />
          <div
            data-file-tree-virtualized-sticky='true'
            style={{
              clipPath: windowClipTop > 0 ? `inset(${windowClipTop}px 0 0)` : undefined,
              height: `${windowHeight}px`,
              top: `${windowStickyTopInset}px`,
              bottom: `${windowStickyBottomInset}px`,
            }}
          >
            {rangeRows.map((row, slotIndex) => (
              <FileTreeRow key={range.start + slotIndex} frame={flowRowFrame} row={row} />
            ))}
            {parkedFocusedRow != null && parkedFocusedRowOffset != null ? (
              <FileTreeRow
                key={`parked:${parkedFocusedRow.path}`}
                frame={flowRowFrame}
                row={parkedFocusedRow}
                options={{
                  isParked: true,
                  style: {
                    left: '0',
                    opacity: '0',
                    pointerEvents:
                      draggedPrimaryPath === parkedFocusedRow.path ? 'none' : undefined,
                    position: 'absolute',
                    right: '0',
                    top: `${parkedFocusedRowOffset}px`,
                  },
                }}
              />
            ) : null}
            {parkedDraggedRow != null && parkedDraggedRowOffset != null ? (
              <FileTreeRow
                key={`parked-drag:${parkedDraggedRow.path}`}
                frame={flowRowFrame}
                row={parkedDraggedRow}
                options={{
                  isParked: true,
                  style: {
                    left: '0',
                    opacity: '0',
                    pointerEvents: 'none',
                    position: 'absolute',
                    right: '0',
                    top: `${parkedDraggedRowOffset}px`,
                  },
                }}
              />
            ) : null}
          </div>
        </div>
      </div>
      {contextMenuEnabled ? (
        <MenuTrigger
          anchorRef={contextMenuAnchorRef}
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
          icon={resolveIcon('file-tree-icon-ellipsis')}
          closeMenu={closeContextMenu}
          openMenu={openMenuFromTrigger}
        />
      ) : null}

      {isContextMenuOpen ? (
        <div
          data-type='context-menu-wash'
          aria-hidden='true'
          onMouseDownCapture={(event) => {
            event.preventDefault()
            closeContextMenu()
          }}
          onTouchStartCapture={(event) => {
            event.preventDefault()
            event.stopPropagation()
            closeContextMenu()
          }}
          onTouchMoveCapture={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onWheelCapture={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
        />
      ) : null}
    </div>
  )
}
