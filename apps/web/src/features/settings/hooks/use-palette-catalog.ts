import { BUNDLED_PALETTES, type Palette } from '@workspace/contracts'

import { usePaletteLibrary } from '@/features/settings/hooks/use-palette-library'

/** Every selectable palette: the bundled ones, then the user's library. */
export function usePaletteCatalog(): readonly Palette[] {
  const library = usePaletteLibrary()
  if (library.length === 0) return BUNDLED_PALETTES

  return [...BUNDLED_PALETTES, ...library]
}
