import { useStore } from 'zustand'
import { settingsIntentStore } from '@workspace/client-core/settings/intent-store'
import { watchIntentHolds } from '@/lib/optimistic/hold-diagnostics'

watchIntentHolds(settingsIntentStore, {
  area: 'settings',
  describe: (patch) =>
    `${patch.request.target} ${patch.request.operations.map((op) => op.kind).join(',')}`,
})

export const useSettingsIntentStore = Object.assign(function useSettingsIntentStore<T>(
  selector: (state: ReturnType<typeof settingsIntentStore.getState>) => T,
) {
  return useStore(settingsIntentStore, selector)
}, settingsIntentStore)
