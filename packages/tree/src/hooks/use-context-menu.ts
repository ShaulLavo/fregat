import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { createMenuTriggerStore, type MenuTriggerStore } from '../state/menu-trigger'
import type { FileTreeRowDom } from './useFileTreeRowDom'
import { CONTEXT_MENU_SLOT_NAME, CONTEXT_MENU_TRIGGER_TYPE } from '../utils/constants'
import type { FileTreeController } from '../utils/model/FileTreeController'
import type {
  FileTreeCompositionOptions,
  FileTreeContextMenuButtonVisibility,
  FileTreeContextMenuItem,
  FileTreeContextMenuOpenContext,
  FileTreeContextMenuTriggerMode,
  FileTreeVisibleRow,
} from '../utils/model/publicTypes'
import type { FileTreeSlotHost } from '../utils/model/internalTypes'
import {
  createContextMenuItem,
  focusFirstMenuElement,
  getContextMenuAnchorButton,
  isEventInContextMenu,
  serializeAnchorRect,
} from '../utils/render/contextMenuAnchor'
import { focusElement } from '../utils/render/focusHelpers'

interface FileTreeContextMenuState {
  readonly anchorRect: FileTreeContextMenuOpenContext['anchorRect'] | null
  readonly item: FileTreeContextMenuItem
  readonly path: string
  readonly source: 'button' | 'keyboard' | 'right-click'
}

export interface ContextMenuOptions {
  readonly composition: FileTreeCompositionOptions | undefined
  readonly controller: FileTreeController
  readonly dom: FileTreeRowDom
  readonly slotHost: FileTreeSlotHost | undefined
  readonly isScrolling: RefObject<boolean>
  readonly focusedPath: string | null
  readonly focusedRowHasVisibleAnchor: boolean
  readonly claimDomFocus: () => void
  readonly ownsDomFocus: () => boolean
  readonly preserveStickyAtScrollTop: (path: string, scrollTop: number | null) => void
  readonly markActiveItem: (path: string) => void
}

export interface ContextMenuHandlers {
  readonly anchorRef: RefObject<HTMLDivElement | null>
  readonly triggerRef: RefObject<HTMLButtonElement | null>
  readonly clearHoverPath: () => void
  readonly closeContextMenu: (restoreFocus?: boolean) => void
  readonly closeContextMenuRef: RefObject<(restoreFocus?: boolean) => void>
  readonly triggerStore: MenuTriggerStore
  readonly focusTriggerPath: string | null
  readonly contextMenuButtonTriggerEnabled: boolean
  readonly contextMenuButtonVisibility: FileTreeContextMenuButtonVisibility
  readonly contextMenuEnabled: boolean
  readonly contextMenuOpenPath: string | null
  readonly contextMenuPointerAnchorRect: FileTreeContextMenuOpenContext['anchorRect'] | null
  readonly contextMenuRightClickEnabled: boolean
  readonly contextMenuTriggerMode: FileTreeContextMenuTriggerMode
  readonly handleTreePointerLeave: () => void
  readonly handleTreePointerOver: (event: ReactPointerEvent<HTMLDivElement>) => void
  readonly isContextMenuOpen: boolean
  readonly isContextMenuOpenNow: () => boolean
  readonly isPointerContextMenuOpen: boolean
  readonly noteFocusInteraction: () => void
  readonly openContextMenuForRow: (
    row: FileTreeVisibleRow,
    targetPath: string,
    options?: {
      anchorRect?: FileTreeContextMenuOpenContext['anchorRect']
      source?: 'button' | 'keyboard' | 'right-click'
    },
  ) => void
  readonly openMenuFromTrigger: (path: string, button: HTMLElement) => void
}

export function useContextMenu(options: ContextMenuOptions): ContextMenuHandlers {
  'use no memo'
  // DOM focus is read during render and can change independently of React state.
  const {
    composition,
    claimDomFocus,
    controller,
    dom,
    focusedPath,
    focusedRowHasVisibleAnchor,
    isScrolling,
    markActiveItem,
    ownsDomFocus,
    preserveStickyAtScrollTop,
    slotHost,
  } = options
  const { getRoot, getRowButtons, getScroll, getStickyRowButtons } = dom
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [triggerStore] = useState(createMenuTriggerStore)
  const [contextMenuState, setContextMenuState] = useState<FileTreeContextMenuState | null>(null)
  const contextMenuStateRef = useRef(contextMenuState)
  useLayoutEffect(() => {
    contextMenuStateRef.current = contextMenuState
  }, [contextMenuState])

  const contextMenuEnabled =
    composition?.contextMenu?.enabled === true ||
    composition?.contextMenu?.render != null ||
    composition?.contextMenu?.onOpen != null ||
    composition?.contextMenu?.onClose != null
  const contextMenuTriggerMode =
    composition?.contextMenu?.triggerMode ?? (contextMenuEnabled ? 'right-click' : 'both')
  const contextMenuButtonTriggerEnabled =
    contextMenuTriggerMode === 'both' || contextMenuTriggerMode === 'button'
  const contextMenuButtonVisibility = composition?.contextMenu?.buttonVisibility ?? 'when-needed'
  const contextMenuRightClickEnabled =
    contextMenuTriggerMode === 'both' || contextMenuTriggerMode === 'right-click'

  const getTriggerAnchorButton = useCallback(
    (path: string | null): HTMLElement | null => {
      return getContextMenuAnchorButton(path, getStickyRowButtons(), getRowButtons())
    },
    [getRowButtons, getStickyRowButtons],
  )
  const restoreContextMenuFocus = useCallback(
    (restorePath: string | null): boolean => {
      const focusedButton = restorePath == null ? null : (getRowButtons().get(restorePath) ?? null)
      if (focusElement(focusedButton)) {
        return true
      }

      return focusElement(getRoot())
    },
    [getRoot, getRowButtons],
  )
  const restoreFocusToTree = useCallback(
    (path: string | null): void => {
      const nextFocusedPath = controller.focusNearestPath(path)
      restoreContextMenuFocus(nextFocusedPath)
    },
    [controller, restoreContextMenuFocus],
  )
  const restoreFocusToTreeRef = useRef(restoreFocusToTree)
  useLayoutEffect(() => {
    restoreFocusToTreeRef.current = restoreFocusToTree
  }, [restoreFocusToTree])
  const shouldRestoreContextMenuFocusRef = useRef(true)
  const closeContextMenuRef = useRef<(restoreFocus?: boolean) => void>(() => {})
  const closeContextMenu = useCallback(
    (restoreFocus: boolean = true): void => {
      const currentContextMenuState = contextMenuStateRef.current
      if (currentContextMenuState == null) {
        return
      }

      shouldRestoreContextMenuFocusRef.current =
        shouldRestoreContextMenuFocusRef.current && restoreFocus
      setContextMenuState(null)
      composition?.contextMenu?.onClose?.()
      if (shouldRestoreContextMenuFocusRef.current) {
        restoreFocusToTree(currentContextMenuState.path)
      }
    },
    [composition?.contextMenu, restoreFocusToTree],
  )
  useLayoutEffect(() => {
    closeContextMenuRef.current = closeContextMenu
  }, [closeContextMenu])
  const openContextMenuForRow = useCallback(
    (
      row: FileTreeVisibleRow,
      targetPath: string,
      openOptions?: {
        anchorRect?: FileTreeContextMenuOpenContext['anchorRect']
        source?: 'button' | 'keyboard' | 'right-click'
      },
    ): void => {
      const item = controller.getItem(targetPath)
      if (item == null) {
        return
      }

      const anchorButton = getTriggerAnchorButton(targetPath)
      if (anchorButton?.dataset.fileTreeStickyRow === 'true') {
        const scrollElement = getScroll()
        preserveStickyAtScrollTop(targetPath, scrollElement?.scrollTop ?? null)
        claimDomFocus()
        markActiveItem(targetPath)
      }
      // FileTree item focus is controller focus, not DOM focus. Sticky anchor
      // preservation relies on this remaining scroll-neutral so the canonical
      // offscreen row is not revealed before the layout effect restores focus.
      item.focus()
      shouldRestoreContextMenuFocusRef.current = true
      setContextMenuState({
        anchorRect: openOptions?.anchorRect ?? null,
        item: createContextMenuItem(row, targetPath),
        path: targetPath,
        source: openOptions?.source ?? 'keyboard',
      })
    },
    [
      controller,
      getScroll,
      claimDomFocus,
      getTriggerAnchorButton,
      markActiveItem,
      preserveStickyAtScrollTop,
    ],
  )

  useLayoutEffect(() => {
    if (contextMenuEnabled || contextMenuState == null) {
      return
    }

    const staleState = contextMenuState
    queueMicrotask(() => {
      if (contextMenuStateRef.current !== staleState) return
      closeContextMenu(false)
    })
  }, [closeContextMenu, contextMenuEnabled, contextMenuState])

  // Keep the mounted menu stable across incidental controller renders.
  const activeContextMenuKey =
    contextMenuState == null ? null : `${contextMenuState.path}::${contextMenuState.source}`

  useLayoutEffect(() => {
    if (activeContextMenuKey == null) {
      slotHost?.clearSlotContent(CONTEXT_MENU_SLOT_NAME)
      return
    }

    const currentState = contextMenuStateRef.current
    if (currentState == null) {
      return
    }

    const anchorElement = triggerRef.current ?? anchorRef.current
    if (anchorElement == null) {
      return
    }

    const context: FileTreeContextMenuOpenContext = {
      anchorElement,
      anchorRect:
        currentState.anchorRect ?? serializeAnchorRect(anchorElement.getBoundingClientRect()),
      close: (closeOptions) => {
        closeContextMenuRef.current(closeOptions?.restoreFocus ?? true)
      },
      restoreFocus: () => {
        if (!shouldRestoreContextMenuFocusRef.current) {
          return
        }
        restoreFocusToTreeRef.current(contextMenuStateRef.current?.path ?? null)
      },
    }
    const menuContent = composition?.contextMenu?.render?.(currentState.item, context) ?? null
    slotHost?.setSlotContent(CONTEXT_MENU_SLOT_NAME, menuContent)
    composition?.contextMenu?.onOpen?.(currentState.item, context)
    focusFirstMenuElement(menuContent)
    queueMicrotask(() => {
      if (menuContent == null || !menuContent.isConnected) {
        return
      }

      if (document.activeElement !== menuContent) {
        return
      }

      focusFirstMenuElement(menuContent)
    })

    return () => {
      slotHost?.clearSlotContent(CONTEXT_MENU_SLOT_NAME)
    }
  }, [activeContextMenuKey, composition?.contextMenu, slotHost])

  useLayoutEffect(() => {
    if (contextMenuState == null || controller.getItem(contextMenuState.path) != null) return

    const staleState = contextMenuState
    queueMicrotask(() => {
      if (contextMenuStateRef.current !== staleState) return
      closeContextMenu()
    })
  }, [closeContextMenu, contextMenuState, controller])

  useLayoutEffect(() => {
    if (contextMenuState == null) {
      return
    }

    const rootNode = getRoot()?.getRootNode()
    const host = rootNode instanceof ShadowRoot ? rootNode.host : getRoot()
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }

      if (isEventInContextMenu(event)) {
        return
      }

      if (anchorRef.current?.contains(target) === true) {
        return
      }

      if (host?.contains(target) === true) {
        return
      }

      closeContextMenu()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeContextMenu()
      }
    }

    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [closeContextMenu, contextMenuState, getRoot])

  const focusTriggerPath =
    contextMenuButtonTriggerEnabled && ownsDomFocus() && focusedRowHasVisibleAnchor
      ? focusedPath
      : null
  const isPointerContextMenuOpen = contextMenuState?.source === 'right-click'

  const handleTreePointerOver = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (isScrolling.current) {
        return
      }

      if (isEventInContextMenu(event.nativeEvent)) {
        return
      }

      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }

      if (target.closest?.(`[data-type="${CONTEXT_MENU_TRIGGER_TYPE}"]`) != null) {
        return
      }

      const stickyRowButton = target.closest?.('[data-file-tree-sticky-row="true"]')
      const rowButton = target.closest?.('[data-type="item"]')
      let nextPath: string | null = null
      if (stickyRowButton instanceof HTMLElement) {
        nextPath = stickyRowButton.dataset.fileTreeStickyPath ?? null
      } else if (rowButton instanceof HTMLElement) {
        nextPath = rowButton.dataset.itemPath ?? null
      }

      triggerStore.getState().hover(nextPath)
    },
    [isScrolling, triggerStore],
  )

  const clearHoverPath = () => triggerStore.getState().hover(null)
  const noteFocusInteraction = triggerStore.getState().noteFocus

  const isContextMenuOpenNow = useCallback((): boolean => {
    return contextMenuStateRef.current != null
  }, [])

  const openMenuFromTrigger = (triggerPath: string, triggerButton: HTMLElement): void => {
    if (isScrolling.current) {
      return
    }

    if (!contextMenuButtonTriggerEnabled) {
      return
    }

    const triggerItem = controller.getItem(triggerPath)
    if (triggerItem == null) {
      return
    }

    shouldRestoreContextMenuFocusRef.current = true
    setContextMenuState({
      anchorRect: null,
      item: {
        kind: triggerItem.isDirectory() ? 'directory' : 'file',
        name: triggerButton.getAttribute('aria-label') ?? triggerPath,
        path: triggerItem.getPath(),
      },
      path: triggerItem.getPath(),
      source: 'button',
    })
  }

  return {
    anchorRef,
    triggerRef,
    clearHoverPath,
    closeContextMenu,
    closeContextMenuRef,
    triggerStore,
    focusTriggerPath,
    contextMenuButtonTriggerEnabled,
    contextMenuButtonVisibility,
    contextMenuEnabled,
    contextMenuOpenPath: contextMenuState?.path ?? null,
    contextMenuPointerAnchorRect: contextMenuState?.anchorRect ?? null,
    contextMenuRightClickEnabled,
    contextMenuTriggerMode,
    handleTreePointerLeave: clearHoverPath,
    handleTreePointerOver,
    isContextMenuOpen: contextMenuState != null,
    isContextMenuOpenNow,
    isPointerContextMenuOpen,
    noteFocusInteraction,
    openContextMenuForRow,
    openMenuFromTrigger,
  }
}
