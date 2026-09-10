import { use } from 'react'

import { EditorColorThemeContext } from '@/features/editor/providers/color-theme-context'
import { clientErrors } from '@/lib/structured-errors'

export function useEditorColorTheme() {
  const colorTheme = use(EditorColorThemeContext)

  if (colorTheme === undefined) {
    throw clientErrors.CONTEXT_MISSING({
      message: 'useEditorColorTheme must be used within an EditorColorThemeProvider',
    })
  }

  return colorTheme
}
