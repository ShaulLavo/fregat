import { editorThemeToShikiTheme, type VscodeThemeRegistration } from '@singapore-editor/core/shiki'
import { themeRegistrationQueryOptions } from '@/lib/code-theme/state/registration-query'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { createClientError } from '@workspace/client-core/errors'
import type { ThemeRegistration } from 'shiki/core'

import { builtinEditorTheme, editorThemeColorMode } from '@/lib/code-theme/utils/catalog'

type ThemeSetting = NonNullable<VscodeThemeRegistration['tokenColors']>[number]

export async function loadPreviewRegistration(themeId: string): Promise<ThemeRegistration> {
  const type = editorThemeColorMode(themeId)
  if (!type) {
    throw createClientError({
      code: 'UNKNOWN_CODE_THEME',
      message: `Code theme unavailable: ${themeId}`,
      status: 400,
      why: 'The requested theme is absent from the code-theme catalog.',
      fix: 'Choose an available code theme.',
    })
  }

  const builtin = builtinEditorTheme(themeId)
  const registration = builtin
    ? editorThemeToShikiTheme(builtin.editorTheme, { name: themeId, type })
    : (await resourceQueryClient.query(themeRegistrationQueryOptions(themeId))).registration

  // Shiki normalizes registrations, so this boundary gives it owned mutable arrays.
  return {
    ...registration,
    name: themeId,
    type,
    colors: definedColors(registration.colors),
    settings: registration.settings?.map(copyThemeSetting),
    tokenColors: registration.tokenColors?.map(copyThemeSetting),
  }
}

function copyThemeSetting(setting: ThemeSetting) {
  return {
    ...setting,
    scope: typeof setting.scope === 'string' ? setting.scope : setting.scope?.slice(),
    settings: { ...setting.settings },
  }
}

function definedColors(source: VscodeThemeRegistration['colors']): Record<string, string> {
  const colors: Record<string, string> = {}
  for (const [name, color] of Object.entries(source ?? {})) {
    if (color === undefined) continue
    colors[name] = color
  }
  return colors
}
