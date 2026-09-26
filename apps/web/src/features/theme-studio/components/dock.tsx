import type { ColorMode } from '@workspace/contracts'
import type { KeyboardEvent } from 'react'
import { log } from '@/lib/client-logging'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'

import { useBundles } from '@/lib/appearance/hooks/use-bundles'
import { useEditorColorTheme } from '@/lib/editor-theme/hooks/use-editor-color-theme'
import { useStudioStore } from '@/lib/theme-studio/state/studio-store'
import { DockHeader } from '@/features/theme-studio/components/dock-header'
import { CodeTab } from '@/features/theme-studio/components/code-tab'
import { ColorsTab } from '@/features/theme-studio/components/colors-tab'
import { WallpaperTab } from '@/features/theme-studio/components/wallpaper-tab'
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

/**
 * The theme studio: a strip along the bottom of a workbench that stays live and full size above
 * it. The app shows the draft throughout; only Apply writes, in one request.
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
      const colors = await owner.fetchQuery(wallpaperColorsOptions(asset))
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

  // Browsing themes is free; leaving a theme with edits of its own asks first, like closing.
  function chooseTheme(next: StudioDraft) {
    const edited =
      Object.keys(store.paletteEdits).length > 0 ||
      (draft !== null && !draftsEqual(draft, savedDraft(draft.theme, customizations)))
    if (edited && !store.confirmingDiscard) return store.setConfirmingDiscard(true)
    store.chooseTheme(next)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    // Portalled dialogs and menus bubble here through React; their Escape is theirs.
    if (event.target instanceof Node && !event.currentTarget.contains(event.target)) return
    if (
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return
    if (event.key === 'Escape') {
      event.preventDefault()
      leave()
      return
    }
    if (event.key !== '\\') return
    const target = event.target
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || target.closest('input, textarea, select'))
    )
      return
    event.preventDefault()
    store.setMode(mode === 'dark' ? 'light' : 'dark')
  }

  return (
    <section
      aria-label='Theme studio'
      className='bg-popover-solid flex shrink-0 flex-col'
      data-theme-studio=''
      ref={ref}
      onKeyDown={handleKeyDown}
    >
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
      {store.collapsed ? null : (
        <div className='h-48 min-h-0'>
          {store.tab === 'themes' ? (
            <ThemesTab
              customizations={customizations}
              draft={draft}
              mode={mode}
              onApply={() => void apply()}
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
            <WallpaperTab
              colors={draftPalette.colors}
              value={draft.variants[mode].wallpaper}
              onChange={(source) =>
                edit((variant) => ({ wallpaper: selectWallpaper(variant.wallpaper, source) }))
              }
              onColorsFromImage={(asset) => void colorsFromImage(asset)}
            />
          ) : null}
          {store.tab === 'code' && draft ? (
            <CodeTab codeTheme={draft.variants[mode].codeTheme} mode={mode} onEdit={edit} />
          ) : null}
          {store.tab === 'surfaces' && draft ? (
            <SurfacesTab material={draft.variants[mode].material} onEdit={edit} />
          ) : null}
        </div>
      )}
    </section>
  )
}
