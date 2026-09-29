import { clamp8 } from './color'
import { MinimapCharRenderer } from './minimapCharRenderer'
import { allCharCodes, Constants } from './minimapCharSheet'

/**
 * Creates minimap character renderers by sampling a normal canvas once and
 * downsampling the glyph data for tiny minimap text rendering.
 */
export class MinimapCharRendererFactory {
  private static lastCreated?: MinimapCharRenderer
  private static lastFontFamily?: string

  public static create(scale: number, fontFamily: string): MinimapCharRenderer {
    if (
      this.lastCreated &&
      scale === this.lastCreated.scale &&
      fontFamily === this.lastFontFamily
    ) {
      return this.lastCreated
    }

    const renderer = this.createFromSampleData(this.createSampleData(fontFamily).data, scale)
    this.lastFontFamily = fontFamily
    this.lastCreated = renderer
    return renderer
  }

  public static createSampleData(fontFamily: string): ImageData {
    const canvas = createSamplingCanvas()
    const context = canvas.getContext('2d')!

    context.fillStyle = '#ffffff'
    context.font = `bold ${Constants.SAMPLED_CHAR_HEIGHT}px ${fontFamily}`
    context.textBaseline = 'middle'

    let x = 0
    for (const code of allCharCodes) {
      context.fillText(String.fromCharCode(code), x, Constants.SAMPLED_CHAR_HEIGHT / 2)
      x += Constants.SAMPLED_CHAR_WIDTH
    }

    return context.getImageData(
      0,
      0,
      Constants.CHAR_COUNT * Constants.SAMPLED_CHAR_WIDTH,
      Constants.SAMPLED_CHAR_HEIGHT,
    )
  }

  public static createFromSampleData(
    source: Uint8ClampedArray,
    scale: number,
  ): MinimapCharRenderer {
    const expectedLength =
      Constants.SAMPLED_CHAR_HEIGHT *
      Constants.SAMPLED_CHAR_WIDTH *
      Constants.RGBA_CHANNELS_CNT *
      Constants.CHAR_COUNT
    if (source.length !== expectedLength)
      throw new Error('Unexpected source in MinimapCharRenderer')

    return new MinimapCharRenderer(MinimapCharRendererFactory.downsample(source, scale), scale)
  }

  private static downsample(data: Uint8ClampedArray, scale: number): Uint8ClampedArray {
    const pixelsPerCharacter =
      Constants.BASE_CHAR_HEIGHT * scale * Constants.BASE_CHAR_WIDTH * scale
    const resultLength = pixelsPerCharacter * Constants.CHAR_COUNT
    const result = new Uint8ClampedArray(resultLength)
    let resultOffset = 0
    let sourceOffset = 0
    let brightest = 0

    for (let index = 0; index < Constants.CHAR_COUNT; index += 1) {
      brightest = Math.max(
        brightest,
        downsampleChar(data, sourceOffset, result, resultOffset, scale),
      )
      resultOffset += pixelsPerCharacter
      sourceOffset += Constants.SAMPLED_CHAR_WIDTH * Constants.RGBA_CHANNELS_CNT
    }

    boostIntensity(result, brightest)
    return result
  }
}

function createSamplingCanvas(): OffscreenCanvas {
  return new OffscreenCanvas(
    Constants.CHAR_COUNT * Constants.SAMPLED_CHAR_WIDTH,
    Constants.SAMPLED_CHAR_HEIGHT,
  )
}

function downsampleChar(
  source: Uint8ClampedArray,
  sourceOffset: number,
  dest: Uint8ClampedArray,
  destOffset: number,
  scale: number,
): number {
  const width = Constants.BASE_CHAR_WIDTH * scale
  const height = Constants.BASE_CHAR_HEIGHT * scale
  let targetIndex = destOffset
  let brightest = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const final = samplePixel(source, sourceOffset, x, y, width, height)
      brightest = Math.max(brightest, final)
      dest[targetIndex++] = clamp8(final)
    }
  }

  return brightest
}

function samplePixel(
  source: Uint8ClampedArray,
  sourceOffset: number,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  const sourceY1 = (y / height) * Constants.SAMPLED_CHAR_HEIGHT
  const sourceY2 = ((y + 1) / height) * Constants.SAMPLED_CHAR_HEIGHT
  const sourceX1 = (x / width) * Constants.SAMPLED_CHAR_WIDTH
  const sourceX2 = ((x + 1) / width) * Constants.SAMPLED_CHAR_WIDTH
  const sample = sampleSourceRect(source, sourceOffset, sourceX1, sourceX2, sourceY1, sourceY2)
  return sample.value / sample.samples
}

function sampleSourceRect(
  source: Uint8ClampedArray,
  sourceOffset: number,
  sourceX1: number,
  sourceX2: number,
  sourceY1: number,
  sourceY2: number,
): { readonly value: number; readonly samples: number } {
  let value = 0
  let samples = 0
  for (let sy = sourceY1; sy < sourceY2; sy += 1) {
    const row = sourceOffset + Math.floor(sy) * Constants.RGBA_SAMPLED_ROW_WIDTH
    const yBalance = 1 - (sy - Math.floor(sy))
    const sampled = sampleSourceRow(source, row, sourceX1, sourceX2, yBalance)
    value += sampled.value
    samples += sampled.samples
  }

  return { value, samples }
}

function sampleSourceRow(
  source: Uint8ClampedArray,
  row: number,
  sourceX1: number,
  sourceX2: number,
  yBalance: number,
): { readonly value: number; readonly samples: number } {
  let value = 0
  let samples = 0
  for (let sx = sourceX1; sx < sourceX2; sx += 1) {
    const xBalance = 1 - (sx - Math.floor(sx))
    const sourceIndex = row + Math.floor(sx) * Constants.RGBA_CHANNELS_CNT
    const weight = xBalance * yBalance
    samples += weight
    value += (((source[sourceIndex] ?? 0) * (source[sourceIndex + 3] ?? 0)) / 255) * weight
  }

  return { value, samples }
}

function boostIntensity(result: Uint8ClampedArray, brightest: number): void {
  if (brightest <= 0) return

  const adjust = 255 / brightest
  for (let index = 0; index < result.length; index += 1)
    result[index] = clamp8(result[index]! * adjust)
}
