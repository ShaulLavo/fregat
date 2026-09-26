import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useDebouncedValue } from '@tanstack/react-pacer/debouncer'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import { Spinner } from '@workspace/ui/components/spinner'

import { useHeldUntilReady } from '@/hooks/use-held-until-ready'
import { useSettingValue } from '@/hooks/use-setting-value'
import { serverEndpoint } from '@/lib/client'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { FileThumbnail } from '@/lib/file-preview/components/file-thumbnail'
import { TextPreview } from '@/lib/file-preview/components/text-preview'
import { imageReadyQueryOptions } from '@/lib/file-preview/utils/image-ready-query'
import { isImageName, PREVIEW_SETTLE_MS, previewImageUrl } from '@/lib/file-preview/utils/preview'
import { previewQueryOptions } from '@/lib/file-preview/utils/preview-query'
import type { FilePaletteItem } from '@/features/command-palette/utils/types'

/** The shown filename and preview change together after the settled highlight can paint. */
export function FilePreviewPanel({ item }: { readonly item: FilePaletteItem | null }) {
  const [settled] = useDebouncedValue(item, { wait: PREVIEW_SETTLE_MS })
  const origin = serverEndpoint(originForQueryClient(useQueryClient()))
  const maxBytes = useSettingValue('files.previewKilobytes') * 1024
  const path = settled?.entry.path ?? ''
  const isImage = isImageName(settled?.entry.name ?? '')
  const text = useQuery({
    ...previewQueryOptions(path, maxBytes),
    enabled: settled !== null && !isImage,
  })
  const image = useQuery({
    ...imageReadyQueryOptions(previewImageUrl(origin, path)),
    enabled: settled !== null && isImage,
  })
  const query = isImage ? image : text
  const shown = useHeldUntilReady(settled, settled === null || !query.isPending)
  if (!shown) return null
  const { entry } = shown
  const fetching = shown !== item || query.isFetching
  const fallback = <p className='text-muted-foreground p-2 text-xs'>Preview unavailable</p>

  return (
    <section
      aria-label='File preview'
      className='flex max-h-[35dvh] shrink-0 flex-col overflow-hidden px-3 pb-3'
      data-file-preview={entry.path}
      title={shown.pathLabel}
    >
      <PaneBar as='header'>
        <span className='min-w-0 flex-1 truncate text-xs font-medium' title={shown.pathLabel}>
          {entry.name}
        </span>
        {fetching ? <Spinner label='Loading preview' size='xs' /> : null}
      </PaneBar>
      {isImageName(entry.name) ? (
        <FileThumbnail fallback={fallback} src={previewImageUrl(origin, entry.path)} />
      ) : (
        <TextPreview fallback={fallback} name={entry.name} path={entry.path} />
      )}
    </section>
  )
}
