import { useCallback, useEffect, useInsertionEffect, useState, type ReactNode } from 'react'

import { loadNerdFont } from '@/lib/default-nerd-font'
import { getPlatformBridge } from '@/lib/platform/bridge'

import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'
import { useSettingsDocument } from '@/features/settings/hooks/use-settings-document'
import { useSettingsProjection } from '@/features/settings/hooks/use-settings-projection'
import { WorkbenchDensityBootContext } from '@/features/settings/providers/density-context'
import {
  ThemeContext,
  type AppColors,
  type Theme,
} from '@/features/settings/providers/theme-context'
import type { SettingsSubmission } from '@workspace/client-core/settings/intent-store'
import {
  applyAppearance,
  resolveColorTheme,
  type AppearanceValues,
} from '@/features/settings/utils/apply-appearance'
import { readSettingsMirror, writeBootMirror } from '@/features/settings/utils/boot-mirror'

const COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)'

type AppearancePreview = {
  readonly handingOffTo: string | null
} & (
  | { readonly kind: 'mode'; readonly value: Theme }
  | { readonly kind: 'colors'; readonly value: AppColors }
)

/** Owns all projected appearance, confirmed boot state, and color-mode preview. */
export function AppearanceProvider({
  bootDensity,
  children,
}: {
  bootDensity: AppearanceValues['workbench.density']
  children: ReactNode
}) {
  const confirmedQuery = useSettingsDocument()
  const projection = useSettingsProjection()
  const { setColorTheme, setSetting } = useSettingsActions()
  const [bootValues] = useState(bootAppearance)
  const [prefersDark, setPrefersDark] = useState(() => systemPrefersDark())
  const [preview, setPreview] = useState<AppearancePreview | null>(null)
  const projectedValues = projection?.values
  const appearanceValues = projectedValues ?? bootValues
  const committedTheme = appearanceValues['workbench.colorTheme']
  const committedColors = appearanceValues['workbench.palette']
  const handoffObserved = projectionObservesHandoff(projection, preview?.handingOffTo)
  const renderedTheme =
    preview?.kind === 'mode' && !handoffObserved ? preview.value : committedTheme
  const renderedColors =
    preview?.kind === 'colors' && !handoffObserved ? preview.value : committedColors

  useEffect(() => {
    const query = window.matchMedia(COLOR_SCHEME_QUERY)
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches)
    query.addEventListener('change', onChange)

    return () => query.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (!handoffObserved || !preview?.handingOffTo) return

    clearMatchingHandoff(setPreview, preview.handingOffTo)
  }, [handoffObserved, preview?.handingOffTo])

  const renderedValues = {
    ...appearanceValues,
    'workbench.colorTheme': renderedTheme,
    'workbench.palette': renderedColors,
  }
  // Descendant layout effects measure density-dependent geometry, so the root
  // appearance must be current before those effects run.
  useInsertionEffect(() => {
    applyAppearance(renderedValues, globalThis.document.documentElement, prefersDark)
  }, [prefersDark, renderedValues])

  const confirmedValues = confirmedQuery.data?.values
  const confirmedFontFamily = confirmedValues?.['editor.fontFamily']
  useEffect(() => {
    if (!confirmedFontFamily) return

    void loadNerdFont(confirmedFontFamily)
  }, [confirmedFontFamily])

  useEffect(() => {
    if (!confirmedValues) return

    writeBootMirror(confirmedValues)
  }, [confirmedValues])

  // Stable identity lets palette unmount cleanup clear hover exactly once.
  const clearThemePreview = useCallback(() => {
    setPreview((current) => (current?.kind === 'mode' && !current.handingOffTo ? null : current))
  }, [])

  const previewTheme = useCallback((theme: Theme) => {
    setPreview((current) =>
      current?.handingOffTo ? current : { handingOffTo: null, kind: 'mode', value: theme },
    )
  }, [])

  const clearAppColorsPreview = useCallback(() => {
    setPreview((current) => (current?.kind === 'colors' && !current.handingOffTo ? null : current))
  }, [])

  const previewAppColors = useCallback((colors: AppColors) => {
    setPreview((current) =>
      current?.handingOffTo ? current : { handingOffTo: null, kind: 'colors', value: colors },
    )
  }, [])

  const setTheme = (theme: Theme, initiator?: string): SettingsSubmission => {
    const submission = setColorTheme(theme, committedTheme, initiator)
    if (submission.kind === 'noop') {
      clearThemePreview()
      return submission
    }

    setPreview({ handingOffTo: submission.mutationId, kind: 'mode', value: theme })
    void submission.settled.then(() => clearMatchingHandoff(setPreview, submission.mutationId))
    return submission
  }

  const setAppColors = (colors: AppColors, initiator?: string): SettingsSubmission => {
    if (colors === committedColors) {
      clearAppColorsPreview()
      return { kind: 'noop' }
    }

    const submission = setSetting('workbench.palette', colors, undefined, initiator)
    if (submission.kind === 'noop') return submission

    setPreview({ handingOffTo: submission.mutationId, kind: 'colors', value: colors })
    void submission.settled.then(() => clearMatchingHandoff(setPreview, submission.mutationId))
    return submission
  }

  return (
    <WorkbenchDensityBootContext value={bootDensity}>
      <ThemeContext
        value={{
          appColors: committedColors,
          clearAppColorsPreview,
          clearThemePreview,
          previewAppColors,
          previewTheme,
          resolvedTheme: resolveColorTheme(renderedTheme, prefersDark),
          setTheme,
          setAppColors,
          theme: committedTheme,
        }}
      >
        {children}
      </ThemeContext>
    </WorkbenchDensityBootContext>
  )
}

function clearMatchingHandoff(
  setPreview: (updater: (current: AppearancePreview | null) => AppearancePreview | null) => void,
  mutationId: string,
) {
  setPreview((current) => (current?.handingOffTo === mutationId ? null : current))
}

function projectionObservesHandoff(
  projection: ReturnType<typeof useSettingsProjection>,
  mutationId: string | null | undefined,
) {
  if (!projection || !mutationId) return false
  if (projection.pendingMutationIds.includes(mutationId)) return true

  return projection.acknowledgedMutationIds.includes(mutationId)
}

export function systemPrefersDark(): boolean {
  // The shell reports the desktop's preference where the webview cannot see it.
  const reported = getPlatformBridge()?.colorScheme
  if (reported) return reported === 'dark'

  return window.matchMedia(COLOR_SCHEME_QUERY).matches
}

/** The values the pre-paint pass uses, before any query can have resolved. */
export function bootAppearance(): AppearanceValues {
  return readSettingsMirror()
}
