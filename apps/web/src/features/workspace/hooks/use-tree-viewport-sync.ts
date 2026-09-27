// Modified for Platform from Pierre. Apache-2.0; see packages/tree/LICENSE-pierre and UPSTREAM.md.
import type { FileTreeController } from '@workspace/tree'
import { type RefObject, useLayoutEffect, useRef } from 'react'

import { transitionControllerSnapshotSubscription } from '@/features/workspace/utils/tree-controller-subscription'
import {
  getCachedViewportHeight,
  getResizeObserverViewportHeight,
  readMeasuredViewportHeight,
  scrollFocusedRowIntoView,
} from '@/features/workspace/utils/tree-focus'
import {
  TREE_DEFAULT_VIEWPORT_HEIGHT,
  computeTreeViewLayoutState,
  type TreeViewLayoutState,
} from '@/features/workspace/utils/tree-view-layout'

export type TreeContextMenuScrollActions = {
  clearHoverPath: () => void
  closeContextMenu: () => void
  isContextMenuOpen: () => boolean
}

/**
 * Keeps the layout snapshot in step with the scroller: scroll, wheel, touch and scroll keys, the
 * controller's changes and the viewport's size. Marks the root while a scroll is in flight so CSS
 * can hide hover affordances in the same frame.
 */
export function useTreeViewportSync({
  contextMenuScrollActionsRef,
  controller,
  getRoot,
  getScroll,
  initialScrollTop,
  invalidateControllerView,
  isScrollingRef,
  itemHeight,
  layoutScrollTop,
  onScrollTopChange,
  overscan,
  setLayoutState,
  setScrollSettledRevision,
  stickyFolders,
  setScrolling,
  setUpdateViewport,
}: {
  readonly contextMenuScrollActionsRef: RefObject<TreeContextMenuScrollActions>
  readonly controller: FileTreeController
  readonly getRoot: () => HTMLElement | null
  readonly getScroll: () => HTMLElement | null
  readonly initialScrollTop: number | undefined
  readonly invalidateControllerView: () => void
  readonly isScrollingRef: RefObject<boolean>
  readonly itemHeight: number
  readonly layoutScrollTop: number
  readonly onScrollTopChange: ((scrollTop: number) => void) | undefined
  readonly overscan: number
  readonly setLayoutState: (state: TreeViewLayoutState) => void
  readonly setScrollSettledRevision: (update: (revision: number) => number) => void
  readonly stickyFolders: boolean
  readonly setScrolling: (scrolling: boolean) => void
  readonly setUpdateViewport: (update: () => void) => void
}): void {
  const hasSeenInitialControllerSnapshotRef = useRef(false)
  const measuredViewportHeightRef = useRef<number | null>(null)
  const initialFocusedScrollAppliedRef = useRef(false)
  const initialFocusedScrollControllerRef = useRef(controller)
  useLayoutEffect(() => {
    if (initialFocusedScrollControllerRef.current === controller) return

    initialFocusedScrollAppliedRef.current = false
    initialFocusedScrollControllerRef.current = controller
  }, [controller])
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
    if (layoutScrollTop <= 0) {
      rootElement.dataset.scrollAtTop = 'true'
    } else {
      delete rootElement.dataset.scrollAtTop
    }
  }, [getRoot, layoutScrollTop])

  useLayoutEffect(() => {
    let scrollTimer: ReturnType<typeof setTimeout> | null = null
    const scrollElement = getScroll()
    const rootElement = getRoot()
    if (scrollElement == null) {
      return
    }

    measuredViewportHeightRef.current = readMeasuredViewportHeight(
      scrollElement,
      TREE_DEFAULT_VIEWPORT_HEIGHT,
    )

    const update = (): void => {
      const nextItemCount = controller.getVisibleCount()
      const nextViewportHeight = getCachedViewportHeight(
        measuredViewportHeightRef.current,
        TREE_DEFAULT_VIEWPORT_HEIGHT,
      )
      const maxScrollTop = Math.max(0, nextItemCount * itemHeight - nextViewportHeight)
      // Collapse can shrink total height under the current scroll position, so
      // clamp scrollTop before recomputing the projected layout snapshot.
      if (scrollElement.scrollTop > maxScrollTop) {
        scrollElement.scrollTop = maxScrollTop
      }

      setLayoutState(
        computeTreeViewLayoutState({
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
          TREE_DEFAULT_VIEWPORT_HEIGHT,
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

    setUpdateViewport(update)
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
      if (rootElement != null) {
        if (rootElement.dataset.isScrolling == null) rootElement.dataset.isScrolling = ''
      }
      setScrolling(true)
      if (scrollTimer != null) {
        clearTimeout(scrollTimer)
      }
      scrollTimer = setTimeout(() => {
        if (rootElement != null) {
          delete rootElement.dataset.isScrolling
        }
        setScrolling(false)
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
              readMeasuredViewportHeight(scrollElement, TREE_DEFAULT_VIEWPORT_HEIGHT)
            update()
          })
        : null
    resizeObserver?.observe(scrollElement)

    return () => {
      setUpdateViewport(() => {})
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
      if (rootElement != null) {
        delete rootElement.dataset.isScrolling
        delete rootElement.dataset.overlayReveal
      }
      // `data-scroll-at-top` is owned by the separate sync layout effect —
      // deleting it here would strand the attribute off if this effect
      // rebinds (e.g. viewportHeight changes) while scrollTop is still 0,
      // because the sync effect only fires when scrollTop itself changes.
      setScrolling(false)
      measuredViewportHeightRef.current = null
      resizeObserver?.disconnect()
    }
  }, [
    controller,
    getRoot,
    getScroll,
    onScrollTopChange,
    initialScrollTop,
    invalidateControllerView,
    itemHeight,
    overscan,
    stickyFolders,
  ])
}
