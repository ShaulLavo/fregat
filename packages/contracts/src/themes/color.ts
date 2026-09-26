import {
  convertHslToRgb,
  parse,
  parseHex,
  parseHsl,
  parseHslLegacy,
  parseOklch,
  parseRgb,
  parseRgbLegacy,
  parseTransparent,
  useParser as registerParser,
} from 'culori/fn'

/**
 * OKLCH is the palette's canonical color. Everything the app authors is OKLCH
 * already, and it is the space where "lift every surface 3%" is one axis. Hex,
 * `rgb()` and `hsl()` exist only at the boundary: import, terminal, export.
 */
export type Oklch = Readonly<{
  l: number
  c: number
  h: number
  alpha: number
}>

export type Rgb = Readonly<{
  r: number
  g: number
  b: number
  alpha: number
}>

const LITERAL_PATTERN = /^(?:transparent|#[0-9a-f]+|(?:rgba?|hsla?|oklch)\(.*\))$/u
const GAMUT_EPSILON = 0.0001

// Culori's parser registry is process-wide, so `parseAnyColor` gates on the
// literal pattern too: another consumer may register named colors.
for (const parser of [
  parseHex,
  parseRgb,
  parseRgbLegacy,
  parseHsl,
  parseHslLegacy,
  parseOklch,
  parseTransparent,
]) {
  // @types/culori types a parser as never returning undefined, which every parser does.
  registerParser(parser as Parameters<typeof registerParser>[0])
}

/**
 * Parses hex, `rgb()`, `hsl()`, `oklch()` and `transparent` into OKLCH, clipped
 * into the sRGB gamut so the hex output is always exact. Returns null for
 * anything else: a palette field is never a keyword, a `var()` or a
 * `color-mix()`.
 */
export function parseColor(input: string): Oklch | null {
  const parsed = parseAnyColor(input.trim().toLowerCase())

  return parsed && stabilize(parsed)
}

// Culori owns the CSS syntax; the conversion below stays ours so a stored
// `oklch()` value never shifts with a library upgrade.
function parseAnyColor(value: string): Oklch | null {
  if (!LITERAL_PATTERN.test(value)) return null

  const parsed = parse(value)
  if (!parsed) return null

  const alpha = parsed.alpha ?? 1
  if (parsed.mode === 'oklch') {
    return clipToSrgb({ l: parsed.l ?? 0, c: parsed.c ?? 0, h: normalizeHue(parsed.h ?? 0), alpha })
  }

  const rgb = parsed.mode === 'hsl' ? convertHslToRgb(parsed) : parsed
  if (rgb.mode !== 'rgb') return null

  return clipToSrgb({ ...linearSrgbToOklch(decodeChannels(rgb.r, rgb.g, rgb.b)), alpha })
}

// Rounding to the precision `toCss` writes can nudge a boundary color a hair
// out of gamut, and clipping it back changes the last digit again. Iterating
// to a fixed point makes a parsed value serialize back to itself, so a saved
// palette hashes the same after reload.
function stabilize(color: Oklch): Oklch {
  let current = quantize(clipToSrgb(color))
  for (let pass = 0; pass < 4; pass += 1) {
    const next = quantize(clipToSrgb(current))
    if (sameColor(next, current)) return next
    current = next
  }

  return current
}

function quantize(color: Oklch): Oklch {
  return {
    l: round(color.l, 4),
    c: round(color.c, 4),
    h: round(color.h, 2),
    alpha: round(color.alpha, 4),
  }
}

function sameColor(a: Oklch, b: Oklch): boolean {
  return a.l === b.l && a.c === b.c && a.h === b.h && a.alpha === b.alpha
}

export function toRgb(color: Oklch): Rgb {
  const [r, g, b] = oklchToLinearSrgb(color)

  return {
    r: gammaEncode(r),
    g: gammaEncode(g),
    b: gammaEncode(b),
    alpha: color.alpha,
  }
}

/** `#rrggbb`, or `#rrggbbaa` when the color is not opaque. */
export function toHex(color: Oklch): string {
  const rgb = toRgb(color)
  const hex = [rgb.r, rgb.g, rgb.b].map(hexByte).join('')
  if (rgb.alpha >= 1) return `#${hex}`

  return `#${hex}${hexByte(rgb.alpha * 255)}`
}

/** The CSS form, exact: what the resolver writes into a custom property. */
export function toCss(color: Oklch): string {
  const channels = `${color.l} ${color.c} ${color.h}`
  if (color.alpha >= 1) return `oklch(${channels})`

  return `oklch(${channels} / ${color.alpha})`
}

/**
 * The color as painted over `background`, for outputs that cannot carry alpha.
 * Blends gamma-encoded sRGB, which is how a browser composites an alpha color
 * over a solid one.
 */
export function flatten(color: Oklch, background: Oklch): Oklch {
  if (color.alpha >= 1) return color

  const top = toRgb(color)
  const under = toRgb(background)
  const mix = (over: number, base: number) => over * color.alpha + base * (1 - color.alpha)

  return stabilize(
    rgbToOklch({
      r: mix(top.r, under.r),
      g: mix(top.g, under.g),
      b: mix(top.b, under.b),
      alpha: 1,
    }),
  )
}

/** WCAG relative luminance contrast, on the flattened sRGB values. */
export function contrastRatio(foreground: Oklch, background: Oklch): number {
  const opaqueBackground = { ...background, alpha: 1 }
  const first = relativeLuminance(flatten(foreground, opaqueBackground))
  const second = relativeLuminance(opaqueBackground)

  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

export function oklch(l: number, c: number, h: number, alpha = 1): Oklch {
  return normalizeColor({ l, c, h, alpha })
}

/** Clips a constructed value into sRGB at the stored precision, like a parse would. */
export function normalizeColor(color: Oklch): Oklch {
  return stabilize({ ...color, h: normalizeHue(color.h), c: Math.max(0, color.c) })
}

/** An 8-bit sRGB pixel as OKLCH, for code that reads images rather than CSS. */
export function oklchFromRgb(rgb: Rgb): Oklch {
  return rgbToOklch(rgb)
}

function rgbToOklch(rgb: Rgb): Oklch {
  const linear = decodeChannels(rgb.r / 255, rgb.g / 255, rgb.b / 255)

  return { ...linearSrgbToOklch(linear), alpha: rgb.alpha }
}

/** Unit-range sRGB channels; a missing (`none`) or out-of-range one is clamped. */
function decodeChannels(r = 0, g = 0, b = 0): [number, number, number] {
  return [gammaDecode(r), gammaDecode(g), gammaDecode(b)]
}

function linearSrgbToOklch([r, g, b]: readonly [number, number, number]): Omit<Oklch, 'alpha'> {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const labL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const labA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const labB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const chroma = Math.hypot(labA, labB)
  const hue = chroma < 1e-6 ? 0 : normalizeHue((Math.atan2(labB, labA) * 180) / Math.PI)

  return { l: clamp(labL, 0, 1), c: chroma, h: hue }
}

function oklchToLinearSrgb(color: Oklch): [number, number, number] {
  const radians = (color.h * Math.PI) / 180
  const labA = color.c * Math.cos(radians)
  const labB = color.c * Math.sin(radians)
  const l = (color.l + 0.3963377774 * labA + 0.2158037573 * labB) ** 3
  const m = (color.l - 0.1055613458 * labA - 0.0638541728 * labB) ** 3
  const s = (color.l - 0.0894841775 * labA - 1.291485548 * labB) ** 3

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

function inGamut(color: Oklch): boolean {
  return oklchToLinearSrgb(color).every(
    (channel) => channel >= -GAMUT_EPSILON && channel <= 1 + GAMUT_EPSILON,
  )
}

/** Reduces chroma until the color fits sRGB; lightness and hue are kept. */
function clipToSrgb(color: Oklch): Oklch {
  if (inGamut(color)) return color

  let low = 0
  let high = color.c
  while (high - low > GAMUT_EPSILON) {
    const mid = (low + high) / 2
    if (inGamut({ ...color, c: mid })) low = mid
    else high = mid
  }

  return { ...color, c: low }
}

function relativeLuminance(color: Oklch): number {
  const [r, g, b] = oklchToLinearSrgb(color).map((channel) => clamp(channel, 0, 1))

  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function gammaDecode(channel: number): number {
  const value = clamp(channel, 0, 1)

  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function gammaEncode(linear: number): number {
  const value = clamp(linear, 0, 1)
  const encoded = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055

  return Math.round(encoded * 255)
}

function hexByte(value: number): string {
  return Math.round(clamp(value, 0, 255))
    .toString(16)
    .padStart(2, '0')
}

function normalizeHue(hue: number): number {
  const wrapped = hue % 360

  return wrapped < 0 ? wrapped + 360 : wrapped
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits

  return Math.round(value * factor) / factor
}
