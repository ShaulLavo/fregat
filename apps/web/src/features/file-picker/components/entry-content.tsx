import { useQueryClient } from '@tanstack/react-query'

import type { FsEntry } from '@/lib/file-system-types'
import { serverEndpoint } from '@/lib/client'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { EntryPreviewTile } from '@/features/file-picker/components/entry-preview-tile'
import { FileThumbnail } from '@/features/file-picker/components/file-thumbnail'
import { FolderPreview } from '@/features/file-picker/components/folder-preview'
import { TextPreview } from '@/features/file-picker/components/text-preview'
import type { FilePickerIconMode, FilePickerMode } from '@/features/file-picker/utils/model'
import { previewImageUrl, previewKind } from '@/features/file-picker/utils/preview'

/** What is in the entry: the image, the first lines, or the first children. */
export function EntryContent({
  entry,
  iconMode,
  mode,
  showHidden,
}: {
  entry: FsEntry
  iconMode: FilePickerIconMode
  mode: FilePickerMode
  showHidden: boolean
}) {
  const origin = serverEndpoint(originForQueryClient(useQueryClient()))
  const kind = previewKind(entry)
  if (kind === 'image')
    return (
      <FileThumbnail entry={entry} iconMode={iconMode} src={previewImageUrl(origin, entry.path)} />
    )
  if (kind === 'text') return <TextPreview entry={entry} iconMode={iconMode} />
  if (kind === 'folder')
    return <FolderPreview entry={entry} iconMode={iconMode} mode={mode} showHidden={showHidden} />
  return <EntryPreviewTile entry={entry} iconMode={iconMode} selected={false} size='lg' />
}
