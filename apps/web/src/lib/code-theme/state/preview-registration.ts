import type { HighlightTheme } from '@singapore-editor/highlighting'
import { themeRegistrationQueryOptions } from '@/lib/code-theme/state/registration-query'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { createClientError } from '@workspace/client-core/errors'

import { builtinEditorTheme, editorThemeColorMode } from '@/lib/code-theme/utils/catalog'

export async function loadPreviewTheme(themeId: string): Promise<HighlightTheme> {
  const type = editorThemeColorMode(themeId)
  if (!type) {
    throw createClientError({
      code: 'UNKNOWN_CODE_THEME',
      message: `Code theme unavailable: ${themeId}`,
      status: 400,
      why: 'The app has no code theme with this name.',
      fix: 'Choose an available code theme.',
    })
  }

  const builtin = builtinEditorTheme(themeId)
  if (builtin) {
    return { format: 'editor', definition: { ...builtin.editorTheme, type }, name: themeId }
  }

  const { registration } = await resourceQueryClient.query(themeRegistrationQueryOptions(themeId))
  return { format: 'vscode', definition: { ...registration, name: themeId, type } }
}
