import type { FilesystemPath } from '@/lib/documents/utils/types'
import { useSyncExternalStore } from 'react'

import { ToolPaneHeader } from '@/features/workbench/components/tool-pane-header'
import type { VisibleTreeItemCountStore } from '@/features/workbench/utils/visible-tree-item-count-store'
import type { LoadState } from '@/lib/load-state'
import type { TreeModel } from '@/lib/tree-model'

export function FileNavigatorHeader({
  rootPath,
  treeState,
  visibleTreeItemCountStore,
}: {
  readonly rootPath: FilesystemPath
  readonly treeState: LoadState<TreeModel>
  readonly visibleTreeItemCountStore: VisibleTreeItemCountStore
}) {
  const snapshot = useSyncExternalStore(
    visibleTreeItemCountStore.subscribe,
    visibleTreeItemCountStore.getSnapshot,
    visibleTreeItemCountStore.getSnapshot,
  )
  const visibleTreeItemCount = snapshot.rootPath === rootPath ? snapshot.count : null

  return (
    <ToolPaneHeader tab='files' treeState={treeState} visibleTreeItemCount={visibleTreeItemCount} />
  )
}
