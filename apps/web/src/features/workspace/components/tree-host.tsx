/** @jsxImportSource react */

import { cn } from '@workspace/ui/lib/utils'
import '@/features/workspace/components/tree-view.css'

import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { useCallback, useEffect, useId, useState, useSyncExternalStore } from 'react'

import { TreeView } from '@/features/workspace/components/tree-view'
import { markTreeOwnedEvent } from '@/features/workspace/utils/tree-context-menu-anchor'
import { TREE_DENSITY_FACTOR } from '@/features/workspace/utils/tree-view-layout'
import type {
  FileTreeCompositionOptions,
  FileTreeContextMenuItem,
  FileTreeContextMenuOpenContext,
} from '@workspace/tree'
import type { TreeViewModel } from '@/features/workspace/state/tree-model'

interface ActiveContextMenuState {
  context: FileTreeContextMenuOpenContext
  item: FileTreeContextMenuItem
}

function resolveComposition(
  baselineComposition: FileTreeCompositionOptions | undefined,
  hasContextMenu: boolean,
  onClose: () => void,
  onOpen: (item: FileTreeContextMenuItem, context: FileTreeContextMenuOpenContext) => void,
): FileTreeCompositionOptions | undefined {
  if (!hasContextMenu) return baselineComposition

  const baselineContextMenu = baselineComposition?.contextMenu
  const contextMenu = {
    ...baselineContextMenu,
    enabled: true,
    onClose: () => {
      baselineContextMenu?.onClose?.()
      onClose()
    },
    onOpen: (item: FileTreeContextMenuItem, context: FileTreeContextMenuOpenContext) => {
      onOpen(item, context)
      baselineContextMenu?.onOpen?.(item, context)
    },
  }
  delete contextMenu.render
  return { ...baselineComposition, contextMenu }
}

export interface TreeHostProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  model: TreeViewModel
  renderContextMenu?: (
    item: FileTreeContextMenuItem,
    context: FileTreeContextMenuOpenContext,
  ) => ReactNode
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
  const [activeContextMenu, setActiveContextMenu] = useState<ActiveContextMenuState | null>(null)
  const [baseline, setBaseline] = useState(() => ({
    composition: model.getComposition(),
    model,
  }))
  if (baseline.model !== model) setBaseline({ composition: model.getComposition(), model })
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

  const hasContextMenu = renderContextMenu != null
  const composition = resolveComposition(
    baseline.composition,
    hasContextMenu,
    () => setActiveContextMenu(null),
    (item, context) => setActiveContextMenu({ context, item }),
  )

  // Dropped during render, not in an effect: a menu whose renderer just went away must not
  // survive into the commit that removes it.
  if (!hasContextMenu && activeContextMenu !== null) setActiveContextMenu(null)

  const viewProps = model.getViewProps(viewVersion)

  return (
    <div
      {...hostProps}
      className={cn('group/tree group/listbox', hostProps.className)}
      data-file-tree=''
      data-file-tree-virtualized='true'
      id={id}
      onMouseDownCapture={(event) => {
        hostProps.onMouseDownCapture?.(event)
        markTreeOwnedEvent(event.nativeEvent)
      }}
      style={densityStyle(model, itemHeightVersion, hostProps.style)}
    >
      <div data-file-tree-virtualized-wrapper='true'>
        <TreeView
          {...viewProps}
          composition={composition}
          instanceId={instanceId}
          key={modelKey(model)}
        />
      </div>
      {renderContextMenu != null && activeContextMenu != null
        ? renderContextMenu(activeContextMenu.item, activeContextMenu.context)
        : null}
    </div>
  )
}
