import { type RefObject, useCallback, useEffectEvent, useLayoutEffect, useRef } from 'react'

import type { FileTreeRowDom } from './useFileTreeRowDom'
import type { FileTreeController } from '../utils/model/FileTreeController'
import type { FileTreeVisibleRow } from '../utils/model/publicTypes'
import {
  focusElement,
  getActiveTreeElement,
  scrollFocusedRowIntoView,
  scrollFocusedRowToOffset,
  scrollFocusedRowToViewportOffset,
} from '../utils/render/focusHelpers'
import {
  getStickyKeyboardFocusPath,
  getStickyKeyboardScrollTopEntry,
  getStickyKeyboardViewportOffsetEntry,
  NO_STICKY_KEYBOARD_FOCUS,
  preserveStickyKeyboardFocusAtScrollTop,
  restoreStickyKeyboardViewportOffset,
  settleStickyKeyboardFocus,
  type StickyKeyboardFocusMode,
} from '../utils/render/stickyFocusMode'

export interface FileTreeFocusCoordinator {
  readonly cancelSearchCloseFocusRestore: () => void
  readonly claimDomFocus: () => void
  readonly clearCanonicalStickyReveal: () => void
  readonly clearStickyKeyboardFocus: () => void
  readonly ownsDomFocus: () => boolean
  readonly preserveStickyAtScrollTop: (path: string, scrollTop: number | null) => void
  readonly releaseDomFocus: () => void
  readonly requestCanonicalStickyReveal: (path: string | null) => void
  readonly requestSearchCloseFocusRestore: (viewportOffset: number | null) => void
  readonly restoreStickyAtViewportOffset: (path: string, viewportOffset: number) => void
  readonly shouldRestoreSearchCloseFocus: () => boolean
  readonly suppressNextPointerFocusScroll: (path: string) => void
}

interface PendingScrollSettlement {
  readonly path: string
  readonly request: NonNullable<ReturnType<FileTreeController['getScrollRequest']>>
}

interface UseFileTreeFocusSyncOptions {
  readonly controller: FileTreeController
  readonly dom: FileTreeRowDom
  readonly focusedIndex: number
  readonly focusedPath: string | null
  readonly focusedRowIsMounted: boolean
  readonly focusRequestId: number | null
  readonly isRenaming: boolean
  readonly isSearchOpen: boolean
  readonly itemHeight: number
  readonly range: { readonly end: number; readonly start: number }
  readonly resolvedViewportHeight: number
  readonly scrollRequest: ReturnType<FileTreeController['getScrollRequest']>
  readonly searchEnabled: boolean
  readonly stickyFolders: boolean
  readonly stickyOverlayHeight: number
  readonly totalScrollableHeight: number
  readonly updateViewport: RefObject<() => void>
  readonly visibleRows: readonly FileTreeVisibleRow[]
}

export function useFileTreeFocusSync(
  options: UseFileTreeFocusSyncOptions,
): FileTreeFocusCoordinator {
  'use no memo'
  // Focus settlement synchronously mutates the shared DOM registry and coordination refs;
  // compiler freezing would change focus/scroll ordering.
  const {
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
    updateViewport,
    visibleRows,
  } = options
  const { getRenameInput, getRoot, getRowButtons, getScroll, getSearchInput } = dom
  const domFocusOwnerRef = useRef(false)
  const pendingStickyFocusPathRef = useRef<string | null>(null)
  const pointerFocusScrollPathRef = useRef<string | null>(null)
  const previousFocusedPathRef = useRef<string | null>(null)
  const processedFocusRequestIdRef = useRef<number | null>(null)
  const processedScrollRequestIdRef = useRef(0)
  const pendingScrollSettlementRef = useRef<PendingScrollSettlement | null>(null)
  const restoreTreeFocusAfterSearchCloseRef = useRef(false)
  const restoreTreeFocusViewportOffsetRef = useRef<number | null>(null)
  const stickyKeyboardFocusRef = useRef<StickyKeyboardFocusMode>(NO_STICKY_KEYBOARD_FOCUS)

  const cancelSearchCloseFocusRestore = useCallback((): void => {
    restoreTreeFocusAfterSearchCloseRef.current = false
    restoreTreeFocusViewportOffsetRef.current = null
  }, [])
  const claimDomFocus = useCallback((): void => {
    domFocusOwnerRef.current = true
  }, [])
  const clearCanonicalStickyReveal = useCallback((): void => {
    pendingStickyFocusPathRef.current = null
  }, [])
  const clearStickyKeyboardFocus = useCallback((): void => {
    stickyKeyboardFocusRef.current = NO_STICKY_KEYBOARD_FOCUS
  }, [])
  const ownsDomFocus = useCallback((): boolean => domFocusOwnerRef.current, [])
  const preserveStickyAtScrollTop = useCallback((path: string, scrollTop: number | null): void => {
    stickyKeyboardFocusRef.current = preserveStickyKeyboardFocusAtScrollTop(path, scrollTop)
  }, [])
  const releaseDomFocus = useCallback((): void => {
    domFocusOwnerRef.current = false
  }, [])
  const requestCanonicalStickyReveal = useCallback((path: string | null): void => {
    pendingStickyFocusPathRef.current = path
  }, [])
  const requestSearchCloseFocusRestore = useCallback((viewportOffset: number | null): void => {
    restoreTreeFocusViewportOffsetRef.current = viewportOffset
    restoreTreeFocusAfterSearchCloseRef.current = true
  }, [])
  const restoreStickyAtViewportOffset = useCallback(
    (path: string, viewportOffset: number): void => {
      stickyKeyboardFocusRef.current = restoreStickyKeyboardViewportOffset(path, viewportOffset)
    },
    [],
  )
  const shouldRestoreSearchCloseFocus = useCallback(
    (): boolean => restoreTreeFocusAfterSearchCloseRef.current,
    [],
  )
  const suppressNextPointerFocusScroll = useCallback((path: string): void => {
    pointerFocusScrollPathRef.current = path
  }, [])

  const applyScrollRequest = useEffectEvent(
    (request: NonNullable<typeof scrollRequest>, behavior = request.behavior) => {
      const scrollElement = getScroll()
      const row = controller.getVisibleRows(request.visibleIndex, request.visibleIndex)[0]
      if (!scrollElement || !row) return null
      const topInset = stickyFolders
        ? Math.max(
            0,
            Math.min(
              row.ancestorPaths.length * itemHeight,
              Math.max(0, resolvedViewportHeight - itemHeight),
            ),
          )
        : stickyOverlayHeight
      return {
        path: row.path,
        scrolled: scrollFocusedRowToOffset(
          scrollElement,
          request.visibleIndex,
          itemHeight,
          resolvedViewportHeight,
          totalScrollableHeight,
          request.offset,
          topInset,
          behavior,
        ),
      }
    },
  )
  const settleScrollRequest = useEffectEvent(() => {
    const pending = pendingScrollSettlementRef.current
    pendingScrollSettlementRef.current = null
    if (!pending) return
    const { request, path } = pending
    const newerRequest = controller.getScrollRequest()
    if (newerRequest && newerRequest.id !== request.id) return
    const row = controller.getVisibleRows(request.visibleIndex, request.visibleIndex)[0]
    if (row?.path !== path) return
    if (applyScrollRequest(request, 'auto')?.scrolled) updateViewport.current()
  })

  useLayoutEffect(() => {
    const scrollElement = getScroll()
    if (!scrollElement) return
    const cancel = () => {
      pendingScrollSettlementRef.current = null
    }
    scrollElement.addEventListener('scroll', settleScrollRequest)
    for (const event of ['wheel', 'pointerdown', 'touchstart', 'keydown']) {
      scrollElement.addEventListener(event, cancel)
    }
    return () => {
      cancel()
      scrollElement.removeEventListener('scroll', settleScrollRequest)
      for (const event of ['wheel', 'pointerdown', 'touchstart', 'keydown']) {
        scrollElement.removeEventListener(event, cancel)
      }
    }
  }, [controller, getScroll])

  useLayoutEffect(() => {
    const scrollElement = getScroll()
    const rootElement = getRoot()
    if (scrollElement == null || rootElement == null) {
      previousFocusedPathRef.current = focusedPath
      return
    }

    const focusedButton = focusedPath == null ? null : (getRowButtons().get(focusedPath) ?? null)
    const activeTreeElement = getActiveTreeElement(rootElement)
    const activeTreeElementPath = activeTreeElement?.dataset.itemPath ?? null
    const renameInputOwnsFocus = isRenaming && getRenameInput() === activeTreeElement
    const searchInputOwnsFocus = searchEnabled && getSearchInput() === activeTreeElement
    const shouldRestoreTreeFocusAfterSearchClose =
      restoreTreeFocusAfterSearchCloseRef.current && !isSearchOpen
    const preservedViewportOffset = restoreTreeFocusViewportOffsetRef.current ?? 0
    const pendingStickyFocusPath = pendingStickyFocusPathRef.current
    const stickyKeyboardFocus = stickyKeyboardFocusRef.current
    const stickyFocusPath = getStickyKeyboardFocusPath(stickyKeyboardFocus)
    const stickyViewportEntry = getStickyKeyboardViewportOffsetEntry(stickyKeyboardFocus)
    const stickyScrollTopEntry = getStickyKeyboardScrollTopEntry(stickyKeyboardFocus)
    const focusWithinTree = activeTreeElement != null
    const hasPendingFocusRequest =
      focusRequestId != null && focusRequestId !== processedFocusRequestIdRef.current
    if (hasPendingFocusRequest) domFocusOwnerRef.current = true
    const shouldOwnDomFocus = domFocusOwnerRef.current || focusWithinTree
    const focusedPathChanged = previousFocusedPathRef.current !== focusedPath
    const shouldPreserveStickyKeyboardFocusViewport =
      stickyFocusPath != null && stickyFocusPath === focusedPath && focusedPath != null
    const pointerFocusScrollPath = pointerFocusScrollPathRef.current
    const shouldSuppressPointerFocusScroll =
      pointerFocusScrollPath != null && pointerFocusScrollPath === focusedPath
    if (pointerFocusScrollPath != null) pointerFocusScrollPathRef.current = null

    let shouldSuppressDomFocusForScrollRequest = false
    let shouldUpdateViewportForScrollRequest = false
    if (scrollRequest != null && scrollRequest.id !== processedScrollRequestIdRef.current) {
      processedScrollRequestIdRef.current = scrollRequest.id
      pendingScrollSettlementRef.current = null
      const result = applyScrollRequest(scrollRequest)
      if (result) {
        shouldSuppressDomFocusForScrollRequest = true
        shouldUpdateViewportForScrollRequest = result.scrolled
        // Cancellation can still deliver one queued compositor scroll event.
        pendingScrollSettlementRef.current = result.scrolled
          ? null
          : { path: result.path, request: scrollRequest }
      }
      controller.clearScrollRequest(scrollRequest.id)
    }

    const shouldRestoreFocusedRowViewportOffset =
      !shouldSuppressDomFocusForScrollRequest &&
      shouldRestoreTreeFocusAfterSearchClose &&
      scrollFocusedRowToViewportOffset(
        scrollElement,
        focusedIndex,
        itemHeight,
        resolvedViewportHeight,
        totalScrollableHeight,
        preservedViewportOffset,
      )
    const shouldRestoreStickyFocusedRowViewportOffset =
      !shouldSuppressDomFocusForScrollRequest &&
      pendingStickyFocusPath != null &&
      pendingStickyFocusPath === focusedPath &&
      scrollFocusedRowToViewportOffset(
        scrollElement,
        focusedIndex,
        itemHeight,
        resolvedViewportHeight,
        totalScrollableHeight,
        stickyOverlayHeight,
      )
    const shouldRestoreStickyKeyboardViewportOffset =
      !shouldSuppressDomFocusForScrollRequest &&
      stickyViewportEntry != null &&
      stickyViewportEntry.path === focusedPath &&
      scrollFocusedRowToViewportOffset(
        scrollElement,
        focusedIndex,
        itemHeight,
        resolvedViewportHeight,
        totalScrollableHeight,
        stickyViewportEntry.viewportOffset,
      )
    const shouldRestoreStickyKeyboardScrollTop =
      !shouldSuppressDomFocusForScrollRequest &&
      stickyScrollTopEntry != null &&
      stickyScrollTopEntry.path === focusedPath &&
      scrollElement.scrollTop !== stickyScrollTopEntry.scrollTop
    if (shouldRestoreStickyKeyboardScrollTop) {
      scrollElement.scrollTop = stickyScrollTopEntry.scrollTop
    }

    if (
      shouldRestoreStickyKeyboardScrollTop ||
      shouldUpdateViewportForScrollRequest ||
      shouldRestoreStickyFocusedRowViewportOffset ||
      shouldRestoreStickyKeyboardViewportOffset ||
      shouldRestoreFocusedRowViewportOffset ||
      (shouldOwnDomFocus &&
        (focusedPathChanged || hasPendingFocusRequest) &&
        pendingStickyFocusPath !== focusedPath &&
        !shouldSuppressPointerFocusScroll &&
        !shouldPreserveStickyKeyboardFocusViewport &&
        scrollFocusedRowIntoView(
          scrollElement,
          focusedIndex,
          itemHeight,
          resolvedViewportHeight,
          stickyOverlayHeight,
        ))
    ) {
      updateViewport.current()
    }

    previousFocusedPathRef.current = focusedPath
    if (shouldSuppressDomFocusForScrollRequest || !shouldOwnDomFocus || renameInputOwnsFocus) return
    if (
      searchInputOwnsFocus &&
      !shouldRestoreTreeFocusAfterSearchClose &&
      !hasPendingFocusRequest
    ) {
      return
    }

    if (focusedButton == null) {
      if (shouldRestoreTreeFocusAfterSearchClose && focusedIndex >= 0) {
        scrollFocusedRowToViewportOffset(
          scrollElement,
          focusedIndex,
          itemHeight,
          resolvedViewportHeight,
          totalScrollableHeight,
          preservedViewportOffset,
        )
        updateViewport.current()
      }
      return
    }

    const shouldFocusCanonicalRow =
      hasPendingFocusRequest ||
      focusedPathChanged ||
      shouldRestoreTreeFocusAfterSearchClose ||
      pendingStickyFocusPath === focusedPath ||
      stickyFocusPath === focusedPath ||
      stickyViewportEntry?.path === focusedPath ||
      stickyScrollTopEntry?.path === focusedPath ||
      activeTreeElementPath == null ||
      activeTreeElementPath !== focusedPath
    if (!shouldFocusCanonicalRow) return

    focusElement(focusedButton)
    if (hasPendingFocusRequest && focusRequestId != null) {
      processedFocusRequestIdRef.current = focusRequestId
      controller.clearFocusRequest(focusRequestId)
    }
    if (pendingStickyFocusPath === focusedPath) pendingStickyFocusPathRef.current = null
    stickyKeyboardFocusRef.current = settleStickyKeyboardFocus(
      stickyKeyboardFocusRef.current,
      focusedPath,
    )
    restoreTreeFocusAfterSearchCloseRef.current = false
    restoreTreeFocusViewportOffsetRef.current = null
  }, [
    controller,
    getRenameInput,
    getRoot,
    getRowButtons,
    getScroll,
    getSearchInput,
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
    updateViewport,
    visibleRows,
  ])

  return {
    cancelSearchCloseFocusRestore,
    claimDomFocus,
    clearCanonicalStickyReveal,
    clearStickyKeyboardFocus,
    ownsDomFocus,
    preserveStickyAtScrollTop,
    releaseDomFocus,
    requestCanonicalStickyReveal,
    requestSearchCloseFocusRestore,
    restoreStickyAtViewportOffset,
    shouldRestoreSearchCloseFocus,
    suppressNextPointerFocusScroll,
  }
}
