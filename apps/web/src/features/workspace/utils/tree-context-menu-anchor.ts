import { CONTEXT_MENU_TRIGGER_TYPE } from '@workspace/tree'
import type {
  FileTreeContextMenuItem,
  FileTreeContextMenuOpenContext,
  FileTreeVisibleRow,
} from '@workspace/tree'
import { focusElement } from '@/features/workspace/utils/tree-focus'
import { getTreeRowAriaLabel } from '@/features/workspace/utils/tree-row-identity'

const treeOwnedEvents = new WeakSet<Event>()

/**
 * Marks an event React routed through the tree, portals included: a menu the caller renders into
 * `<body>` is still the tree's, so its clicks are not outside clicks.
 */
export function markTreeOwnedEvent(event: Event): void {
  treeOwnedEvents.add(event)
}

export function isEventInContextMenu(event: Event): boolean {
  if (treeOwnedEvents.has(event)) return true

  for (const entry of event.composedPath()) {
    if (!(entry instanceof HTMLElement)) continue

    const type = entry.dataset.type
    if (
      type === 'context-menu-anchor' ||
      type === 'context-menu-content' ||
      type === CONTEXT_MENU_TRIGGER_TYPE
    ) {
      return true
    }
  }

  return false
}

export function serializeAnchorRect(rect: DOMRect): FileTreeContextMenuOpenContext['anchorRect'] {
  return {
    bottom: rect.bottom,
    height: rect.height,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    width: rect.width,
    x: rect.x,
    y: rect.y,
  }
}

export function createAnchorRectFromPoint(
  x: number,
  y: number,
): FileTreeContextMenuOpenContext['anchorRect'] {
  return {
    bottom: y,
    height: 0,
    left: x,
    right: x,
    top: y,
    width: 0,
    x,
    y,
  }
}

// The floating trigger is positioned against the root container, not the
// scrollbox. Using root-relative coordinates keeps sticky rows aligned even
// during the native scroll step before React processes the new layout.
export function getContextMenuAnchorTop(
  rootElement: HTMLElement | null,
  itemElement: HTMLElement,
): number {
  if (rootElement == null) {
    return itemElement.offsetTop
  }

  const itemRect = itemElement.getBoundingClientRect()
  const rootRect = rootElement.getBoundingClientRect()
  return itemRect.top - rootRect.top
}

// Sticky overlay rows are separate DOM mirrors of the real row. Prefer them
// when positioning the floating trigger so it follows the row the user can see.
export function getContextMenuAnchorButton(
  path: string | null,
  stickyButtonRefs: ReadonlyMap<string, HTMLElement>,
  rowButtons: ReadonlyMap<string, HTMLElement>,
): HTMLElement | null {
  if (path == null) {
    return null
  }

  const stickyButton = stickyButtonRefs.get(path) ?? null
  if (stickyButton != null) {
    return stickyButton
  }

  const rowButton = rowButtons.get(path) ?? null
  return rowButton?.dataset.itemParked === 'true' ? null : rowButton
}

export function createContextMenuItem(
  row: FileTreeVisibleRow,
  path: string,
): FileTreeContextMenuItem {
  return {
    kind: row.kind,
    name: getTreeRowAriaLabel(row),
    path,
  }
}

export function focusFirstMenuElement(menuElement: HTMLElement | null): void {
  if (menuElement == null) {
    return
  }

  const focusable = menuElement.querySelector<HTMLElement>(
    [
      'button:not([disabled])',
      '[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', '),
  )

  focusElement(focusable ?? menuElement)
}
