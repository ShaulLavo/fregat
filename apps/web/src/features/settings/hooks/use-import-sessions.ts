import { settingsMutationKeys } from '@/features/settings/utils/mutation-keys'
import { useMutation } from '@tanstack/react-query'
import type { ProviderInstanceId } from '@workspace/contracts'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { settingsQueryKeys } from '@/features/settings/utils/query-keys'
import { importSessions } from '@/features/settings/utils/session-import'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'

export function useImportSessions(providerInstanceId: ProviderInstanceId) {
  const owner = useSettingsOwner()
  return useMutation(
    {
      mutationKey: settingsMutationKeys.importSessions(providerInstanceId),
      mutationFn: () => importSessions(clientForQueryClient(owner), providerInstanceId),
      retry: false,
      // An import also records what the imported chats spent.
      onSuccess: () => owner.invalidateQueries({ queryKey: settingsQueryKeys.usageHistoryAll }),
    },
    owner,
  )
}
