import { Spinner } from '@workspace/ui/components/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { CrosshairIcon, FilePlusIcon, FolderPlusIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { useStore } from 'zustand'

import { ToolPaneHeader } from '@/components/tool-pane-header'
import { LiveUpdatesLimited } from '@/features/workbench/components/live-updates-limited'
import type { NavigatorHeaderStore } from '@/features/workbench/state/navigator-header-store'
import type { LoadState } from '@/lib/load-state'
import type { TreeModel } from '@/lib/tree-model'

export function FileNavigatorHeader({
  loading,
  rootPath,
  treeState,
  headerStore,
}: {
  readonly loading: boolean
  readonly rootPath: FilesystemPath
  readonly treeState: LoadState<TreeModel>
  readonly headerStore: NavigatorHeaderStore['store']
}) {
  const visibleTreeItemCount = useStore(headerStore, ({ visibleCount }) =>
    visibleCount?.rootPath === rootPath ? visibleCount.count : null,
  )
  const toolbar = useStore(headerStore, (state) => state.toolbar)
  const mutationsEnabled = toolbar?.mutationsEnabled ?? false

  return (
    <ToolPaneHeader
      actions={
        <>
          {loading ? <Spinner label='Loading files' size='xs' /> : null}
          <LiveUpdatesLimited rootPath={rootPath} />
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
