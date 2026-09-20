import type { KeyboardEvent as ReactKeyboardEvent, KeyboardEventHandler } from 'react'

import type { FileTreeFocusCoordinator } from './useFileTreeFocusSync'
import type { FileTreeRowDom } from './useFileTreeRowDom'
import type { FileTreeController } from '../utils/model/FileTreeController'
import type { FileTreeContextMenuOpenContext, FileTreeVisibleRow } from '../utils/model/publicTypes'
import { getContextMenuAnchorButton } from '../utils/render/contextMenuAnchor'
import { isFileTreeDirectoryHandle } from '../utils/render/dragPointer'
import { getActiveTreeElement, readMeasuredViewportHeight } from '../utils/render/focusHelpers'
import {
  BLOCKED_CONTEXT_MENU_NAV_KEYS,
  canKeyUseStickyKeyboardState,
  isSearchOpenSeedKey,
  isSpaceSelectionKey,
} from '../utils/render/keyboard'
import { isContextMenuKey as isContextMenuOpenKey } from '@workspace/utils/keyboard'

interface UseFileTreeKeyboardOptions {
  readonly closeContextMenu: () => void
  readonly contextMenuEnabled: boolean
  readonly controller: FileTreeController
  readonly dom: FileTreeRowDom
  readonly focus: FileTreeFocusCoordinator
  readonly focusedIndex: number
  readonly focusedPath: string | null
  readonly invalidateControllerView: () => void
  readonly isContextMenuOpen: boolean
  readonly isSearchOpen: boolean
  readonly itemHeight: number
  readonly markActiveItem: (path: string) => void
  readonly noteContextMenuInteraction: () => void
  readonly openContextMenuForRow: (
    row: FileTreeVisibleRow,
    targetPath: string,
    options?: {
      anchorRect?: FileTreeContextMenuOpenContext['anchorRect']
      source?: 'button' | 'keyboard' | 'right-click'
    },
  ) => void
  readonly renameView: ReturnType<FileTreeController['getRenameView']>
  readonly renamingEnabled: boolean
  readonly resolvedViewportHeight: number
  readonly searchBlurBehavior: 'close' | 'retain'
  readonly searchEnabled: boolean
  readonly startRenameFromPath: (path?: string) => void
  readonly stickyOverlayHeight: number
  readonly stickyRowPathSet: ReadonlySet<string>
}

interface StickyKeyState {
  readonly activeElement: HTMLElement | null
  readonly activePath: string | null
  readonly activeRowOwnsFocus: boolean
  readonly mountedPathSet: ReadonlySet<string>
}

function getMountedStickyRowPaths(rootElement: HTMLElement | null): string[] {
  if (rootElement == null) return []

  const paths: string[] = []
  for (const element of rootElement.querySelectorAll('button[data-file-tree-sticky-row="true"]')) {
    if (!(element instanceof HTMLElement)) continue

    const path = element.dataset.fileTreeStickyPath
    if (path != null) paths.push(path)
  }
  return paths
}

function getFocusedParkedRowElement(
  rootElement: HTMLElement | null,
  path: string | null,
): HTMLElement | null {
  if (rootElement == null || path == null) return null

  for (const element of rootElement.querySelectorAll(
    'button[data-item-focused="true"][data-item-parked="true"]',
  )) {
    if (element instanceof HTMLElement && element.dataset.itemPath === path) return element
  }
  return null
}

function getStickyKeyboardViewportOffset(
  rootElement: HTMLElement | null,
  scrollElement: HTMLElement | null,
  activeTreeElement: HTMLElement | null,
  path: string | null,
  itemHeight: number,
  stickyOverlayHeight: number,
  viewportHeight: number,
): number {
  const minimumViewportOffset = Math.max(0, stickyOverlayHeight - itemHeight)
  const scrollElementRect = scrollElement?.getBoundingClientRect() ?? null
  const activeElementOffset =
    scrollElementRect == null || activeTreeElement == null
      ? null
      : activeTreeElement.getBoundingClientRect().top - scrollElementRect.top
  const parkedElement = getFocusedParkedRowElement(rootElement, path)
  const parkedElementOffset =
    scrollElementRect == null || parkedElement == null
      ? null
      : parkedElement.getBoundingClientRect().top - scrollElementRect.top
  const preferredOffset =
    parkedElementOffset ?? Math.max(activeElementOffset ?? 0, minimumViewportOffset)
  return Math.max(0, Math.min(preferredOffset, Math.max(0, viewportHeight - itemHeight)))
}

function getStickyKeyState(
  event: ReactKeyboardEvent<HTMLElement>,
  dom: FileTreeRowDom,
  contextMenuEnabled: boolean,
): StickyKeyState {
  const shouldInspect = canKeyUseStickyKeyboardState(event, contextMenuEnabled)
  const rootElement = dom.getRoot()
  const activeElement =
    shouldInspect && rootElement != null ? getActiveTreeElement(rootElement) : null
  const mountedPathSet = shouldInspect
    ? new Set(getMountedStickyRowPaths(rootElement))
    : new Set<string>()
  const activePath = activeElement?.dataset.fileTreeStickyPath ?? null
  return {
    activeElement,
    activePath,
    activeRowOwnsFocus: activeElement?.dataset.fileTreeStickyRow === 'true' && activePath != null,
    mountedPathSet,
  }
}

function finishHandledEvent(
  event: ReactKeyboardEvent<HTMLElement>,
  noteContextMenuInteraction: () => void,
  invalidateControllerView: () => void,
): void {
  noteContextMenuInteraction()
  invalidateControllerView()
  event.preventDefault()
  event.stopPropagation()
}

export function useFileTreeKeyboard(
  options: UseFileTreeKeyboardOptions,
): KeyboardEventHandler<HTMLElement> {
  const {
    closeContextMenu,
    contextMenuEnabled,
    controller,
    dom,
    focus,
    focusedIndex,
    focusedPath,
    invalidateControllerView,
    isContextMenuOpen,
    isSearchOpen,
    itemHeight,
    markActiveItem,
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
  } = options

  const submitFocusedSearchResult = (): void => {
    const currentFocusedPath = controller.getFocusedPath()
    if (currentFocusedPath != null) controller.selectOnlyPath(currentFocusedPath)
    if (searchBlurBehavior === 'retain') return

    const scrollElement = dom.getScroll()
    const viewportHeight = readMeasuredViewportHeight(scrollElement, resolvedViewportHeight)
    const restoreViewportOffset =
      focusedIndex < 0 || scrollElement == null
        ? null
        : Math.max(
            0,
            Math.min(
              focusedIndex * itemHeight - scrollElement.scrollTop,
              Math.max(0, viewportHeight - itemHeight),
            ),
          )
    focus.requestSearchCloseFocusRestore(restoreViewportOffset)
    controller.closeSearch()
  }

  const handleOpenContextMenuKey = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      closeContextMenu()
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (!BLOCKED_CONTEXT_MENU_NAV_KEYS.has(event.key)) return

    event.preventDefault()
    event.stopPropagation()
  }

  const handleRenameKey = (event: ReactKeyboardEvent<HTMLElement>): boolean => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return false
    if (event.key === 'Escape') renameView.cancel()
    if (event.key === 'Enter') renameView.commit()
    return event.key === 'Escape' || event.key === 'Enter'
  }

  const handleSearchKey = (event: ReactKeyboardEvent<HTMLElement>): boolean => {
    if (event.key === 'Escape') {
      focus.cancelSearchCloseFocusRestore()
      controller.closeSearch()
      return true
    }
    if (event.key === 'Enter') {
      submitFocusedSearchResult()
      return true
    }
    if (event.key === 'ArrowDown') {
      controller.focusNextSearchMatch()
      return true
    }
    if (event.key !== 'ArrowUp') return false

    controller.focusPreviousSearchMatch()
    return true
  }

  const performNavigation = (
    event: ReactKeyboardEvent<HTMLElement>,
    effectiveFocusedPath: string | null,
    effectiveFocusedIndex: number,
  ): boolean => {
    const focusedItem = controller.getFocusedItem()
    if (focusedItem == null) return false

    const focusedDirectoryItem = isFileTreeDirectoryHandle(focusedItem) ? focusedItem : null
    if (event.shiftKey && event.key === 'ArrowDown') {
      controller.extendSelectionFromFocused(1)
      return true
    }
    if (event.shiftKey && event.key === 'ArrowUp') {
      controller.extendSelectionFromFocused(-1)
      return true
    }
    if (
      contextMenuEnabled &&
      isContextMenuOpenKey(event) &&
      effectiveFocusedPath != null &&
      effectiveFocusedIndex >= 0
    ) {
      const focusedRow =
        controller.getVisibleRows(effectiveFocusedIndex, effectiveFocusedIndex)[0] ?? null
      const focusedButton = getContextMenuAnchorButton(
        effectiveFocusedPath,
        dom.getStickyRowButtons(),
        dom.getRowButtons(),
      )
      if (focusedRow == null || focusedButton == null) return false

      openContextMenuForRow(focusedRow, effectiveFocusedPath)
      return true
    }
    if ((event.ctrlKey || event.metaKey) && isSpaceSelectionKey(event)) {
      controller.toggleFocusedSelection()
      return true
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      controller.selectAllVisiblePaths()
      return true
    }
    if (event.key === 'ArrowDown') controller.focusNextItem()
    if (event.key === 'ArrowUp') controller.focusPreviousItem()
    if (event.key === 'Home') controller.focusFirstItem()
    if (event.key === 'End') controller.focusLastItem()
    if (event.key === 'ArrowRight' && focusedDirectoryItem?.isExpanded() === false) {
      focusedDirectoryItem.expand()
      return true
    }
    if (event.key === 'ArrowRight') controller.focusNextItem()
    if (event.key === 'ArrowLeft' && focusedDirectoryItem?.isExpanded() === true) {
      focusedDirectoryItem.collapse()
      return true
    }
    if (event.key === 'ArrowLeft') controller.focusParentItem()
    return ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)
  }

  const handleTreeKeyDown: KeyboardEventHandler<HTMLElement> = (event): void => {
    if (isContextMenuOpen) {
      handleOpenContextMenuKey(event)
      return
    }
    if (renameView.isActive()) {
      if (handleRenameKey(event)) {
        finishHandledEvent(event, noteContextMenuInteraction, invalidateControllerView)
      }
      return
    }
    if (renamingEnabled && event.key === 'F2') {
      startRenameFromPath(focusedPath ?? undefined)
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (isSearchOpen) {
      if (handleSearchKey(event)) {
        finishHandledEvent(event, noteContextMenuInteraction, invalidateControllerView)
      }
      return
    }
    if (searchEnabled && isSearchOpenSeedKey(event)) {
      controller.openSearch(event.key)
      invalidateControllerView()
      event.preventDefault()
      event.stopPropagation()
      return
    }

    const stickyState = getStickyKeyState(event, dom, contextMenuEnabled)
    if (
      stickyState.activeRowOwnsFocus &&
      stickyState.activePath !== focusedPath &&
      stickyState.activePath != null &&
      stickyState.mountedPathSet.has(stickyState.activePath)
    ) {
      focus.preserveStickyAtScrollTop(stickyState.activePath, dom.getScroll()?.scrollTop ?? null)
      controller.focusPath(stickyState.activePath)
    }

    const effectiveFocusedPath = controller.getFocusedPath()
    const effectiveFocusedIndex = controller.getFocusedIndex()
    const focusedItem = controller.getFocusedItem()
    if (focusedItem == null) return

    const focusedDirectoryItem = isFileTreeDirectoryHandle(focusedItem) ? focusedItem : null
    const startedFromStickyRow =
      effectiveFocusedPath != null &&
      (stickyRowPathSet.has(effectiveFocusedPath) ||
        (stickyState.activeRowOwnsFocus &&
          stickyState.activePath === effectiveFocusedPath &&
          stickyState.mountedPathSet.has(effectiveFocusedPath)))
    const preserveLocalStickyMove =
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      (event.key === 'ArrowRight' && focusedDirectoryItem?.isExpanded() === true)
    const restoreCollapsedStickyViewport =
      event.key === 'ArrowLeft' &&
      startedFromStickyRow &&
      focusedDirectoryItem?.isExpanded() === true
    if (!performNavigation(event, effectiveFocusedPath, effectiveFocusedIndex)) return

    noteContextMenuInteraction()
    const nextFocusedPath = controller.getFocusedPath()
    const nextPathIsMountedSticky =
      nextFocusedPath != null &&
      (stickyRowPathSet.has(nextFocusedPath) || stickyState.mountedPathSet.has(nextFocusedPath))
    const keyboardMenuStaysOnStickyRow =
      contextMenuEnabled &&
      isContextMenuOpenKey(event) &&
      stickyState.activeRowOwnsFocus &&
      stickyState.activePath === effectiveFocusedPath &&
      nextFocusedPath === effectiveFocusedPath
    const preserveStickyPath =
      (preserveLocalStickyMove &&
        nextFocusedPath !== effectiveFocusedPath &&
        nextPathIsMountedSticky) ||
      keyboardMenuStaysOnStickyRow
    if (
      (startedFromStickyRow || keyboardMenuStaysOnStickyRow) &&
      nextFocusedPath != null &&
      preserveStickyPath
    ) {
      focus.preserveStickyAtScrollTop(nextFocusedPath, dom.getScroll()?.scrollTop ?? null)
      focus.claimDomFocus()
      markActiveItem(nextFocusedPath)
    } else {
      const stickyArrowUpExitsStack =
        event.key === 'ArrowUp' && startedFromStickyRow && nextFocusedPath !== effectiveFocusedPath
      const stickyCollapseStaysOnRow =
        restoreCollapsedStickyViewport && nextFocusedPath === effectiveFocusedPath
      if (nextFocusedPath != null && (stickyArrowUpExitsStack || stickyCollapseStaysOnRow)) {
        focus.restoreStickyAtViewportOffset(
          nextFocusedPath,
          getStickyKeyboardViewportOffset(
            dom.getRoot(),
            dom.getScroll(),
            stickyState.activeElement,
            effectiveFocusedPath,
            itemHeight,
            stickyOverlayHeight,
            resolvedViewportHeight,
          ),
        )
        focus.claimDomFocus()
        markActiveItem(nextFocusedPath)
      } else {
        focus.clearStickyKeyboardFocus()
      }
    }

    invalidateControllerView()
    event.preventDefault()
    event.stopPropagation()
  }

  return handleTreeKeyDown
}
