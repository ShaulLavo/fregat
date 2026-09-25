import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import * as v from 'valibot'
import {
  normalizeColor,
  oklchFromRgb,
  wallpaperColorsSchema,
  type AssetId,
  type WallpaperColors,
} from '@workspace/contracts'
import { displayName, type WallpaperLibrary } from './library'

/** Enough pixels to find a wallpaper's colors; more only costs time. */
const SAMPLE_WIDTH = 64
const SAMPLE_HEIGHT = 36
const CLUSTERS = 8

type Lab = readonly [number, number, number]

/**
 * The wallpaper's dominant colors, quantized once from its display rendition and cached beside it.
 * Median cut in OKLab, so a split follows how different two colors look.
 */
export async function wallpaperColors(
  library: WallpaperLibrary,
  id: AssetId,
): Promise<WallpaperColors> {
  await library.read(id)
  const directory = await library.assetDirectory(id)
  const cache = path.join(directory, `${id}.colors.json`)
  const cached = await readFile(cache, 'utf8').then(
    (text) => v.safeParse(wallpaperColorsSchema, JSON.parse(text)),
    () => null,
  )
  if (cached?.success) return cached.output
  const { data, info } = await sharp(path.join(directory, displayName(id)))
    .resize(SAMPLE_WIDTH, SAMPLE_HEIGHT, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const colors = quantize(labPixels(data, info.channels), CLUSTERS)
  await writeFile(cache, `${JSON.stringify(colors)}\n`)
  return colors
}

function labPixels(data: Uint8Array, channels: number): Lab[] {
  const pixels: Lab[] = []
  for (let offset = 0; offset + 2 < data.length; offset += channels) {
    const color = oklchFromRgb({
      r: data[offset]!,
      g: data[offset + 1]!,
      b: data[offset + 2]!,
      alpha: 1,
    })
    const radians = (color.h * Math.PI) / 180
    pixels.push([color.l, color.c * Math.cos(radians), color.c * Math.sin(radians)])
  }
  return pixels
}

/** Median cut: split the box with the widest spread at its median until there are `count` boxes. */
export function quantize(pixels: readonly Lab[], count: number): WallpaperColors {
  const boxes: Lab[][] = pixels.length === 0 ? [] : [[...pixels]]
  while (boxes.length < count) {
    const widest = widestBox(boxes)
    if (!widest) break
    const [box, axis] = widest
    box.sort((left, right) => left[axis] - right[axis])
    const half = Math.floor(box.length / 2)
    boxes.splice(boxes.indexOf(box), 1, box.slice(0, half), box.slice(half))
  }
  return {
    clusters: boxes
      .map((box) => ({ color: meanColor(box), weight: box.length / pixels.length }))
      .sort((left, right) => right.weight - left.weight),
  }
}

function widestBox(boxes: readonly Lab[][]): [Lab[], 0 | 1 | 2] | null {
  let best: [Lab[], 0 | 1 | 2] | null = null
  let bestSpread = 0
  for (const box of boxes) {
    if (box.length < 2) continue
    for (const axis of [0, 1, 2] as const) {
      const spread = range(box, axis) * box.length
      if (spread <= bestSpread) continue
      bestSpread = spread
      best = [box, axis]
    }
  }
  return best
}

function range(box: readonly Lab[], axis: 0 | 1 | 2) {
  let low = Infinity
  let high = -Infinity
  for (const pixel of box) {
    low = Math.min(low, pixel[axis])
    high = Math.max(high, pixel[axis])
  }
  return high - low
}

function meanColor(box: readonly Lab[]) {
  const sum = box.reduce<[number, number, number]>(
    (total, pixel) => [total[0] + pixel[0], total[1] + pixel[1], total[2] + pixel[2]],
    [0, 0, 0],
  )
  const [l, a, b] = sum.map((value) => value / box.length) as [number, number, number]
  return normalizeColor({ l, c: Math.hypot(a, b), h: (Math.atan2(b, a) * 180) / Math.PI, alpha: 1 })
}
