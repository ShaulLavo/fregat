import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useHeldUntilReady } from '@/hooks/use-held-until-ready'
import { clientForQueryClient, originForQueryClient } from '@/lib/environments/state/query-clients'
import { statPath } from '@/lib/file-server'
import { fileSystemKeys } from '@/lib/query-keys'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import type { PdfSource } from '@/lib/pdf-viewer/source'

export function usePdfFileSource(path: FilesystemPath) {
  const queryClient = useQueryClient()
  const origin = originForQueryClient(queryClient)
  const metadata = useQuery({
    queryKey: fileSystemKeys.fileMetadata(path),
    queryFn: ({ signal, client }) => statPath(path, signal, clientForQueryClient(client)),
    gcTime: 0,
    refetchOnMount: 'always',
  })
  // useHeldUntilReady compares identity while retaining the complete source.
  const next = useMemo<PdfSource | null>(
    () => (metadata.data ? { kind: 'file', origin, path, version: metadata.data.version } : null),
    [metadata.data, origin, path],
  )
  const source = useHeldUntilReady(next, metadata.isSuccess)
  return { source, loading: metadata.isFetching, error: metadata.error }
}
