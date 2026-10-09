import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { FsEntry } from '@/lib/file-system-types'
import { directoryQueryOptions } from '@/features/file-picker/utils/directory-query'

/** The folder to show: the previous one stays up until the next one's listing has loaded. */
export function usePreviewReady(entry: FsEntry | null, showHidden: boolean) {
  const [shown, setShown] = useState<FsEntry | null>(null)
  const folder = useQuery({
    ...directoryQueryOptions({ path: entry?.path ?? '', query: '', showHidden }),
    enabled: entry !== null,
  })
  if (!entry && shown) setShown(null)
  if (entry && !folder.isPending && shown !== entry) setShown(entry)
  return { shown: shown ?? entry, fetching: shown !== entry || folder.isFetching }
}
