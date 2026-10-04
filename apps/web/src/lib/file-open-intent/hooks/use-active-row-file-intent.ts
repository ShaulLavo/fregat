import { useEffect } from 'react'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { useFileIntent } from '@/lib/file-open-intent/hooks/use-file-intent'
import type { FileOpenIntentSource } from '@/lib/file-open-intent/state/service'

/** Holds the file behind a list's active row until that row or its environment changes. */
export function useActiveRowFileIntent(
  path: FilesystemPath | null,
  source: FileOpenIntentSource,
  knownSize?: number,
) {
  const prepare = useFileIntent(source)
  useEffect(() => {
    if (!path) return
    const interest = prepare(path, 'active-row', { knownSize })
    return () => interest.release()
  }, [path, knownSize, prepare])
}
