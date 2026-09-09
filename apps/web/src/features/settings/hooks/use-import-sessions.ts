import { useMutation } from '@tanstack/react-query'
import type { ProviderInstanceId } from '@workspace/contracts'
import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'
import { importSessions } from '@/features/settings/utils/session-import'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'

export function useImportSessions(providerInstanceId: ProviderInstanceId) {
  const owner = useSettingsOwner()
  return useMutation(
    {
      mutationKey: ['settings', 'session-import', providerInstanceId],
      mutationFn: () => importSessions(clientForQueryClient(owner), providerInstanceId),
      retry: false,
    },
    owner,
  )
}
