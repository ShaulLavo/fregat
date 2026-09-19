import { queryOptions } from '@tanstack/react-query'
import type { ThemeId } from '@workspace/contracts'
import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { createRpcError } from '@/lib/structured-errors'

export function useBundleExport() {
  const owner = useSettingsOwner()
  return async (id: ThemeId) => {
    const archive = await owner.fetchQuery(
      queryOptions({
        queryKey: ['themes', 'bundles', id, 'export'],
        staleTime: 0,
        queryFn: async () => {
          const response = await clientForQueryClient(owner).themes.bundles({ id }).export.get()
          if (response.error) throw createRpcError(response.error)
          return response.data
        },
      }),
    )
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' }),
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${id}.platform-theme.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
