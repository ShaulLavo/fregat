import { interfaceTheme } from '@/features/editor/utils/interface-theme'
import { createElement, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import type { SettingsSubmission } from '@workspace/client-core/settings/intent-store'

import { useTheme } from '@/features/settings/hooks/use-theme'
import { useSettingValue } from '@/hooks/use-setting-value'
import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'
import {
  EditorColorThemeContext,
  type EditorColorThemeState,
} from '@/lib/editor-theme/providers/context'
import { editorThemeColorMode } from '@/lib/code-theme/utils/catalog'
import {
  clearEditorThemePreview,
  colorThemeStore,
  getCommittedEditorThemeId,
  getResolvedShikiThemeContentHash,
  getSelectedEditorThemeId,
  loadEditorThemeForSelection,
  loadedEditorThemeForSelection,
  setActiveEditorColorMode,
  syncEditorThemeSelection,
  type LoadedEditorColorTheme,
} from '@/features/editor/state/color-theme-store'

export function EditorColorThemeProvider({ children }: { readonly children: ReactNode }) {
  const { resolvedTheme } = useTheme()
  const darkThemeId = useSettingValue('editor.codeTheme.dark')
  const lightThemeId = useSettingValue('editor.codeTheme.light')
  const { setSetting } = useSettingsActions()

  useLayoutEffect(() => {
    syncEditorThemeSelection('dark', darkThemeId)
    syncEditorThemeSelection('light', lightThemeId)
  }, [darkThemeId, lightThemeId])

  const selectTheme = (themeId: string, initiator?: string): SettingsSubmission => {
    if (editorThemeColorMode(themeId) !== resolvedTheme) return { kind: 'noop' }
    if (getCommittedEditorThemeId(resolvedTheme) === themeId) {
      clearEditorThemePreview()
      return { kind: 'noop' }
    }

    const submission = setSetting(
      `editor.codeTheme.${resolvedTheme}`,
      themeId,
      undefined,
      initiator,
    )
    syncEditorThemeSelection(resolvedTheme, themeId)
    return submission
  }
  // The selection id doubles as the shiki theme name (id === shikiName), so the
  // provider knows the theme name synchronously even before the JSON loads.
  const shikiTheme = useStore(colorThemeStore, (state) =>
    getSelectedEditorThemeId(resolvedTheme, state),
  )
  const committedThemeId = useStore(colorThemeStore, (state) =>
    getCommittedEditorThemeId(resolvedTheme, state),
  )
  const [loadedTheme, setLoadedTheme] = useState<LoadedEditorColorTheme | null>(() =>
    loadedEditorThemeForSelection(resolvedTheme),
  )
  // The hash lives in the query cache; `loadedRevision` bumps re-run this when it lands.
  const appliedThemeContentHash = useStore(colorThemeStore, () => {
    const themeId = loadedTheme?.resolvedThemeId
    return themeId ? getResolvedShikiThemeContentHash(themeId) : null
  })
  // The highlighter uses this callback identity to decide whether to rebuild.
  const shikiThemeResolver = () => shikiTheme

  // The shiki plugin's non-React theme resolver reads the active mode from the
  // store; mirror the app's resolved mode there.
  useEffect(() => {
    setActiveEditorColorMode(resolvedTheme)
  }, [resolvedTheme])

  // Keep showing the previous theme while the new selection loads — the editor
  // never flashes back to unstyled.
  useEffect(() => {
    let cancelled = false
    void loadEditorThemeForSelection(resolvedTheme)
      .then((theme) => {
        if (cancelled) return

        setLoadedTheme(theme)
      })
      .catch(() => {
        // Load failures are logged in the store; keep showing the previous theme.
      })

    return () => {
      cancelled = true
    }
  }, [resolvedTheme, shikiTheme])

  const value: EditorColorThemeState = {
    appliedThemeContentHash,
    appliedThemeId: loadedTheme?.resolvedThemeId ?? null,
    colorMode: resolvedTheme,
    committedThemeId,
    definition: loadedTheme?.definition ?? null,
    editorTheme: interfaceTheme(loadedTheme?.editorTheme ?? {}),
    registration: loadedTheme?.registration ?? null,
    shikiTheme,
    shikiThemeResolver,
    selectedThemeId: shikiTheme,
    selectTheme,
  }

  return createElement(EditorColorThemeContext, { value }, children)
}
