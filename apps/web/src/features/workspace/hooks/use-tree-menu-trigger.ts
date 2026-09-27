import { useLayoutEffect, type RefObject } from 'react'
import { useStore } from 'zustand'

import type { TreeRowDom } from '@/features/workspace/hooks/use-tree-row-dom'
import type { MenuTriggerStore } from '@/features/workspace/state/tree-menu-trigger'
import {
  getContextMenuAnchorButton,
  getContextMenuAnchorTop,
} from '@/features/workspace/utils/tree-context-menu-anchor'

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
  dom: TreeRowDom
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
