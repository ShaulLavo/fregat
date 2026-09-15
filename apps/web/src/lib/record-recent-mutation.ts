import type { MutationOptions, QueryClient } from '@tanstack/react-query'

import type { FilesystemPath } from '@/lib/documents/utils/types'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { recordRecentEntry } from '@/lib/file-server'
import { filePickerKeys } from '@/lib/query-keys'
import { recentFolderKeys } from '@/lib/recent-folders-query'

const recentMutationKeys = {
  record: (path: FilesystemPath) => ['recents', 'record', path] as const,
}

export function recordRecentMutationOptions(
  queryClient: QueryClient,
  path: FilesystemPath,
): MutationOptions<void, unknown, void> {
  return {
    mutationFn: async (_variables, { client }) => {
      await recordRecentEntry(path, clientForQueryClient(client))
    },
    mutationKey: recentMutationKeys.record(path),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: recentFolderKeys.all })
      await queryClient.invalidateQueries({ queryKey: filePickerKeys.recents() })
    },
  }
}
