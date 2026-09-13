import { useSettingsIntentStore } from '@/features/settings/state/intent-store'
import type { QueryClient } from '@tanstack/react-query'
import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'
import {
  projectSettings,
  type SettingsProjection,
} from '@workspace/client-core/settings/projection'

import { useSettingsDocument } from '@/features/settings/hooks/use-settings-document'

export type { SettingsProjection } from '@workspace/client-core/settings/projection'

/** Effective settings after replaying local semantic intent over confirmed state. */
export function useSettingsProjection(owner?: QueryClient): SettingsProjection | undefined {
  const settingsOwner = useSettingsOwner()
  const queryClient = owner ?? settingsOwner
  const document = useSettingsDocument(queryClient)
  const active = useSettingsIntentStore((state) => state.active)
  if (!document.data) return undefined

  return projectSettings(
    document.data,
    active.filter((entry) => entry.patch.owner === queryClient),
  )
}
