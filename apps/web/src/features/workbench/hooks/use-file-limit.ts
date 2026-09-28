import { useQuery } from '@tanstack/react-query'
import { fetchServerInfo, statPath } from '@/lib/file-server'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { pagedFileQueryKeys } from '@/features/workbench/utils/query-keys'

export function useFileLimit(path: FilesystemPath, enabled: boolean) {
  return useQuery({
    queryKey: pagedFileQueryKeys.limits(path),
    enabled,
    queryFn: async ({ signal, client }) => {
      const transport = clientForQueryClient(client)
      const [file, server] = await Promise.all([
        statPath(path, signal, transport),
        fetchServerInfo(signal, transport),
      ])
      return { size: file.size, limit: server.maxTextFileBytes }
    },
  })
}
