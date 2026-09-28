import { useEffect, useEffectEvent } from 'react'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { useFileIntent } from '@/lib/file-open-intent/hooks/use-file-intent'
import type { FileOpenIntentSource } from '@/lib/file-open-intent/state/service'

/** Prepares the file behind a list's active row each time the row changes. */
export function useActiveRowFileIntent(
  path: FilesystemPath | null,
  source: FileOpenIntentSource,
  knownSize?: number,
) {
  const prepare = useFileIntent(source)
  const prepareActive = useEffectEvent((next: FilesystemPath) =>
    prepare(next, 'active-row', { knownSize }),
  )

  useEffect(() => {
    if (path) prepareActive(path)
  }, [path])
}
