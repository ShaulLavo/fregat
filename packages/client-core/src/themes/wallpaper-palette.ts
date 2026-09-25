import {
  contrastRatio,
  normalizeColor,
  type ColorMode,
  type Oklch,
  type PaletteColors,
  type WallpaperColors,
} from '@workspace/contracts'

import { contrastFailures, deriveFromAccent, deriveFromBackground } from './palette-editing'

type Cluster = WallpaperColors['clusters'][number]

/** Where a mode's background sits; a wallpaper color outside it is pulled in, keeping its hue. */
const BACKGROUND_LIGHTNESS: Record<ColorMode, readonly [number, number]> = {
  dark: [0.16, 0.3],
  light: [0.92, 0.985],
}
/** A background stays a quiet tint of the image, never its full saturation. */
const BACKGROUND_CHROMA = 0.03
const ACCENT_LIGHTNESS: Record<ColorMode, number> = { dark: 0.72, light: 0.55 }
const ACCENT_CHROMA: readonly [number, number] = [0.04, 0.2]
const NUDGE = 0.02

function clamp(value: number, [low, high]: readonly [number, number]) {
  return Math.min(high, Math.max(low, value))
}

function inBand(color: Oklch, mode: ColorMode) {
  return mode === 'dark' ? color.l < 0.45 : color.l > 0.7
}

/** The largest cluster already near the mode's lightness, else the largest one. */
function backgroundCluster(clusters: readonly Cluster[], mode: ColorMode): Cluster | undefined {
  return clusters.find((cluster) => inBand(cluster.color, mode)) ?? clusters[0]
}

function mostChromatic(clusters: readonly Cluster[]): Cluster | undefined {
  return clusters.reduce<Cluster | undefined>(
    (best, cluster) => (!best || cluster.color.c > best.color.c ? cluster : best),
    undefined,
  )
}

/**
 * App colors taken from a wallpaper: the background from its largest cluster near the mode's
 * lightness, the accent from its most chromatic, the rest derived as the color editor does, then
 * every text pair nudged until it reads at 4.5:1.
 */
export function paletteFromWallpaperColors(
  colors: WallpaperColors,
  mode: ColorMode,
  base: PaletteColors,
): PaletteColors {
  const ground = backgroundCluster(colors.clusters, mode)?.color
  const vivid = mostChromatic(colors.clusters)?.color
  let result = base
  if (ground) {
    result = deriveFromBackground(
      result,
      normalizeColor({
        l: clamp(ground.l, BACKGROUND_LIGHTNESS[mode]),
        c: Math.min(ground.c, BACKGROUND_CHROMA),
        h: ground.h,
        alpha: 1,
      }),
    )
  }
  if (vivid) {
    result = deriveFromAccent(
      result,
      normalizeColor({
        l: ACCENT_LIGHTNESS[mode],
        c: clamp(vivid.c, ACCENT_CHROMA),
        h: vivid.h,
        alpha: 1,
      }),
    )
  }
  return withReadableText(result)
}

/** Moves each failing text color away from its surface until the pair reads. */
function withReadableText(colors: PaletteColors): PaletteColors {
  let result = colors
  for (let pass = 0; pass < 60; pass += 1) {
    const [failure] = contrastFailures(result)
    if (!failure) return result
    const surface = result.app[failure.background]
    const text = result.app[failure.foreground]
    const direction = surface.l < 0.6 ? 1 : -1
    const nudged = normalizeColor({ ...text, l: clamp(text.l + direction * NUDGE, [0, 1]) })
    if (contrastRatio(nudged, surface) <= failure.ratio && (nudged.l === 0 || nudged.l === 1))
      return result
    result = { ...result, app: { ...result.app, [failure.foreground]: nudged } }
  }
  return result
}

function colorDistance(left: Oklch, right: Oklch) {
  const hue = Math.abs(((left.h - right.h + 540) % 360) - 180) / 180
  // Hue only counts where both colors have some; two greys match on lightness alone.
  const chroma = Math.min(1, Math.min(left.c, right.c) * 10)
  return Math.abs(left.l - right.l) + hue * chroma
}

/**
 * How far a wallpaper's colors sit from a palette's background and accent; lower matches better.
 * Each target takes its nearest cluster, weighted so a speck of the right hue counts for less.
 */
export function wallpaperMatchScore(
  colors: WallpaperColors,
  background: Oklch,
  accent: Oklch,
): number {
  if (colors.clusters.length === 0) return Number.POSITIVE_INFINITY
  const nearest = (target: Oklch) =>
    Math.min(
      ...colors.clusters.map(
        (cluster) => colorDistance(cluster.color, target) + (1 - cluster.weight) * 0.1,
      ),
    )
  return nearest(background) + nearest(accent)
}
