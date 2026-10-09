import { BUNDLED_PALETTES } from '@workspace/contracts'

import { usePaletteLibrary } from '@/features/settings/hooks/use-palette-library'

/** Every selectable palette: the bundled ones, then the user's library. */
export function usePaletteCatalog() {
  const library = usePaletteLibrary()
  const palettes =
    library.palettes.length === 0 ? BUNDLED_PALETTES : BUNDLED_PALETTES.concat(library.palettes)
  return { palettes, pending: library.pending }
}
