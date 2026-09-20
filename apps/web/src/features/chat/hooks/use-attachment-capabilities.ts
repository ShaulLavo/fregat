import { useQuery } from '@tanstack/react-query'
import type { EnvironmentId } from '@workspace/contracts'
import { environmentClientFor } from '@/lib/client'
import { confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'
import { createClientInvariantError } from '@/lib/structured-errors'
import { attachmentQueryKeys } from '../utils/query-keys'

export function useAttachmentCapabilities(environmentId: EnvironmentId) {
  return useQuery({
    queryKey: attachmentQueryKeys.capabilities(environmentId),
    staleTime: 10_000,
    queryFn: async () => {
      const client = environmentClientFor(confirmedEnvironmentOrigin(environmentId))
      const response = await client.attachments.capabilities.get()
      if (response.error)
        throw createClientInvariantError('Attachment capabilities are unavailable.')
      return response.data
    },
  })
}
