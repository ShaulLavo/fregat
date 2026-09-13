import type { FilesystemPath } from '@/lib/documents/utils/types'
import { CrosshairIcon, FilePlusIcon, FolderPlusIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { useSyncExternalStore } from 'react'

import { ToolPaneHeader } from '@/features/workbench/components/tool-pane-header'
import type { TreeToolbarStore } from '@/features/workbench/utils/tree-toolbar-store'
import type { VisibleTreeItemCountStore } from '@/features/workbench/utils/visible-tree-item-count-store'
import type { LoadState } from '@/lib/load-state'
import type { TreeModel } from '@/lib/tree-model'

export function FileNavigatorHeader({
  rootPath,
  treeState,
  treeToolbarStore,
  visibleTreeItemCountStore,
}: {
  readonly rootPath: FilesystemPath
  readonly treeState: LoadState<TreeModel>
  readonly treeToolbarStore: TreeToolbarStore
  readonly visibleTreeItemCountStore: VisibleTreeItemCountStore
}) {
  const snapshot = useSyncExternalStore(
    visibleTreeItemCountStore.subscribe,
    visibleTreeItemCountStore.getSnapshot,
    visibleTreeItemCountStore.getSnapshot,
  )
  const toolbar = useSyncExternalStore(
    treeToolbarStore.subscribe,
    treeToolbarStore.getSnapshot,
    treeToolbarStore.getSnapshot,
  )
  const visibleTreeItemCount = snapshot.rootPath === rootPath ? snapshot.count : null
  const mutationsEnabled = toolbar?.mutationsEnabled ?? false

  return (
    <ToolPaneHeader
      actions={
        <>
          <Button
            aria-label='New file at workspace root'
            className='text-muted-foreground'
            disabled={!mutationsEnabled}
            size='icon-sm'
            title='New File'
            type='button'
            variant='ghost'
            onClick={toolbar?.createFile}
          >
            <FilePlusIcon className='size-3.5' />
          </Button>
          <Button
            aria-label='New folder at workspace root'
            className='text-muted-foreground'
            disabled={!mutationsEnabled}
            size='icon-sm'
            title='New Folder'
            type='button'
            variant='ghost'
            onClick={toolbar?.createFolder}
          >
            <FolderPlusIcon className='size-3.5' />
          </Button>
          <Button
            aria-label='Reveal active file in tree'
            className='text-muted-foreground'
            disabled={!toolbar}
            size='icon-sm'
            title='Reveal Active File'
            type='button'
            variant='ghost'
            onClick={toolbar?.revealActiveFile}
          >
            <CrosshairIcon className='size-3.5' />
          </Button>
        </>
      }
      tab='files'
      treeState={treeState}
      visibleTreeItemCount={visibleTreeItemCount}
    />
  )
}
