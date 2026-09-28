import { isContextMenuKey } from '@workspace/utils/keyboard'
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react'

import { useContextMenu } from '@/keymap/menus/hooks/use-context-menu'

/** Owns a list's menu target and lifetime; each list decides which target a row represents. */
export function useListContextMenu<T>({
  containerRef,
  focusTargetOf,
  isTargetPresent,
  touchPolicy = 'suppress',
}: {
  readonly containerRef: RefObject<HTMLElement | null>
  /** Where focus returns for a target; the list container when absent or null. */
  readonly focusTargetOf?: (target: T) => HTMLElement | null
  readonly isTargetPresent: (target: T) => boolean
  /** Standalone phone lists keep their native long-press context-menu gesture. */
  readonly touchPolicy?: 'suppress' | 'context-menu'
}) {
  const contextMenu = useContextMenu()
  const [target, setTarget] = useState<T | null>(null)
  const pointerType = useRef('mouse')

  function returnFocusTo() {
    const element = target === null ? null : (focusTargetOf?.(target) ?? null)
    return element ?? containerRef.current
  }

  function onOpenChange(open: boolean) {
    contextMenu.onOpenChange(open)
    if (!open) setTarget(null)
  }

  const dismiss = useEffectEvent(() => {
    onOpenChange(false)
    returnFocusTo()?.focus({ preventScroll: true })
  })
  const checkTarget = useEffectEvent(() => {
    if (target !== null && !isTargetPresent(target)) dismiss()
  })
  useEffect(() => {
    checkTarget()
  })

  const anchorElement = contextMenu.anchor?.contextElement
  useEffect(() => {
    const list = containerRef.current
    if (!contextMenu.open || !list || !anchorElement) return

    const onScroll = (event: Event) => {
      const scroller = event.target
      if (
        scroller === list.ownerDocument ||
        (scroller instanceof Element && (scroller.contains(list) || list.contains(scroller)))
      )
        dismiss()
    }
    // Base UI's backdrop receives wheel input and prevents the underlying list from scrolling.
    const onWheel = (event: WheelEvent) => {
      if (event.target instanceof Element && event.target.closest('[role="menu"]')) return
      dismiss()
    }
    const observer = new MutationObserver(() => {
      if (!list.contains(anchorElement)) dismiss()
    })
    observer.observe(list, { childList: true, subtree: true })
    list.ownerDocument.addEventListener('scroll', onScroll, true)
    list.ownerDocument.addEventListener('wheel', onWheel, { capture: true, passive: true })
    return () => {
      observer.disconnect()
      list.ownerDocument.removeEventListener('scroll', onScroll, true)
      list.ownerDocument.removeEventListener('wheel', onWheel, true)
    }
  }, [anchorElement, containerRef, contextMenu.open])

  function suppressed(element: Element) {
    return element.closest('[data-scrolling]:not([data-scrolling="false"])') !== null
  }

  function openAtEvent(nextTarget: T, event: MouseEvent<HTMLElement>) {
    event.preventDefault()
    if (touchPolicy === 'suppress' && pointerType.current === 'touch') return
    if (suppressed(event.currentTarget)) return
    setTarget(nextTarget)
    contextMenu.openAtEvent(event, event.currentTarget)
  }

  function openOnMenuKey(event: KeyboardEvent<HTMLElement>, nextTarget: T, row?: Element | null) {
    if (!isContextMenuKey(event)) return false
    event.preventDefault()
    const activeId = event.currentTarget.getAttribute('aria-activedescendant')
    const element =
      row ??
      (activeId ? event.currentTarget.ownerDocument.getElementById(activeId) : event.currentTarget)
    if (!element || suppressed(element)) return true
    setTarget(nextTarget)
    contextMenu.openAtElement(element)
    return true
  }

  return {
    anchor: contextMenu.anchor,
    target,
    onOpenChange,
    openAtEvent,
    openOnMenuKey,
    returnFocusTo,
    containerProps: {
      onPointerDownCapture: (event: PointerEvent<HTMLElement>) => {
        pointerType.current = event.pointerType
      },
      onTouchStartCapture: () => {
        pointerType.current = 'touch'
      },
    },
  }
}
