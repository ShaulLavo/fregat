import type { BrowserContext } from 'playwright'

export type PixelDiff = {
  readonly width: number
  readonly height: number
  /** Set when the two images differ in size; nothing else is compared then. */
  readonly sizeMismatch: string | null
  readonly mismatched: number
  readonly ratio: number
  /** A PNG: mismatched pixels red over a faded copy of the actual image. */
  readonly image: Uint8Array
}

/** A channel difference at or under this is antialiasing noise, not drift. */
const CHANNEL_TOLERANCE = 2

/**
 * Compares two PNGs pixel by pixel in a blank page of `context`, which decodes and encodes them
 * with the browser's own codecs, so the harness needs no image dependency.
 */
export async function pixelDiff(
  context: BrowserContext,
  baseline: Uint8Array,
  actual: Uint8Array,
): Promise<PixelDiff> {
  const page = await context.newPage()
  try {
    const result = await page.evaluate(comparePngs, {
      baseline: Buffer.from(baseline).toString('base64'),
      actual: Buffer.from(actual).toString('base64'),
      tolerance: CHANNEL_TOLERANCE,
    })
    return { ...result, image: Buffer.from(result.image, 'base64') }
  } finally {
    await page.close()
  }
}

async function comparePngs(input: { baseline: string; actual: string; tolerance: number }) {
  const decode = async (base64: string) => {
    const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob()
    const bitmap = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('No 2d context for the pixel diff')
    context.drawImage(bitmap, 0, 0)
    return context.getImageData(0, 0, bitmap.width, bitmap.height)
  }
  const encode = async (image: ImageData) => {
    const canvas = new OffscreenCanvas(image.width, image.height)
    canvas.getContext('2d')?.putImageData(image, 0, 0)
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
  }
  const before = await decode(input.baseline)
  const after = await decode(input.actual)
  const { width, height } = after
  if (before.width !== width || before.height !== height) {
    return {
      width,
      height,
      sizeMismatch: `${before.width}x${before.height} → ${width}x${height}`,
      mismatched: width * height,
      ratio: 1,
      image: await encode(after),
    }
  }
  const diff = new ImageData(width, height)
  let mismatched = 0
  for (let index = 0; index < after.data.length; index += 4) {
    const delta = Math.max(
      Math.abs(before.data[index]! - after.data[index]!),
      Math.abs(before.data[index + 1]! - after.data[index + 1]!),
      Math.abs(before.data[index + 2]! - after.data[index + 2]!),
      Math.abs(before.data[index + 3]! - after.data[index + 3]!),
    )
    if (delta > input.tolerance) {
      mismatched += 1
      diff.data.set([255, 0, 0, 255], index)
      continue
    }
    const grey = (after.data[index]! + after.data[index + 1]! + after.data[index + 2]!) / 3
    const faded = 255 - (255 - grey) * 0.25
    diff.data.set([faded, faded, faded, 255], index)
  }
  return {
    width,
    height,
    sizeMismatch: null,
    mismatched,
    ratio: mismatched / (width * height),
    image: await encode(diff),
  }
}
