// Modified for Platform from Pierre. Apache-2.0; see packages/tree/LICENSE-pierre and UPSTREAM.md.
import type { FileTreeController } from '@workspace/tree'
import { useCallback, useLayoutEffect, useRef } from 'react'

import { focusElement, readMeasuredViewportHeight } from '@/features/workspace/utils/tree-focus'
import { classifyTreeRenameHandoff } from '@/features/workspace/utils/tree-rename-handoff'
import type { TreeStickyReveal } from '@/features/workspace/hooks/use-tree-sticky-reveal'

/** Starts a rename on a row, closing the filter first and remembering where its focus sat. */
export function useTreeRenameStart({
  controller,
  getScroll,
  invalidateControllerView,
  itemHeight,
  noteContextMenuInteraction,
  renamingEnabled,
  requestSearchCloseFocusRestore,
  resolvedViewportHeight,
}: {
  readonly controller: FileTreeController
  readonly getScroll: () => HTMLElement | null
  readonly invalidateControllerView: () => void
  readonly itemHeight: number
  readonly noteContextMenuInteraction: () => void
  readonly renamingEnabled: boolean
  readonly requestSearchCloseFocusRestore: (viewportOffset: number | null) => void
  readonly resolvedViewportHeight: number
}) {
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

  return startRenameFromPath
}

/**
 * Hands focus to the rename input once its row is on screen: reveals the canonical row first when
 * the rename started from a sticky mirror. Re-runs as the window moves so the reveal lands.
 */
export function useTreeRenameHandoff({
  clearCanonicalStickyReveal,
  getRenameInput,
  range,
  renamingPath,
  revealCanonicalRowAtStickyOffset,
  stickyRowPathSet,
}: {
  readonly clearCanonicalStickyReveal: () => void
  readonly getRenameInput: () => HTMLInputElement | null
  readonly range: { readonly end: number; readonly start: number }
  readonly renamingPath: string | null
  readonly revealCanonicalRowAtStickyOffset: TreeStickyReveal
  readonly stickyRowPathSet: ReadonlySet<string>
}): void {
  const previousRenamingPathRef = useRef<string | null>(null)
  // Re-triggers on range / stickyRowPathSet changes so that once a sticky reveal
  // lands the canonical row inside the window, the follow-up render finds the
  // rendered input and grabs focus. The classifier here turns the ref state +
  // rendered-input presence into a single action so the transitions are
  // explicit instead of buried in early-return logic.
  useLayoutEffect(() => {
    const input = getRenameInput()
    const action = classifyTreeRenameHandoff({
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
}
