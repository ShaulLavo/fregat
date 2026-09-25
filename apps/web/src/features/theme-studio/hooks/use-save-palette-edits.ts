import { errorMessage } from '@/lib/error-message'
import { useStudioStore } from '@/lib/theme-studio/state/studio-store'
import { usePaletteActions } from '@/lib/theme-library/hooks/use-palette-actions'
import { toastError } from '@/lib/toast-error'

/** Saves the palettes the draft forked; a theme may only name palettes the library holds. */
export function useSavePaletteEdits() {
  const edits = useStudioStore((state) => state.paletteEdits)
  const palettes = usePaletteActions()
  return async () => {
    try {
      for (const palette of Object.values(edits)) await palettes.create.mutateAsync(palette)
      return true
    } catch (error) {
      toastError('The colors could not be saved', {
        description: errorMessage(error, 'The palette library did not accept them.'),
      })
      return false
    }
  }
}
