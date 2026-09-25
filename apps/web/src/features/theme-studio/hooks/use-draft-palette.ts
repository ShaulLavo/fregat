import {
  paletteColorsFor,
  type ColorMode,
  type PaletteColors,
  type PaletteId,
} from '@workspace/contracts'

import { usePalette } from '@/lib/appearance/hooks/use-palette'
import { useStudioStore, type StudioDraft } from '@/lib/theme-studio/state/studio-store'
import { editVariant } from '@/features/theme-studio/utils/draft'
import { forkPalette, withModeColors } from '@/features/theme-studio/utils/palette-fork'

/**
 * The colors of the half on screen, and the two ways to change them: choose a palette, or edit
 * colors, which forks the palette into a user copy the first time and previews it until Apply.
 */
export function useDraftPalette(draft: StudioDraft | null, mode: ColorMode) {
  const { catalog } = usePalette()
  const edits = useStudioStore((state) => state.paletteEdits)
  const generation = useStudioStore((state) => state.generation)
  const edited = edits[mode]
  const chosenId = draft?.variants[mode].palette
  const palette = edited ?? catalog.find((entry) => entry.id === chosenId)

  return {
    palette,
    edited: edited ?? null,
    colors: palette ? paletteColorsFor(palette, mode) : null,
    choose(id: PaletteId) {
      const current = useStudioStore.getState()
      if (!draft || !current.open || current.generation !== generation) return
      const liveMode = current.mode ?? mode
      current.setPaletteEdit(liveMode, null)
      current.setDraft(editVariant(current.draft ?? draft, liveMode, { palette: id }))
    },
    setColors(
      colors: PaletteColors | ((current: PaletteColors, mode: ColorMode) => PaletteColors),
    ) {
      const current = useStudioStore.getState()
      if (!draft || !current.open || current.generation !== generation) return
      const liveDraft = current.draft ?? draft
      const liveMode = current.mode ?? mode
      const liveEdit = current.paletteEdits[liveMode]
      const livePalette =
        liveEdit ?? catalog.find((entry) => entry.id === liveDraft.variants[liveMode].palette)
      if (!livePalette) return
      const base =
        liveEdit ??
        forkPalette(
          livePalette,
          liveDraft.theme.name,
          liveMode,
          catalog.map((entry) => entry.id),
        )
      const nextColors =
        typeof colors === 'function'
          ? colors(paletteColorsFor(livePalette, liveMode), liveMode)
          : colors
      const next = withModeColors(base, liveMode, nextColors)
      current.setPaletteEdit(liveMode, next)
      if (liveDraft.variants[liveMode].palette !== next.id)
        current.setDraft(editVariant(liveDraft, liveMode, { palette: next.id }))
    },
  }
}
