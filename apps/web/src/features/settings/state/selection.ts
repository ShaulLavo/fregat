import type { SettingsSelection } from '@/lib/documents/utils/types'
import { settingsScope } from '@/features/settings/state/scope-store'
import { settingsView } from '@/features/settings/state/view-store'

export function settingsSelection(): SettingsSelection {
  if (settingsView() === 'form') return { kind: 'form' }
  return { kind: 'json', target: settingsScope() }
}
