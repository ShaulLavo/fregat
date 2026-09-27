import type { RefObject } from 'react'

import { Icon } from '@/features/workspace/components/tree-icon'
import { useMenuTrigger } from '@/features/workspace/hooks/use-tree-menu-trigger'
import type { TreeRowDom } from '@/features/workspace/hooks/use-tree-row-dom'
import type { MenuTriggerStore } from '@/features/workspace/state/tree-menu-trigger'
import { CONTEXT_MENU_TRIGGER_TYPE } from '@workspace/tree'
import type { FileTreeContextMenuOpenContext } from '@workspace/tree'
import type { TreeResolvedIcon } from '@/features/workspace/utils/tree-icon-resolver'
import { menuTriggerAnchorStyle } from '@/features/workspace/utils/tree-menu-trigger-style'

export function MenuTrigger({
  anchorRef,
  contentHostRef,
  triggerRef,
  store,
  dom,
  focusPath,
  openPath,
  pointerRect,
  isPointerMenu,
  isRenaming,
  isScrolling,
  buttonEnabled,
  icon,
  closeMenu,
  openMenu,
}: {
  anchorRef: RefObject<HTMLDivElement | null>
  contentHostRef: RefObject<HTMLDivElement | null>
  triggerRef: RefObject<HTMLButtonElement | null>
  store: MenuTriggerStore
  dom: TreeRowDom
  focusPath: string | null
  openPath: string | null
  pointerRect: FileTreeContextMenuOpenContext['anchorRect'] | null
  isPointerMenu: boolean
  isRenaming: boolean
  isScrolling: RefObject<boolean>
  buttonEnabled: boolean
  icon: TreeResolvedIcon
  closeMenu: () => void
  openMenu: (path: string, button: HTMLElement) => void
}) {
  const { button, path } = useMenuTrigger({
    store,
    dom,
    focusPath,
    openPath,
    isScrolling,
    buttonEnabled,
    anchorRef,
    isPointerMenu,
  })
  const isOpen = openPath !== null
  const buttonVisible =
    buttonEnabled && !isPointerMenu && !isRenaming && button !== null && path !== null
  const anchorVisible = buttonVisible || isOpen

  return (
    <div
      ref={anchorRef}
      data-type='context-menu-anchor'
      data-visible={anchorVisible ? 'true' : 'false'}
      style={menuTriggerAnchorStyle(pointerRect)}
    >
      <button
        ref={triggerRef}
        type='button'
        data-type={CONTEXT_MENU_TRIGGER_TYPE}
        aria-label='Options'
        aria-haspopup='menu'
        aria-expanded={isOpen ? 'true' : 'false'}
        data-visible={buttonVisible ? 'true' : 'false'}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (isOpen) {
            closeMenu()
            return
          }
          if (path !== null && button !== null) openMenu(path, button)
        }}
        tabIndex={-1}
        style={isPointerMenu ? { opacity: 0 } : undefined}
      >
        <Icon {...icon} />
      </button>
      {isOpen ? <div data-type='context-menu-content' ref={contentHostRef} /> : null}
    </div>
  )
}
