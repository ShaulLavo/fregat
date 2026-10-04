import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query'
import { settingsMutationKeys } from '@/features/settings/utils/mutation-keys'
import { settingsQueryKeys } from '@/features/settings/utils/query-keys'
import { shortcutMetadataError } from '@/features/settings/utils/structured-errors'
import { runMutation } from '@/lib/mutations/run'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

type Metadata = typeof import('@/keymap/presets/inventory')

export function shortcutMetadataQueryOptions(client: QueryClient = resourceQueryClient) {
  const load = mutationOptions({
    mutationKey: settingsMutationKeys.shortcutMetadata,
    scope: { id: 'settings.shortcut-metadata' },
    networkMode: 'always',
    retry: false,
    mutationFn: async () => {
      const cached = client.getQueryData<Metadata>(settingsQueryKeys.shortcutMetadata)
      if (cached) return cached
      try {
        return await import('@/keymap/presets/inventory')
      } catch (cause) {
        throw shortcutMetadataError(cause)
      }
    },
    onSuccess: (metadata) => {
      client.setQueryData(settingsQueryKeys.shortcutMetadata, metadata)
    },
  })
  return queryOptions({
    queryKey: settingsQueryKeys.shortcutMetadata,
    staleTime: 'static',
    gcTime: Infinity,
    structuralSharing: false,
    networkMode: 'always',
    retry: false,
    queryFn: () => runMutation(client, load, undefined),
  })
}
