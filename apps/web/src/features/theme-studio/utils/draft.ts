import {
  jsonEqual,
  themeIdSchema,
  themeVariants,
  type ThemeBundle,
  type ThemeDocument,
  type ThemeCustomizations,
  type ThemeId,
  type ThemeVariant,
  type ThemeVariantPatch,
} from '@workspace/contracts'
import * as v from 'valibot'

import type { StudioDraft } from '@/lib/theme-studio/state/studio-store'

/**
 * The id a draft previews under. A preview that reused the theme's own id would have that
 * theme's saved changes laid over the draft, hiding every edit to a field they touch.
 */
export const STUDIO_PREVIEW_ID = 'studio-draft' as ThemeId

/** The bundled theme whose colors the app wears before any theme is chosen. */
export const DEFAULT_THEME_ID = 'graphite' as ThemeId

/** The saved theme as a draft: the library theme with its saved changes applied. */
export function savedDraft(theme: ThemeBundle, customizations: ThemeCustomizations): StudioDraft {
  return { theme, variants: themeVariants(theme, customizations) }
}

export function previewBundle(draft: StudioDraft): ThemeBundle {
  return {
    ...draft.theme,
    id: STUDIO_PREVIEW_ID,
    revision: 'preview',
    source: 'user',
    variants: draft.variants,
  }
}

export function draftsEqual(left: StudioDraft | null, right: StudioDraft | null) {
  if (!left || !right) return left === right
  return left.theme.id === right.theme.id && jsonEqual(left.variants, right.variants)
}

/** The fields a half changes from the theme's own values, or null when it changes none. */
export function variantPatch(base: ThemeVariant, next: ThemeVariant): ThemeVariantPatch | null {
  const patch: { -readonly [K in keyof ThemeVariantPatch]: ThemeVariantPatch[K] } = {}
  if (next.palette !== base.palette) patch.palette = next.palette
  if (next.codeTheme !== base.codeTheme) patch.codeTheme = next.codeTheme
  if (!jsonEqual(next.wallpaper, base.wallpaper)) patch.wallpaper = next.wallpaper
  const material = Object.fromEntries(
    Object.entries(next.material).filter(
      ([key, value]) => base.material[key as keyof ThemeVariant['material']] !== value,
    ),
  )
  if (Object.keys(material).length > 0) patch.material = material
  return Object.keys(patch).length > 0 ? patch : null
}

/** A draft half with one change applied. */
export function editVariant(
  draft: StudioDraft,
  mode: 'light' | 'dark',
  patch: ThemeVariantPatch,
): StudioDraft {
  const current = draft.variants[mode]
  const next: ThemeVariant = {
    ...current,
    ...patch,
    material: { ...current.material, ...patch.material },
  }
  return { ...draft, variants: { ...draft.variants, [mode]: next } }
}

/** A new library theme with these variants; the id is fresh, so it never overwrites one. */
export function newThemeDocument(name: string, variants: StudioDraft['variants']): ThemeDocument {
  return {
    schemaVersion: 1,
    id: v.parse(themeIdSchema, `theme-${crypto.randomUUID()}`),
    name,
    variants,
  }
}
