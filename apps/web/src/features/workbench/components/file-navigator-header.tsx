import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { CrosshairIcon, FilePlusIcon, FolderPlusIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { useSyncExternalStore } from 'react'

import { ToolPaneHeader } from '@/components/tool-pane-header'
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
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label='New file at workspace root'
                  className='text-muted-foreground'
                  disabled={!mutationsEnabled}
                  focusableWhenDisabled
                  size='icon-sm'
                  type='button'
                  variant='ghost'
                  onClick={toolbar?.createFile}
                >
                  <FilePlusIcon className='size-(--icon-size-sm)' />
                </Button>
              }
            />
            <TooltipContent>{'New File'}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label='New folder at workspace root'
                  className='text-muted-foreground'
                  disabled={!mutationsEnabled}
                  focusableWhenDisabled
                  size='icon-sm'
                  type='button'
                  variant='ghost'
                  onClick={toolbar?.createFolder}
                >
                  <FolderPlusIcon className='size-(--icon-size-sm)' />
                </Button>
              }
            />
            <TooltipContent>{'New Folder'}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label='Reveal active file in tree'
                  className='text-muted-foreground'
                  disabled={!toolbar}
                  focusableWhenDisabled
                  size='icon-sm'
                  type='button'
                  variant='ghost'
                  onClick={toolbar?.revealActiveFile}
                >
                  <CrosshairIcon className='size-(--icon-size-sm)' />
                </Button>
              }
            />
            <TooltipContent>{'Reveal Active File'}</TooltipContent>
          </Tooltip>
        </>
      }
      tab='files'
      treeState={treeState}
      visibleTreeItemCount={visibleTreeItemCount}
    />
  )
}
