import type { ColorMode } from '@workspace/contracts'
import { useEffect, useRef, type KeyboardEvent } from 'react'

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
import { editVariant, previewBundle, variantPatch } from '@/features/theme-studio/utils/draft'
import type { AssetId, ThemeVariantPatch } from '@workspace/contracts'

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
  const ref = useRef<HTMLElement>(null)
  useStudioPreview(draft, store.mode)
  const draftPalette = useDraftPalette(draft, mode)
  const savePaletteEdits = useSavePaletteEdits()
  const owner = useSettingsOwner()

  // Opening moves focus into the dock once; after that keys belong to whatever holds focus.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-studio-themes]')?.focus()
  }, [])

  async function apply() {
    if (!draft || !editsPending) return
    if (!(await savePaletteEdits())) return
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
      draftPalette.setColors(paletteFromWallpaperColors(colors, mode, draftPalette.colors))
    } catch (error) {
      toastError('Could not read this image’s colors', {
        description: errorMessage(error, 'Try another wallpaper.'),
      })
    }
  }

  function edit(patch: ThemeVariantPatch) {
    if (draft) store.setDraft(editVariant(draft, mode, patch))
  }

  function leave() {
    if (editsPending && !store.confirmingDiscard) return store.setConfirmingDiscard(true)
    store.closeStudio()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'Escape') {
      event.preventDefault()
      leave()
      return
    }
    if (event.key !== '\\') return
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
        dirty={editsPending}
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
              onChoose={store.chooseTheme}
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
              onChange={(wallpaper) => edit({ wallpaper })}
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
