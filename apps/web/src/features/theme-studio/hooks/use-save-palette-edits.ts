import { usePalette } from '@/lib/appearance/hooks/use-palette'
import { errorMessage } from '@/lib/error-message'
import { useStudioStore } from '@/lib/theme-studio/state/studio-store'
import { usePaletteActions } from '@/features/theme-studio/hooks/use-palette-actions'
import { toastError } from '@/lib/toast-error'

/** Saves the palettes the draft forked; a theme may only name palettes the library holds. */
export function useSavePaletteEdits() {
  const edits = useStudioStore((state) => state.paletteEdits)
  const generation = useStudioStore((state) => state.generation)
  const palettes = usePaletteActions()
  const { catalog } = usePalette()
  async function save() {
    // A fork an earlier Apply saved is updated; creating it again is refused.
    for (const palette of Object.values(edits)) {
      if (useStudioStore.getState().generation !== generation) return false
      const saved = catalog.some((entry) => entry.id === palette.id)
      await (saved ? palettes.update : palettes.create).mutateAsync(palette)
    }
    return true
  }
  return () =>
    save().catch((error: unknown) => {
      toastError('The colors could not be saved', {
        description: errorMessage(error, 'The palette library did not accept them.'),
      })
      return false
    })
}
