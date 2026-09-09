import { useQuery } from '@tanstack/react-query'
import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'
import { fetchImportSources, importSourcesQueryKey } from '@/features/settings/utils/session-import'
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
