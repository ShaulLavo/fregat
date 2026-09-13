import { useSyncExternalStore } from 'react'

import type { FilesystemPath } from '@/lib/documents/utils/types'
import type { TreeModel } from '@/lib/tree-model'
import { projectedTreeModel, treeIntents } from '@/features/workspace/state/tree-intents'

/** The tree as the user should see it: confirmed entries plus this root's pending changes. */
export function useProjectedTreeModel(confirmed: TreeModel, rootPath: FilesystemPath) {
  const snapshot = () => projectedTreeModel(confirmed, rootPath)
  return useSyncExternalStore(treeIntents.subscribe, snapshot, snapshot)
}
