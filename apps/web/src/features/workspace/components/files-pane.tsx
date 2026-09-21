import type { FilesystemPath } from '@/lib/documents/utils/types'
import { TreePane } from '@/features/workspace/components/tree-pane'
import { useStatus } from '@/features/git/hooks/use-status'
import { statusEntriesForTree } from '@/features/git/utils/status-entries-for-tree'
import type { LoadState } from '@/lib/load-state'
import type { TreeModel } from '@/lib/tree-model'
import { memo } from 'react'
import { StaleNotice } from '@/lib/environments/components/stale-notice'

export const FilesPane = memo(
  ({
    rootPath,
    state,
  }: {
    rootPath: FilesystemPath
    state: LoadState<TreeModel> & { refreshError?: string | null }
  }) => {
    const { refreshError } = state
    const gitStatus = useStatus(rootPath)
    const gitStatusEntries = gitStatus.data
      ? statusEntriesForTree(gitStatus.data.files, rootPath)
      : undefined

    return (
      <div className='flex h-full min-h-0 flex-col'>
        <StaleNotice />
        {refreshError ? (
          <p role='status' className='text-destructive p-(--density-section-padding) text-xs'>
            Files could not be refreshed. Showing saved files. {refreshError}
          </p>
        ) : null}
        <div className='min-h-0 flex-1'>
          <TreePane gitStatus={gitStatusEntries} rootPath={rootPath} state={state} />
        </div>
      </div>
    )
  },
)
