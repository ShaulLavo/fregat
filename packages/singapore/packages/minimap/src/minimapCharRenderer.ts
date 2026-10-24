import { clamp8 } from './color'
import { Constants, getCharIndex } from './minimapCharSheet'
import type { RGBA8 } from './types'

export class MinimapCharRenderer {
  private readonly charDataNormal: Uint8ClampedArray
  private readonly charDataLight: Uint8ClampedArray

  public constructor(
    charData: Uint8ClampedArray,
    public readonly scale: number,
  ) {
    this.charDataNormal = MinimapCharRenderer.soften(charData, 12 / 15)
    this.charDataLight = MinimapCharRenderer.soften(charData, 50 / 60)
  }

  public renderChar(
    target: ImageData,
    dx: number,
    dy: number,
    chCode: number,
    color: RGBA8,
    foregroundAlpha: number,
    backgroundColor: RGBA8,
    backgroundAlpha: number,
    fontScale: number,
    useLighterFont: boolean,
    force1pxHeight: boolean,
  ): void {
    const charWidth = Constants.BASE_CHAR_WIDTH * this.scale
    const charHeight = Constants.BASE_CHAR_HEIGHT * this.scale
    const renderHeight = force1pxHeight ? 1 : charHeight
    if (dx + charWidth > target.width || dy + renderHeight > target.height) return

    this.renderCharData({
      target,
      dx,
      dy,
      charWidth,
      renderHeight,
      charIndex: getCharIndex(chCode, fontScale),
      color,
      foregroundAlpha,
      backgroundColor,
      backgroundAlpha,
      charData: useLighterFont ? this.charDataLight : this.charDataNormal,
    })
  }

  public blockRenderChar(
    target: ImageData,
    dx: number,
    dy: number,
    color: RGBA8,
    foregroundAlpha: number,
    backgroundColor: RGBA8,
    backgroundAlpha: number,
    force1pxHeight: boolean,
  ): void {
    const charWidth = Constants.BASE_CHAR_WIDTH * this.scale
    const charHeight = Constants.BASE_CHAR_HEIGHT * this.scale
    const renderHeight = force1pxHeight ? 1 : charHeight
    if (dx + charWidth > target.width || dy + renderHeight > target.height) return

    const foregroundRatio = 0.5 * (foregroundAlpha / 255)
    const alpha = sourceOverAlpha(backgroundAlpha / 255, foregroundRatio)
    const blended = sourceOverColor(
      backgroundColor,
      color,
      backgroundAlpha / 255,
      foregroundRatio,
      alpha,
    )
    const destWidth = target.width * Constants.RGBA_CHANNELS_CNT
    let row = dy * destWidth + dx * Constants.RGBA_CHANNELS_CNT

    for (let y = 0; y < renderHeight; y += 1) {
      writeBlockRow(target.data, row, charWidth, blended, blended.a)
      row += destWidth
    }
  }

  private renderCharData(options: RenderCharDataOptions): void {
    if (options.backgroundAlpha === 0) {
      this.renderTransparentCharData(options)
      return
    }

    const dest = options.target.data
    const destWidth = options.target.width * Constants.RGBA_CHANNELS_CNT
    let sourceOffset =
      options.charIndex * options.charWidth * Constants.BASE_CHAR_HEIGHT * this.scale
    let row = options.dy * destWidth + options.dx * Constants.RGBA_CHANNELS_CNT

    for (let y = 0; y < options.renderHeight; y += 1) {
      sourceOffset = writeCharRow(dest, row, sourceOffset, {
        charWidth: options.charWidth,
        charData: options.charData,
        foregroundAlpha: options.foregroundAlpha,
        color: options.color,
        backgroundColor: options.backgroundColor,
        backgroundAlpha: options.backgroundAlpha,
      })
      row += destWidth
    }
  }

  private renderTransparentCharData(options: RenderCharDataOptions): void {
    const dest = options.target.data
    const destWidth = options.target.width * Constants.RGBA_CHANNELS_CNT
    let sourceOffset =
      options.charIndex * options.charWidth * Constants.BASE_CHAR_HEIGHT * this.scale
    let row = options.dy * destWidth + options.dx * Constants.RGBA_CHANNELS_CNT

    for (let y = 0; y < options.renderHeight; y += 1) {
      sourceOffset = writeTransparentCharRow(dest, row, sourceOffset, {
        charWidth: options.charWidth,
        charData: options.charData,
        foregroundAlpha: options.foregroundAlpha,
        color: options.color,
      })
      row += destWidth
    }
  }

  private static soften(input: Uint8ClampedArray, ratio: number): Uint8ClampedArray {
    const result = new Uint8ClampedArray(input.length)
    for (let index = 0; index < input.length; index += 1)
      result[index] = clamp8(input[index]! * ratio)
    return result
  }
}

type RenderCharDataOptions = {
  readonly target: ImageData
  readonly dx: number
  readonly dy: number
  readonly charWidth: number
  readonly renderHeight: number
  readonly charIndex: number
  readonly color: RGBA8
  readonly foregroundAlpha: number
  readonly backgroundColor: RGBA8
  readonly backgroundAlpha: number
  readonly charData: Uint8ClampedArray
}

type WriteCharRowOptions = {
  readonly charWidth: number
  readonly charData: Uint8ClampedArray
  readonly foregroundAlpha: number
  readonly color: RGBA8
  readonly backgroundColor: RGBA8
  readonly backgroundAlpha: number
}

type WriteTransparentCharRowOptions = {
  readonly charWidth: number
  readonly charData: Uint8ClampedArray
  readonly foregroundAlpha: number
  readonly color: RGBA8
}

function writeCharRow(
  dest: Uint8ClampedArray,
  row: number,
  sourceOffset: number,
  options: WriteCharRowOptions,
): number {
  let column = row
  let source = sourceOffset
  for (let x = 0; x < options.charWidth; x += 1) {
    const c = ((options.charData[source] ?? 0) / 255) * (options.foregroundAlpha / 255)
    source += 1
    const alpha = sourceOverAlpha(options.backgroundAlpha / 255, c)
    const color = sourceOverColor(
      options.backgroundColor,
      options.color,
      options.backgroundAlpha / 255,
      c,
      alpha,
    )
    dest[column++] = color.r
    dest[column++] = color.g
    dest[column++] = color.b
    dest[column++] = clamp8(alpha * 255)
  }
  return source
}

function writeTransparentCharRow(
  dest: Uint8ClampedArray,
  row: number,
  sourceOffset: number,
  options: WriteTransparentCharRowOptions,
): number {
  let column = row
  let source = sourceOffset
  for (let x = 0; x < options.charWidth; x += 1) {
    const coverage = ((options.charData[source] ?? 0) / 255) * (options.foregroundAlpha / 255)
    source += 1
    dest[column++] = options.color.r
    dest[column++] = options.color.g
    dest[column++] = options.color.b
    dest[column++] = clamp8(coverage * 255)
  }
  return source
}

function sourceOverAlpha(backgroundAlpha: number, foregroundAlpha: number): number {
  return foregroundAlpha + backgroundAlpha * (1 - foregroundAlpha)
}

function sourceOverColor(
  background: RGBA8,
  foreground: RGBA8,
  backgroundAlpha: number,
  foregroundAlpha: number,
  alpha: number,
): RGBA8 {
  if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 }

  const backgroundRatio = (backgroundAlpha * (1 - foregroundAlpha)) / alpha
  const foregroundRatio = foregroundAlpha / alpha
  return {
    r: clamp8(background.r * backgroundRatio + foreground.r * foregroundRatio),
    g: clamp8(background.g * backgroundRatio + foreground.g * foregroundRatio),
    b: clamp8(background.b * backgroundRatio + foreground.b * foregroundRatio),
    a: clamp8(alpha * 255),
  }
}

function writeBlockRow(
  dest: Uint8ClampedArray,
  row: number,
  width: number,
  color: RGBA8,
  alpha: number,
): void {
  let column = row
  for (let x = 0; x < width; x += 1) {
    dest[column++] = color.r
    dest[column++] = color.g
    dest[column++] = color.b
    dest[column++] = alpha
  }
}
