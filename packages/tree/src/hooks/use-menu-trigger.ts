import { useLayoutEffect, type RefObject } from 'react'
import { useStore } from 'zustand'

import type { FileTreeRowDom } from './useFileTreeRowDom'
import type { MenuTriggerStore } from '../state/menu-trigger'
import {
  getContextMenuAnchorButton,
  getContextMenuAnchorTop,
} from '../utils/render/contextMenuAnchor'

export function useMenuTrigger({
  store,
  dom,
  focusPath,
  openPath,
  isScrolling,
  buttonEnabled,
  anchorRef,
  isPointerMenu,
}: {
  store: MenuTriggerStore
  dom: FileTreeRowDom
  focusPath: string | null
  openPath: string | null
  isScrolling: RefObject<boolean>
  buttonEnabled: boolean
  anchorRef: RefObject<HTMLDivElement | null>
  isPointerMenu: boolean
}) {
  const hoveredPath = useStore(store, (state) => state.hoveredPath)
  const interaction = useStore(store, (state) => state.interaction)
  const pointerPath = interaction === 'pointer' ? hoveredPath : null
  const path = openPath ?? pointerPath ?? focusPath ?? hoveredPath
  const button = getContextMenuAnchorButton(path, dom.getStickyRowButtons(), dom.getRowButtons())

  // Position before the parent opens its menu, without scheduling another render.
  useLayoutEffect(() => {
    if (isScrolling.current && openPath === null) return
    if (!buttonEnabled && openPath === null) return
    if (isPointerMenu || anchorRef.current === null || button === null) return
    const top = getContextMenuAnchorTop(dom.getRoot(), button)
    anchorRef.current.style.top = `${top}px`
  })

  return { button, path }
}
