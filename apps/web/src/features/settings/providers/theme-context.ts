import type { SettingsValues } from '@workspace/contracts'
import { createContext } from 'react'

import type { SettingsSubmission } from '@workspace/client-core/settings/intent-store'

export type Theme = SettingsValues['workbench.colorTheme']
type ResolvedTheme = Exclude<Theme, 'system'>

export type ThemeContextValue = {
  readonly clearThemePreview: () => void
  readonly previewTheme: (theme: Theme) => void
  readonly resolvedTheme: ResolvedTheme
  readonly setTheme: (theme: Theme, initiator?: string) => SettingsSubmission
  readonly theme: Theme
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)
