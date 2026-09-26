import { useQueryClient } from '@tanstack/react-query'
import { useDebouncedValue } from '@tanstack/react-pacer/debouncer'

import { serverEndpoint } from '@/lib/client'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { FileThumbnail } from '@/lib/file-preview/components/file-thumbnail'
import { TextPreview } from '@/lib/file-preview/components/text-preview'
import { isImageName, PREVIEW_SETTLE_MS, previewImageUrl } from '@/lib/file-preview/utils/preview'
import type { FilePaletteItem } from '@/features/command-palette/utils/types'

/**
 * What is in the highlighted file, below the results. It follows the highlight only once it rests;
 * a new file never shows the previous file's body under its name.
 */
export function FilePreviewPanel({ item }: { readonly item: FilePaletteItem | null }) {
  const [settled] = useDebouncedValue(item, { wait: PREVIEW_SETTLE_MS })
  const origin = serverEndpoint(originForQueryClient(useQueryClient()))
  if (!settled) return null
  const { entry } = settled

  return (
    <section
      aria-label='File preview'
      className='flex max-h-[35dvh] shrink-0 flex-col overflow-hidden px-3 pb-3'
      data-file-preview={entry.path}
      title={settled.pathLabel}
    >
      {isImageName(entry.name) ? (
        <FileThumbnail fallback={null} src={previewImageUrl(origin, entry.path)} />
      ) : (
        <TextPreview fallback={null} name={entry.name} path={entry.path} />
      )}
    </section>
  )
}
