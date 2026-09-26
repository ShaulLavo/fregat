import { useQueryClient } from '@tanstack/react-query'

import type { FsEntry } from '@/lib/file-system-types'
import { serverEndpoint } from '@/lib/client'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { EntryPreviewTile } from '@/features/file-picker/components/entry-preview-tile'
import { FileThumbnail } from '@/lib/file-preview/components/file-thumbnail'
import { FolderPreview } from '@/features/file-picker/components/folder-preview'
import { TextPreview } from '@/lib/file-preview/components/text-preview'
import { previewImageUrl } from '@/lib/file-preview/utils/preview'
import type { FilePickerMode } from '@/features/file-picker/utils/model'
import { previewKind } from '@/features/file-picker/utils/preview'

/** What is in the entry: the image, the first lines, or the first children. */
export function EntryContent({
  accept,
  entry,
  mode,
  showHidden,
}: {
  accept?: readonly string[]
  entry: FsEntry
  mode: FilePickerMode
  showHidden: boolean
}) {
  const origin = serverEndpoint(originForQueryClient(useQueryClient()))
  const kind = previewKind(entry)
  const tile = (
    <div className='flex min-h-0 flex-1 items-center justify-center'>
      <EntryPreviewTile entry={entry} />
    </div>
  )
  if (kind === 'image')
    return (
      <FileThumbnail
        className='h-full min-h-0'
        fallback={tile}
        src={previewImageUrl(origin, entry.path)}
      />
    )
  if (kind === 'text') return <TextPreview fallback={tile} name={entry.name} path={entry.path} />
  if (kind === 'folder')
    return <FolderPreview accept={accept} entry={entry} mode={mode} showHidden={showHidden} />
  return tile
}
