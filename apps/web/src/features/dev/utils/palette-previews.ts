import { resolvePalette } from '@workspace/client-core/themes/palette'
import {
  BUNDLED_PALETTES,
  paletteSupportsMode,
  type ColorMode,
  type Palette,
} from '@workspace/contracts'

const MODES: readonly ColorMode[] = ['dark', 'light']

export type PalettePreview = {
  readonly key: string
  readonly name: string
  readonly mode: ColorMode
  readonly variables: Readonly<Record<string, string>>
}

/** Every bundled palette in every mode it ships, as custom properties a card can scope. */
export function bundledPalettePreviews(): readonly PalettePreview[] {
  return BUNDLED_PALETTES.flatMap((palette) =>
    MODES.filter((mode) => paletteSupportsMode(palette, mode)).map((mode) => ({
      key: `${palette.id}-${mode}`,
      name: palette.name,
      mode,
      variables: opaqueVariables(palette, mode),
    })),
  )
}

// The root derives each surface from its `-solid` input and the opacity setting;
// a card has no such formula in scope, so it takes the solid value outright.
function opaqueVariables(palette: Palette, mode: ColorMode): Record<string, string> {
  const variables = { ...resolvePalette(palette, mode).cssVariables }
  for (const [name, value] of Object.entries(variables)) {
    if (name.endsWith('-solid')) variables[name.slice(0, -'-solid'.length)] = value
  }
  return variables
}
