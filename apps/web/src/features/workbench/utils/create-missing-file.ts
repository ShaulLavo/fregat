import { mutationOptions, type QueryClient } from '@tanstack/react-query'
import { workbenchMutationKeys } from '@/features/workbench/utils/mutation-keys'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { createFileContent, ensureFolderPath } from '@/lib/file-server'
import { parentFilesystemPath } from '@/lib/path-formatters'
import { fileSystemKeys, gitKeys } from '@/lib/query-keys'

export function createMissingFileOptions(queryClient: QueryClient, path: FilesystemPath) {
  return mutationOptions({
    mutationKey: workbenchMutationKeys.createMissingFile(path),
    scope: { id: `create-file:${path}` },
    mutationFn: async () => {
      const client = clientForQueryClient(queryClient)
      await ensureFolderPath(parentFilesystemPath(path), client)
      return createFileContent(path, '', client)
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: fileSystemKeys.all }),
        queryClient.invalidateQueries({ queryKey: gitKeys.all }),
      ])
    },
  })
}
