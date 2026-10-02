import { unstable_batchedUpdates } from 'react-dom'
import { createSettingsSnapshotAdmission } from '@workspace/client-core/settings/snapshot-admission'
import { providerQueryKeys } from '@/lib/query-keys'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { fetchSettings } from '@/features/settings/utils/api'
import { importSourcesQueryKey } from '@/features/settings/utils/query-keys'
import { notifyPrunedSettings } from '@/features/settings/utils/notify-pruned-settings'

const admission = createSettingsSnapshotAdmission({
  batch: unstable_batchedUpdates,
  fetch: (owner, signal, options) => fetchSettings(signal, clientForQueryClient(owner), options),
  invalidateProviders: (owner) => {
    void owner.invalidateQueries({ queryKey: providerQueryKeys.all })
    void owner.invalidateQueries({ queryKey: importSourcesQueryKey })
  },
})

export const settingsSnapshotAdmission = {
  ...admission,
  admitSettingsEvent: (...args: Parameters<typeof admission.admitSettingsEvent>) => {
    notifyPrunedSettings(args[1].snapshot)
    return admission.admitSettingsEvent(...args)
  },
}

export const {
  beginSettingsSnapshotRead,
  observeInitialSettingsSnapshot,
  admitSettingsMutationResult,
  admitSettingsEvent,
  admitSettingsRawResult,
  refreshConfirmedSettings,
  resetSettingsSnapshotAdmission,
} = settingsSnapshotAdmission
