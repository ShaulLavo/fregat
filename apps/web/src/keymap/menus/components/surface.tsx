import { useRef, useState, type ReactElement } from 'react'

import { useResolvedMenu } from '@/keymap/menus/hooks/use-resolved-menu'
import type { Menu } from '@/keymap/menus/utils/model'
import type { ResolvedMenuInvocation, ResolvedMenuItem } from '@/keymap/menus/utils/resolve'
import type { MenuAnchor } from '@/keymap/menus/utils/virtual-anchor'
import type { MenuSurfaceId } from '@/keymap/types'
import { useFocusService } from '@/lib/focus/hooks/use-service'
import {
  registeredFocusTarget,
  type FocusService,
  type FocusTargetToken,
} from '@/lib/focus/state/service'
import { log } from '@/lib/client-logging'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@workspace/ui/components/context-menu'

import { MenuSection } from './section'

/**
 * The only place app code touches Base UI's context menu parts. Two ways in:
 *
 * - pass `trigger` and Base UI wraps the element, tracks the cursor, and owns
 *   open state. Correct for anything that renders its own DOM node.
 * - pass `anchor` + `open` + `onOpenChange` and the menu opens at a virtual
 *   rect with no trigger at all. The path for surfaces with nothing to wrap:
 *   the terminal canvas, the shadow-DOM file tree, keyboard invocation.
 */
export function MenuSurface({
  anchor,
  className,
  menu,
  onOpenChange,
  open,
  popupProps,
  surface,
  trigger,
}: {
  readonly anchor?: MenuAnchor | null
  readonly className?: string
  readonly menu: Menu
  readonly onOpenChange?: (open: boolean) => void
  readonly open?: boolean
  /**
   * Data attributes for the portalled popup. Surfaces that run their own
   * outside-click detection need to recognise our menu as inside — the file
   * tree looks for `data-file-tree-context-menu-root`.
   */
  readonly popupProps?: Readonly<Record<`data-${string}`, string>>
  readonly surface: MenuSurfaceId
  readonly trigger?: ReactElement
}) {
  const focusService = useFocusService()
  const [originState, setOriginState] = useState(() => ({
    controlledOpen: open,
    origin: open ? captureMenuOrigin(focusService, anchor) : null,
  }))
  if (open !== originState.controlledOpen) {
    setOriginState({
      controlledOpen: open,
      origin: open ? captureMenuOrigin(focusService, anchor) : originState.origin,
    })
  }
  const pendingCommand = useRef<ResolvedMenuInvocation>(undefined)
  const sections = useResolvedMenu(menu, surface, originState.origin)

  /**
   * Closing clears the consumer's anchor while Base UI's exit animation is
   * still running. An anchorless Positioner falls back to the viewport corner,
   * flashing the popup there for the animation's duration. Keep the last
   * anchor until the next open replaces it.
   */
  const [lastAnchor, setLastAnchor] = useState<MenuAnchor | null>(null)
  if (anchor && anchor !== lastAnchor) {
    setLastAnchor(anchor)
  }

  /**
   * Logging only — the row itself runs the item. Every kind reports, so a menu
   * whose only affordance is a radio group is not invisible in the logs.
   */
  function handleInvoke(
    item: ResolvedMenuItem,
    value?: string,
    invocation?: ResolvedMenuInvocation,
  ) {
    if (invocation) pendingCommand.current = invocation
    let command = item.kind === 'run' ? item.command : null
    if (item.kind === 'radio-group') {
      command = item.options.find((option) => option.value === value)?.command ?? null
    }

    log.info({
      action: 'menu.invoke',
      area: 'command',
      command,
      item: item.key,
      menu: surface,
      value,
    })
  }

  function handleOpenChange(next: boolean, details: { readonly trigger?: Element }) {
    if (next) {
      pendingCommand.current = undefined
      setOriginState({
        controlledOpen: open === undefined ? undefined : true,
        origin: captureMenuOrigin(focusService, anchor, details.trigger),
      })
      onOpenChange?.(true)
      return
    }

    const origin = originState.origin
    const command = pendingCommand.current
    pendingCommand.current = undefined
    setOriginState({
      controlledOpen: open === undefined ? undefined : false,
      origin,
    })
    onOpenChange?.(false)
    if (!command) {
      restoreMenuOrigin(focusService, origin)
      return
    }

    void command.completion.then(() => restoreMenuOrigin(focusService, origin))
  }

  return (
    <ContextMenu onOpenChange={handleOpenChange} open={open}>
      {trigger ? <ContextMenuTrigger render={trigger} /> : null}
      <ContextMenuContent
        anchor={anchor ?? lastAnchor ?? undefined}
        className={className}
        data-menu-surface={surface}
        finalFocus={false}
        {...popupProps}
      >
        {sections.map((section, index) => (
          <MenuSection index={index} key={section.id} onInvoke={handleInvoke} section={section} />
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
}

function captureMenuOrigin(
  focusService: FocusService,
  anchor?: MenuAnchor | null,
  trigger?: Element,
): FocusTargetToken | null {
  const anchorOrigin = anchor?.contextElement
    ? focusService.captureOrigin(anchor.contextElement)
    : null
  if (anchorOrigin) return anchorOrigin

  const triggerOrigin = trigger ? focusService.captureOrigin(trigger) : null
  if (triggerOrigin) return triggerOrigin

  return focusService.captureOrigin()
}

function restoreMenuOrigin(focusService: FocusService, origin: FocusTargetToken | null) {
  if (!origin || !focusService.isRegistered(origin)) return

  const currentOwner = focusService.getSnapshot().currentOwner
  if (currentOwner) return

  void focusService.request(registeredFocusTarget(origin)).completion
}
