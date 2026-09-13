import { useCallback, useEffect, useInsertionEffect, useState, type ReactNode } from 'react'
import {
  bundledPalette,
  DEFAULT_PALETTE_ID,
  type Palette,
  type PaletteId,
} from '@workspace/contracts'
import { paletteStylesheet, resolvePalette } from '@workspace/client-core/themes/palette'

import { loadNerdFont } from '@/lib/default-nerd-font'
import { getPlatformBridge } from '@/lib/platform/bridge'
import { PaletteContext } from '@/lib/appearance/providers/palette-context'
import { applyPaletteStylesheet, writePaletteBootCache } from '@/lib/appearance/utils/palette-style'

import { usePaletteCatalog } from '@/features/settings/hooks/use-palette-catalog'
import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'
import { useSettingsDocument } from '@/features/settings/hooks/use-settings-document'
import { useSettingsProjection } from '@/features/settings/hooks/use-settings-projection'
import { WorkbenchDensityBootContext } from '@/features/settings/providers/density-context'
import { ThemeContext, type Theme } from '@/features/settings/providers/theme-context'
import type { SettingsSubmission } from '@workspace/client-core/settings/intent-store'
import {
  applyAppearance,
  resolveColorTheme,
  type AppearanceValues,
} from '@/features/settings/utils/apply-appearance'
import { readSettingsMirror, writeBootMirror } from '@/features/settings/utils/boot-mirror'

const COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)'

type Preview<T> = {
  readonly value: T
  readonly handingOffTo: string | null
}

// The test `bundled palettes parse` pins Graphite's presence; a missing default
// here would be a build defect, not a runtime state.
const GRAPHITE = bundledPalette(DEFAULT_PALETTE_ID)!

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
  const catalog = usePaletteCatalog()
  const [bootValues] = useState(bootAppearance)
  const [prefersDark, setPrefersDark] = useState(() => systemPrefersDark())
  const [modePreview, setModePreview] = useState<Preview<Theme> | null>(null)
  const [palettePreview, setPalettePreview] = useState<Preview<Palette> | null>(null)
  const projectedValues = projection?.values
  const appearanceValues = projectedValues ?? bootValues
  const committedTheme = appearanceValues['workbench.colorTheme']
  const committedPaletteId = appearanceValues['workbench.palette']
  const committedPalette = catalog.find((palette) => palette.id === committedPaletteId)
  const modeHandoffObserved = projectionObservesHandoff(projection, modePreview?.handingOffTo)
  const paletteHandoffObserved = projectionObservesHandoff(projection, palettePreview?.handingOffTo)
  const renderedTheme = modePreview && !modeHandoffObserved ? modePreview.value : committedTheme
  // Undefined while a user palette is still being looked up: the boot
  // stylesheet stays on screen rather than flashing Graphite in between.
  const renderedPalette =
    palettePreview && !paletteHandoffObserved ? palettePreview.value : committedPalette
  const resolvedMode = resolveColorTheme(renderedTheme, prefersDark)

  useEffect(() => {
    const query = window.matchMedia(COLOR_SCHEME_QUERY)
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches)
    query.addEventListener('change', onChange)

    return () => query.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (!modeHandoffObserved || !modePreview?.handingOffTo) return

    clearMatchingHandoff(setModePreview, modePreview.handingOffTo)
  }, [modeHandoffObserved, modePreview?.handingOffTo])

  useEffect(() => {
    if (!paletteHandoffObserved || !palettePreview?.handingOffTo) return

    clearMatchingHandoff(setPalettePreview, palettePreview.handingOffTo)
  }, [paletteHandoffObserved, palettePreview?.handingOffTo])

  const renderedValues = { ...appearanceValues, 'workbench.colorTheme': renderedTheme }
  // Descendant layout effects measure density-dependent geometry, so the root
  // appearance must be current before those effects run.
  useInsertionEffect(() => {
    applyAppearance(renderedValues, globalThis.document.documentElement, prefersDark)
  }, [prefersDark, renderedValues])

  useInsertionEffect(() => {
    if (!renderedPalette) return

    applyPaletteStylesheet(globalThis.document, paletteStylesheet(renderedPalette))
  }, [renderedPalette])

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

  const confirmedPaletteId = confirmedValues?.['workbench.palette']
  useEffect(() => {
    if (!confirmedPaletteId) return
    const palette = catalog.find((candidate) => candidate.id === confirmedPaletteId)
    if (!palette) return

    writePaletteBootCache(palette.id, paletteStylesheet(palette))
  }, [catalog, confirmedPaletteId])

  // Stable identity lets palette unmount cleanup clear hover exactly once.
  const clearThemePreview = useCallback(() => {
    setModePreview((current) => (current && !current.handingOffTo ? null : current))
  }, [])

  const previewTheme = useCallback((theme: Theme) => {
    setModePreview((current) =>
      current?.handingOffTo ? current : { handingOffTo: null, value: theme },
    )
  }, [])

  const clearPalettePreview = useCallback(() => {
    setPalettePreview((current) => (current && !current.handingOffTo ? null : current))
  }, [])

  const previewPalette = useCallback((palette: Palette) => {
    setPalettePreview((current) =>
      current?.handingOffTo ? current : { handingOffTo: null, value: palette },
    )
  }, [])

  const setTheme = (theme: Theme, initiator?: string): SettingsSubmission => {
    const submission = setColorTheme(theme, committedTheme, initiator)
    if (submission.kind === 'noop') {
      clearThemePreview()
      return submission
    }

    setModePreview({ handingOffTo: submission.mutationId, value: theme })
    void submission.settled.then(() => clearMatchingHandoff(setModePreview, submission.mutationId))
    return submission
  }

  const selectPalette = (id: PaletteId, initiator?: string): SettingsSubmission => {
    if (id === committedPaletteId) {
      clearPalettePreview()
      return { kind: 'noop' }
    }

    const submission = setSetting('workbench.palette', id, undefined, initiator)
    if (submission.kind === 'noop') return submission

    const palette = catalog.find((candidate) => candidate.id === id)
    if (palette) setPalettePreview({ handingOffTo: submission.mutationId, value: palette })
    void submission.settled.then(() =>
      clearMatchingHandoff(setPalettePreview, submission.mutationId),
    )
    return submission
  }

  return (
    <WorkbenchDensityBootContext value={bootDensity}>
      <ThemeContext
        value={{
          clearThemePreview,
          previewTheme,
          resolvedTheme: resolvedMode,
          setTheme,
          theme: committedTheme,
        }}
      >
        <PaletteContext
          value={{
            paletteId: committedPaletteId,
            catalog,
            resolved: resolvePalette(renderedPalette ?? GRAPHITE, resolvedMode),
            previewPalette,
            clearPalettePreview,
            selectPalette,
          }}
        >
          {children}
        </PaletteContext>
      </ThemeContext>
    </WorkbenchDensityBootContext>
  )
}

function clearMatchingHandoff<T>(
  setPreview: (updater: (current: Preview<T> | null) => Preview<T> | null) => void,
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
export function bootAppearance(): AppearanceValues & { 'workbench.palette': PaletteId } {
  return readSettingsMirror()
}
