import type { FilesystemPath } from '@/lib/documents/utils/types'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { useCallback, useMemo, useState } from 'react'

import { FilesPane } from '@/features/workspace/components/files-pane'
import {
  FileTreeActionsContext,
  type FileTreeActions,
} from '@/features/workspace/providers/actions-context'
import { FileNavigatorHeader } from '@/features/workbench/components/file-navigator-header'
import { createVisibleTreeItemCountStore } from '@/features/workbench/utils/visible-tree-item-count-store'
import { useWorkspaceTreeForRootPath } from '@/features/workspace/hooks/use-tree'

export function FileNavigatorPanel({ rootPath }: { readonly rootPath: FilesystemPath }) {
  const { loadTreeDirectory, prefetchTreeDirectory, treeState } =
    useWorkspaceTreeForRootPath(rootPath)
  const [visibleTreeItemCountStore] = useState(() => createVisibleTreeItemCountStore())
  // Measured: visible-count publication should update the header, not repaint FilesPane.
  const handleVisibleTreeItemCountChange = useCallback(
    (count: number) => visibleTreeItemCountStore.setCount(rootPath, count),
    [rootPath, visibleTreeItemCountStore],
  )
  // Keep tree action identity stable so header count updates do not repaint the tree.
  const fileTreeActions = useMemo<FileTreeActions>(
    () => ({
      loadDirectory: loadTreeDirectory,
      prefetchDirectory: prefetchTreeDirectory,
      publishVisibleItemCount: handleVisibleTreeItemCountChange,
    }),
    [handleVisibleTreeItemCountChange, loadTreeDirectory, prefetchTreeDirectory],
  )

  return (
    <section className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden'>
      <FileNavigatorHeader
        rootPath={filesystemPath(rootPath)}
        treeState={treeState}
        visibleTreeItemCountStore={visibleTreeItemCountStore}
      />
      <div className='min-h-0 min-w-0 flex-1 overflow-hidden'>
        <FileTreeActionsContext value={fileTreeActions}>
          <FilesPane key={rootPath} rootPath={filesystemPath(rootPath)} state={treeState} />
        </FileTreeActionsContext>
      </div>
    </section>
  )
}
