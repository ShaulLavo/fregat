/** @jsxImportSource react */

import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import {
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from 'react'

import { CONTEXT_MENU_SLOT_NAME, FILE_TREE_TAG_NAME, HEADER_SLOT_NAME } from '../utils/constants'
import type {
  FileTreeCompositionOptions,
  FileTreeContextMenuItem,
  FileTreeContextMenuOpenContext,
} from '../utils/model/publicTypes'
import type { FileTree as FileTreeModel } from '../utils/render/FileTree'

const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

interface ActiveContextMenuState {
  context: FileTreeContextMenuOpenContext
  item: FileTreeContextMenuItem
}

function renderFileTreeChildren(
  header: ReactNode,
  renderContextMenu:
    | ((item: FileTreeContextMenuItem, context: FileTreeContextMenuOpenContext) => ReactNode)
    | undefined,
  activeContextMenu: ActiveContextMenuState | null,
): ReactNode {
  const headerChild = header != null ? <div slot={HEADER_SLOT_NAME}>{header}</div> : null
  const contextMenuChild =
    renderContextMenu != null && activeContextMenu != null ? (
      <div slot={CONTEXT_MENU_SLOT_NAME}>
        {renderContextMenu(activeContextMenu.item, activeContextMenu.context)}
      </div>
    ) : null

  if (headerChild == null && contextMenuChild == null) {
    return null
  }

  return (
    <>
      {headerChild}
      {contextMenuChild}
    </>
  )
}

function resolveComposition(
  baselineComposition: FileTreeCompositionOptions | undefined,
  header: ReactNode,
  hasContextMenu: boolean,
  onClose: () => void,
  onOpen: (item: FileTreeContextMenuItem, context: FileTreeContextMenuOpenContext) => void,
): FileTreeCompositionOptions | undefined {
  const nextComposition: FileTreeCompositionOptions = {
    ...baselineComposition,
  }

  if (header != null) {
    delete nextComposition.header
  }

  if (hasContextMenu) {
    const baselineContextMenu = baselineComposition?.contextMenu
    const baselineOnClose = baselineContextMenu?.onClose
    const baselineOnOpen = baselineContextMenu?.onOpen

    nextComposition.contextMenu = {
      ...baselineContextMenu,
      enabled: true,
      onClose: () => {
        baselineOnClose?.()
        onClose()
      },
      onOpen: (item, context) => {
        onOpen(item, context)
        baselineOnOpen?.(item, context)
      },
    }
    delete nextComposition.contextMenu.render
  }

  return nextComposition.header != null || nextComposition.contextMenu != null
    ? nextComposition
    : undefined
}

export interface FileTreeProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  header?: ReactNode
  model: FileTreeModel
  renderContextMenu?: (
    item: FileTreeContextMenuItem,
    context: FileTreeContextMenuOpenContext,
  ) => ReactNode
}

/**
 * Paints the model's resolved density onto the host so callers don't have to set
 * `--trees-item-height` and `--trees-density-override` themselves; caller `style` keys still win.
 *
 * `version` is the cache key, and it is why this is a function: the model changes its density in
 * place, so its identity cannot report the change and a memo keyed on it would serve stale sizes.
 */
function densityStyle(
  model: FileTreeModel,
  _version: number,
  style: CSSProperties | undefined,
): CSSProperties {
  return {
    ['--trees-item-height' as string]: `${String(model.getItemHeight())}px`,
    ['--trees-density-override' as string]: model.getDensityFactor(),
    ...style,
  }
}

export function FileTree({
  header,
  id,
  model,
  renderContextMenu,
  ...hostProps
}: FileTreeProps): React.JSX.Element {
  const [activeContextMenu, setActiveContextMenu] = useState<ActiveContextMenuState | null>(null)
  const [hostElement, setHostElement] = useState<HTMLElement | null>(null)
  // The composition the model arrived with, re-read only when the model itself is replaced.
  // State, not a ref: React re-runs this render with the new baseline before it commits.
  const [baseline, setBaseline] = useState(() => ({
    composition: model.getComposition(),
    model,
  }))
  if (baseline.model !== model) setBaseline({ composition: model.getComposition(), model })
  // Stable callbacks prevent useSyncExternalStore from resubscribing every render.
  // Manual memo: useSyncExternalStore resubscribes when this changes, and the compiler's cache is a cache, not an identity
  // guarantee — a recompute hands it a cold value every render.
  const subscribeToDensity = useCallback(
    (listener: () => void) => model.subscribeDensity(listener),
    [model],
  )
  // Manual memo: useSyncExternalStore re-reads when this changes, and the compiler's cache is a cache, not an identity
  // guarantee — a recompute hands it a cold value every render.
  const getDensitySnapshot = useCallback(() => model.getDensityVersion(), [model])
  const densityVersion = useSyncExternalStore(
    subscribeToDensity,
    getDensitySnapshot,
    getDensitySnapshot,
  )

  const hasContextMenu = renderContextMenu != null
  const handleContextMenuClose = () => {
    setActiveContextMenu(null)
  }
  const handleContextMenuOpen = (
    item: FileTreeContextMenuItem,
    context: FileTreeContextMenuOpenContext,
  ) => {
    setActiveContextMenu({ context, item })
  }
  const baselineComposition = baseline.composition
  const composition: FileTreeCompositionOptions | undefined = resolveComposition(
    baselineComposition,
    header,
    hasContextMenu,
    handleContextMenuClose,
    handleContextMenuOpen,
  )

  const handleHostRef = (node: HTMLElement | null) => {
    setHostElement(node)
  }

  // Dropped during render, not in an effect: a menu whose renderer just went away must not
  // survive into the commit that removes it.
  if (!hasContextMenu && activeContextMenu !== null) setActiveContextMenu(null)

  useClientLayoutEffect(() => {
    model.setComposition(composition)
  }, [composition, model])

  useClientLayoutEffect(() => {
    if (hostElement == null) {
      return
    }

    model.render({ fileTreeContainer: hostElement })

    return () => {
      model.unmount()
      model.setComposition(baselineComposition)
    }
  }, [baselineComposition, hostElement, model])

  const children = renderFileTreeChildren(header, renderContextMenu, activeContextMenu)

  const mergedStyle = densityStyle(model, densityVersion, hostProps.style)

  return createElement(
    FILE_TREE_TAG_NAME,
    {
      ...hostProps,
      id,
      ref: handleHostRef,
      style: mergedStyle,
    },
    children,
  )
}
