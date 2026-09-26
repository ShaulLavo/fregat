import type { FileTreeController } from '@workspace/tree'
import { type RefObject, useCallback } from 'react'

import {
  readMeasuredViewportHeight,
  scrollFocusedRowToViewportOffset,
} from '@/features/workspace/utils/tree-focus'
import { computeTreeViewLayoutState } from '@/features/workspace/utils/tree-view-layout'

export type TreeStickyReveal = (
  path: string,
  options?: {
    restoreTreeFocus?: boolean
    targetOffset?: 'live-overlay' | 'sticky-parents'
  },
) => boolean

/** Scrolls a row out from under its sticky mirror, so the in-flow row takes the interaction. */
export function useTreeStickyReveal({
  claimDomFocus,
  controller,
  getScroll,
  itemHeight,
  overscan,
  requestCanonicalStickyReveal,
  resolvedViewportHeight,
  stickyFolders,
  updateViewportRef,
}: {
  readonly claimDomFocus: () => void
  readonly controller: FileTreeController
  readonly getScroll: () => HTMLElement | null
  readonly itemHeight: number
  readonly overscan: number
  readonly requestCanonicalStickyReveal: (path: string | null) => void
  readonly resolvedViewportHeight: number
  readonly stickyFolders: boolean
  readonly updateViewportRef: RefObject<() => void>
}): TreeStickyReveal {
  'use no memo'
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
          : computeTreeViewLayoutState({
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

  return revealCanonicalRowAtStickyOffset
}
