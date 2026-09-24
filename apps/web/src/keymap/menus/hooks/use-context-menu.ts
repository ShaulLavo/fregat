import { stopPropagation as stopEvent } from '@workspace/utils/events'
import { isContextMenuKey } from '@workspace/utils/keyboard'
import { useState } from 'react'

import { pointAnchor, rectAnchor, type MenuAnchor } from '@/keymap/menus/utils/virtual-anchor'

type ContextMenuPointerEvent = {
  readonly clientX: number
  readonly clientY: number
  preventDefault: () => void
}

type ContextMenuKeyEvent = {
  readonly key: string
  readonly shiftKey: boolean
  readonly currentTarget: EventTarget | null
  preventDefault: () => void
}

/**
 * Owns every cross-surface rule for opening a context menu, so no surface has
 * to remember them: suppressing the native menu, the macOS press-drag-release
 * hazard, and keyboard invocation.
 */
export function useContextMenu() {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)

  function onOpenChange(next: boolean) {
    if (next) return

    setAnchor(null)
  }

  /** Attach to `onContextMenu`. Opens at the exact cursor point. */
  function openAtEvent(event: ContextMenuPointerEvent, contextElement?: Element) {
    event.preventDefault()
    swallowTerminatingMouseUp()
    setAnchor(pointAnchor(event.clientX, event.clientY, contextElement))
  }

  function openAtElement(element: Element) {
    setAnchor(rectAnchor(element.getBoundingClientRect(), element))
  }

  /**
   * Attach to `onKeyDown`. Base UI binds neither key, and macOS has no
   * ContextMenu key, so keyboard users get nothing without this.
   */
  function openOnMenuKey(event: ContextMenuKeyEvent) {
    if (!isContextMenuKey(event)) return false

    event.preventDefault()
    const target = event.currentTarget
    if (!(target instanceof Element)) return false

    openAtElement(target)
    return true
  }

  return {
    anchor,
    onOpenChange,
    open: anchor !== null,
    openAtElement,
    openAtEvent,
    openOnMenuKey,
  }
}

/**
 * Base UI only guards against this when its own Trigger recorded the opening
 * cursor point. Opening from our own handler leaves the guard disarmed, so on
 * macOS the `mouseup` that ends the right-click would activate whichever item
 * landed under the cursor. React delegates at the root container, so a
 * capture-phase listener on `document` runs strictly before it.
 */
function swallowTerminatingMouseUp() {
  if (typeof document === 'undefined') return

  document.addEventListener('mouseup', stopEvent, { capture: true, once: true })
}
