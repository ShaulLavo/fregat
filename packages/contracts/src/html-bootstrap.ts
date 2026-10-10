import * as v from 'valibot'
import { environmentIdSchema } from './chat-ids'
import type { SettingsValues } from './settings/keys'
import {
  COLOR_THEME_MODES,
  DEFAULT_COLOR_THEME,
  DEFAULT_CODE_FONT,
  DEFAULT_UI_FONT,
  DEFAULT_PALETTE_ID,
  DEFAULT_WALLPAPER_SELECTION,
  DEFAULT_WORKBENCH_DENSITY,
  WORKBENCH_DENSITIES,
  DEFAULT_WORKBENCH_FEEL,
  WORKBENCH_FEELS,
} from './settings/boot-defaults'
import { fontRefSchema } from './fonts/schema'
import { themeBundleSchema, themeCustomizationsSchema, themeMaterialSchema } from './themes/bundle'
import { wallpaperSelectionSchema } from './themes/wallpaper'
import { APP_COLOR_ROLES, TERMINAL_COLOR_ROLES, paletteIdSchema } from './themes/palette'

export const HTML_BOOTSTRAP_ID = 'fregat-html-bootstrap'
export const HTML_BOOTSTRAP_PALETTE_ID = 'platform-palette'
export const HTML_BOOTSTRAP_WALLPAPER_IDS = {
  light: 'fregat-wallpaper-light',
  dark: 'fregat-wallpaper-dark',
} as const

export const APPEARANCE_BOOT_KEYS = [
  'window.material',
  'editor.fontFamily',
  'workbench.colorTheme',
  'workbench.density',
  'workbench.feel',
  'workbench.fontFamily',
  'workbench.surface.blur',
  'workbench.surface.contentOpacity',
  'workbench.surface.opacity',
  'workbench.surface.saturation',
  'workbench.tree.indentGuides',
  'workbench.wallpaper',
  'workbench.palette',
  'editor.codeTheme.light',
  'editor.codeTheme.dark',
  'workbench.theme',
  'workbench.theme.customizations',
] as const satisfies readonly (keyof SettingsValues)[]

export type AppearanceBootKey = (typeof APPEARANCE_BOOT_KEYS)[number]
export type AppearanceBootValues = Pick<SettingsValues, AppearanceBootKey>

export const DEFAULT_APPEARANCE_BOOT_VALUES = {
  'window.material': 'none',
  'editor.fontFamily': DEFAULT_CODE_FONT,
  'workbench.colorTheme': DEFAULT_COLOR_THEME,
  'workbench.density': DEFAULT_WORKBENCH_DENSITY,
  'workbench.feel': DEFAULT_WORKBENCH_FEEL,
  'workbench.fontFamily': DEFAULT_UI_FONT,
  'workbench.surface.blur': 9,
  'workbench.surface.contentOpacity': 50,
  'workbench.surface.opacity': 80,
  'workbench.surface.saturation': 160,
  'workbench.tree.indentGuides': 'always',
  'workbench.wallpaper': DEFAULT_WALLPAPER_SELECTION,
  'workbench.palette': DEFAULT_PALETTE_ID,
  'editor.codeTheme.light': 'light-plus',
  'editor.codeTheme.dark': 'dark-plus',
  'workbench.theme': null,
  'workbench.theme.customizations': {},
} satisfies AppearanceBootValues
export const appearanceBootValuesSchema = v.object({
  'window.material': v.picklist(['none', 'frosted', 'glass']),
  'editor.fontFamily': fontRefSchema,
  'workbench.colorTheme': v.picklist(COLOR_THEME_MODES),
  'workbench.density': v.picklist(WORKBENCH_DENSITIES),
  'workbench.feel': v.picklist(WORKBENCH_FEELS),
  'workbench.fontFamily': fontRefSchema,
  'workbench.surface.blur': themeMaterialSchema.entries.blur,
  'workbench.surface.contentOpacity': themeMaterialSchema.entries.contentOpacity,
  'workbench.surface.opacity': themeMaterialSchema.entries.opacity,
  'workbench.surface.saturation': themeMaterialSchema.entries.saturation,
  'workbench.tree.indentGuides': v.picklist(['none', 'onHover', 'always']),
  'workbench.wallpaper': wallpaperSelectionSchema,
  'workbench.palette': paletteIdSchema,
  'editor.codeTheme.light': v.pipe(v.string(), v.minLength(1)),
  'editor.codeTheme.dark': v.pipe(v.string(), v.minLength(1)),
  'workbench.theme': v.nullable(themeBundleSchema),
  'workbench.theme.customizations': themeCustomizationsSchema,
})
const colorSchema = v.strictObject({
  l: v.number(),
  c: v.number(),
  h: v.number(),
  alpha: v.number(),
})
function colorsFor<const Roles extends readonly string[]>(roles: Roles) {
  return v.strictObject(
    Object.fromEntries(roles.map((role) => [role, colorSchema])) as {
      [Role in Roles[number]]: typeof colorSchema
    },
  )
}
const colorsSchema = v.strictObject({
  app: colorsFor(APP_COLOR_ROLES),
  terminal: colorsFor(TERMINAL_COLOR_ROLES),
})
const paletteSchema = v.strictObject({
  schemaVersion: v.literal(1),
  id: paletteIdSchema,
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80)),
  provenance: v.optional(
    v.strictObject({
      kind: v.picklist(['omarchy', 'upstream']),
      repository: v.string(),
      commit: v.string(),
      theme: v.string(),
    }),
  ),
  variants: v.variant('kind', [
    v.strictObject({ kind: v.literal('paired'), light: colorsSchema, dark: colorsSchema }),
    v.strictObject({
      kind: v.literal('single'),
      mode: v.picklist(['light', 'dark']),
      colors: colorsSchema,
    }),
  ]),
  source: v.picklist(['bundled', 'user', 'theme']),
})
export const htmlBootstrapUrlSchema = v.pipe(
  v.string(),
  v.check((value) => {
    const url = URL.parse(value)
    return (
      url !== null &&
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === ''
    )
  }, 'Expected an HTTP URL without credentials, query or fragment'),
)
const variantSchema = v.strictObject({
  values: appearanceBootValuesSchema,
  palette: paletteSchema,
  image: v.nullable(
    v.strictObject({
      href: htmlBootstrapUrlSchema,
      crossOrigin: v.literal('anonymous'),
    }),
  ),
})
export const htmlBootstrapSchema = v.variant('kind', [
  v.strictObject({ version: v.literal(1), kind: v.literal('pairing') }),
  v.strictObject({
    version: v.literal(1),
    kind: v.literal('app'),
    apiBase: htmlBootstrapUrlSchema,
    environmentId: environmentIdSchema,
    serverVersion: v.strictObject({
      epoch: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
      sequence: v.pipe(v.number(), v.integer(), v.minValue(0)),
    }),
    backdrop: v.picklist(['app', 'compositor', 'transparent']),
    colorMode: v.picklist(COLOR_THEME_MODES),
    variants: v.strictObject({ light: variantSchema, dark: variantSchema }),
  }),
])
export type AppearanceBootstrapVariant = v.InferOutput<typeof variantSchema>
export type HtmlBootstrap = v.InferOutput<typeof htmlBootstrapSchema>
