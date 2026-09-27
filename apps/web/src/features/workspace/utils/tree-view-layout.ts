// Modified for Platform from Pierre. Apache-2.0; see packages/tree/LICENSE-pierre and UPSTREAM.md.
import type {
  FileTreeController,
  FileTreeLayoutSnapshot,
  FileTreeLayoutStickyRow,
  FileTreeStickyRowCandidate,
  FileTreeVisibleRow,
} from '@workspace/tree'
import { computeFileTreeLayout, computeStickyRows } from '@workspace/tree'

export type TreeViewLayoutState = {
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
export function computeTreeViewLayoutState({
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
}): TreeViewLayoutState {
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

export function getTreeGuideStyleText(
  treeDomId: string | undefined,
  focusedParentPath: string | null,
): string {
  if (focusedParentPath == null) {
    return ''
  }

  const escape = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  // A document-level rule, so it names this tree; other trees keep their own guides.
  const scope = treeDomId == null ? '' : `[id="${escape(treeDomId)}"] `
  // Focus reveals the ancestor; its level colour deliberately stays unchanged.
  return `${scope}[data-item-section="spacing-item"][data-ancestor-path="${escape(focusedParentPath)}"] { opacity: var(--trees-indent-guide-active-opacity); }`
}

export function getTreeRootDomId(instanceId: string | undefined): string | undefined {
  return instanceId == null ? undefined : `${instanceId}__tree`
}
