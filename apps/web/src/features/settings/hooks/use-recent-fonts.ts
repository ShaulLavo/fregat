import { useMutationState } from '@tanstack/react-query'

import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import type { FontSettingId } from '@/features/settings/providers/font-preview-context'
import { SETTINGS_MUTATION_KEY } from '@/features/settings/utils/mutation-keys'
import { recentFonts, writtenFont } from '@/features/settings/utils/recent-fonts'

/** The saved font, then the ones this session's settings writes chose before it. */
export function useRecentFonts(key: FontSettingId, saved: string): string[] {
  const owner = useSettingsOwner()
  const written = useMutationState(
    {
      filters: { mutationKey: SETTINGS_MUTATION_KEY },
      select: (mutation) => writtenFont(mutation.state.variables, key),
    },
    owner,
  )
  return recentFonts(saved, written)
}
