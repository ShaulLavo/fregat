import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useSettingValue } from '@/hooks/use-setting-value'
import { serverEndpoint } from '@/lib/client'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { previewQueryOptions } from '@/lib/file-preview/utils/preview-query'
import { previewImageUrl } from '@/lib/file-preview/utils/preview'
import type { FsEntry } from '@/lib/file-system-types'
import { directoryQueryOptions } from '@/features/file-picker/utils/directory-query'
import { imageReadyQueryOptions } from '@/features/file-picker/utils/image-ready-query'
import type { FilePickerMode } from '@/features/file-picker/utils/model'
import { previewKind } from '@/features/file-picker/utils/preview'

/** Whether `entry`'s preview can paint without a loader: its first lines, children or image. */
export function usePreviewReady(
  entry: FsEntry | null,
  { mode, showHidden }: { mode: FilePickerMode; showHidden: boolean },
) {
  const origin = serverEndpoint(originForQueryClient(useQueryClient()))
  const maxBytes = useSettingValue('files.previewKilobytes') * 1024
  const kind = entry ? previewKind(entry) : 'none'
  const path = entry?.path ?? ''
  const text = useQuery({ ...previewQueryOptions(path, maxBytes), enabled: kind === 'text' })
  const folder = useQuery({
    ...directoryQueryOptions({ mode, path, query: '', showHidden }),
    enabled: kind === 'folder',
  })
  const image = useQuery({
    ...imageReadyQueryOptions(previewImageUrl(origin, path)),
    enabled: kind === 'image',
  })
  if (kind === 'text') return !text.isPending
  if (kind === 'folder') return !folder.isPending
  if (kind === 'image') return !image.isPending
  return true
}
