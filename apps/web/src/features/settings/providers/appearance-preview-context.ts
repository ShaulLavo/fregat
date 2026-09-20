import { createContext } from 'react'
import type { SettingsValues } from '@workspace/contracts'

export const AppearancePreviewContext = createContext<SettingsValues | null>(null)
