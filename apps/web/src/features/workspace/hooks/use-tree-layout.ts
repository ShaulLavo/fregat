// Modified for Platform from Pierre. Apache-2.0; see packages/tree/LICENSE-pierre and UPSTREAM.md.
import type { FileTreeController } from '@workspace/tree'
import { useLayoutEffect, useRef, useState } from 'react'

import {
  computeTreeViewLayoutState,
  TREE_DEFAULT_VIEWPORT_HEIGHT,
  type TreeViewLayoutState,
} from '@/features/workspace/utils/tree-view-layout'

interface DensityScrollAnchor {
  itemHeight: number
  logicalScrollTop: number
}

/**
 * The tree's layout snapshot and the refs the viewport sync writes, plus the effects that keep the
 * scroll position through a density change and measure the real scrollbar lane.
 */
export function useTreeLayout({
  controller,
  getRoot,
  getScroll,
  initialScrollTop,
  itemHeight,
  overscan,
  stickyFolders,
}: {
  readonly controller: FileTreeController
  readonly getRoot: () => HTMLElement | null
  readonly getScroll: () => HTMLElement | null
  readonly initialScrollTop: number | undefined
  readonly itemHeight: number
  readonly overscan: number
  readonly stickyFolders: boolean
}) {
  const updateViewportRef = useRef<() => void>(() => {})
  const densityScrollAnchorRef = useRef<DensityScrollAnchor | null>(null)
  // The scroller's right padding subtracts the real scrollbar lane, whose width the app's
  // scrollbar styles decide, so it is measured once the scroller is laid out.
  useLayoutEffect(() => {
    const scroll = getScroll()
    const root = getRoot()
    if (!scroll || !root) return
    const lane = scroll.offsetWidth - scroll.clientWidth
    root.style.setProperty('--trees-scrollbar-gutter-measured', `${Math.max(lane, 0)}px`)
  }, [getRoot, getScroll])
  const [layoutState, setLayoutState] = useState<TreeViewLayoutState>(() =>
    computeTreeViewLayoutState({
      controller,
      itemHeight,
      overscan,
      scrollTop: initialScrollTop ?? 0,
      stickyFolders,
      viewportHeight: TREE_DEFAULT_VIEWPORT_HEIGHT,
    }),
  )
  const layoutSnapshot = layoutState.snapshot

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

  // The viewport sync installs its updater here, so the ref is only written where it lives.
  const setUpdateViewport = (update: () => void): void => {
    updateViewportRef.current = update
  }

  return { layoutState, setLayoutState, setUpdateViewport, updateViewportRef }
}
