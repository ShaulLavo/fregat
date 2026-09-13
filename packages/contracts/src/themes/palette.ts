import * as v from 'valibot'

import { parseColor, toCss, type Oklch } from './color'

/**
 * The closed set of app color roles a palette authors, per mode. Each maps to
 * the custom property of the same name in `globals.css` (`-solid` where the
 * surface formula mixes it with the material opacity). Row tints, dividers and
 * diff colors are derived from these in CSS and are not palette fields.
 */
export const APP_COLOR_ROLES = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'info',
  'info-foreground',
  'success',
  'success-foreground',
  'warning',
  'warning-foreground',
  'update',
  'update-foreground',
  'border',
  'input',
  'ring',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
] as const

export const TERMINAL_ANSI_ROLES = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'bright-black',
  'bright-red',
  'bright-green',
  'bright-yellow',
  'bright-blue',
  'bright-magenta',
  'bright-cyan',
  'bright-white',
] as const

export const TERMINAL_COLOR_ROLES = [
  'foreground',
  'cursor',
  'cursor-accent',
  'selection',
  'selection-foreground',
  ...TERMINAL_ANSI_ROLES,
] as const

export type AppColorRole = (typeof APP_COLOR_ROLES)[number]
export type TerminalColorRole = (typeof TERMINAL_COLOR_ROLES)[number]
export type ColorMode = 'light' | 'dark'

export const PALETTE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export const paletteIdSchema = v.pipe(v.string(), v.regex(PALETTE_ID_PATTERN))
export type PaletteId = v.InferOutput<typeof paletteIdSchema>

/**
 * A color field on disk and on the wire is any CSS color the parser accepts;
 * hex is what a person writes, `oklch()` is what the app writes back so a
 * bundled value survives a round trip without 8-bit quantization.
 */
export const colorFieldSchema = v.pipe(
  v.string(),
  v.transform((text) => parseColor(text)),
  v.check((color): color is Oklch => color !== null, 'not a color'),
  v.transform((color) => color as Oklch),
)

function roleRecord<const TRoles extends readonly string[]>(roles: TRoles) {
  return v.object(
    Object.fromEntries(roles.map((role) => [role, colorFieldSchema])) as {
      [Role in TRoles[number]]: typeof colorFieldSchema
    },
  )
}

export const paletteColorsSchema = v.object({
  app: roleRecord(APP_COLOR_ROLES),
  terminal: roleRecord(TERMINAL_COLOR_ROLES),
})

const paletteVariantsSchema = v.variant('kind', [
  v.object({
    kind: v.literal('paired'),
    light: paletteColorsSchema,
    dark: paletteColorsSchema,
  }),
  v.object({
    kind: v.literal('single'),
    mode: v.picklist(['light', 'dark']),
    colors: paletteColorsSchema,
  }),
])

const paletteProvenanceSchema = v.object({
  kind: v.literal('omarchy'),
  repository: v.string(),
  commit: v.string(),
  theme: v.string(),
})

/** What a palette file or request body looks like. Colors are strings. */
export const paletteDocumentSchema = v.object({
  schemaVersion: v.literal(1),
  id: paletteIdSchema,
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80)),
  variants: paletteVariantsSchema,
  provenance: v.optional(paletteProvenanceSchema),
})

export type PaletteDocument = v.InferInput<typeof paletteDocumentSchema>
export type PaletteColorsDocument = v.InferInput<typeof paletteColorsSchema>
export type PaletteColors = v.InferOutput<typeof paletteColorsSchema>
export type PaletteVariants = v.InferOutput<typeof paletteVariantsSchema>
export type PaletteProvenance = v.InferOutput<typeof paletteProvenanceSchema>

/** A parsed palette: the document with OKLCH values and its origin. */
export type Palette = v.InferOutput<typeof paletteDocumentSchema> &
  Readonly<{ source: 'bundled' | 'user' }>

export type ParsedPalette =
  | { readonly success: true; readonly palette: Palette }
  | { readonly success: false; readonly issues: [v.BaseIssue<unknown>, ...v.BaseIssue<unknown>[]] }

export function parsePalette(document: unknown, source: Palette['source']): ParsedPalette {
  const result = v.safeParse(paletteDocumentSchema, document)
  if (!result.success) return { success: false, issues: result.issues }

  return { success: true, palette: { ...result.output, source } }
}

/** The on-disk form, with every color written back as exact `oklch()`. */
export function serializePalette(palette: Palette): PaletteDocument {
  return {
    schemaVersion: 1,
    id: palette.id,
    name: palette.name,
    variants: serializeVariants(palette.variants),
    ...(palette.provenance ? { provenance: palette.provenance } : {}),
  }
}

function serializeVariants(variants: PaletteVariants): PaletteDocument['variants'] {
  if (variants.kind === 'single') {
    return { kind: 'single', mode: variants.mode, colors: serializeColors(variants.colors) }
  }

  return {
    kind: 'paired',
    light: serializeColors(variants.light),
    dark: serializeColors(variants.dark),
  }
}

function serializeColors(colors: PaletteColors): PaletteColorsDocument {
  return {
    app: mapRoles(colors.app, toCss),
    terminal: mapRoles(colors.terminal, toCss),
  }
}

function mapRoles<TRole extends string, TOut>(
  record: Readonly<Record<TRole, Oklch>>,
  map: (color: Oklch) => TOut,
): Record<TRole, TOut> {
  return Object.fromEntries(
    Object.entries<Oklch>(record).map(([role, color]) => [role, map(color)]),
  ) as Record<TRole, TOut>
}

/** The colors a palette shows in `mode`: its own variant, or the only one it has. */
export function paletteColorsFor(palette: Palette, mode: ColorMode): PaletteColors {
  if (palette.variants.kind === 'single') return palette.variants.colors

  return palette.variants[mode]
}

export function paletteSupportsMode(palette: Palette, mode: ColorMode): boolean {
  return palette.variants.kind === 'paired' || palette.variants.mode === mode
}
