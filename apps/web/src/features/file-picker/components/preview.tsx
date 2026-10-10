import { useDebouncedValue } from '@tanstack/react-pacer/debouncer'
import { Spinner } from '@workspace/ui/components/spinner'
import { ToolPane } from '@workspace/ui/patterns/tool-pane'

import type { FsEntry } from '@/lib/file-system-types'
import { EntryFacts } from '@/features/file-picker/components/entry-facts'
import { FolderPreview } from '@/features/file-picker/components/folder-preview'
import { NoPreview } from '@/features/file-picker/components/no-preview'
import { PREVIEW_SETTLE_MS } from '@/lib/file-preview/utils/preview'
import { usePreviewReady } from '@/features/file-picker/hooks/use-preview-ready'

/**
 * The selected folder's first children and facts. It follows the selection only once it rests, so
 * holding an arrow key reads nothing, and the previous folder stays up until the next one loads.
 */
export function PreviewPane({
  entry,
  isSearching,
  showHidden,
}: {
  entry: FsEntry | null
  isSearching: boolean
  showHidden: boolean
}) {
  const [settled] = useDebouncedValue(entry, { wait: PREVIEW_SETTLE_MS })
  const { shown, fetching } = usePreviewReady(settled, showHidden)

  return (
    <ToolPane
      actions={fetching ? <Spinner label='Loading preview' size='xs' /> : null}
      title='Preview'
      className='h-full'
      bodyClassName='flex flex-col p-(--density-section-padding)'
      scroll={false}
    >
      {shown ? (
        <div
          className='flex min-h-0 flex-1 flex-col gap-(--density-section-gap)'
          data-file-preview={shown.path}
        >
          <div className='flex min-h-0 w-full flex-1 flex-col items-center'>
            <FolderPreview entry={shown} showHidden={showHidden} />
          </div>
          <div className='flex shrink-0 flex-col gap-(--density-control-gap)'>
            <div className='w-full min-w-0 text-center' title={shown.path}>
              <div className='truncate text-xs font-medium'>{shown.name}</div>
            </div>
            <EntryFacts entry={shown} />
          </div>
        </div>
      ) : (
        <NoPreview isSearching={isSearching} />
      )}
    </ToolPane>
  )
}
