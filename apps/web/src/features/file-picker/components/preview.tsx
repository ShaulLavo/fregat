import { useIsFetching } from '@tanstack/react-query'
import { useDebouncedValue } from '@tanstack/react-pacer/debouncer'
import { Spinner } from '@workspace/ui/components/spinner'
import { ToolPane } from '@workspace/ui/patterns/tool-pane'

import type { FsEntry } from '@/lib/file-system-types'
import { filePreviewKeys } from '@/lib/query-keys'
import { EntryContent } from '@/features/file-picker/components/entry-content'
import { EntryFacts } from '@/features/file-picker/components/entry-facts'
import { NoPreview } from '@/features/file-picker/components/no-preview'
import type { FilePickerMode } from '@/features/file-picker/utils/model'
import { PREVIEW_SETTLE_MS } from '@/lib/file-preview/utils/preview'

/**
 * The selection's content and facts. It follows the selection only once it rests, so holding an
 * arrow key reads nothing, and the previous preview stays up until the next one lands.
 */
export function PreviewPane({
  accept,
  className = 'hidden lg:flex',
  entry,
  isSearching,
  mode,
  showHidden,
}: {
  accept?: readonly string[]
  className?: string
  entry: FsEntry | null
  isSearching: boolean
  mode: FilePickerMode
  showHidden: boolean
}) {
  const [settled] = useDebouncedValue(entry, { wait: PREVIEW_SETTLE_MS })
  const shown = settled
  const fetching = useIsFetching({ queryKey: filePreviewKeys.preview(shown?.path ?? '') }) > 0

  return (
    <ToolPane
      actions={fetching ? <Spinner label='Loading preview' size='xs' /> : null}
      title='Preview'
      className={className}
      bodyClassName='flex flex-col gap-(--density-section-padding) p-(--density-section-padding)'
    >
      {shown ? (
        <div
          className='flex min-h-0 flex-1 flex-col items-center gap-(--density-section-gap)'
          data-file-preview={shown.path}
        >
          <div className='flex max-h-72 min-h-0 w-full shrink justify-center overflow-hidden'>
            <EntryContent accept={accept} entry={shown} mode={mode} showHidden={showHidden} />
          </div>
          <div className='w-full min-w-0 text-center' title={shown.path}>
            <div className='truncate text-xs font-medium'>{shown.name}</div>
          </div>
          <EntryFacts entry={shown} />
        </div>
      ) : (
        <NoPreview isSearching={isSearching} mode={mode} />
      )}
    </ToolPane>
  )
}
