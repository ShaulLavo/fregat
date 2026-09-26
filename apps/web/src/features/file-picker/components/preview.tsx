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
import { useHeldUntilReady } from '@/hooks/use-held-until-ready'
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
  const ready = usePreviewReady(settled, { mode, showHidden })
  const shown = useHeldUntilReady(settled, ready)
  const refetching = useIsFetching({ queryKey: filePreviewKeys.file(shown?.path ?? '') }) > 0
  const fetching = shown !== settled || refetching

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
            <EntryContent accept={accept} entry={shown} mode={mode} showHidden={showHidden} />
          </div>
          <div className='flex shrink-0 flex-col gap-(--density-control-gap)'>
            <div className='w-full min-w-0 text-center' title={shown.path}>
              <div className='truncate text-xs font-medium'>{shown.name}</div>
            </div>
            <EntryFacts entry={shown} />
          </div>
        </div>
      ) : (
        <NoPreview isSearching={isSearching} mode={mode} />
      )}
    </ToolPane>
  )
}
