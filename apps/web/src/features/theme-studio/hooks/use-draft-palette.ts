import {
  paletteColorsFor,
  type ColorMode,
  type PaletteColors,
  type PaletteId,
} from '@workspace/contracts'
import { useEffect, useEffectEvent } from 'react'

import { usePalette } from '@/lib/appearance/hooks/use-palette'
import { useStudioStore, type StudioDraft } from '@/lib/theme-studio/state/studio-store'
import { editVariant } from '@/features/theme-studio/utils/draft'
import { forkPalette, withModeColors } from '@/features/theme-studio/utils/palette-fork'

/**
 * The colors of the half on screen, and the two ways to change them: choose a palette, or edit
 * colors, which forks the palette into a user copy the first time and previews it until Apply.
 */
export function useDraftPalette(draft: StudioDraft | null, mode: ColorMode) {
  const { catalog, previewPalette, clearPalettePreview } = usePalette()
  const edits = useStudioStore((state) => state.paletteEdits)
  const setDraft = useStudioStore((state) => state.setDraft)
  const setPaletteEdit = useStudioStore((state) => state.setPaletteEdit)
  const edited = edits[mode]
  const chosenId = draft?.variants[mode].palette
  const palette = edited ?? catalog.find((entry) => entry.id === chosenId)

  const key = edited ? JSON.stringify(edited) : ''
  const show = useEffectEvent(() => (edited ? previewPalette(edited) : clearPalettePreview()))
  useEffect(() => {
    show()
  }, [key])
  useEffect(() => clearPalettePreview, [clearPalettePreview])

  return {
    palette,
    colors: palette ? paletteColorsFor(palette, mode) : null,
    choose(id: PaletteId) {
      if (!draft) return
      setPaletteEdit(mode, null)
      setDraft(editVariant(draft, mode, { palette: id }))
    },
    setColors(colors: PaletteColors) {
      if (!draft || !palette) return
      const base =
        edited ??
        forkPalette(
          palette,
          draft.theme.name,
          mode,
          catalog.map((entry) => entry.id),
        )
      const next = withModeColors(base, mode, colors)
      setPaletteEdit(mode, next)
      if (draft.variants[mode].palette !== next.id)
        setDraft(editVariant(draft, mode, { palette: next.id }))
    },
  }
}
