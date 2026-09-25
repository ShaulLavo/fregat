import type { ScopedProjectRef } from '@workspace/contracts'

import { useRailEnvironments } from '@/features/chat-mode/hooks/use-rail-environments'
import { draftMachines } from '@/features/chat-mode/utils/draft-machines'
import { useSettingValue } from '@/hooks/use-setting-value'

export function useDraftMachines(ref: ScopedProjectRef | null) {
  const environments = useRailEnvironments()
  const mode = useSettingValue('chat.projectGrouping')
  const overrides = useSettingValue('chat.projectGroupingOverrides')
  if (!ref) return []

  return draftMachines(environments, { mode, overrides }, ref)
}
