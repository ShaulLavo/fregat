import { bundleQueryKey } from '@/lib/theme-library/utils/keys'
import { useQuery } from '@tanstack/react-query'
import { BUNDLED_THEMES } from '@workspace/contracts'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { createRpcError } from '@/lib/structured-errors'

export function useBundleLibrary() {
  const owner = useSettingsOwner()
  const query = useQuery(
    {
      queryKey: bundleQueryKey,
      queryFn: async () => {
        const response = await clientForQueryClient(owner).themes.bundles.get()
        if (response.error) throw createRpcError(response.error)
        return response.data
      },
      staleTime: 30_000,
    },
    owner,
  )
  return { ...query, catalog: query.data ?? BUNDLED_THEMES }
}
