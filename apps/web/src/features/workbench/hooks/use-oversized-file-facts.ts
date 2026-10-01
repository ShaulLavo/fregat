import { useQuery } from '@tanstack/react-query'
import { toClientError } from '@/lib/client-error-taxonomy'
import { fileSnapshotQueryOptions } from '@/lib/file-snapshot-query-cache'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { oversizedFileFactsOptions } from '@/features/workbench/utils/oversized-file-facts'

export function useOversizedFileFacts(
  path: FilesystemPath,
  version: string | null,
  enabled: boolean,
) {
  const snapshot = useQuery({ ...fileSnapshotQueryOptions(path), enabled: false })
  const applicable = enabled && toClientError(snapshot.error).category === 'too_large'
  const query = useQuery({
    ...oversizedFileFactsOptions(path, version),
    enabled: applicable,
  })
  return { query, applicable }
}
