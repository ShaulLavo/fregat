import { use } from 'react'

import { EditorColorThemeContext } from '@/lib/editor-theme/providers/context'
import { requireContext } from '@/lib/require-context'

export function useEditorColorTheme() {
  const colorTheme = use(EditorColorThemeContext)
  requireContext(colorTheme, 'useEditorColorTheme must be used within an EditorColorThemeProvider')
  return colorTheme
}
