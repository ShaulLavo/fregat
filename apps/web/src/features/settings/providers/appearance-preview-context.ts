import { createContext } from 'react'
import type { SettingsValues, ThemeBundle, ColorMode } from '@workspace/contracts'

export const AppearancePreviewContext = createContext<SettingsValues | null>(null)
export const BundlePreviewContext = createContext<{
  preview: (bundle: ThemeBundle, mode?: ColorMode) => void
  clear: () => void
} | null>(null)
