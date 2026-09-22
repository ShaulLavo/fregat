import type { QueryClient } from '@tanstack/react-query'
import { useSettingsDocument } from '@/features/settings/hooks/use-settings-document'
import { useSettingsProjection } from '@/features/settings/hooks/use-settings-projection'
import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'

export function useSettingsDisplay(owner?: QueryClient) {
  const settingsOwner = useSettingsOwner()
  const queryClient = owner ?? settingsOwner

  return {
    document: useSettingsDocument(queryClient),
    projection: useSettingsProjection(queryClient),
  }
}
