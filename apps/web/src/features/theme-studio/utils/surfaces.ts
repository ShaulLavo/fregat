import type { ThemeVariant } from '@workspace/contracts'

type ThemeMaterial = ThemeVariant['material']

export const MATERIAL_LIMITS = {
  opacity: 100,
  contentOpacity: 100,
  blur: 40,
  saturation: 400,
} as const

export const MATERIAL_LABELS = {
  opacity: 'Panes',
  contentOpacity: 'Content',
  blur: 'Blur',
  saturation: 'Saturation',
} as const

export const MATERIAL_UNITS = {
  opacity: '%',
  contentOpacity: '%',
  blur: 'px',
  saturation: '%',
} as const

/** Three starting points; the sliders take it from there. */
export const SURFACE_PRESETS: readonly {
  readonly label: string
  readonly material: ThemeMaterial
}[] = [
  { label: 'Solid', material: { opacity: 100, contentOpacity: 100, blur: 0, saturation: 100 } },
  { label: 'Frosted', material: { opacity: 80, contentOpacity: 50, blur: 9, saturation: 160 } },
  { label: 'Clear', material: { opacity: 55, contentOpacity: 30, blur: 4, saturation: 120 } },
]
