import { useMutation } from '@tanstack/react-query'

import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { settingsMutationKeys } from '@/features/settings/utils/mutation-keys'
import { issuePairingLink } from '@/features/settings/utils/pairing-api'

/** Makes a one-time pairing code; the link it becomes lives only in this panel. */
export function usePairingLink() {
  const owner = useSettingsOwner()
  return useMutation(
    {
      mutationKey: settingsMutationKeys.pairing.link,
      mutationFn: () => issuePairingLink(clientForQueryClient(owner)),
    },
    owner,
  )
}
