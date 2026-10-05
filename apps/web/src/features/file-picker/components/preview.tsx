import { useDebouncedValue } from '@tanstack/react-pacer/debouncer'
import { Spinner } from '@workspace/ui/components/spinner'
import { ToolPane } from '@workspace/ui/patterns/tool-pane'

import type { FsEntry } from '@/lib/file-system-types'
import { EntryContent } from '@/features/file-picker/components/entry-content'
import { EntryFacts } from '@/features/file-picker/components/entry-facts'
import { NoPreview } from '@/features/file-picker/components/no-preview'
import type { FilePickerMode } from '@/features/file-picker/utils/model'
import { PREVIEW_SETTLE_MS } from '@/lib/file-preview/utils/preview'
import { usePreviewReady } from '@/features/file-picker/hooks/use-preview-ready'

/**
 * The selection's content and facts. It follows the selection only once it rests, so holding an
 * arrow key reads nothing, and the previous entry (content, name and facts) stays up until the
 * next one's content can paint.
 */
export function PreviewPane({
  accept,
  entry,
  isSearching,
  mode,
  showHidden,
}: {
  accept?: readonly string[]
  entry: FsEntry | null
  isSearching: boolean
  mode: FilePickerMode
  showHidden: boolean
}) {
  const [settled] = useDebouncedValue(entry, { wait: PREVIEW_SETTLE_MS })
  const { shown, fetching } = usePreviewReady(settled, { mode, showHidden })

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
          data-file-preview={shown.entry.path}
        >
          <div className='flex min-h-0 w-full flex-1 flex-col items-center'>
            <EntryContent
              accept={accept}
              entry={shown.entry}
              mode={mode}
              showHidden={showHidden}
              read={shown.read}
              origin={shown.origin}
            />
          </div>
          <div className='flex shrink-0 flex-col gap-(--density-control-gap)'>
            <div className='w-full min-w-0 text-center' title={shown.entry.path}>
              <div className='truncate text-xs font-medium'>{shown.entry.name}</div>
            </div>
            <EntryFacts entry={shown.entry} read={shown.read} />
          </div>
        </div>
      ) : (
        <NoPreview isSearching={isSearching} mode={mode} />
      )}
    </ToolPane>
  )
}
