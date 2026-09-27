import type { SettingId, ThemeVariant } from '@workspace/contracts'

export type MaterialField = keyof ThemeVariant['material']

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

const SURFACE_FIELDS: Partial<Record<SettingId, MaterialField>> = {
  'workbench.surface.opacity': 'opacity',
  'workbench.surface.contentOpacity': 'contentOpacity',
  'workbench.surface.blur': 'blur',
  'workbench.surface.saturation': 'saturation',
}

/** The material field a surface setting holds, for the four surface settings. */
export function surfaceField(id: SettingId): MaterialField | undefined {
  return SURFACE_FIELDS[id]
}
