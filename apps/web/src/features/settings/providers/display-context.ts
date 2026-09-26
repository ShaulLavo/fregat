import { createContext } from 'react'
import type { SettingsScope } from '@/features/settings/state/scope-store'
import type { SettingsView } from '@/features/settings/state/view-store'

// Descendants, including portals, act on the held subject while a new selection loads.
export const SettingsDisplayContext = createContext<{
  readonly scope: SettingsScope
  readonly view: SettingsView
} | null>(null)
