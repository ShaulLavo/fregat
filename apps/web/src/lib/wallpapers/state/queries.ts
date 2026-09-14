import { queryOptions } from '@tanstack/react-query'
import type { AssetId } from '@workspace/contracts'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { primaryServerOrigin, serverEndpoint } from '@/lib/client'
import { createRpcError } from '@/lib/structured-errors'

export const wallpaperLibraryKey = ['themes', 'wallpapers'] as const
export function wallpaperLibraryOptions() {
  return queryOptions({
    queryKey: wallpaperLibraryKey,
    staleTime: 60_000,
    queryFn: async ({ client }) => {
      const response = await clientForQueryClient(client).themes.wallpapers.get()
      if (response.error) throw createRpcError(response.error)
      return response.data
    },
  })
}

export function libraryImageUrl(id: AssetId, kind: 'asset' | 'thumbnail') {
  return `${serverEndpoint(primaryServerOrigin()).replace(/\/+$/u, '')}/themes/wallpapers/${id}/${kind}`
}
