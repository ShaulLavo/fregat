import type { QueryClient } from '@tanstack/react-query'
import { projectSettings } from '@workspace/client-core/settings/projection'
import { resolveThemeSettings } from '@workspace/contracts'
import { useSettingsDocument } from '@/features/settings/hooks/use-settings-document'
import { useSettingsProjection } from '@/features/settings/hooks/use-settings-projection'
import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'
import { useSystemColorMode } from '@/features/settings/hooks/use-system-color-mode'
import { useSettingsReloadOwner } from '@/features/settings/hooks/use-reload-owner'

export function useSettingsDisplay(owner?: QueryClient) {
  const settingsOwner = useSettingsOwner()
  const queryClient = owner ?? settingsOwner
  const document = useSettingsDocument(queryClient)
  const projection = useSettingsProjection(queryClient)
  const systemMode = useSystemColorMode()
  const saved = useSettingsReloadOwner(queryClient)?.saved
  if (document.data || !saved) return { document, projection, saved: false }
  const observed = projectSettings(saved, [])
  return {
    document: { ...document, data: saved },
    projection: {
      ...observed,
      values: resolveThemeSettings(observed.values, systemMode, observed.layers),
    },
    saved: true,
  }
}
