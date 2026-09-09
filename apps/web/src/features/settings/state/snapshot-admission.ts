import { unstable_batchedUpdates } from 'react-dom'
import { createSettingsSnapshotAdmission } from '@workspace/client-core/settings/snapshot-admission'
import { providerQueryKeys } from '@/features/chat/utils/provider-query'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { fetchSettings } from '@/features/settings/utils/api'
import { importSourcesQueryKey } from '@/features/settings/utils/session-import'

export const settingsSnapshotAdmission = createSettingsSnapshotAdmission({
  batch: unstable_batchedUpdates,
  fetch: (owner, signal) => fetchSettings(signal, clientForQueryClient(owner)),
  invalidateProviders: (owner) => {
    void owner.invalidateQueries({ queryKey: providerQueryKeys.all })
    void owner.invalidateQueries({ queryKey: importSourcesQueryKey })
  },
})

export const {
  beginSettingsSnapshotRead,
  observeInitialSettingsSnapshot,
  admitSettingsMutationResult,
  admitSettingsEvent,
  admitSettingsRawResult,
  refreshConfirmedSettings,
  resetSettingsSnapshotAdmission,
} = settingsSnapshotAdmission
