import { useMutationState } from '@tanstack/react-query'
import { SETTINGS_MUTATION_KEY } from '@/features/settings/utils/mutation-keys'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'

/** True while a settings write is in flight for the owner on screen. */
export function useSettingsSaving() {
  const owner = useSettingsOwner()
  const pending = useMutationState(
    { filters: { mutationKey: SETTINGS_MUTATION_KEY, status: 'pending' }, select: () => true },
    owner,
  )
  return pending.length > 0
}
