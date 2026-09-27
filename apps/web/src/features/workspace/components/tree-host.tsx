/** @jsxImportSource react */

import { cn } from '@workspace/ui/lib/utils'
import '@/features/workspace/components/tree-view.css'

import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { useCallback, useEffect, useEffectEvent, useId, useRef, useSyncExternalStore } from 'react'

import { TreeView } from '@/features/workspace/components/tree-view'
import { TREE_DENSITY_FACTOR } from '@/features/workspace/utils/tree-view-layout'
import type { FileTreeContextMenuItem } from '@workspace/tree'
import type { TreeViewModel } from '@/features/workspace/state/tree-model'
import type {
  TreeMenuTrigger,
  TreeRowMenuHandle,
} from '@/features/workspace/utils/tree-row-menu-open'
import { useListContextMenu } from '@/keymap/menus/hooks/use-list-context-menu'

export interface TreeHostProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  model: TreeViewModel
  /** The open row's menu; the host owns its target, anchor and dismissal. */
  renderContextMenu?: (item: FileTreeContextMenuItem, menu: TreeRowMenuHandle) => ReactNode
}

/**
 * Paints the model's row height and the density factor onto the wrapper; caller `style` keys
 * still win.
 *
 * `version` is the cache key, and it is why this is a function: the model changes its row height
 * in place, so its identity cannot report the change and a memo keyed on it would serve stale sizes.
 */
function densityStyle(
  model: TreeViewModel,
  _version: number,
  style: CSSProperties | undefined,
): CSSProperties {
  return {
    ['--trees-item-height' as string]: `${String(model.getItemHeight())}px`,
    ['--trees-density-override' as string]: TREE_DENSITY_FACTOR,
    display: 'flex',
    ...style,
  }
}

const modelKeys = new WeakMap<TreeViewModel, number>()
let nextModelKey = 0

/** A key per model, so a replaced model remounts the view with fresh hook state. */
function modelKey(model: TreeViewModel) {
  const existing = modelKeys.get(model)
  if (existing !== undefined) return existing
  nextModelKey += 1
  modelKeys.set(model, nextModelKey)
  return nextModelKey
}

/** The tree, rendered in the caller's React root; `[data-file-tree]` scopes its stylesheet. */
export function TreeHost({
  id,
  model,
  renderContextMenu,
  ...hostProps
}: TreeHostProps): React.JSX.Element {
  const instanceId = useId()
  const hostRef = useRef<HTMLDivElement>(null)
  const menu = useListContextMenu<FileTreeContextMenuItem>({
    containerRef: hostRef,
    focusTargetOf: (item) =>
      model.getRowElement(item.path) ?? model.getRowElement(model.getFocusedPath() ?? ''),
    isTargetPresent: (item) => model.getItem(item.path) != null,
  })
  // Identity is load-bearing: useSyncExternalStore resubscribes when these change.
  const subscribeToItemHeight = useCallback(
    (listener: () => void) => model.subscribeItemHeight(listener),
    [model],
  )
  const getItemHeightSnapshot = useCallback(() => model.getItemHeightVersion(), [model])
  const itemHeightVersion = useSyncExternalStore(
    subscribeToItemHeight,
    getItemHeightSnapshot,
    getItemHeightSnapshot,
  )
  useEffect(() => model.connectSelectionChange(), [model])
  // Identity is load-bearing: useSyncExternalStore resubscribes when these change.
  const subscribeToView = useCallback(
    (listener: () => void) => model.subscribeView(listener),
    [model],
  )
  const getViewSnapshot = useCallback(() => model.getViewVersion(), [model])
  const viewVersion = useSyncExternalStore(subscribeToView, getViewSnapshot, getViewSnapshot)

  // Rows are keyed by slot, so a removed row's element can stay mounted for another path: the list
  // menu cannot see the removal in the DOM, so the model reports it.
  const menuPath = menu.target?.path ?? null
  const closeMenuIfGone = useEffectEvent(() => {
    if (menuPath == null || model.getItem(menuPath) != null) return
    menu.onOpenChange(false)
    menu.returnFocusTo()?.focus({ preventScroll: true })
  })
  useEffect(() => {
    if (menuPath == null) return
    return model.subscribe(closeMenuIfGone)
  }, [menuPath, model])

  function openMenu(item: FileTreeContextMenuItem, trigger: TreeMenuTrigger) {
    if (trigger.kind === 'pointer') {
      menu.openAtEvent(item, trigger.event)
      return
    }
    menu.openOnMenuKey(trigger.event, item, trigger.element)
  }

  const viewProps = model.getViewProps(viewVersion)

  return (
    <div
      {...hostProps}
      {...menu.containerProps}
      ref={hostRef}
      className={cn('group/tree group/listbox', hostProps.className)}
      data-file-tree=''
      data-file-tree-virtualized='true'
      id={id}
      style={densityStyle(model, itemHeightVersion, hostProps.style)}
    >
      <div data-file-tree-virtualized-wrapper='true'>
        <TreeView
          {...viewProps}
          instanceId={instanceId}
          key={modelKey(model)}
          menuPath={menuPath}
          onCloseMenu={() => menu.onOpenChange(false)}
          onOpenMenu={renderContextMenu == null ? undefined : openMenu}
        />
      </div>
      {renderContextMenu != null && menu.anchor != null && menu.target != null
        ? renderContextMenu(menu.target, {
            anchor: menu.anchor,
            onOpenChange: menu.onOpenChange,
            returnFocusTo: menu.returnFocusTo,
          })
        : null}
    </div>
  )
}
