import { SYNTAX_THEME_MODES } from './syntax-modes'
import * as v from 'valibot'
import { paletteIdSchema } from './palette'
import { wallpaperSelectionSchema } from './wallpaper'

export const themeIdSchema = v.pipe(
  v.string(),
  v.regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  v.brand('ThemeId'),
)
const percent = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100))
export const themeMaterialSchema = v.strictObject({
  opacity: percent,
  contentOpacity: percent,
  blur: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(40)),
  saturation: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(400)),
})
export const themeVariantSchema = v.strictObject({
  palette: paletteIdSchema,
  codeTheme: v.pipe(
    v.string(),
    v.check(
      (id) =>
        Object.hasOwn(SYNTAX_THEME_MODES, id) ||
        id === 'tree-sitter-light' ||
        id === 'tree-sitter-dark',
      'Unknown syntax theme',
    ),
  ),
  wallpaper: wallpaperSelectionSchema,
  material: themeMaterialSchema,
})
export const themeVariantPatchSchema = v.partial(
  v.strictObject({
    ...themeVariantSchema.entries,
    material: v.partial(themeMaterialSchema),
  }),
)
export const themeDocumentSchema = v.strictObject({
  schemaVersion: v.literal(1),
  id: themeIdSchema,
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80)),
  variants: v.strictObject({ light: themeVariantSchema, dark: themeVariantSchema }),
})
export const themeBundleSchema = v.strictObject({
  ...themeDocumentSchema.entries,
  revision: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  source: v.picklist(['bundled', 'user']),
})
const themeCustomizationSchema = v.partial(
  v.strictObject({
    light: themeVariantPatchSchema,
    dark: themeVariantPatchSchema,
  }),
)
export const themeCustomizationsSchema = v.record(themeIdSchema, themeCustomizationSchema)
export const themeCustomizeOperationSchema = v.strictObject({
  kind: v.literal('theme.customize'),
  id: themeIdSchema,
  mode: v.picklist(['light', 'dark']),
  patch: themeVariantPatchSchema,
})
export const themeResetOperationSchema = v.strictObject({
  kind: v.literal('theme.reset'),
  id: themeIdSchema,
  // What the theme's customization becomes; absent or empty clears it.
  to: v.optional(themeCustomizationSchema),
})
export type ThemeId = v.InferOutput<typeof themeIdSchema>
export type ThemeDocument = v.InferOutput<typeof themeDocumentSchema>
export type ThemeBundle = v.InferOutput<typeof themeBundleSchema>
export type ThemeVariant = v.InferOutput<typeof themeVariantSchema>
export type ThemeVariantPatch = v.InferOutput<typeof themeVariantPatchSchema>
export type ThemeCustomization = v.InferOutput<typeof themeCustomizationSchema>
export type ThemeCustomizations = v.InferOutput<typeof themeCustomizationsSchema>
export type ThemeCustomizeOperation = v.InferOutput<typeof themeCustomizeOperationSchema>
export type ThemeResetOperation = v.InferOutput<typeof themeResetOperationSchema>

export function customizeThemeVariant(
  variant: ThemeVariant,
  patch?: ThemeVariantPatch,
): ThemeVariant {
  return { ...variant, ...patch, material: { ...variant.material, ...patch?.material } }
}
