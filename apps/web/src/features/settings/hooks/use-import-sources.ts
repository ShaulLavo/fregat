import { useQuery } from '@tanstack/react-query'
import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'
import { fetchImportSources } from '@/features/settings/utils/session-import'
import { importSourcesQueryKey } from '@/features/settings/utils/query-keys'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'

export function useImportSources() {
  const owner = useSettingsOwner()
  return useQuery(
    {
      queryKey: importSourcesQueryKey,
      queryFn: ({ signal }) => fetchImportSources(clientForQueryClient(owner), signal),
    },
    owner,
  )
}
