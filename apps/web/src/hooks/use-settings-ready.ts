import { useSettingsProjection } from '@/features/settings/hooks/use-settings-projection'

export function useSettingsReady() {
  return useSettingsProjection() !== undefined
}
