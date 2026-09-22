import { useSystemColorMode } from '@/features/settings/hooks/use-system-color-mode'
import { useTransitionedColorMode } from '@/features/settings/hooks/use-transitioned-color-mode'
import { useThemeApplicationLog } from '@/features/settings/hooks/use-theme-application-log'
import {
  DEFAULT_SETTING_VALUES,
  resolveThemeSettings,
  type ThemeBundle,
  type ColorMode,
} from '@workspace/contracts'
import { AppearancePreviewContext } from '@/features/settings/providers/appearance-preview-context'
import {
  ViewTransition,
  useCallback,
  useEffect,
  useInsertionEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  bundledPalette,
  DEFAULT_PALETTE_ID,
  type Palette,
  type PaletteId,
} from '@workspace/contracts'
import { paletteStylesheet, resolvePalette } from '@workspace/client-core/themes/palette'

import { useQuery } from '@tanstack/react-query'
import { nerdFontQueryOptions } from '@/lib/default-nerd-font'
import { BundleContext } from '@/lib/appearance/providers/bundle-context'
import { PaletteContext } from '@/lib/appearance/providers/palette-context'
import { applyPaletteStylesheet, writePaletteBootCache } from '@/lib/appearance/utils/palette-style'

import { useBundleLibrary } from '@/features/settings/hooks/use-bundle-library'
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
import { readSettingsMirror, writeBootMirror } from '@/lib/settings-boot-mirror'

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
  const { selectBundle, setColorTheme, setSetting } = useSettingsActions()
  const catalog = usePaletteCatalog()
  const bundles = useBundleLibrary().catalog
  const [bootValues] = useState(readSettingsMirror)
  const prefersDark = useSystemColorMode() === 'dark'
  const [bundleState, setBundlePreview] = useState<Preview<{
    theme: ThemeBundle
    mode?: ColorMode
  }> | null>(null)
  const [modePreview, setModePreview] = useState<Preview<Theme> | null>(null)
  const [palettePreview, setPalettePreview] = useState<Preview<Palette> | null>(null)
  const projectedValues = projection?.values
  const baseValues = projectedValues ?? { ...DEFAULT_SETTING_VALUES, ...bootValues }
  const committedTheme = baseValues['workbench.colorTheme']
  const bundleHandoffObserved = projectionObservesHandoff(projection, bundleState?.handingOffTo)
  const bundlePreview = bundleState && !bundleHandoffObserved ? bundleState.value : null
  const modeHandoffObserved = projectionObservesHandoff(projection, modePreview?.handingOffTo)
  const requestedMode =
    bundlePreview?.mode ??
    (modePreview && !modeHandoffObserved ? modePreview.value : committedTheme)
  const resolvedMode = useTransitionedColorMode(resolveColorTheme(requestedMode, prefersDark))
  const appearanceValues = resolveThemeSettings(
    {
      ...baseValues,
      'workbench.colorTheme': resolvedMode,
      'workbench.theme': bundlePreview?.theme ?? baseValues['workbench.theme'],
    },
    prefersDark ? 'dark' : 'light',
    projection?.layers,
  )
  const committedPaletteId = appearanceValues['workbench.palette']
  const committedPalette = catalog.find((palette) => palette.id === committedPaletteId)
  const paletteHandoffObserved = projectionObservesHandoff(projection, palettePreview?.handingOffTo)
  // Undefined while a user palette is still being looked up: the boot
  // stylesheet stays on screen rather than flashing Graphite in between.
  const renderedPalette =
    palettePreview && !paletteHandoffObserved ? palettePreview.value : committedPalette

  useEffect(() => {
    if (!modeHandoffObserved || !modePreview?.handingOffTo) return

    clearMatchingHandoff(setModePreview, modePreview.handingOffTo)
  }, [modeHandoffObserved, modePreview?.handingOffTo])

  useEffect(() => {
    if (!bundleHandoffObserved || !bundleState?.handingOffTo) return

    clearMatchingHandoff(setBundlePreview, bundleState.handingOffTo)
  }, [bundleHandoffObserved, bundleState?.handingOffTo])

  useEffect(() => {
    if (!paletteHandoffObserved || !palettePreview?.handingOffTo) return

    clearMatchingHandoff(setPalettePreview, palettePreview.handingOffTo)
  }, [paletteHandoffObserved, palettePreview?.handingOffTo])

  const renderedValues = { ...appearanceValues, 'workbench.colorTheme': requestedMode }
  const applicationDuration = useRef(0)
  useThemeApplicationLog(
    renderedValues,
    resolvedMode,
    Boolean(bundlePreview || modePreview || palettePreview),
    applicationDuration,
  )
  // Descendant layout effects measure density-dependent geometry, so the root
  // appearance must be current before those effects run.
  useInsertionEffect(() => {
    const started = performance.now()
    applyAppearance(appearanceValues, globalThis.document.documentElement, prefersDark)
    applicationDuration.current = performance.now() - started
  }, [prefersDark, appearanceValues])

  useInsertionEffect(() => {
    if (!renderedPalette) return

    applyPaletteStylesheet(globalThis.document, paletteStylesheet(renderedPalette))
  }, [renderedPalette])

  const confirmedValues = confirmedQuery.data?.values
  const confirmedFontFamily = confirmedValues?.['editor.fontFamily']
  useQuery({
    ...nerdFontQueryOptions(confirmedFontFamily ?? ''),
    enabled: Boolean(confirmedFontFamily),
  })

  useEffect(() => {
    if (!confirmedValues) return

    writeBootMirror(confirmedValues, confirmedQuery.data?.layers)
  }, [confirmedValues, confirmedQuery.data?.layers])

  const confirmedAppearance = confirmedValues
    ? resolveThemeSettings(
        confirmedValues,
        prefersDark ? 'dark' : 'light',
        confirmedQuery.data?.layers,
      )
    : null
  const confirmedPaletteId = confirmedAppearance?.['workbench.palette']
  useEffect(() => {
    if (!confirmedPaletteId) return
    const palette = catalog.find((candidate) => candidate.id === confirmedPaletteId)
    if (!palette) return

    if (!confirmedValues) return
    const lightId = resolveThemeSettings(
      { ...confirmedValues, 'workbench.colorTheme': 'light' },
      'light',
      confirmedQuery.data?.layers,
    )['workbench.palette']
    const darkId = resolveThemeSettings(
      { ...confirmedValues, 'workbench.colorTheme': 'dark' },
      'dark',
      confirmedQuery.data?.layers,
    )['workbench.palette']
    const light = catalog.find((entry) => entry.id === lightId) ?? palette
    const dark = catalog.find((entry) => entry.id === darkId) ?? palette
    writePaletteBootCache([light.id, dark.id], paletteStylesheet(light, dark))
  }, [catalog, confirmedPaletteId, confirmedValues, confirmedQuery.data?.layers])

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

  // Cleanup uses stable identities so moving focus between cards cannot clear a newer preview.
  const previewBundle = useCallback((bundle: ThemeBundle, mode?: ColorMode) => {
    setBundlePreview((current) =>
      current?.handingOffTo ? current : { handingOffTo: null, value: { theme: bundle, mode } },
    )
  }, [])
  const clearBundlePreview = useCallback(() => {
    setBundlePreview((current) => (current && !current.handingOffTo ? null : current))
  }, [])

  const chooseBundle = (bundle: ThemeBundle, initiator?: string): SettingsSubmission => {
    const submission = selectBundle(bundle, initiator)
    if (submission.kind === 'noop') return submission

    setBundlePreview({ handingOffTo: submission.mutationId, value: { theme: bundle } })
    void submission.settled.then(() =>
      clearMatchingHandoff(setBundlePreview, submission.mutationId),
    )
    return submission
  }

  return (
    <BundleContext
      value={{
        bundleId: baseValues['workbench.theme']?.id ?? null,
        catalog: bundles,
        preview: previewBundle,
        clear: clearBundlePreview,
        select: chooseBundle,
      }}
    >
      <AppearancePreviewContext value={renderedValues}>
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
              <ViewTransition
                default='none'
                update={{ 'color-mode': 'color-mode', default: 'none' }}
              >
                <div className='size-full' data-color-mode={resolvedMode}>
                  {children}
                </div>
              </ViewTransition>
            </PaletteContext>
          </ThemeContext>
        </WorkbenchDensityBootContext>
      </AppearancePreviewContext>
    </BundleContext>
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
