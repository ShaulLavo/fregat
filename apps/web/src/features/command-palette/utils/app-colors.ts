import type { Palette, PaletteId } from '@workspace/contracts'

const ITEM_PREFIX = 'app-colors:'

export function appColorItems(catalog: readonly Palette[]) {
  return catalog.map((palette) => ({
    id: palette.id,
    label: palette.name,
    value: `${ITEM_PREFIX}${palette.id}`,
  }))
}

export function paletteIdFromItemValue(value: string): PaletteId | null {
  return value.startsWith(ITEM_PREFIX) ? value.slice(ITEM_PREFIX.length) : null
}
