// Modified for Platform from Pierre. Apache-2.0; see packages/tree/LICENSE-pierre and UPSTREAM.md.
import type {
  FileTreeController,
  FileTreeSearchBlurBehavior,
  FileTreeVisibleRow,
} from '@workspace/tree'
import {
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
  useCallback,
} from 'react'

import type { TreeRenderedRowMode } from '@/features/workspace/components/tree-row'
import type { TreeStickyReveal } from '@/features/workspace/hooks/use-tree-sticky-reveal'
import { computeTreeRowClickPlan } from '@/features/workspace/utils/tree-row-click-plan'

/** A row click: selection by modifier, focus, folder toggle, filter close and sticky reveal. */
export function useTreeRowClick({
  claimDomFocus,
  controller,
  isSearchOpen,
  revealCanonicalRowAtStickyOffset,
  searchBlurBehavior,
  setActiveItemPath,
  suppressNextPointerFocusScroll,
  visibleEndIndex,
  visibleStartIndex,
}: {
  readonly claimDomFocus: () => void
  readonly controller: FileTreeController
  readonly isSearchOpen: boolean
  readonly revealCanonicalRowAtStickyOffset: TreeStickyReveal
  readonly searchBlurBehavior: FileTreeSearchBlurBehavior
  readonly setActiveItemPath: Dispatch<SetStateAction<string | null>>
  readonly suppressNextPointerFocusScroll: (path: string) => void
  readonly visibleEndIndex: number
  readonly visibleStartIndex: number
}) {
  const handleRowClick = useCallback(
    (
      event: ReactMouseEvent<HTMLElement>,
      row: FileTreeVisibleRow,
      targetPath: string,
      mode: TreeRenderedRowMode,
    ): void => {
      const plan = computeTreeRowClickPlan({
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
      const clickedRowIsVisible = row.index >= visibleStartIndex && row.index <= visibleEndIndex
      const claimsRowFocus =
        mode === 'flow' &&
        clickedRowIsVisible &&
        clickedElement != null &&
        clickedElement.dataset.itemParked !== 'true'

      if (event.detail > 0 && mode === 'flow' && controller.getFocusedPath() !== actionTargetPath) {
        suppressNextPointerFocusScroll(actionTargetPath)
      }
      controller.focusMountedPathFromInput(actionTargetPath)
      if (claimsRowFocus) {
        claimDomFocus()
        setActiveItemPath((previousPath) =>
          previousPath === actionTargetPath ? previousPath : actionTargetPath,
        )
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
      visibleEndIndex,
      visibleStartIndex,
      revealCanonicalRowAtStickyOffset,
      searchBlurBehavior,
      setActiveItemPath,
      suppressNextPointerFocusScroll,
    ],
  )

  return handleRowClick
}
