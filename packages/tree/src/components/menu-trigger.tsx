import type { RefObject } from 'react'

import { Icon } from './Icon'
import { useMenuTrigger } from '../hooks/use-menu-trigger'
import type { FileTreeRowDom } from '../hooks/useFileTreeRowDom'
import type { MenuTriggerStore } from '../state/menu-trigger'
import { CONTEXT_MENU_SLOT_NAME, CONTEXT_MENU_TRIGGER_TYPE } from '../utils/constants'
import type { FileTreeContextMenuOpenContext } from '../utils/model/publicTypes'
import type { FileTreeResolvedIcon } from '../utils/render/iconResolver'
import { menuTriggerAnchorStyle } from '../utils/render/menu-trigger-style'

export function MenuTrigger({
  anchorRef,
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
  triggerRef: RefObject<HTMLButtonElement | null>
  store: MenuTriggerStore
  dom: FileTreeRowDom
  focusPath: string | null
  openPath: string | null
  pointerRect: FileTreeContextMenuOpenContext['anchorRect'] | null
  isPointerMenu: boolean
  isRenaming: boolean
  isScrolling: RefObject<boolean>
  buttonEnabled: boolean
  icon: FileTreeResolvedIcon
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
      {isOpen ? <slot name={CONTEXT_MENU_SLOT_NAME} /> : null}
    </div>
  )
}
