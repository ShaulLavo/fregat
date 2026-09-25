import { invalidateCheckout } from '@/lib/invalidate-checkout'
import type { useQueryClient } from '@tanstack/react-query'

import { fileSystemKeys, gitKeys } from '@/lib/query-keys'

export function invalidateWorkspace(
  queryClient: ReturnType<typeof useQueryClient>,
  rootPath?: string,
) {
  return Promise.all([
    rootPath === undefined
      ? queryClient.invalidateQueries({ queryKey: gitKeys.all })
      : invalidateCheckout(queryClient, rootPath),
    queryClient.invalidateQueries({ queryKey: fileSystemKeys.fileSnapshots() }),
    queryClient.invalidateQueries({ queryKey: fileSystemKeys.trees() }),
  ])
}
