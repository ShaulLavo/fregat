import { copyFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { PNG } from 'pngjs'
import { createScriptError } from '../structured-errors'

export type Bitmap = { readonly width: number; readonly height: number; readonly data: Uint8Array }
export type Visual = {
  readonly engine: 'remark' | 'tree-sitter'
  readonly fixture: string
  readonly screenshot: string
  readonly width: number
  readonly theme: string
  readonly browser: string
}
export type Calibration = {
  readonly engine: Visual['engine']
  readonly browser: string
  readonly first: string
  readonly repeated: string
  readonly fixture: string
  readonly width: number
  readonly theme: string
}
const MAX_SELF_VARIANCE_RATIO = 0.001

export function pixelDifference(first: Bitmap, second: Bitmap) {
  if (first.width !== second.width || first.height !== second.height) {
    return {
      status: 'different-size' as const,
      changedPixels: first.width * first.height,
      ratio: 1,
    }
  }
  let changedPixels = 0
  for (let offset = 0; offset < first.data.length; offset += 4) {
    if (!samePixel(first.data, second.data, offset)) changedPixels += 1
  }
  return {
    status: 'compared' as const,
    changedPixels,
    ratio: changedPixels / (first.width * first.height),
  }
}

function samePixel(first: Uint8Array, second: Uint8Array, offset: number): boolean {
  return (
    first[offset] === second[offset] &&
    first[offset + 1] === second[offset + 1] &&
    first[offset + 2] === second[offset + 2] &&
    first[offset + 3] === second[offset + 3]
  )
}

export function nonblankPixels(image: Bitmap): number {
  const colors = new Map<number, number>()
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const color =
      ((image.data[offset] ?? 0) << 24) |
      ((image.data[offset + 1] ?? 0) << 16) |
      ((image.data[offset + 2] ?? 0) << 8) |
      (image.data[offset + 3] ?? 0)
    colors.set(color, (colors.get(color) ?? 0) + 1)
  }
  let background = 0
  for (const count of colors.values()) background = Math.max(background, count)
  return image.width * image.height - background
}

export async function inspectRasterEvidence(log: string, root: string, output: string) {
  const images = parseLines(log, 'MARKDOWN_BROWSER_VISUAL ').map(readVisual)
  const repeats = parseLines(log, 'MARKDOWN_BROWSER_CALIBRATION ').map(readCalibration)
  const directory = path.join(output, 'images')
  await mkdir(directory, { recursive: true })
  const inspected = []
  for (const image of images) {
    const bitmap = await readBitmap(image.screenshot, root)
    const contentPixels = nonblankPixels(bitmap)
    const filename = `${image.engine}-${image.browser}-${path.basename(image.screenshot)}`
    await copyFile(image.screenshot, path.join(directory, filename))
    inspected.push({
      ...image,
      screenshot: `images/${filename}`,
      bitmapWidth: bitmap.width,
      bitmapHeight: bitmap.height,
      contentPixels,
      status: contentPixels >= 8 ? 'passed' : 'failed',
    })
  }
  const calibration = []
  for (const repeat of repeats) {
    const first = await readBitmap(repeat.first, root)
    const second = await readBitmap(repeat.repeated, root)
    calibration.push({
      engine: repeat.engine,
      browser: repeat.browser,
      fixture: repeat.fixture,
      width: repeat.width,
      theme: repeat.theme,
      ...pixelDifference(first, second),
    })
  }
  const negative = negativeControls()
  return {
    engines: Array.from(new Set(images.map((image) => image.engine))),
    comparison: 'baseline-raster-controls',
    images: inspected,
    calibration,
    negativeControls: negative,
    status:
      inspected.length > 0 &&
      inspected.every((image) => image.status === 'passed') &&
      calibration.length > 0 &&
      calibration.every(
        (row) => row.status === 'compared' && row.ratio <= MAX_SELF_VARIANCE_RATIO,
      ) &&
      negative
        ? 'passed'
        : 'failed',
    candidateComparison: 'NOT VERIFIED',
    pixelTolerance:
      calibration.length > 0 ? Math.max(...calibration.map((row) => row.ratio)) : null,
    maximumSelfVarianceRatio: MAX_SELF_VARIANCE_RATIO,
  }
}

export function negativeControls(): boolean {
  const blank: Bitmap = { width: 4, height: 4, data: new Uint8Array(64).fill(255) }
  const changed = blank.data.slice()
  changed[0] = 0
  return (
    nonblankPixels(blank) === 0 &&
    nonblankPixels({ ...blank, data: changed }) === 1 &&
    pixelDifference(blank, { ...blank, data: changed }).changedPixels === 1 &&
    pixelDifference(blank, blank).changedPixels === 0
  )
}

export async function readBitmap(file: string, root: string): Promise<Bitmap> {
  const resolved = path.resolve(file)
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw invalidRaster('screenshot-path')
  return PNG.sync.read(await readFile(resolved))
}

function parseLines(log: string, marker: string): unknown[] {
  return log
    .split('\n')
    .filter((line) => line.includes(marker))
    .map((line) => JSON.parse(line.slice(line.indexOf(marker) + marker.length).trim()))
}

export function rasterRecords(log: string) {
  return {
    images: parseLines(log, 'MARKDOWN_BROWSER_VISUAL ').map(readVisual),
    calibration: parseLines(log, 'MARKDOWN_BROWSER_CALIBRATION ').map(readCalibration),
  }
}

function readVisual(value: unknown): Visual {
  if (!value || typeof value !== 'object') throw invalidRaster('visual-record')
  if (!('fixture' in value) || typeof value.fixture !== 'string') throw invalidRaster('fixture')
  if (!('screenshot' in value) || typeof value.screenshot !== 'string')
    throw invalidRaster('screenshot')
  if (!('width' in value) || typeof value.width !== 'number') throw invalidRaster('width')
  if (!('theme' in value) || typeof value.theme !== 'string') throw invalidRaster('theme')
  if (!('browser' in value) || typeof value.browser !== 'string') throw invalidRaster('browser')
  return {
    engine: readEngine(value),
    fixture: value.fixture,
    screenshot: value.screenshot,
    width: value.width,
    theme: value.theme,
    browser: value.browser,
  }
}

function readCalibration(value: unknown): Calibration {
  if (!value || typeof value !== 'object') throw invalidRaster('calibration-record')
  if (!('first' in value) || typeof value.first !== 'string') throw invalidRaster('first')
  if (!('repeated' in value) || typeof value.repeated !== 'string') throw invalidRaster('repeated')
  if (!('fixture' in value) || typeof value.fixture !== 'string') throw invalidRaster('fixture')
  if (!('width' in value) || typeof value.width !== 'number') throw invalidRaster('width')
  if (!('theme' in value) || typeof value.theme !== 'string') throw invalidRaster('theme')
  if (!('browser' in value) || typeof value.browser !== 'string') throw invalidRaster('browser')
  return {
    engine: readEngine(value),
    browser: value.browser,
    fixture: value.fixture,
    first: value.first,
    repeated: value.repeated,
    width: value.width,
    theme: value.theme,
  }
}

function readEngine(value: object): Visual['engine'] {
  if ('engine' in value && (value.engine === 'remark' || value.engine === 'tree-sitter'))
    return value.engine
  throw invalidRaster('engine')
}

function invalidRaster(field: string) {
  return createScriptError('Raster evidence is missing a required field.', { internal: { field } })
}
