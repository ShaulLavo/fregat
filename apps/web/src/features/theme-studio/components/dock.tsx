import { useKeymapNode } from '@/keymap/hooks/use-keymap-node'
import { eventTargetsTextEntry } from '@/keymap/utils/keyboard-event'
import { openingPopupTrigger } from '@workspace/ui/patterns/popup-trigger'
import type { ColorMode } from '@workspace/contracts'
import { useCallback, useEffect, useEffectEvent } from 'react'
import { log } from '@/lib/client-logging'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'

import { useBundles } from '@/lib/appearance/hooks/use-bundles'
import { useEditorColorTheme } from '@/lib/editor-theme/hooks/use-editor-color-theme'
import { useStudioStore } from '@/lib/theme-studio/state/studio-store'
import { DockHeader } from '@/features/theme-studio/components/dock-header'
import { CodeThemePicker } from '@/lib/appearance/components/code-theme-picker'
import { ColorsTab } from '@/features/theme-studio/components/colors-tab'
import { WallpaperLibrary } from '@/lib/appearance/components/wallpaper-library'
import { useDraftPalette } from '@/features/theme-studio/hooks/use-draft-palette'
import { useSavePaletteEdits } from '@/features/theme-studio/hooks/use-save-palette-edits'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { wallpaperColorsOptions } from '@/lib/wallpapers/state/queries'
import { paletteFromWallpaperColors } from '@workspace/client-core/themes/wallpaper-palette'
import { errorMessage } from '@/lib/error-message'
import { toastError } from '@/lib/toast-error'
import { SurfacesTab } from '@/features/theme-studio/components/surfaces-tab'
import { ThemesTab } from '@/features/theme-studio/components/themes-tab'
import { useStudioDraft } from '@/features/theme-studio/hooks/use-studio-draft'
import { useStudioPreview } from '@/features/theme-studio/hooks/use-studio-preview'
import {
  draftsEqual,
  editVariant,
  previewBundle,
  savedDraft,
  variantPatch,
} from '@/features/theme-studio/utils/draft'
import type { StudioDraft } from '@/lib/theme-studio/state/studio-store'
import { selectWallpaper } from '@/lib/wallpapers/utils/selection'
import type { AssetId, ThemeVariant, ThemeVariantPatch } from '@workspace/contracts'
import { useIsMutating } from '@tanstack/react-query'
import { paletteMutationKeys } from '@/features/theme-studio/utils/mutation-keys'

const TAB_PADDING = 'px-(--bar-padding-x) py-(--density-section-gap)'

/**
 * The theme studio: a drawer over the bottom of the window, with the app live behind it. The app
 * shows the draft throughout; only Apply writes, in one request.
 */
export function Dock() {
  const { customizations, draft, dirty } = useStudioDraft()
  const store = useStudioStore()
  const { colorMode } = useEditorColorTheme()
  const bundles = useBundles()
  const mode: ColorMode = store.mode ?? colorMode
  const editsPending = dirty || Object.keys(store.paletteEdits).length > 0
  const { ref } = useFocusTarget<HTMLElement>(
    {
      area: 'settings',
      id: { kind: 'theme-studio' },
      onIntent(intent, element) {
        const themes = element.querySelector<HTMLElement>('[data-studio-themes]')
        if (intent !== 'focus' || !themes) return false
        themes.focus()
        const focused = document.activeElement === themes
        log.info({
          area: 'theme-studio',
          action: 'focus',
          focused,
          activeTag: document.activeElement?.tagName,
          activeRole: document.activeElement?.getAttribute('role'),
        })
        return focused
      },
    },
    !store.collapsed && store.tab === 'themes',
  )
  const draftPalette = useDraftPalette(draft, mode)
  useStudioPreview(draft, store.mode, draftPalette.edited)
  const savePaletteEdits = useSavePaletteEdits()
  const owner = useSettingsOwner()
  // Apply saves forked palettes first; a second click meanwhile would save them twice.
  const saving = useIsMutating({ mutationKey: paletteMutationKeys.all }, owner) > 0

  async function apply() {
    if (!draft || !editsPending || saving) return
    if (!(await savePaletteEdits())) return
    const current = useStudioStore.getState()
    if (!current.open || current.generation !== store.generation) return
    if (current.draft !== store.draft || current.paletteEdits !== store.paletteEdits) return
    bundles.apply(
      draft.theme,
      {
        light: variantPatch(draft.theme.variants.light, draft.variants.light),
        dark: variantPatch(draft.theme.variants.dark, draft.variants.dark),
      },
      previewBundle(draft),
    )
    store.closeStudio()
  }

  async function colorsFromImage(asset: AssetId) {
    if (!draftPalette.colors) return
    try {
      const colors = await owner.query(wallpaperColorsOptions(asset))
      draftPalette.setColors((current, currentMode) =>
        paletteFromWallpaperColors(colors, currentMode, current),
      )
    } catch (error) {
      toastError('Could not read this image’s colors', {
        description: errorMessage(error, 'Try another wallpaper.'),
      })
    }
  }

  function edit(patch: ThemeVariantPatch | ((variant: ThemeVariant) => ThemeVariantPatch)) {
    const current = useStudioStore.getState()
    if (!draft || !current.open || current.generation !== store.generation) return
    const liveDraft = current.draft ?? draft
    const liveMode = current.mode ?? colorMode
    const update = typeof patch === 'function' ? patch(liveDraft.variants[liveMode]) : patch
    current.setDraft(editVariant(liveDraft, liveMode, update))
  }

  function leave() {
    if (editsPending && !store.confirmingDiscard) return store.setConfirmingDiscard(true)
    store.closeStudio()
  }

  const answerLeaveRequest = useEffectEvent(leave)
  useEffect(() => {
    if (store.leaveRequests > 0) answerLeaveRequest()
  }, [store.leaveRequests])

  // Browsing themes is free; leaving a theme with edits of its own asks first, like closing.
  function chooseTheme(next: StudioDraft) {
    const edited =
      Object.keys(store.paletteEdits).length > 0 ||
      (draft !== null && !draftsEqual(draft, savedDraft(draft.theme, customizations)))
    if (edited && !store.confirmingDiscard) return store.setConfirmingDiscard(true)
    store.chooseTheme(next)
  }

  const studioRef = useKeymapNode({
    area: 'settings',
    context: 'ThemeStudio',
    commands: {
      'themeStudio.close': ({ source }) => {
        if (!store.open) return false
        if (source && (eventTargetsTextEntry(source) || openingPopupTrigger(source.target)))
          return false
        leave()
        return true
      },
      'themeStudio.toggleMode': () => {
        if (!store.open) return false
        store.setMode(mode === 'dark' ? 'light' : 'dark')
        return true
      },
      'themeStudio.apply': ({ source }) => {
        if (!store.open || store.collapsed || store.tab !== 'themes') return false
        if (!draft || !editsPending || saving) return false
        if (!(source?.target instanceof Element) || !source.target.closest('[data-studio-themes]'))
          return false
        void apply()
        return true
      },
    },
  })

  // React ref attachment needs a stable callback to keep both registrations mounted.
  const dockRef = useCallback(
    (element: HTMLElement | null) => {
      studioRef(element)
      ref(element)
    },
    [studioRef, ref],
  )

  return (
    <section aria-label='Theme studio' className='flex flex-col' data-theme-studio='' ref={dockRef}>
      <DockHeader
        collapsed={store.collapsed}
        confirmingDiscard={store.confirmingDiscard}
        dirty={editsPending && !saving}
        mode={mode}
        name={draft?.theme.name ?? 'Theme'}
        tab={store.tab}
        onApply={() => void apply()}
        onClose={leave}
        onMode={store.setMode}
        onRevert={store.revert}
        onTab={store.setTab}
        onToggleCollapsed={() => store.setCollapsed(!store.collapsed)}
      />
      {/* Collapsed, the drawer tucks this under the window edge; inert keeps Tab off it. */}
      <div className='h-48 min-h-0' inert={store.collapsed}>
        {store.tab === 'themes' ? (
          <ThemesTab
            customizations={customizations}
            draft={draft}
            mode={mode}
            onChoose={chooseTheme}
          />
        ) : null}
        {store.tab === 'colors' && draft ? (
          <ColorsTab
            colors={draftPalette.colors}
            mode={mode}
            palette={draftPalette.palette}
            onChoose={draftPalette.choose}
            onColors={draftPalette.setColors}
          />
        ) : null}
        {store.tab === 'wallpaper' && draft ? (
          <WallpaperLibrary
            className={TAB_PADDING}
            colors={draftPalette.colors}
            value={draft.variants[mode].wallpaper}
            onChange={(source) =>
              edit((variant) => ({ wallpaper: selectWallpaper(variant.wallpaper, source) }))
            }
            onColorsFromImage={(asset) => void colorsFromImage(asset)}
          />
        ) : null}
        {store.tab === 'code' && draft ? (
          <CodeThemePicker
            className={TAB_PADDING}
            live
            mode={mode}
            value={draft.variants[mode].codeTheme}
            onChange={(codeTheme) => edit({ codeTheme })}
          />
        ) : null}
        {store.tab === 'surfaces' && draft ? (
          <SurfacesTab material={draft.variants[mode].material} onEdit={edit} />
        ) : null}
      </div>
    </section>
  )
}
