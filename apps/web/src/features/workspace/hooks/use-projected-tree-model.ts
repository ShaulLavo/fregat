import { useStore } from 'zustand'

import type { FilesystemPath } from '@/lib/documents/utils/types'
import type { TreeModel } from '@/lib/tree-model'
import { projectedTreeModel, treeIntents } from '@/features/workspace/state/tree-intents'

/** The tree as the user should see it: confirmed entries plus this root's pending changes. */
export function useProjectedTreeModel(confirmed: TreeModel, rootPath: FilesystemPath) {
  return useStore(treeIntents, (state) => projectedTreeModel(confirmed, rootPath, state))
}
