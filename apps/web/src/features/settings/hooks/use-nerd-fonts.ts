import { settingsQueryKeys } from '@/features/settings/utils/query-keys'
import { useQuery } from '@tanstack/react-query'
import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'

import { clientForQueryClient } from '@/lib/environments/state/query-clients'

/**
 * Every Nerd Font the server can fetch, subset and cache on demand.
 *
 * Scraped from nerdfonts.com and cached under `~/.platform/fonts`, so this is
 * the real catalogue rather than whatever happens to be installed on the machine
 * — picking one here means the user gets it, not that they already had it.
 */
export function useNerdFonts() {
  const owner = useSettingsOwner()
  return useQuery(
    {
      queryFn: async ({ client }) => {
        const response = await clientForQueryClient(client).fonts.get()

        return Object.keys(response.data ?? {}).sort((a, b) => a.localeCompare(b))
      },
      queryKey: settingsQueryKeys.nerdFonts,
      // The catalogue is a release manifest; it does not move while the app is open.
      staleTime: Number.POSITIVE_INFINITY,
    },
    owner,
  )
}
