import type { SettingsValues } from '@workspace/contracts'
import { createContext } from 'react'

import type { SettingsSubmission } from '@workspace/client-core/settings/intent-store'

export type Theme = SettingsValues['workbench.colorTheme']
export type ResolvedTheme = Exclude<Theme, 'system'>
export type AppColors = SettingsValues['workbench.palette']

export type ThemeContextValue = {
  readonly appColors: AppColors
  readonly clearAppColorsPreview: () => void
  readonly clearThemePreview: () => void
  readonly previewAppColors: (colors: AppColors) => void
  readonly previewTheme: (theme: Theme) => void
  readonly resolvedTheme: ResolvedTheme
  readonly setTheme: (theme: Theme, initiator?: string) => SettingsSubmission
  readonly setAppColors: (colors: AppColors, initiator?: string) => SettingsSubmission
  readonly theme: Theme
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)
