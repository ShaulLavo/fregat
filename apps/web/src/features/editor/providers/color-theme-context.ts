import { createContext } from 'react'
import type { EditorTheme } from '@singapore-editor/core'
import type { VscodeThemeDefinition, VscodeThemeRegistration } from '@singapore-editor/core/shiki'
import type { SettingsSubmission } from '@workspace/client-core/settings/intent-store'
import type { EditorColorMode } from '@/features/editor/state/color-theme-store'

export type EditorColorThemeState = {
  readonly appliedThemeContentHash: string | null
  readonly appliedThemeId: string | null
  readonly colorMode: EditorColorMode
  readonly committedThemeId: string
  readonly definition: VscodeThemeDefinition | null
  readonly editorTheme: EditorTheme
  readonly registration: VscodeThemeRegistration | null
  readonly shikiTheme: string
  readonly shikiThemeResolver: () => string
  readonly selectedThemeId: string
  readonly selectTheme: (themeId: string, initiator?: string) => SettingsSubmission
}

export const EditorColorThemeContext = createContext<EditorColorThemeState | undefined>(undefined)
